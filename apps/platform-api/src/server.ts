import { execFile } from 'node:child_process';
import { connect } from '@trust/platform-db';
import { maxUploadBytesFromEnv } from '@trust/platform-assets';
import { mediaRuntimeFromEnv } from '@trust/platform-media';
import { storageFromEnv } from '@trust/platform-storage';
import { DevelopmentActorProvider } from './actor';
import { buildApp } from './app';

/**
 * Arranque desde el entorno (.env.example). Sin auth real todavía (Fase C):
 * el único provider disponible es DEV ONLY y se niega en producción.
 */
function binarioPresente(bin: string): Promise<boolean> {
  return new Promise((ok) => execFile(bin, ['-version'], { timeout: 5_000, windowsHide: true }, (e) => ok(!e)));
}

export async function createServer(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error('platform-api: no hay ActorProvider de producción todavía (Fase C). DevelopmentActorProvider es DEV ONLY.');
  }
  if (env.TRUST_DEV_ACTOR_PROVIDER !== 'enabled') {
    throw new Error('platform-api: definí TRUST_DEV_ACTOR_PROVIDER=enabled para usar el provider de desarrollo (DEV ONLY).');
  }
  if (!env.DATABASE_URL) throw new Error('falta DATABASE_URL');
  const db = connect(env.DATABASE_URL);
  const storage = await storageFromEnv(env);
  const media = mediaRuntimeFromEnv(env);
  // Se verifica UNA vez al arrancar: /ready no lanza procesos por cada probe.
  const binarios = (await binarioPresente(media.ffprobePath)) && (await binarioPresente(media.ffmpegPath));
  const app = await buildApp({
    db, storage, media, actors: new DevelopmentActorProvider(db), maxUploadBytes: maxUploadBytesFromEnv(env), mediaBinariesOk: () => binarios,
    log: { level: env.LOG_LEVEL ?? 'info' },
  });
  app.addHook('onClose', async () => { await db.destroy(); }); // el pool es de este servidor
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await createServer();
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 4000) });
}
