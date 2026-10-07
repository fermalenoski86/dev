import { type LoginRateLimiter, login, revokeSession } from '@trust/platform-auth';
import type { Database } from '@trust/platform-db';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import { type ActorProvider, type RequestActor, requireActor } from './actor';
import { LoginBodySchema, MeResponseSchema } from './contracts';
import { ApiError } from './errors';

/**
 * Rutas de auth — §30 (/auth/login, /auth/logout, /auth/me) bajo /api/v1.
 *
 * Login no lleva CSRF (todavía no hay sesión) pero sí exige JSON: un form
 * cross-site no puede mandar application/json sin preflight CORS, y la cookie
 * es SameSite=Lax. Cada login emite una sesión NUEVA y revoca la que viniera
 * en la cookie (rotación, sin session fixation).
 */
export interface AuthConfig {
  limiter: LoginRateLimiter;
  sessionTtlMs: number;
  cookieName: string;
  /** true en producción (cookie `__Host-` exige Secure). */
  secureCookie: boolean;
}

export function registerAuthRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; actors: ActorProvider; auth: AuthConfig }): void {
  const { auth } = deps;
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: auth.secureCookie };

  const meBody = async (actor: RequestActor) => {
    const u = await deps.db.selectFrom('users').select(['id', 'name', 'email', 'organization']).where('id', '=', actor.userId).executeTakeFirstOrThrow();
    return MeResponseSchema.parse({
      user: u,
      roles: [...actor.roles].sort(),
      externalContractIds: [...actor.externalContractIds],
      csrfToken: actor.session?.csrfToken ?? null,
      expiresAt: actor.session?.expiresAt.toISOString() ?? null,
    });
  };

  app.post('/api/v1/auth/login', async (req, reply: FastifyReply) => {
    const ct = String(req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (ct !== 'application/json') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El login se manda como application/json.');
    const body = LoginBodySchema.parse(req.body);
    const r = await login({ db: deps.db, limiter: auth.limiter, sessionTtlMs: auth.sessionTtlMs }, { email: body.email, password: body.password, ip: req.ip });
    if (!r.ok) {
      if (r.kind === 'RATE_LIMITED') {
        reply.header('retry-after', String(Math.max(1, Math.ceil(r.retryAfterMs / 1000))));
        throw new ApiError(429, 'RATE_LIMITED', 'Demasiados intentos. Probá de nuevo más tarde.');
      }
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos.');
    }
    // Rotación: si venía con otra sesión válida, esa muere.
    const previa = await deps.actors.resolve({ method: 'GET', headers: {}, cookies: req.cookies }).catch(() => null);
    if (previa?.session) await revokeSession(deps.db, previa.session.id);

    reply.setCookie(auth.cookieName, r.session.token, { ...cookieOpts, expires: r.session.expiresAt });
    req.log.info({ event: 'auth.login', requestId: req.id, userId: r.userId }, 'login');
    const actor = await deps.actors.resolve({ method: 'GET', headers: {}, cookies: { [auth.cookieName]: r.session.token } });
    if (!actor) throw new Error('sesión recién emitida no resuelve');
    return reply.status(200).send(await meBody(actor));
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const actor = await requireActor(deps.actors, req);
    if (actor.session) await revokeSession(deps.db, actor.session.id);
    reply.clearCookie(auth.cookieName, cookieOpts);
    return reply.status(204).send();
  });

  app.get('/api/v1/auth/me', async (req) => meBody(await requireActor(deps.actors, req)));
}
