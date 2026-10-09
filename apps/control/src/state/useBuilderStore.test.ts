import { CampaignSession, type OpenedCampaign, RepositoryError, type ResolvableRepository, type SaveResult } from '@trust/builder-repository';
import { PRESET_EMPTY, type TakeoverDraft } from '@trust/show-authoring';
import { beforeEach, describe, expect, it } from 'vitest';
import { useBuilderStore } from './useBuilderStore';

/**
 * D3 (#15, opción 1) — el store del Builder con el `CampaignRepository`
 * inyectado. Sin campaña, el camino de M2C no cambia; con campaña, el autosave
 * pasa por la sesión (expectedRevision, pending, conflicto §9) y el estado
 * "limpio" solo se marca cuando lo guardado es lo que está en pantalla.
 */
const CID = '33333333-3333-4333-8333-333333333333';
const d = (name: string): TakeoverDraft => ({ ...PRESET_EMPTY(), name });
const tick = () => new Promise((r) => setTimeout(r, 0));

function repo(opts: { abrir?: 'ok' | 'falla' } = {}) {
  const s = {
    revision: 4,
    conflict: null as null | { serverRevision: number; clientRevision: number; serverUpdatedAt: string },
    saves: [] as Array<{ name: string; rev: number }>,
    esperas: [] as Array<() => void>,
    proximo: null as null | ((rev: number) => SaveResult),
    servidor: d('del-servidor'),
  };
  const abierta = (): OpenedCampaign => ({ campaignId: CID, draft: s.servidor, revision: s.revision, updatedAt: 't', approvedVersion: { id: 'v', versionNumber: 2, versionHash: 'abc' }, source: 'server' });
  const r: ResolvableRepository = {
    async open() {
      if (opts.abrir === 'falla') throw new RepositoryError(403, 'CAMPAIGN_FORBIDDEN', 'Sin acceso a la campaña.');
      return abierta();
    },
    async save(draft, rev) {
      s.saves.push({ name: draft.name, rev });
      await new Promise<void>((ok) => s.esperas.push(ok));
      const res = s.proximo ? s.proximo(rev) : ({ kind: 'saved', revision: rev + 1, updatedAt: 'u' } as SaveResult);
      if (res.kind === 'saved') s.revision = res.revision;
      if (res.kind === 'conflict') s.conflict = res.conflict;
      return res;
    },
    async sync() {
      return null;
    },
    async recoverServer() {
      s.conflict = null;
      s.revision = 9;
      s.servidor = d('servidor-9');
      return abierta();
    },
    async keepLocal() {
      s.conflict = null;
      s.revision = 10;
      return { kind: 'saved', revision: 10, updatedAt: 'u' };
    },
    async duplicateAsNew() {
      s.conflict = null;
      s.revision = 9;
      s.servidor = d('servidor-9');
      return { draft: d('copia'), server: abierta() };
    },
    status: () => ({ connectivity: 'online', revision: s.revision, pending: false, conflict: s.conflict }),
  };
  const liberar = async () => {
    while (s.esperas.length === 0) await tick();
    s.esperas.shift()?.();
    await tick();
    await tick();
  };
  return { s, r, liberar };
}

beforeEach(() => {
  useBuilderStore.setState({ campaign: null, campaignSession: null, dirty: false });
  useBuilderStore.getState().setDraft(d('inicial'), { markDirty: false });
});

