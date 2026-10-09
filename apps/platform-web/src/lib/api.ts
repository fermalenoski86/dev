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

const pagina = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: Uuid.nullable() });

const ErrorBodySchema = z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }).passthrough();

/** Error de la API, tal como lo devuelve el servidor (la regla vive allá). */
export class PlatformApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

export interface PlatformClientOptions {
  /** Base absoluta de la API, p. ej. `https://api.trust.example`. */
  baseUrl: string;
  fetch: FetchLike;
}

const MUTACIONES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
  private csrf: string | null = null;

  constructor(opts: PlatformClientOptions) {
    const base = normalizeBaseUrl(opts.baseUrl);
    if (!base) throw new Error('platform-web: la URL de la API tiene que ser absoluta (http/https)');
    this.base = base;
    this.doFetch = opts.fetch;
  }

  /** Solo para tests y diagnóstico: nunca se persiste. */
  get hasCsrfToken(): boolean {
    return this.csrf !== null;
  }

  private async request<S extends z.ZodTypeAny>(method: string, path: string, schema: S | null, body?: unknown): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (MUTACIONES.has(method) && path !== '/api/v1/auth/login') {
      if (this.csrf === null) await this.me();
      if (this.csrf === null) throw new PlatformApiError(401, 'UNAUTHENTICATED', 'La sesión no está activa.');
      headers['x-csrf-token'] = this.csrf;
    }
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method, headers, credentials: 'include', cache: 'no-store',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new PlatformApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con la API.');
    }
    if (res.status === 204) return undefined as z.infer<S>;
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) this.csrf = null;
      const e = ErrorBodySchema.safeParse(json);
      if (e.success) throw new PlatformApiError(res.status, e.data.code, e.data.message, e.data.requestId ?? null);
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
    const m = await this.request('POST', '/api/v1/auth/login', MeSchema, { email, password });
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
    return this.request('POST', '/api/v1/campaigns', CampaignSchema, { contractId: input.contractId, name: input.name });
  }
}
