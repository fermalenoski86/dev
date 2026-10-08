import { DRAFT_STORAGE_KEY, MemoryDraftStorage, PRESET_EMPTY, PRESET_TAKEOVER_15S, type TakeoverDraft, loadDraft, saveDraft } from '@trust/show-authoring';
import { describe, expect, it } from 'vitest';
import { ApiCampaignRepository, LocalCampaignRepository, OfflineError, RepositoryError, SyncingCampaignRepository, mismoDraft, syncKey } from './index';

/**
 * D2 — unitarios con storage en memoria y un doble de la API de D1 con la
 * misma semántica (revisión monotónica, 409 DRAFT_CONFLICT sin escribir).
 * Los tests contra la API real (Fastify + PostgreSQL) están en
 * apps/platform-api/src/builder-repository.db.test.ts.
 */
const CID = '11111111-1111-4111-8111-111111111111';
const CSRF = 'csrf-ok';

function draft(nombre: string): TakeoverDraft {
  return { ...PRESET_EMPTY(), name: nombre };
}

/** Doble de la API de D1. */
function apiFalsa() {
  const s = {
    online: true,
    /** El PUT se confirma pero la respuesta se pierde (red cortada después del commit). */
    perderRespuesta: false,
    status: 0 as number,
    revision: 1,
    updatedAt: '2026-10-08T10:00:00.000Z',
    draft: draft('servidor') as unknown,
    approved: null as null | { id: string; versionNumber: number; versionHash: string },
    puts: 0,
    csrfVisto: [] as Array<string | null>,
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (!s.online) throw new TypeError('fetch failed');
    if (s.status) return new Response('', { status: s.status });
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const h = new Headers(init?.headers);
    if (url.pathname === `/api/v1/campaigns/${CID}` && method === 'GET') {
      return json(200, { id: CID, latestApprovedVersion: s.approved });
    }
    if (url.pathname === `/api/v1/campaigns/${CID}/draft` && method === 'GET') {
      return json(200, { campaignId: CID, draftId: CID, revision: s.revision, updatedAt: s.updatedAt, takeoverDraft: s.draft });
    }
    if (url.pathname === `/api/v1/campaigns/${CID}/draft` && method === 'PUT') {
      s.csrfVisto.push(h.get('x-csrf-token'));
      if (h.get('x-csrf-token') !== CSRF) return json(403, { code: 'CSRF_TOKEN_INVALID', message: 'csrf', requestId: 'r' });
      const body = JSON.parse(String(init?.body)) as { takeoverDraft: unknown; expectedRevision: number };
      if (body.expectedRevision !== s.revision) {
        return json(409, { code: 'DRAFT_CONFLICT', message: 'conflicto', details: { serverRevision: s.revision, clientRevision: body.expectedRevision, serverUpdatedAt: s.updatedAt }, requestId: 'r' });
      }
      s.puts += 1;
      s.revision += 1;
      s.updatedAt = new Date(Date.parse(s.updatedAt) + 1000).toISOString();
      // JSONB reordena claves: el doble también, para no depender del orden.
      s.draft = Object.fromEntries(Object.entries(body.takeoverDraft as Record<string, unknown>).reverse());
      if (s.perderRespuesta) throw new TypeError('socket hang up');
      return json(200, { campaignId: CID, draftId: CID, revision: s.revision, updatedAt: s.updatedAt, takeoverDraft: s.draft });
    }
    return json(404, { code: 'NOT_FOUND', message: 'no', requestId: 'r' });
  };
  /** Otro cliente escribe directo en el servidor. */
  const otroCliente = (nombre: string) => { s.revision += 1; s.draft = draft(nombre); };
  return { s, fetch, otroCliente };
}

const api = (fetch: typeof globalThis.fetch, csrf: string | null = CSRF) =>
  new ApiCampaignRepository({ baseUrl: 'http://api.test/', fetch, csrfToken: () => csrf });