describe('D3 · store del Builder', () => {
  it('sin campaña: el guardado de M2C no cambia (localStorage) y no hay indicador', () => {
    const st = useBuilderStore.getState();
    st.patchMeta({ name: 'solo-local' });
    expect(useBuilderStore.getState().dirty).toBe(true);
    st.save();
    expect(useBuilderStore.getState()).toMatchObject({ dirty: false, campaign: null, campaignSession: null });
    useBuilderStore.getState().setDraft(d('otro'), { markDirty: false });
    expect(useBuilderStore.getState().loadFromStorage()).toBe(true);
    expect(useBuilderStore.getState().draft.name).toBe('solo-local');
  });

  it('abre la campaña del backend: adopta su draft limpio y expone APPROVED VERSION / WORKING DRAFT', async () => {
    const { r } = repo();
    expect(await useBuilderStore.getState().openCampaign(new CampaignSession(r), CID)).toBe(true);
    const st = useBuilderStore.getState();
    expect(st.draft.name).toBe('del-servidor');
    expect(st.dirty).toBe(false);
    expect(st.campaign).toMatchObject({ campaignId: CID, revision: 4, approvedVersion: { versionNumber: 2 }, phase: 'idle' });
  });

  it('autosave con expectedRevision del repositorio; limpio recién al confirmar', async () => {
    const { s, r, liberar } = repo();
    await useBuilderStore.getState().openCampaign(new CampaignSession(r), CID);
    useBuilderStore.getState().patchMeta({ name: 'editado' });
    useBuilderStore.getState().save();
    await tick();
    expect(useBuilderStore.getState().dirty).toBe(true); // en vuelo: todavía no está confirmado
    expect(useBuilderStore.getState().campaign?.phase).toBe('saving');
    await liberar();
    expect(s.saves).toEqual([{ name: 'editado', rev: 4 }]);
    expect(useBuilderStore.getState()).toMatchObject({ dirty: false, campaign: { phase: 'saved', revision: 5 } });
  });

  it('si se edita mientras se guarda, el draft sigue sucio (no se marca limpio lo que no se subió)', async () => {
    const { s, r, liberar } = repo();
    await useBuilderStore.getState().openCampaign(new CampaignSession(r), CID);
    useBuilderStore.getState().patchMeta({ name: 'v1' });
    useBuilderStore.getState().save();
    await tick();
    useBuilderStore.getState().patchMeta({ name: 'v2' });
    await liberar();
    expect(useBuilderStore.getState().dirty).toBe(true);
    useBuilderStore.getState().save();
    await liberar();
    expect(s.saves.map((x) => [x.name, x.rev])).toEqual([['v1', 4], ['v2', 5]]);
    expect(useBuilderStore.getState().dirty).toBe(false);
  });

  it('conflicto: queda visible y sucio (reemplazarlo pide confirmación); recuperar servidor lo resuelve', async () => {
    const { s, r, liberar } = repo();
    await useBuilderStore.getState().openCampaign(new CampaignSession(r), CID);
    s.proximo = (rev) => ({ kind: 'conflict', conflict: { serverRevision: 8, clientRevision: rev, serverUpdatedAt: 't8' } });
    useBuilderStore.getState().patchMeta({ name: 'mio' });
    useBuilderStore.getState().save();
    await liberar();
    expect(useBuilderStore.getState().campaign).toMatchObject({ phase: 'conflict', conflict: { serverRevision: 8, clientRevision: 4 } });
    expect(useBuilderStore.getState().dirty).toBe(true);
    expect(useBuilderStore.getState().needsDiscardConfirmation()).toBe(true);
    await useBuilderStore.getState().resolveConflict('server');
    expect(useBuilderStore.getState()).toMatchObject({ dirty: false, draft: { name: 'servidor-9' }, campaign: { phase: 'saved', revision: 9, conflict: null } });
  });

  it('conflicto: mantener la mía la sube y duplicar deja la copia para exportar', async () => {
    {
      const { s, r, liberar } = repo();
      await useBuilderStore.getState().openCampaign(new CampaignSession(r), CID);
      s.proximo = (rev) => ({ kind: 'conflict', conflict: { serverRevision: 8, clientRevision: rev, serverUpdatedAt: 't8' } });
      useBuilderStore.getState().patchMeta({ name: 'mia' });
      useBuilderStore.getState().save();
      await liberar();
      await useBuilderStore.getState().resolveConflict('local');
      expect(useBuilderStore.getState()).toMatchObject({ dirty: false, draft: { name: 'mia' }, campaign: { phase: 'saved', revision: 10 } });
    }
    {
      const { s, r, liberar } = repo();
      await useBuilderStore.getState().openCampaign(new CampaignSession(r), CID);
      s.proximo = (rev) => ({ kind: 'conflict', conflict: { serverRevision: 8, clientRevision: rev, serverUpdatedAt: 't8' } });
      useBuilderStore.getState().patchMeta({ name: 'mia' });
      useBuilderStore.getState().save();
      await liberar();
      await useBuilderStore.getState().resolveConflict('duplicate');
      expect(useBuilderStore.getState()).toMatchObject({ dirty: false, draft: { name: 'servidor-9' }, campaign: { localCopy: { name: 'copia' } } });
    }
  });

  it('si la campaña no abre: error visible y el autosave queda local (M2C), nunca a una campaña no abierta', async () => {
    const { s, r } = repo({ abrir: 'falla' });
    expect(await useBuilderStore.getState().openCampaign(new CampaignSession(r), CID)).toBe(false);
    expect(useBuilderStore.getState()).toMatchObject({ campaignSession: null, campaign: { phase: 'error', error: { code: 'CAMPAIGN_FORBIDDEN' } } });
    useBuilderStore.getState().patchMeta({ name: 'local' });
    useBuilderStore.getState().save();
    expect(useBuilderStore.getState().dirty).toBe(false);
    expect(s.saves).toEqual([]);
  });
});
