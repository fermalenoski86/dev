import { type Principal, type Role, csrfMatches, hasAnyRole, loadPrincipal, lookupSession } from '@trust/platform-auth';
import type { Database } from '@trust/platform-db';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { ApiError } from './errors';

/**
 * RequestActor — ADR-056 (Fase B) + C1.
 *
 * Las rutas reciben un RequestActor resuelto por un ActorProvider; ningún
 * handler sabe de dónde sale. En C1 el actor suma los roles EFECTIVOS y los
 * contratos externos habilitados, siempre derivados en el backend (§22–24).
 *
 *   · SessionActorProvider: cookie de sesión server-side (producción).
 *   · DevelopmentActorProvider: header X-Dev-Actor (DEV ONLY, solo tests).
 */
export interface RequestActor extends Principal {
  /** De dónde salió la identidad: auditable en logs. */
  source: 'development' | 'session';
  /** Solo con sesión: para revocarla en logout y para el chequeo CSRF. */
  session?: { id: string; csrfToken: string; expiresAt: Date };
}

export interface ActorRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

export interface ActorProvider {
  /** null = no autenticado (401). Nunca devuelve un actor por defecto. */
  resolve(req: ActorRequest): Promise<RequestActor | null>;
}

export const DEV_ACTOR_HEADER = 'x-dev-actor';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_COOKIE_DEV = 'trust_session';
/** `__Host-`: el navegador la acepta solo con Secure, sin Domain y con Path=/ (host-only). */
export const SESSION_COOKIE_PROD = '__Host-trust_session';

const Uuid = z.string().uuid();
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * DEV ONLY. Lee el usuario de `X-Dev-Actor` y exige que exista y esté
 * habilitado. Sin header válido → 401. `createServer` no lo usa nunca: queda
 * para los tests de API que no son de auth.
 */
export class DevelopmentActorProvider implements ActorProvider {
  constructor(private readonly db: Kysely<Database>, private readonly opts: { externalApprovalEnabled: boolean } = { externalApprovalEnabled: false }) {}

  async resolve(req: ActorRequest): Promise<RequestActor | null> {
    const raw = first(req.headers[DEV_ACTOR_HEADER]);
    if (raw === undefined) return null;
    const id = Uuid.safeParse(raw);
    if (!id.success) return null;
    const u = await this.db.selectFrom('users').select(['id', 'enabled']).where('id', '=', id.data).executeTakeFirst();
    if (!u || !u.enabled) return null;
    return { ...(await loadPrincipal(this.db, u.id, this.opts)), source: 'development' };
  }
}

/** Producción: sesión server-side por cookie (§23). */
export class SessionActorProvider implements ActorProvider {
  constructor(private readonly db: Kysely<Database>, private readonly opts: { cookieName: string; externalApprovalEnabled: boolean }) {}

  async resolve(req: ActorRequest): Promise<RequestActor | null> {
    const s = await lookupSession(this.db, req.cookies?.[this.opts.cookieName]);
    if (!s) return null;
    const p = await loadPrincipal(this.db, s.userId, { externalApprovalEnabled: this.opts.externalApprovalEnabled });
    return { ...p, source: 'session', session: { id: s.sessionId, csrfToken: s.csrfToken, expiresAt: s.expiresAt } };
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Exige actor y, si la ruta lo pide, alguno de los roles. Toda mutación con
 * sesión exige además `X-CSRF-Token` igual al token de ESA sesión (§23):
 * se chequea antes que los roles y antes de leer el cuerpo.
 */
export async function requireActor(provider: ActorProvider, req: ActorRequest, roles?: readonly Role[]): Promise<RequestActor> {
  const actor = await provider.resolve(req);
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Se requiere un actor autenticado.');
  if (actor.source === 'session' && !SAFE_METHODS.has(req.method.toUpperCase())) {
    if (!actor.session || !csrfMatches({ sessionId: actor.session.id, userId: actor.userId, csrfToken: actor.session.csrfToken, expiresAt: actor.session.expiresAt }, first(req.headers[CSRF_HEADER]))) {
      throw new ApiError(403, 'CSRF_TOKEN_INVALID', 'Falta el token CSRF o no corresponde a esta sesión.');
    }
  }
  if (roles && !hasAnyRole(actor, roles)) throw new ApiError(403, 'FORBIDDEN', 'El usuario no tiene un rol que permita esta operación.');
  return actor;
}
