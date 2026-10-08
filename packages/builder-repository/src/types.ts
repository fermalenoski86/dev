import type { TakeoverDraft } from '@trust/show-authoring';

/**
 * Contrato del repositorio de campañas del Builder — M3A.1 Fase D2 (master §31).
 *
 * El Builder (D3, pendiente de #15) habla SOLO con esta interfaz: ningún
 * componente React llama a `fetch()` (§31). Hay tres implementaciones:
 *
 *   · LocalCampaignRepository   — el comportamiento actual, solo localStorage;
 *   · ApiCampaignRepository     — la API de D1 (`GET/PUT /campaigns/:id/draft`);
 *   · SyncingCampaignRepository — guarda local siempre y sincroniza con la API
 *                                  cuando hay conexión (§9).
 */

/** Lo que devuelve la API en el 409 `DRAFT_CONFLICT` (master §9). */
export interface DraftConflict {
  serverRevision: number;
  clientRevision: number;
  serverUpdatedAt: string;
}

/** Última versión APROBADA de la campaña (§32: "APPROVED VERSION vN"). */
export interface ApprovedVersionRef {
  id: string;
  versionNumber: number;
  versionHash: string;
}

export interface OpenedCampaign {
  campaignId: string;
  /** El draft de trabajo (§32: "WORKING DRAFT"). */
  draft: TakeoverDraft;
  /** Revisión del servidor sobre la que se edita (0 en modo solo local). */
  revision: number;
  updatedAt: string | null;
  approvedVersion: ApprovedVersionRef | null;
  /** De dónde salió el draft que se muestra. */
  source: 'server' | 'local';
}

export type SaveResult =
  /** Confirmado por el servidor (o por el storage, en modo solo local). */
  | { kind: 'saved'; revision: number; updatedAt: string | null }
  /** Guardado local; queda pendiente de sincronizar (sin conexión). */
  | { kind: 'pending'; revision: number }
  /** El servidor cambió: NO se lo pisó (§9). Se resuelve con las operaciones de §9. */
  | { kind: 'conflict'; conflict: DraftConflict };

export type Connectivity = 'local-only' | 'online' | 'offline';

export interface RepositoryStatus {
  connectivity: Connectivity;
  campaignId: string | null;
  /** Revisión base para el próximo `save` (`expectedRevision`). */
  revision: number | null;
  /** Hay cambios locales sin confirmar en el servidor. */
  pending: boolean;
  conflict: DraftConflict | null;
}

export interface CampaignRepository {
  open(campaignId: string): Promise<OpenedCampaign>;
  save(draft: TakeoverDraft, expectedRevision: number): Promise<SaveResult>;
  status(): RepositoryStatus;
}

/** Error de la API o del storage que el Builder tiene que mostrar (no es "sin conexión"). */
export class RepositoryError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/** No hubo respuesta del backend (red caída, o 502/503/504 de un proxy). */
export class OfflineError extends Error {
  constructor(message = 'Sin conexión con el backend.') {
    super(message);
    this.name = 'OfflineError';
  }
}
