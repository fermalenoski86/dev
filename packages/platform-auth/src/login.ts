import { appendAuditEvent } from '@trust/platform-audit';
import type { Database } from '@trust/platform-db';
import type { Kysely } from 'kysely';
import { MAX_PASSWORD_CHARS, verifyPassword } from './password';
import type { LoginRateLimiter } from './rate-limit';
import { type IssuedSession, issueSession } from './sessions';
import { normalizeEmail } from './users';

/**
 * Login — §23 + decisión 3 del brief C.
 *
 * Orden: (1) rate limit, ANTES de tocar Argon2 o el audit (un ataque no hace
 * crecer el audit sin límite); (2) verificación en tiempo constante (hash
 * señuelo si el usuario no existe o está deshabilitado); (3) audit
 * AUTH_LOGIN_SUCCEEDED / AUTH_LOGIN_FAILED. El fallo de un usuario inexistente
 * se audita con actor_user_id = null. La metadata NUNCA lleva email, password,
 * cookie, token ni IP: solo el motivo.
 * La respuesta al cliente es la misma para los tres motivos.
 */
export type LoginFailureReason = 'UNKNOWN_USER' | 'BAD_PASSWORD' | 'USER_DISABLED';

export type LoginResult =
  | { ok: true; userId: string; session: IssuedSession }
  | { ok: false; kind: 'INVALID_CREDENTIALS' }
  | { ok: false; kind: 'RATE_LIMITED'; retryAfterMs: number };

export interface LoginDeps {
  db: Kysely<Database>;
  limiter: LoginRateLimiter;
  sessionTtlMs?: number;
}

export async function login(deps: LoginDeps, input: { email: string; password: string; ip: string }): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const retry = deps.limiter.check(email, input.ip);
  if (retry !== null) return { ok: false, kind: 'RATE_LIMITED', retryAfterMs: retry };

  const user = email.length > 0 && email.length <= 320
    ? await deps.db.selectFrom('users').select(['id', 'password_hash', 'enabled']).where('email', '=', email).executeTakeFirst()
    : undefined;
  const pw = Array.from(input.password).length <= MAX_PASSWORD_CHARS ? input.password : '';
  const valid = await verifyPassword(user?.enabled ? user.password_hash : null, pw);

  if (!user || !user.enabled || !valid) {
    const reason: LoginFailureReason = !user ? 'UNKNOWN_USER' : !user.enabled ? 'USER_DISABLED' : 'BAD_PASSWORD';
    await deps.db.transaction().execute((trx) =>
      appendAuditEvent(trx, { actorUserId: user?.id ?? null, action: 'AUTH_LOGIN_FAILED', entityType: 'user', entityId: user?.id ?? null, metadata: { reason } }),
    );
    return { ok: false, kind: 'INVALID_CREDENTIALS' };
  }

  deps.limiter.succeeded(email);
  const session = await deps.db.transaction().execute(async (trx) => {
    const s = await issueSession(trx, user.id, deps.sessionTtlMs);
    await appendAuditEvent(trx, { actorUserId: user.id, action: 'AUTH_LOGIN_SUCCEEDED', entityType: 'session', entityId: s.sessionId, metadata: {} });
    return s;
  });
  return { ok: true, userId: user.id, session };
}