describe('D2 · LocalCampaignRepository — comportamiento actual detrás de la interfaz', () => {
  it('sin nada guardado abre el preset vacío; guarda con saveDraft en trust.builder.draft.v1 (formato sin cambios)', async () => {
    const st = new MemoryDraftStorage();
    const r = new LocalCampaignRepository(st);
    const o = await r.open(CID);
    expect(o).toMatchObject({ revision: 0, source: 'local', approvedVersion: null });
    const d = PRESET_TAKEOVER_15S();
    expect(await r.save(d, 0)).toEqual({ kind: 'saved', revision: 1, updatedAt: null });
    expect(st.getItem(DRAFT_STORAGE_KEY)).toBe(JSON.stringify(d));
    expect(loadDraft(st)).toEqual(d);
    expect((await new LocalCampaignRepository(st).open(CID)).draft).toEqual(d);
  });

  it('expectedRevision vieja → conflicto, no escribe (nunca last-write-wins); sin open → NOT_OPEN', async () => {
    const st = new MemoryDraftStorage();
    const r = new LocalCampaignRepository(st);
    await expect(r.save(draft('x'), 0)).rejects.toMatchObject({ code: 'NOT_OPEN' });
    await r.open(CID);
    await r.save(draft('a'), 0);
    const c = await r.save(draft('b'), 0);
    expect(c).toMatchObject({ kind: 'conflict', conflict: { serverRevision: 1, clientRevision: 0 } });
    expect(loadDraft(st)?.name).toBe('a');
    expect(r.status()).toEqual({ connectivity: 'local-only', campaignId: CID, revision: 1, pending: false, conflict: null });
  });

  it('storage bloqueado → LOCAL_STORAGE_UNAVAILABLE (no finge haber guardado)', async () => {
    const st = new MemoryDraftStorage();
    st.setItem = () => { throw new Error('QuotaExceededError'); };
    const r = new LocalCampaignRepository(st);
    await r.open(CID);
    await expect(r.save(draft('a'), 0)).rejects.toMatchObject({ code: 'LOCAL_STORAGE_UNAVAILABLE' });
  });
});

