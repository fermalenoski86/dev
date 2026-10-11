import { z } from 'zod';

/**
 * Cliente HTTP de platform-web — M3A.1 E3a (ADR-063).
 *
 * - Va **directo** a `platform-api` (`baseUrl` absoluta = NEXT_PUBLIC_TRUST_API_URL):
 *   la cookie de sesión es host-only del host de la API.
 * - Siempre `credentials: 'include'` (sin eso el navegador no manda ni guarda
 *   la cookie en una llamada cross-origin).
 * - Toda mutación con sesión lleva `X-CSRF-Token`, que vive solo en memoria
 *   (nunca en localStorage). Si todavía no hay token, se pide a `/auth/me`.
 * - `fetch` inyectado: los componentes no llaman a `fetch()` (§31, como D3).
 * - Las respuestas se validan con Zod: la UI no muestra lo que no entiende.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const ROLES = ['OPERATOR', 'INTERNAL_APPROVER', 'ADMIN', 'EXTERNAL_APPROVER'] as const;
export type Role = (typeof ROLES)[number];

const Uuid = z.string().uuid();
const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const MeSchema = z.object({
  user: z.object({ id: Uuid, name: z.string(), email: z.string(), organization: z.string() }),
  roles: z.array(z.enum(ROLES)),
  externalContractIds: z.array(Uuid),
  csrfToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type Me = z.infer<typeof MeSchema>;

export const ContractSchema = z.object({
  id: Uuid, advertiserId: Uuid, name: z.string(), status: z.string(), startsAt: z.string(), endsAt: z.string(),
});
export type Contract = z.infer<typeof ContractSchema>;

export const CampaignSchema = z.object({
  id: Uuid, contractId: Uuid, name: z.string(), lifecycleStatus: z.enum(['ACTIVE', 'ARCHIVED']),
  currentDraft: z.object({ id: Uuid, revision: z.number().int().positive(), updatedAt: z.string() }).nullable(),
  latestApprovedVersion: z.object({ id: Uuid, versionNumber: z.number().int().positive(), versionHash: Sha }).nullable(),
  createdAt: z.string(), updatedAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const DraftSchema = z.object({
  campaignId: Uuid, draftId: Uuid, revision: z.number().int().positive(), updatedAt: z.string(),
  takeoverDraft: z.record(z.string(), z.unknown()),
});
export type Draft = z.infer<typeof DraftSchema>;

export const AssetSchema = z.object({
  id: Uuid,
  status: z.enum(['UPLOADING', 'VALIDATING', 'READY', 'REJECTED']),
  surfaceType: z.string(),
  originalFilename: z.string(),
  sha256: Sha.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(),
  codec: z.string().nullable(),
  durationMs: z.number().int().positive().nullable(),
  rejection: z.object({ code: z.string(), message: z.string(), remediation: z.object({ summary: z.string() }).passthrough() }).passthrough().nullable(),
}).passthrough();
export type Asset = z.infer<typeof AssetSchema>;

export const EvidenceSchema = z.object({
  id: Uuid, showVersionId: Uuid, type: z.enum(['EMAIL', 'PDF', 'MESSAGE', 'OTHER']), originalFilename: z.string(),
  mimeType: z.string(), sizeBytes: z.number().int().positive(), sha256: Sha, uploadedBy: Uuid, uploadedAt: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ShowVersionSchema = z.object({
  id: Uuid, campaignId: Uuid, contractId: Uuid, versionNumber: z.number().int().positive(), versionHash: Sha,
  sourceDraftRevision: z.number().int().positive(), submittedBy: Uuid, submittedAt: z.string(),
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']), fourEyesRequired: z.boolean(),
  approval: z.object({
    id: Uuid, decision: z.enum(['APPROVED', 'REJECTED']), actorUserId: Uuid, evidenceId: Uuid.nullable(),
    reason: z.string().nullable(), versionHash: Sha, createdAt: z.string(),
  }).nullable(),
  evidence: z.array(EvidenceSchema),
  assets: z.array(z.object({ logicalRef: z.string(), assetId: Uuid, sha256: Sha })),
}).passthrough();
export type ShowVersion = z.infer<typeof ShowVersionSchema>;

/** BL-31: resumen de una versión en el historial de su campaña (sin paquete, evidencia ni actores). */
export const VersionSummarySchema = z.object({
  id: Uuid, versionNumber: z.number().int().positive(), versionHash: Sha, status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']),
  sourceDraftRevision: z.number().int().positive(), submittedAt: z.string(),
});
export type VersionSummary = z.infer<typeof VersionSummarySchema>;
export interface VersionPage { items: VersionSummary[]; nextCursor: string | null }

export const EVIDENCE_TYPES = ['PDF', 'EMAIL', 'MESSAGE'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const pagina = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: Uuid.nullable() });

