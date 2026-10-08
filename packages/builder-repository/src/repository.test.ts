import { DRAFT_STORAGE_KEY, MemoryDraftStorage, PRESET_EMPTY, PRESET_TAKEOVER_15S, type TakeoverDraft, loadDraft } from '@trust/show-authoring';
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
