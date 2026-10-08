import { type DraftStorage, PRESET_EMPTY, type TakeoverDraft, loadDraft, saveDraft } from '@trust/show-authoring';
import { type CampaignRepository, type OpenedCampaign, RepositoryError, type RepositoryStatus, type SaveResult } from './types';

/**
 * Modo solo local: el comportamiento ACTUAL del Builder (M2C), detrás de la
 * interfaz. Usa `saveDraft`/`loadDraft` de show-authoring tal cual, así que el
 * formato de `trust.builder.draft.v1` no cambia (decisión 6 del brief D).
 *
 * Ese storage guarda UN draft, sin campaña ni revisión: la revisión de este
 * repositorio vive en memoria (empieza en 0 al abrir) y existe solo para que
 * el contrato sea el mismo que el de la API. Un `expectedRevision` que no es
 * la revisión vigente da conflicto también acá: nunca last-write-wins.
 */
export class LocalCampaignRepository implements CampaignRepository {
  private campaignId: string | null = null;
  private revision = 0;

  constructor(
    private readonly storage: DraftStorage,
    private readonly fallback: () => TakeoverDraft = PRESET_EMPTY,
  ) {}

  async open(campaignId: string): Promise<OpenedCampaign> {
    this.campaignId = campaignId;
    this.revision = 0;
    const guardado = loadDraft(this.storage);
    return {
      campaignId, draft: guardado ?? this.fallback(), revision: 0, updatedAt: null, approvedVersion: null,
      source: 'local',
    };
  }

  async save(draft: TakeoverDraft, expectedRevision: number): Promise<SaveResult> {
    if (this.campaignId === null) throw new RepositoryError(0, 'NOT_OPEN', 'Abrí una campaña antes de guardar.');
    if (expectedRevision !== this.revision) {
      return { kind: 'conflict', conflict: { serverRevision: this.revision, clientRevision: expectedRevision, serverUpdatedAt: new Date(0).toISOString() } };
    }
    if (!saveDraft(this.storage, draft)) {
      throw new RepositoryError(0, 'LOCAL_STORAGE_UNAVAILABLE', 'El navegador no deja guardar el draft localmente.');
    }
    this.revision += 1;
    return { kind: 'saved', revision: this.revision, updatedAt: null };
  }

  status(): RepositoryStatus {
    return { connectivity: 'local-only', campaignId: this.campaignId, revision: this.campaignId === null ? null : this.revision, pending: false, conflict: null };
  }
}
