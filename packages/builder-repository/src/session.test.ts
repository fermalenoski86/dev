import { DRAFT_STORAGE_KEY, MemoryDraftStorage, PRESET_EMPTY, type TakeoverDraft } from '@trust/show-authoring';
import { describe, expect, it } from 'vitest';
import {
  CampaignSession,
  type DraftConflict,
  OfflineError,
  type OpenedCampaign,
  RepositoryError,
  type ResolvableRepository,
  type SaveResult,
  campaignIdFromSearch,
  connectBuilderBackend,
  syncKey,
} from './index';

/**
 * D3 — `CampaignSession`: la capa que usa el store del Builder. Unitarios con
 * un repositorio doble (para controlar el orden de los guardados) y, para la
 * composición del navegador, con el repositorio REAL de D2 sobre un fetch doble.
 * Contra la API real (Fastify + PostgreSQL): apps/platform-api/src/builder-d3.db.test.ts.
 */
const CID = '22222222-2222-4222-8222-222222222222';
const d = (name: string): TakeoverDraft => ({ ...PRESET_EMPTY(), name });

/** Repositorio doble: cada save queda en espera hasta que el test lo libera. */
function repoDoble() {
  const s = {
    revision: 1 as number | null,
    pending: false,
    conflict: null as DraftConflict | null,
    connectivity: 'online' as 'online' | 'offline' | 'local-only',
    llamadas: [] as Array<{ op: string; name?: string; rev?: number }>,
    enVuelo: 0,
    maxEnVuelo: 0,
    esperas: [] as Array<() => void>,
    proximo: null as null | ((draft: TakeoverDraft, rev: number) => SaveResult),
    falla: null as Error | null,
    approved: { id: 'v', versionNumber: 3, versionHash: 'h' } as OpenedCampaign['approvedVersion'],
  };
  const abierta = (draft: TakeoverDraft): OpenedCampaign => ({ campaignId: CID, draft, revision: s.revision ?? 0, updatedAt: '2026-10-09T00:00:00.000Z', approvedVersion: s.approved, source: 'server' });
  const repo: ResolvableRepository = {
    async open() {
      s.llamadas.push({ op: 'open' });
      return abierta(d('servidor'));
    },
    async save(draft, rev) {
      s.llamadas.push({ op: 'save', name: draft.name, rev });
      s.enVuelo += 1;
      s.maxEnVuelo = Math.max(s.maxEnVuelo, s.enVuelo);
      await new Promise<void>((r) => s.esperas.push(r));
      s.enVuelo -= 1;
      if (s.falla) throw s.falla;
      const r = s.proximo ? s.proximo(draft, rev) : ({ kind: 'saved', revision: rev + 1, updatedAt: 'u' } as SaveResult);
      if (r.kind === 'saved') s.revision = r.revision;
      if (r.kind === 'conflict') s.conflict = r.conflict;
      if (r.kind === 'pending') s.pending = true;
      return r;
    },
    async sync() {
      s.llamadas.push({ op: 'sync' });
      if (!s.pending) return null;
      s.pending = false;
      s.revision = (s.revision ?? 0) + 1;
      return { kind: 'saved', revision: s.revision, updatedAt: 'u2' };
    },
    async recoverServer() {
      s.llamadas.push({ op: 'recover' });
      s.conflict = null;
      s.revision = 7;
      return abierta(d('servidor-7'));
    },
    async keepLocal() {
      s.llamadas.push({ op: 'keep' });
      const base = s.conflict?.serverRevision ?? 0;
      s.conflict = null;
      s.revision = base + 1;
      return { kind: 'saved', revision: base + 1, updatedAt: 'u3' };
    },
    async duplicateAsNew() {
      s.llamadas.push({ op: 'dup' });
      s.conflict = null;
      s.revision = 7;
      return { draft: d('copia-local'), server: abierta(d('servidor-7')) };
    },
    status: () => ({ connectivity: s.connectivity, revision: s.revision, pending: s.pending, conflict: s.conflict }),
  };
  const liberar = async () => {
    while (s.esperas.length === 0) await new Promise((r) => setTimeout(r, 0));
    s.esperas.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { s, repo, liberar };
}

describe('D3 · CampaignSession', () => {
  it('open expone APPROVED VERSION y la revisión del WORKING DRAFT (§32)', async () => {
    const { repo } = repoDoble();
    const ses = new CampaignSession(repo);
    const vistas: string[] = [];
    ses.subscribe((v) => vistas.push(v?.phase ?? 'null'));
    const o = await ses.open(CID);
    expect(o.draft.name).toBe('servidor');
    expect(ses.view()).toMatchObject({ campaignId: CID, phase: 'idle', revision: 1, approvedVersion: { versionNumber: 3 } });
    expect(vistas).toEqual(['opening', 'idle']);
  });

  it('el expectedRevision sale del repositorio, no del llamador', async () => {
    const { s, repo, liberar } = repoDoble();
    const ses = new CampaignSession(repo);
    await ses.open(CID);
    s.revision = 41;
    const p = ses.save(d('a'));
    await liberar();
    expect(await p).toEqual({ kind: 'saved', revision: 42, updatedAt: 'u' });
    expect(s.llamadas.at(-1)).toEqual({ op: 'save', name: 'a', rev: 41 });
    expect(ses.view()).toMatchObject({ phase: 'saved', revision: 42 });
  });

  it('nunca dos guardados en paralelo; los del medio se descartan y se sube SOLO el último', async () => {
    const { s, repo, liberar } = repoDoble();
    const ses = new CampaignSession(repo);
    await ses.open(CID);
    const p1 = ses.save(d('uno'));
    await new Promise((r) => setTimeout(r, 0));
    const p2 = ses.save(d('dos'));
    const p3 = ses.save(d('tres'));
    expect(ses.view()?.phase).toBe('saving');
    await liberar(); // uno
    await liberar(); // tres (dos nunca se sube)
    const rs = await Promise.all([p1, p2, p3]);
    expect(s.llamadas.filter((l) => l.op === 'save').map((l) => [l.name, l.rev])).toEqual([['uno', 1], ['tres', 2]]);
    expect(s.maxEnVuelo).toBe(1);
    expect(rs[1]).toEqual(rs[2]); // el que se saltó recibe el resultado del que lo incluyó
    expect(ses.view()).toMatchObject({ phase: 'saved', revision: 3 });
  });

  it('sin conexión queda pending y sync() lo sube', async () => {
    const { s, repo, liberar } = repoDoble();
    const ses = new CampaignSession(repo);
    await ses.open(CID);
    s.proximo = (_dr, rev) => ({ kind: 'pending', revision: rev });
    s.connectivity = 'offline';
    const p = ses.save(d('offline'));
    await liberar();
    await p;
    expect(ses.view()).toMatchObject({ phase: 'pending', connectivity: 'offline', revision: 1 });
    s.connectivity = 'online';
    expect(await ses.sync()).toMatchObject({ kind: 'saved', revision: 2 });
    expect(ses.view()).toMatchObject({ phase: 'saved', revision: 2 });
  });

  it('un 409 queda como conflicto visible con las revisiones (§9) y nada se pisa', async () => {
    const { s, repo, liberar } = repoDoble();
    const ses = new CampaignSession(repo);
    await ses.open(CID);
    const conflict = { serverRevision: 5, clientRevision: 1, serverUpdatedAt: '2026-10-09T01:00:00.000Z' };
    s.proximo = () => ({ kind: 'conflict', conflict });
    const p = ses.save(d('mio'));
    await liberar();
    expect(await p).toEqual({ kind: 'conflict', conflict });
    expect(ses.view()).toMatchObject({ phase: 'conflict', conflict, revision: 1 });
  });

  it('las tres salidas de §9: recuperar server, mantener local, duplicar', async () => {
    const conflict = { serverRevision: 5, clientRevision: 1, serverUpdatedAt: 'x' };
    {
      const { s, repo } = repoDoble();
      const ses = new CampaignSession(repo);
      await ses.open(CID);
      s.conflict = conflict;
      expect((await ses.recoverServer()).name).toBe('servidor-7');
      expect(ses.view()).toMatchObject({ phase: 'saved', revision: 7, conflict: null });
    }
    {
      const { s, repo } = repoDoble();
      const ses = new CampaignSession(repo);
      await ses.open(CID);
      s.conflict = conflict;
      expect(await ses.keepLocal()).toMatchObject({ kind: 'saved', revision: 6 });
      expect(ses.view()).toMatchObject({ phase: 'saved', revision: 6, conflict: null });
    }
    {
      const { s, repo } = repoDoble();
      const ses = new CampaignSession(repo);
      await ses.open(CID);
      s.conflict = conflict;
      expect((await ses.duplicateAsNew()).name).toBe('servidor-7');
      expect(ses.view()).toMatchObject({ phase: 'saved', revision: 7, localCopy: { name: 'copia-local' } });
    }
  });

  it('un error del backend se muestra; con conflicto abierto, sigue el conflicto', async () => {
    const { s, repo, liberar } = repoDoble();
    const ses = new CampaignSession(repo);
    await ses.open(CID);
    s.falla = new RepositoryError(403, 'FORBIDDEN', 'sin permiso');
    const p = expect(ses.save(d('x'))).rejects.toThrow('sin permiso');
    await liberar();
    await p;
    expect(ses.view()).toMatchObject({ phase: 'error', error: { code: 'FORBIDDEN' } });
    s.conflict = { serverRevision: 2, clientRevision: 1, serverUpdatedAt: 'x' };
    const p2 = expect(ses.save(d('y'))).rejects.toThrow();
    await liberar();
    await p2;
    expect(ses.view()?.phase).toBe('conflict');
  });

  it('save antes de abrir es un error explícito', async () => {
    const { repo } = repoDoble();
    await expect(new CampaignSession(repo).save(d('x'))).rejects.toThrow(/Abrí una campaña/);
  });
});

describe('D3 · composición del navegador', () => {
  it('campaignIdFromSearch solo acepta un uuid en ?campaign=', () => {
    expect(campaignIdFromSearch(`?campaign=${CID}`)).toBe(CID);
    expect(campaignIdFromSearch(`?campaign=${CID.toUpperCase()}`)).toBe(CID);
    expect(campaignIdFromSearch('')).toBeNull();
    expect(campaignIdFromSearch('?campaign=../../etc')).toBeNull();
    expect(campaignIdFromSearch('?campaign=')).toBeNull();
  });

  function backend(opts: { me?: number; csrf?: string | null } = {}) {
    const s = { revision: 1, draft: d('servidor') as unknown, csrfVisto: [] as Array<string | null> };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const f: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/v1/auth/me') {
        if (opts.me) return json(opts.me, { code: 'UNAUTHENTICATED', message: 'no', requestId: 'r' });
        return json(200, { user: { id: 'u' }, roles: ['OPERATOR'], externalContractIds: [], csrfToken: opts.csrf === undefined ? 'tok' : opts.csrf, expiresAt: null });
      }
      if (url.pathname === `/api/v1/campaigns/${CID}`) return json(200, { id: CID, latestApprovedVersion: { id: 'v1', versionNumber: 2, versionHash: 'hh' } });
      if (url.pathname === `/api/v1/campaigns/${CID}/draft` && method === 'GET') return json(200, { campaignId: CID, draftId: CID, revision: s.revision, updatedAt: 't', takeoverDraft: s.draft });
      if (url.pathname === `/api/v1/campaigns/${CID}/draft` && method === 'PUT') {
        s.csrfVisto.push(new Headers(init?.headers).get('x-csrf-token'));
        const b = JSON.parse(String(init?.body)) as { takeoverDraft: unknown; expectedRevision: number };
        if (b.expectedRevision !== s.revision) return json(409, { code: 'DRAFT_CONFLICT', message: 'c', details: { serverRevision: s.revision, clientRevision: b.expectedRevision, serverUpdatedAt: 't' }, requestId: 'r' });
        s.revision += 1;
        s.draft = b.takeoverDraft;
        return json(200, { campaignId: CID, draftId: CID, revision: s.revision, updatedAt: 't2', takeoverDraft: s.draft });
      }
      return json(404, { code: 'NOT_FOUND', message: 'no', requestId: 'r' });
    };
    return { s, f };
  }

  it('lee el CSRF de /auth/me y compone el repositorio de D2 (registro de sync + espejo M2C)', async () => {
    const { s, f } = backend();
    const storage = new MemoryDraftStorage();
    const ses = await connectBuilderBackend({ baseUrl: 'http://api.local/', fetch: f, storage });
    await ses.open(CID);
    expect(ses.view()).toMatchObject({ revision: 1, approvedVersion: { versionNumber: 2 } });
    expect(await ses.save(d('editado'))).toMatchObject({ kind: 'saved', revision: 2 });
    expect(s.csrfVisto).toEqual(['tok']);
    expect(JSON.parse(storage.getItem(syncKey(CID)) ?? '{}')).toMatchObject({ baseRevision: 2, pending: false, draft: { name: 'editado' } });
    expect(storage.getItem(DRAFT_STORAGE_KEY)).toContain('editado');
    // otro escritor avanza el servidor → conflicto visible, el servidor no se pisa
    s.revision = 9;
    expect(await ses.save(d('mio'))).toMatchObject({ kind: 'conflict', conflict: { serverRevision: 9, clientRevision: 2 } });
    expect(ses.view()?.phase).toBe('conflict');
    expect(s.revision).toBe(9);
  });

  it('sin sesión → UNAUTHENTICATED; sin backend → OfflineError', async () => {
    await expect(connectBuilderBackend({ baseUrl: 'http://api.local', fetch: backend({ me: 401 }).f, storage: new MemoryDraftStorage() })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(connectBuilderBackend({ baseUrl: 'http://api.local', fetch: backend({ me: 503 }).f, storage: new MemoryDraftStorage() })).rejects.toBeInstanceOf(OfflineError);
    const caido: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(connectBuilderBackend({ baseUrl: '', fetch: caido, storage: new MemoryDraftStorage() })).rejects.toBeInstanceOf(OfflineError);
  });
});
