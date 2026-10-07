import { execFile } from 'node:child_process';
import { connect } from '@trust/platform-db';
import { maxUploadBytesFromEnv } from '@trust/platform-assets';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { storageFromEnv } from '@trust/platform-storage';
import { LoginRateLimiter } from '@trust/platform-auth';
import { SESSION_COOKIE_DEV, SESSION_COOKIE_PROD, SessionActorProvider } from './actor';
import { buildApp } from './app';
import type { AuthConfig } from './auth-routes';

/**
 * Arranque desde el entorno (.env.example). Desde C1 la identidad sale SIEMPRE
 * de la sesión server-side (SessionActorProvider). El provider DEV
 * (X-Dev-Actor) ya no se puede prender desde el entorno: queda solo para tests.
 */
export interface AuthEnv {
  auth: AuthConfig;
  externalApprovalEnabled: boolean;
}

export function authFromEnv(env: NodeJS.ProcessEnv): AuthEnv {
  const prod = env.NODE_ENV === 'production';
  const ttlMin = env.TRUST_SESSION_TTL_MINUTES === undefined ? 480 : Number(env.TRUST_SESSION_TTL_MINUTES);
  if (!Number.isInteger(ttlMin) || ttlMin < 5 || ttlMin > 1440) throw new Error('TRUST_SESSION_TTL_MINUTES tiene que ser un entero entre 5 y 1440');
  const ext = env.EXTERNAL_APPROVAL_ENABLED ?? 'false';
  if (ext !== 'true' && ext !== 'false') throw new Error('EXTERNAL_APPROVAL_ENABLED tiene que ser true o false');
  const secureFlag = env.TRUST_COOKIE_SECURE ?? (prod ? 'true' : 'false');
  if (secureFlag !== 'true' && secureFlag !== 'false') throw new Error('TRUST_COOKIE_SECURE tiene que ser true o false');
  if (prod && secureFlag !== 'true') throw new Error('en producción la cookie de sesión es Secure (TRUST_COOKIE_SECURE no puede ser false)');
  const secure = secureFlag === 'true';
  return {
    auth: {
      limiter: new LoginRateLimiter(),
      sessionTtlMs: ttlMin * 60_000,
      // `__Host-` exige Secure: sin Secure (solo dev por http://localhost) va el nombre común
      cookieName: secure ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV,
      secureCookie: secure,
    },
    externalApprovalEnabled: ext === 'true',
  };
}
function binarioPresente(bin: string): Promise<boolean> {
  return new Promise((ok) => execFile(bin, ['-version'], { timeout: 5_000, windowsHide: true }, (e) => ok(!e)));
}

export async function createServer(env: NodeJS.ProcessEnv = process.env) {
  if (env.TRUST_DEV_ACTOR_PROVIDER !== undefined) {
    throw new Error('platform-api: TRUST_DEV_ACTOR_PROVIDER ya no existe (C1): la identidad sale de la sesión. Sacalo del entorno.');
  }
  const { auth, externalApprovalEnabled } = authFromEnv(env);
  const hops = env.TRUST_PROXY_HOPS === undefined ? 0 : Number(env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw new Error('TRUST_PROXY_HOPS tiene que ser un entero entre 0 y 5');
  if (!env.DATABASE_URL) throw new Error('falta DATABASE_URL');
  const db = connect(env.DATABASE_URL);
  const storage = await storageFromEnv(env);
  const media = mediaRuntimeFromEnv(env);
  // Se verifica UNA vez al arrancar: /ready no lanza procesos por cada probe.
  const binarios = (await binarioPresente(media.ffprobePath)) && (await binarioPresente(media.ffmpegPath));
  const app = await buildApp({
    db, storage, media, actors: new SessionActorProvider(db, { cookieName: auth.cookieName, externalApprovalEnabled }), auth, trustProxyHops: hops, maxUploadBytes: maxUploadBytesFromEnv(env), mediaBinariesOk: () => binarios,
    log: { level: env.LOG_LEVEL ?? 'info' },
  });
  app.addHook('onClose', async () => { await db.destroy(); }); // el pool es de este servidor
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createServer();
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 4000) });
}