describe('D2 · ApiCampaignRepository — fetch inyectado, CSRF, contrato de D1', () => {
  it('open trae draft + revisión + última aprobada; save manda expectedRevision y el CSRF', async () => {
    const f = apiFalsa();
    f.s.approved = { id: CID, versionNumber: 3, versionHash: 'a'.repeat(64) };
    const r = api(f.fetch);
    const o = await r.open(CID);
    expect(o).toMatchObject({ campaignId: CID, revision: 1, source: 'server', approvedVersion: { versionNumber: 3 } });
    expect(o.draft.name).toBe('servidor');
    expect(await r.save(draft('nuevo'), 1)).toMatchObject({ kind: 'saved', revision: 2 });
    expect(f.s.csrfVisto).toEqual([CSRF]);
    expect(r.status()).toMatchObject({ connectivity: 'online', revision: 2 });
  });

  it('409 DRAFT_CONFLICT → resultado con las tres propiedades de §9; el servidor no cambia', async () => {
    const f = apiFalsa();
    const r = api(f.fetch);
    await r.open(CID);
    f.otroCliente('otro');
    const c = await r.save(draft('mío'), 1);
    expect(c).toEqual({ kind: 'conflict', conflict: { serverRevision: 2, clientRevision: 1, serverUpdatedAt: f.s.updatedAt } });
    expect((f.s.draft as TakeoverDraft).name).toBe('otro');
  });

  it('otros errores son RepositoryError con el code de la API; sin red o 503 → OfflineError', async () => {
    const f = apiFalsa();
    const sinCsrf = api(f.fetch, null);
    await sinCsrf.open(CID);
    await expect(sinCsrf.save(draft('x'), 1)).rejects.toMatchObject({ httpStatus: 403, code: 'CSRF_TOKEN_INVALID' });
    f.s.online = false;
    await expect(api(f.fetch).open(CID)).rejects.toBeInstanceOf(OfflineError);
    f.s.online = true;
    f.s.status = 503;
    const r = api(f.fetch);
    await expect(r.open(CID)).rejects.toBeInstanceOf(OfflineError);
    expect(r.status().connectivity).toBe('offline');
  });

  it('respuesta con otro formato o draft inválido → error explícito, no un draft roto', async () => {
    const f = apiFalsa();
    f.s.draft = { schemaVersion: 999 };
    await expect(api(f.fetch).open(CID)).rejects.toMatchObject({ code: 'DRAFT_INVALID' });
    const raro: typeof fetch = async () => new Response(JSON.stringify({ hola: 1 }), { status: 200 });
    await expect(api(raro).open(CID)).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe('D2 · SyncingCampaignRepository — offline, sync y conflicto (§9)', () => {
  const armar = () => {
    const f = apiFalsa();
    const st = new MemoryDraftStorage();
    return { f, st, repo: new SyncingCampaignRepository({ storage: st, api: api(f.fetch) }) };
  };

  it('online: open del servidor, save confirma y deja la copia local al día (draft en la clave de siempre)', async () => {
    const { f, st, repo } = armar();
    expect((await repo.open(CID)).source).toBe('server');
    expect(await repo.save(draft('v2'), 1)).toMatchObject({ kind: 'saved', revision: 2 });
    expect(repo.status()).toMatchObject({ connectivity: 'online', revision: 2, pending: false, conflict: null });
    expect(loadDraft(st)?.name).toBe('v2');
    expect(JSON.parse(st.getItem(syncKey(CID))!)).toMatchObject({ v: 1, campaignId: CID, baseRevision: 2, pending: false });
    expect(f.s.revision).toBe(2);
  });

  it('offline: guarda local y queda pending; al volver, sync sube con expectedRevision', async () => {
    const { f, st, repo } = armar();
    await repo.open(CID);
    f.s.online = false;
    expect(await repo.save(draft('offline-1'), 1)).toEqual({ kind: 'pending', revision: 1 });
    expect(await repo.save(draft('offline-2'), 1)).toEqual({ kind: 'pending', revision: 1 });
    expect(repo.status()).toMatchObject({ connectivity: 'offline', pending: true });
    expect(loadDraft(st)?.name).toBe('offline-2');
    expect(f.s.puts).toBe(0);
    f.s.online = true;
    expect(await repo.sync()).toMatchObject({ kind: 'saved', revision: 2 });
    expect((f.s.draft as TakeoverDraft).name).toBe('offline-2');
    expect(repo.status()).toMatchObject({ connectivity: 'online', pending: false });
    expect(await repo.sync()).toBeNull();
  });

  it('offline → otro cliente escribe → online: CONFLICTO, el servidor NO se pisa y los saves siguientes no suben', async () => {
    const { f, st, repo } = armar();
    await repo.open(CID);
    f.s.online = false;
    await repo.save(draft('local'), 1);
    f.s.online = true;
    f.otroCliente('remoto');
    const c = await repo.sync();
    expect(c).toEqual({ kind: 'conflict', conflict: { serverRevision: 2, clientRevision: 1, serverUpdatedAt: f.s.updatedAt } });
    expect((f.s.draft as TakeoverDraft).name).toBe('remoto');
    expect(await repo.save(draft('local-2'), 1)).toMatchObject({ kind: 'conflict' });
    expect(f.s.puts).toBe(0);
    expect((f.s.draft as TakeoverDraft).name).toBe('remoto');
    expect(loadDraft(st)?.name).toBe('local-2'); // lo local tampoco se pierde
    expect(repo.status()).toMatchObject({ pending: true, conflict: { serverRevision: 2 } });
  });

  it('§9 recuperar server: descarta lo local y adopta la revisión del servidor', async () => {
    const { f, st, repo } = armar();
    await repo.open(CID);
    f.otroCliente('remoto');
    await repo.save(draft('local'), 1);
    const o = await repo.recoverServer();
    expect(o).toMatchObject({ revision: 2, source: 'server' });
    expect(o.draft.name).toBe('remoto');
    expect(loadDraft(st)?.name).toBe('remoto');
    expect(repo.status()).toMatchObject({ pending: false, conflict: null, revision: 2 });
  });

  it('§9 mantener local: sube sobre la revisión que mostró el conflicto; si el servidor volvió a cambiar, otro conflicto', async () => {
    const { f, repo } = armar();
    await repo.open(CID);
    f.otroCliente('remoto');
    await repo.save(draft('local'), 1);
    f.otroCliente('remoto-2'); // el servidor sigue moviéndose
    expect(await repo.keepLocal()).toMatchObject({ kind: 'conflict', conflict: { serverRevision: 3, clientRevision: 2 } });
    expect((f.s.draft as TakeoverDraft).name).toBe('remoto-2');
    expect(await repo.keepLocal()).toMatchObject({ kind: 'saved', revision: 4 });
    expect((f.s.draft as TakeoverDraft).name).toBe('local');
    await expect(repo.keepLocal()).rejects.toMatchObject({ code: 'NO_CONFLICT' });
  });

  it('§9 duplicar como nuevo draft: devuelve una copia de lo local, vuelve al servidor y NO escribe remoto', async () => {
    const { f, repo } = armar();
    await repo.open(CID);
    f.otroCliente('remoto');
    await repo.save(draft('local'), 1);
    const { draft: copia, server } = await repo.duplicateAsNew();
    expect(copia.name).toBe('local');
    expect(server.draft.name).toBe('remoto');
    expect(f.s.puts).toBe(0);
    expect(repo.status()).toMatchObject({ pending: false, conflict: null, revision: 2 });
  });

  it('reabrir con trabajo pendiente: se conserva lo local y se sincroniza; sin backend abre lo local', async () => {
    const { f, st, repo } = armar();
    await repo.open(CID);
    f.s.online = false;
    await repo.save(draft('pendiente'), 1);
    const sinRed = new SyncingCampaignRepository({ storage: st, api: api(f.fetch) });
    expect(await sinRed.open(CID)).toMatchObject({ source: 'local', revision: 1 });
    expect(sinRed.status()).toMatchObject({ connectivity: 'offline', pending: true });
    f.s.online = true;
    const otra = new SyncingCampaignRepository({ storage: st, api: api(f.fetch) });
    const o = await otra.open(CID);
    expect(o.draft.name).toBe('pendiente');
    expect(otra.status()).toMatchObject({ pending: false, revision: 2 });
    expect((f.s.draft as TakeoverDraft).name).toBe('pendiente');
    // sin backend y sin nada local: no hay qué abrir
    f.s.online = false;
    await expect(new SyncingCampaignRepository({ storage: new MemoryDraftStorage(), api: api(f.fetch) }).open(CID)).rejects.toBeInstanceOf(OfflineError);
  });

  it('PUT confirmado sin respuesta: el reintento da 409 pero el servidor tiene ESTE draft → saved, no conflicto', async () => {
    const { f, repo } = armar();
    await repo.open(CID);
    f.s.perderRespuesta = true;
    expect(await repo.save(draft('una-vez'), 1)).toEqual({ kind: 'pending', revision: 1 });
    f.s.perderRespuesta = false;
    expect(await repo.sync()).toMatchObject({ kind: 'saved', revision: 2 });
    expect(f.s.puts).toBe(1);
    expect(repo.status()).toMatchObject({ pending: false, conflict: null });
  });

  /** Storage que, con `roto = true`, rechaza SOLO la clave del draft (cuota/bloqueo) y deja pasar la de sync. */
  const conDraftRoto = () => {
    const f = apiFalsa();
    const st = new MemoryDraftStorage();
    const ctl = { roto: false };
    const storage = {
      getItem: (k: string) => st.getItem(k),
      setItem: (k: string, v: string) => {
        if (ctl.roto && k === DRAFT_STORAGE_KEY) throw new Error('QuotaExceededError');
        st.setItem(k, v);
      },
      removeItem: (k: string) => st.removeItem(k),
    };
    return { f, st, ctl, repo: new SyncingCampaignRepository({ storage, api: api(f.fetch) }) };
  };

  it('AUDIT D2 P1: si el draft no se guarda local → LOCAL_STORAGE_UNAVAILABLE, CERO PUT y nada queda pendiente', async () => {
    const { f, st, ctl, repo } = conDraftRoto();
    await repo.open(CID);
    const metaAntes = st.getItem(syncKey(CID));
    ctl.roto = true;
    await expect(repo.save(draft('no-guardado'), 1)).rejects.toMatchObject({ code: 'LOCAL_STORAGE_UNAVAILABLE' });
    expect(f.s.csrfVisto).toHaveLength(0); // ningún PUT intentado (ni siquiera uno que diera 409)
    expect(f.s.puts).toBe(0);
    expect((f.s.draft as TakeoverDraft).name).toBe('servidor');
    expect(loadDraft(st)?.name).toBe('servidor');
    expect(st.getItem(syncKey(CID))).toBe(metaAntes); // la metadata tampoco se tocó
    expect(repo.status()).toMatchObject({ pending: false, revision: 1, conflict: null });
    expect(await repo.sync()).toBeNull(); // nada pendiente: un sync posterior tampoco lo sube
    expect(f.s.csrfVisto).toHaveLength(0);
  });

  it('AUDIT D2 P1: sin red tampoco queda pendiente un draft que no se guardó; al volver, sync no sube nada', async () => {
    const { f, ctl, repo } = conDraftRoto();
    await repo.open(CID);
    f.s.online = false;
    ctl.roto = true;
    await expect(repo.save(draft('no-guardado'), 1)).rejects.toMatchObject({ code: 'LOCAL_STORAGE_UNAVAILABLE' });
    f.s.online = true;
    expect(await repo.sync()).toBeNull();
    expect(f.s.csrfVisto).toHaveLength(0);
    ctl.roto = false;
    expect(await repo.save(draft('ahora sí'), 1)).toMatchObject({ kind: 'saved', revision: 2 });
  });

  it('AUDIT D2 P1: mantener local con el storage roto no sube nada y el conflicto sigue abierto', async () => {
    const { f, ctl, repo } = conDraftRoto();
    await repo.open(CID);
    f.otroCliente('remoto');
    expect(await repo.save(draft('local'), 1)).toMatchObject({ kind: 'conflict' });
    const intentos = f.s.csrfVisto.length;
    ctl.roto = true;
    await expect(repo.keepLocal()).rejects.toMatchObject({ code: 'LOCAL_STORAGE_UNAVAILABLE' });
    expect(f.s.csrfVisto).toHaveLength(intentos);
    expect((f.s.draft as TakeoverDraft).name).toBe('remoto');
    expect(repo.status()).toMatchObject({ conflict: { serverRevision: 2 }, revision: 1 });
  });

  /**
   * Storage con fallas por clave para la re-auditoría 2: `sync` rechaza la clave
   * de sync; `syncDespuesDe` deja pasar N escrituras de sync y después rechaza
   * (falla la RESTAURACIÓN); `draft` rechaza la clave M2C.
   */
  const conFallas = () => {
    const f = apiFalsa();
    const st = new MemoryDraftStorage();
    const ctl = { draft: false, sync: false, syncDespuesDe: Number.POSITIVE_INFINITY, removeRoto: false };
    const storage = {
      getItem: (k: string) => st.getItem(k),
      setItem: (k: string, v: string) => {
        if (k === DRAFT_STORAGE_KEY && ctl.draft) throw new Error('QuotaExceededError');
        if (k.startsWith('trust.builder.sync.v1:')) {
          if (ctl.sync || ctl.syncDespuesDe <= 0) throw new Error('QuotaExceededError');
          ctl.syncDespuesDe -= 1;
        }
        st.setItem(k, v);
      },
      removeItem: (k: string) => { if (ctl.removeRoto) throw new Error('SecurityError'); st.removeItem(k); },
    };
    const nuevo = () => new SyncingCampaignRepository({ storage, api: api(f.fetch) });
    return { f, st, ctl, repo: nuevo(), nuevo };
  };

  it('AUDIT D2 re-auditoría 2: falla SOLO la clave de sync → no queda en M2C un draft que el registro no tenga; reabrir no pierde nada', async () => {
    const { f, st, ctl, repo, nuevo } = conFallas();
    await repo.open(CID);
    const metaAntes = st.getItem(syncKey(CID));
    ctl.sync = true;
    await expect(repo.save(draft('nuevo'), 1)).rejects.toMatchObject({ code: 'LOCAL_STORAGE_UNAVAILABLE' });
    expect(f.s.csrfVisto).toHaveLength(0);
    // el registro se escribe PRIMERO: si falla, la clave M2C no se toca
    expect(loadDraft(st)?.name).toBe('servidor');
    expect(st.getItem(syncKey(CID))).toBe(metaAntes);
    expect(repo.status()).toMatchObject({ pending: false, revision: 1 });
    // reinicio del Builder: el repositorio nuevo ve exactamente lo que hay en disco
    ctl.sync = false;
    const otro = nuevo();
    expect((await otro.open(CID)).draft.name).toBe('servidor');
    expect(loadDraft(st)?.name).toBe('servidor');
    expect(f.s.csrfVisto).toHaveLength(0);
  });

  it('AUDIT D2 re-auditoría 2: falla el espejo M2C Y la restauración del registro → el registro conserva el draft nuevo pendiente y el próximo open lo recupera y lo sube', async () => {
    const { f, st, ctl, repo, nuevo } = conFallas();
    await repo.open(CID);
    ctl.draft = true;
    ctl.syncDespuesDe = 1; // pasa la escritura del registro nuevo, falla la restauración
    await expect(repo.save(draft('recuperable'), 1)).rejects.toMatchObject({ code: 'LOCAL_STORAGE_UNAVAILABLE' });
    expect(f.s.csrfVisto).toHaveLength(0); // nada se sube en esta llamada
    expect(JSON.parse(st.getItem(syncKey(CID))!)).toMatchObject({ baseRevision: 1, pending: true, draft: { name: 'recuperable' } });
    // reinicio con el storage sano: el trabajo está en el registro y no se descarta
    ctl.draft = false;
    ctl.syncDespuesDe = Number.POSITIVE_INFINITY;
    const otro = nuevo();
    const o = await otro.open(CID);
    expect(o.draft.name).toBe('recuperable');
    expect((f.s.draft as TakeoverDraft).name).toBe('recuperable');
    expect(otro.status()).toMatchObject({ pending: false, revision: 2 });
    expect(loadDraft(st)?.name).toBe('recuperable');
  });

  it('AUDIT D2 re-auditoría 2: falla el espejo M2C de un registro NUEVO y no se puede borrar → igual recuperable al reabrir', async () => {
    const { f, st, ctl, nuevo } = conFallas();
    const repo = nuevo();
    // primera vez para esta campaña: no hay registro previo, la restauración es un removeItem
    st.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft('servidor')));
    await repo.open(CID);
    st.removeItem(syncKey(CID));
    ctl.draft = true;
    ctl.removeRoto = true;
    await expect(repo.save(draft('primera'), 1)).rejects.toMatchObject({ code: 'LOCAL_STORAGE_UNAVAILABLE' });
    ctl.draft = false;
    ctl.removeRoto = false;
    expect((await nuevo().open(CID)).draft.name).toBe('primera');
    expect((f.s.draft as TakeoverDraft).name).toBe('primera');
  });

  it('AUDIT D2 re-auditoría 2: al adoptar el servidor NO se pisa una clave M2C escrita por otro (Builder sin repositorio)', async () => {
    const { f, st, repo, nuevo } = conFallas();
    await repo.open(CID);
    saveDraft(st, draft('escrito por el Builder actual'));
    f.otroCliente('remoto');
    const otro = nuevo();
    expect((await otro.open(CID)).draft.name).toBe('remoto');
    expect(loadDraft(st)?.name).toBe('escrito por el Builder actual'); // se conserva, no se pierde en silencio
    // una edición propia del repositorio sí actualiza el espejo
    expect(await otro.save(draft('mío'), 2)).toMatchObject({ kind: 'saved', revision: 3 });
    expect(loadDraft(st)?.name).toBe('mío');
  });

  it('metadata de sync corrupta o de otra campaña se ignora (Zod al leer)', async () => {
    const { st, repo } = armar();
    st.setItem(syncKey(CID), JSON.stringify({ v: 1, campaignId: 'otra', baseRevision: 1, pending: true, draft: draft('de otra campaña') }));
    expect((await repo.open(CID)).source).toBe('server');
    st.setItem(syncKey(CID), 'no-json');
    expect((await repo.open(CID)).source).toBe('server');
  });

  it('mismoDraft ignora el orden de claves pero no los valores', () => {
    expect(mismoDraft({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(mismoDraft({ a: 1 }, { a: 2 })).toBe(false);
    expect(mismoDraft([1, 2], [2, 1])).toBe(false);
  });
});
