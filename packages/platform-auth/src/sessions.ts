import { type Database } from '@trust/platform-db';
import { type Kysely, sql } from 'kysely';
import { csrfTokenFor, isWellFormedToken, newSessionToken, safeEqual, sha256Hex } from './tokens';

/**
 * Sesiones server-side — §23 + decisión 5 del brief C.
 *
 *   · Se crean en el login (rotación: cada login es una sesión nueva; no se
 *     reutiliza un token que llegue de afuera → sin session fixation).
 *   · Vencimiento ABSOLUTO decidido por el servidor (`expires_at`), no por la cookie.
 *   · Revocables: logout revoca la propia; un cambio de privilegios revoca TODAS
 *     las del usuario (`revokeAllSessions`), así el usuario vuelve a loguearse y
 *     obtiene una sesión nueva con los roles nuevos.
 *   · Un usuario deshabilitado no tiene sesión válida aunque no esté revocada.
 */
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60_000;

export type { Role } from '@trust/platform-db';
import type { Role } from '@trust/platform-db';

export interface IssuedSession {
  sessionId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface ValidSession {
  sessionId: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function issueSession(db: Kysely<Database>, userId: string, ttlMs = DEFAULT_SESSION_TTL_MS): Promise<IssuedSession> {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error('el TTL de sesión tiene que ser un entero positivo de ms');
  const token = newSessionToken();
  const csrfToken = csrfTokenFor(token);
  const row = await db
    .insertInto('sessions')
    .values({
      user_id: userId,
      token_hash: sha256Hex(token),
      csrf_token_hash: sha256Hex(csrfToken),
      expires_at: sql<Date>`now() + make_interval(secs => ${ttlMs / 1000})`,
    })
    .returning(['id', 'expires_at'])
    .executeTakeFirstOrThrow();
  return { sessionId: row.id, token, csrfToken, expiresAt: new Date(row.expires_at) };
}

/** Sesión vigente para el token, o null. Vigente = no revocada, no vencida (reloj de la base) y usuario habilitado. */
export async function lookupSession(db: Kysely<Database>, token: unknown): Promise<ValidSession | null> {
  if (!isWellFormedToken(token)) return null;
  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.id', 's.user_id', 's.csrf_token_hash', 's.expires_at'])
    .where('s.token_hash', '=', sha256Hex(token))
    .where('s.revoked_at', 'is', null)
    .where('s.expires_at', '>', sql<Date>`now()`)
    .where('u.enabled', '=', true)
    .executeTakeFirst();
  if (!row) return null;
  const csrfToken = csrfTokenFor(token);
  // Defensa en profundidad: el hash guardado tiene que corresponder al CSRF derivado.
  if (!safeEqual(sha256Hex(csrfToken), row.csrf_token_hash)) return null;
  return { sessionId: row.id, userId: row.user_id, csrfToken, expiresAt: new Date(row.expires_at) };
}

export function csrfMatches(session: ValidSession, presented: unknown): boolean {
  return typeof presented === 'string' && presented.length > 0 && safeEqual(presented, session.csrfToken);
}

export async function revokeSession(db: Kysely<Database>, sessionId: string): Promise<void> {
  await db.updateTable('sessions').set({ revoked_at: sql<Date>`now()` }).where('id', '=', sessionId).where('revoked_at', 'is', null).execute();
}

export async function revokeAllSessions(db: Kysely<Database>, userId: string): Promise<number> {
  const r = await db.updateTable('sessions').set({ revoked_at: sql<Date>`now()` }).where('user_id', '=', userId).where('revoked_at', 'is', null).executeTakeFirst();
  return Number(r.numUpdatedRows);
}

export interface Principal {
  userId: string;
  roles: ReadonlySet<Role>;
  /** Contratos donde el usuario es EXTERNAL_APPROVER HABILITADO (flag global + contrato). */
  externalContractIds: readonly string[];
}

/**
 * Roles efectivos. EXTERNAL_APPROVER solo cuenta si el flag global
 * `externalApprovalEnabled` está prendido Y el contrato lo tiene habilitado;
 * si no, la fila existe (modelada) pero no da ningún permiso.
 */
export async function loadPrincipal(db: Kysely<Database>, userId: string, opts: { externalApprovalEnabled: boolean }): Promise<Principal> {
  const rows = await db
    .selectFrom('user_roles as r')
    .leftJoin('contracts as c', 'c.id', 'r.contract_id')
    .select(['r.role', 'r.contract_id', 'c.external_approval_enabled'])
    .where('r.user_id', '=', userId)
    .execute();
  const roles = new Set<Role>();
  const external: string[] = [];
  for (const r of rows) {
    if (r.role === 'EXTERNAL_APPROVER') {
      if (opts.externalApprovalEnabled && r.external_approval_enabled === true && r.contract_id) external.push(r.contract_id);
      continue;
    }
    roles.add(r.role);
  }
  if (external.length > 0) roles.add('EXTERNAL_APPROVER');
  return { userId, roles, externalContractIds: external.sort() };
}
