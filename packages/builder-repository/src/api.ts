import { type TakeoverDraft, safeParseTakeoverDraft } from '@trust/show-authoring';
import { z } from 'zod';
import {
  type CampaignRepository,
  type Connectivity,
  type DraftConflict,
  OfflineError,
  type OpenedCampaign,
  RepositoryError,
  type RepositoryStatus,
  type SaveResult,
} from './types';

/**
 * Repositorio contra la API de D1. `fetch` es INYECTADO (§31: nada de
 * `fetch()` adentro de componentes): en el navegador se pasa `window.fetch`;
 * en tests, un fetch que apunta a la API real o a un doble.
 *
 * Sesión de C1: la cookie la manda el navegador (`credentials: 'include'`) y
 * el token CSRF va en `x-csrf-token` en cada escritura. Ninguno de los dos se
 * guarda acá: `csrfToken()` y `headers()` se leen en cada request.
 *
 * Las respuestas se validan con Zod: un backend distinto del esperado es un
 * error explícito (`INVALID_RESPONSE`), no un draft roto en el editor.
 */
export interface ApiRepositoryOptions {
  baseUrl: string;
  fetch: typeof fetch;
  csrfToken: () => string | null;
  /** Headers extra por request (p. ej. la cookie fuera del navegador). */
  headers?: () => Record<string, string>;
}

const Iso = z.string().min(1);
const Rev = z.number().int().nonnegative();
const DraftBody = z.object({ campaignId: z.string().min(1), revision: Rev, updatedAt: Iso, takeoverDraft: z.unknown() });
const CampaignBody = z.object({
  id: z.string().min(1),
  latestApprovedVersion: z.object({ id: z.string().min(1), versionNumber: z.number().int().positive(), versionHash: z.string().min(1) }).nullable(),
});
const ErrorBody = z.object({ code: z.string().min(1), message: z.string(), details: z.record(z.string(), z.unknown()).optional() });
const ConflictDetails = z.object({ serverRevision: Rev, clientRevision: z.number().int(), serverUpdatedAt: Iso });

/** Sin respuesta útil del backend: red caída o un proxy que no llega a la API. */
const SIN_BACKEND = new Set([502, 503, 504]);

export class ApiCampaignRepository implements CampaignRepository {
  private campaignId: string | null = null;
  private revision: number | null = null;
  private connectivity: Connectivity = 'online';

  constructor(private readonly opts: ApiRepositoryOptions) {}

  async open(campaignId: string): Promise<OpenedCampaign> {
    const [campania, draft] = await Promise.all([this.fetchCampaign(campaignId), this.fetchDraft(campaignId)]);
    this.campaignId = campaignId;
    this.revision = draft.revision;
    return { ...draft, approvedVersion: campania.latestApprovedVersion, source: 'server' };
  }

  /** Lee el draft del servidor sin cambiar la campaña abierta. */
  async fetchDraft(campaignId: string): Promise<Omit<OpenedCampaign, 'approvedVersion' | 'source'>> {
    const body = DraftBody.safeParse(await this.json('GET', `/api/v1/campaigns/${encodeURIComponent(campaignId)}/draft`));
    if (!body.success) throw new RepositoryError(0, 'INVALID_RESPONSE', 'La API devolvió un draft con otro formato.');
    const d = safeParseTakeoverDraft(body.data.takeoverDraft);
    if (!d.success) throw new RepositoryError(0, 'DRAFT_INVALID', 'El draft del servidor no es un TakeoverDraft válido.');
    return { campaignId: body.data.campaignId, draft: d.data, revision: body.data.revision, updatedAt: body.data.updatedAt };
  }

  async save(draft: TakeoverDraft, expectedRevision: number): Promise<SaveResult> {
    if (this.campaignId === null) throw new RepositoryError(0, 'NOT_OPEN', 'Abrí una campaña antes de guardar.');
    return this.put(this.campaignId, draft, expectedRevision);
  }

  /** PUT con `expectedRevision`. El 409 `DRAFT_CONFLICT` es un resultado, no una excepción. */
  async put(campaignId: string, draft: TakeoverDraft, expectedRevision: number): Promise<SaveResult> {
    const res = await this.request('PUT', `/api/v1/campaigns/${encodeURIComponent(campaignId)}/draft`, { takeoverDraft: draft, expectedRevision });
    if (res.status === 409) {
      const err = ErrorBody.safeParse(await leer(res));
      if (err.success && err.data.code === 'DRAFT_CONFLICT') {
        const c = ConflictDetails.safeParse(err.data.details);
        if (!c.success) throw new RepositoryError(409, 'INVALID_RESPONSE', 'El 409 no trae serverRevision/clientRevision/serverUpdatedAt.');
        const conflict: DraftConflict = c.data;
        return { kind: 'conflict', conflict };
      }
      throw aError(409, err.success ? err.data : null);
    }
    const body = DraftBody.safeParse(await this.ok(res));
    if (!body.success) throw new RepositoryError(0, 'INVALID_RESPONSE', 'La API devolvió un draft con otro formato.');
    if (campaignId === this.campaignId) this.revision = body.data.revision;
    return { kind: 'saved', revision: body.data.revision, updatedAt: body.data.updatedAt };
  }

  status(): RepositoryStatus {
    return { connectivity: this.connectivity, campaignId: this.campaignId, revision: this.revision, pending: false, conflict: null };
  }

  /* ── internos ─────────────────────────────────────────────────────── */

  private async fetchCampaign(campaignId: string) {
    const body = CampaignBody.safeParse(await this.json('GET', `/api/v1/campaigns/${encodeURIComponent(campaignId)}`));
    if (!body.success) throw new RepositoryError(0, 'INVALID_RESPONSE', 'La API devolvió una campaña con otro formato.');
    return body.data;
  }

  private async json(method: 'GET', path: string): Promise<unknown> {
    return this.ok(await this.request(method, path));
  }

  private async ok(res: Response): Promise<unknown> {
    const body = await leer(res);
    if (!res.ok) {
      const err = ErrorBody.safeParse(body);
      throw aError(res.status, err.success ? err.data : null);
    }
    return body;
  }

  private async request(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', ...(this.opts.headers?.() ?? {}) };
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      const csrf = this.opts.csrfToken();
      if (csrf) headers['x-csrf-token'] = csrf;
    }
    let res: Response;
    try {
      res = await this.opts.fetch(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, {
        method, headers, credentials: 'include', ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      this.connectivity = 'offline';
      throw new OfflineError();
    }
    if (SIN_BACKEND.has(res.status)) {
      this.connectivity = 'offline';
      throw new OfflineError(`El backend no respondió (${res.status}).`);
    }
    this.connectivity = 'online';
    return res;
  }
}

async function leer(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function aError(status: number, e: z.infer<typeof ErrorBody> | null): RepositoryError {
  return e ? new RepositoryError(status, e.code, e.message, e.details) : new RepositoryError(status, 'HTTP_ERROR', `La API respondió ${status}.`);
}