const ErrorBodySchema = z.object({ code: z.string(), message: z.string(), requestId: z.string().optional(), details: z.record(z.string(), z.unknown()).optional() }).passthrough();

/** Error de la API, tal como lo devuelve el servidor (la regla vive allá). */
export class PlatformApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

export interface PlatformClientOptions {
  /** Base absoluta de la API, p. ej. `https://api.trust.example`. */
  baseUrl: string;
  fetch: FetchLike;
  /** Idempotency-Key por operación (uploads, submit, decisiones). Default: `crypto.randomUUID()`. */
  newKey?: () => string;
}

type Cuerpo = { json: unknown } | { form: FormData } | undefined;

const MUTACIONES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Idempotency-Key (UUID v4). `crypto.randomUUID` existe solo en contextos
 * seguros (https o localhost); en un host http de desarrollo no está, pero
 * `getRandomValues` sí (lo encontró el smoke de navegador de E3b).
 */
export function randomKey(c: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function normalizeBaseUrl(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return u.origin + u.pathname.replace(/\/+$/, '');
}

export class PlatformClient {
  private readonly base: string;
  private readonly doFetch: FetchLike;
  private readonly newKey: () => string;
  private csrf: string | null = null;

  constructor(opts: PlatformClientOptions) {
    const base = normalizeBaseUrl(opts.baseUrl);
    if (!base) throw new Error('platform-web: la URL de la API tiene que ser absoluta (http/https)');
    this.base = base;
    this.doFetch = opts.fetch;
    this.newKey = opts.newKey ?? randomKey;
  }

  /** URL de descarga de una evidencia (la API la sirve como attachment; la cookie viaja: mismo site). */
  evidenceUrl(versionId: string, evidenceId: string): string {
    return `${this.base}/api/v1/show-versions/${encodeURIComponent(versionId)}/evidence/${encodeURIComponent(evidenceId)}`;
  }

  /** Solo para tests y diagnóstico: nunca se persiste. */
  get hasCsrfToken(): boolean {
    return this.csrf !== null;
  }

  private async request<S extends z.ZodTypeAny>(method: string, path: string, schema: S | null, body?: Cuerpo, extra: Record<string, string> = {}): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: 'application/json', ...extra };
    // multipart: el navegador pone el content-type con el boundary
    if (body && 'json' in body) headers['content-type'] = 'application/json';
    if (MUTACIONES.has(method) && path !== '/api/v1/auth/login') {
      if (this.csrf === null) await this.me();
      if (this.csrf === null) throw new PlatformApiError(401, 'UNAUTHENTICATED', 'La sesión no está activa.');
      headers['x-csrf-token'] = this.csrf;
    }
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method, headers, credentials: 'include', cache: 'no-store',
        ...(body ? { body: 'json' in body ? JSON.stringify(body.json) : body.form } : {}),
      });
    } catch {
      throw new PlatformApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con la API.');
    }
    if (res.status === 204) return undefined as z.infer<S>;
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) this.csrf = null;
      const e = ErrorBodySchema.safeParse(json);
      if (e.success) throw new PlatformApiError(res.status, e.data.code, e.data.message, e.data.requestId ?? null, e.data.details ?? null);
      throw new PlatformApiError(res.status, 'UNEXPECTED_RESPONSE', `La API respondió ${res.status}.`);
    }
    if (!schema) return undefined as z.infer<S>;
    const ok = schema.safeParse(json);
    if (!ok.success) throw new PlatformApiError(res.status, 'UNEXPECTED_RESPONSE', 'La respuesta de la API no tiene el formato esperado.');
    return ok.data;
  }

  /** Sesión actual, o null si no hay (401). */
  async me(): Promise<Me | null> {
    try {
      const m = await this.request('GET', '/api/v1/auth/me', MeSchema);
      this.csrf = m.csrfToken;
      return m;
    } catch (e) {
      if (e instanceof PlatformApiError && e.status === 401) {
        this.csrf = null;
        return null;
      }
      throw e;
    }
  }

  async login(email: string, password: string): Promise<Me> {
    const m = await this.request('POST', '/api/v1/auth/login', MeSchema, { json: { email, password } });
    this.csrf = m.csrfToken;
    return m;
  }

  /** Revoca la sesión en el servidor. Si ya estaba vencida, igual queda afuera. */
  async logout(): Promise<void> {
    try {
      await this.request('POST', '/api/v1/auth/logout', null);
    } catch (e) {
      if (!(e instanceof PlatformApiError && e.status === 401)) throw e;
    } finally {
      this.csrf = null;
    }
  }

  async listCampaigns(): Promise<Campaign[]> {
    return (await this.request('GET', '/api/v1/campaigns?limit=100', pagina(CampaignSchema))).items;
  }

  async listContracts(): Promise<Contract[]> {
    return (await this.request('GET', '/api/v1/contracts?limit=100', pagina(ContractSchema.passthrough()))).items;
  }

  async createCampaign(input: { contractId: string; name: string }): Promise<Campaign> {
    return this.request('POST', '/api/v1/campaigns', CampaignSchema, { json: { contractId: input.contractId, name: input.name } });
  }

  /* ── E3b: campaña, draft, assets, envío y aprobación ─────────────── */

  async getCampaign(id: string): Promise<Campaign> {
    return this.request('GET', `/api/v1/campaigns/${encodeURIComponent(id)}`, CampaignSchema);
  }

  async getDraft(campaignId: string): Promise<Draft> {
    return this.request('GET', `/api/v1/campaigns/${encodeURIComponent(campaignId)}/draft`, DraftSchema);
  }

  /** PUT con `expectedRevision`: un 409 DRAFT_CONFLICT llega tal cual (no se pisa al servidor). */
  async putDraft(campaignId: string, input: { takeoverDraft: Record<string, unknown>; expectedRevision: number }): Promise<Draft> {
    return this.request('PUT', `/api/v1/campaigns/${encodeURIComponent(campaignId)}/draft`, DraftSchema, { json: { takeoverDraft: input.takeoverDraft, expectedRevision: input.expectedRevision } });
  }

  async listAssets(): Promise<Asset[]> {
    return (await this.request('GET', '/api/v1/assets?limit=100', pagina(AssetSchema))).items;
  }

  /**
   * Upload multipart (campos antes que el archivo, §18) con Idempotency-Key.
   * Un asset rechazado por la validación real (ffprobe) vuelve como asset
   * REJECTED con su motivo: es un resultado, no un error de la UI.
   */
  async uploadAsset(input: { surfaceType: string; file: Blob; filename: string }): Promise<Asset> {
    const form = new FormData();
    form.append('surfaceType', input.surfaceType);
    form.append('file', input.file, input.filename);
    try {
      return await this.request('POST', '/api/v1/assets', AssetSchema, { form }, { 'idempotency-key': this.newKey() });
    } catch (e) {
      const rechazado = e instanceof PlatformApiError ? AssetSchema.safeParse(e.details?.asset) : null;
      if (rechazado?.success && rechazado.data.status === 'REJECTED') return rechazado.data;
      throw e;
    }
  }

  /** El servidor recompila, corre el preflight y crea la ShowVersion con su hash. */
  async submit(campaignId: string, draftRevision: number): Promise<ShowVersion> {
    return this.request('POST', `/api/v1/campaigns/${encodeURIComponent(campaignId)}/submit`, ShowVersionSchema, { json: { draftRevision } }, { 'idempotency-key': this.newKey() });
  }

  async getVersion(id: string): Promise<ShowVersion> {
    return this.request('GET', `/api/v1/show-versions/${encodeURIComponent(id)}`, ShowVersionSchema);
  }

  /**
   * BL-31: historial de versiones de la campaña, de la más nueva a la más vieja.
   * `cursor` = el `nextCursor` de la página anterior; la autorización por objeto
   * (y el 404 de una campaña ajena) la decide el servidor.
   */
  async listCampaignVersions(campaignId: string, o: { cursor?: string | null; limit?: number } = {}): Promise<VersionPage> {
    const q = new URLSearchParams({ limit: String(o.limit ?? 20) });
    if (o.cursor) q.set('cursor', o.cursor);
    return this.request('GET', `/api/v1/campaigns/${encodeURIComponent(campaignId)}/versions?${q.toString()}`, pagina(VersionSummarySchema));
  }

  async uploadEvidence(versionId: string, input: { type: EvidenceType; file: Blob; filename: string }): Promise<Evidence> {
    const form = new FormData();
    form.append('type', input.type);
    form.append('file', input.file, input.filename);
    return this.request('POST', `/api/v1/show-versions/${encodeURIComponent(versionId)}/evidence`, EvidenceSchema, { form }, { 'idempotency-key': this.newKey() });
  }

  /** La decisión cita el hash EXACTO que se mostró; la regla de cuatro ojos y el hash los decide el servidor. */
  async approve(versionId: string, input: { evidenceId: string; versionHash: string }): Promise<ShowVersion> {
    return this.request('POST', `/api/v1/show-versions/${encodeURIComponent(versionId)}/approve`, ShowVersionSchema, { json: { evidenceId: input.evidenceId, versionHash: input.versionHash } }, { 'idempotency-key': this.newKey() });
  }

  async reject(versionId: string, input: { reason: string; versionHash: string }): Promise<ShowVersion> {
    return this.request('POST', `/api/v1/show-versions/${encodeURIComponent(versionId)}/reject`, ShowVersionSchema, { json: { reason: input.reason, versionHash: input.versionHash } }, { 'idempotency-key': this.newKey() });
  }
}
