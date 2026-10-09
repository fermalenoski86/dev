import type { FastifyInstance } from 'fastify';
import { ErrorResponseSchema } from './contracts';

/**
 * E3a · CORS por allowlist exacta (ADR-063, docs/platform/AUTH.md).
 *
 * `platform-web` y `apps/control` llaman a la API **directo desde el
 * navegador**: la cookie de sesión es host-only (`__Host-trust_session`) y
 * tiene que emitirla y recibirla el host de la API. Esto sólo habilita a esos
 * orígenes exactos a leer las respuestas con credenciales; **no** reemplaza a
 * CSRF, que sigue igual (`X-CSRF-Token` atado a la sesión).
 *
 * - Lista vacía → sin CORS (comportamiento previo a E3a).
 * - Origen permitido → `Access-Control-Allow-Origin: <origen>` (nunca `*`),
 *   `Access-Control-Allow-Credentials: true`.
 * - `Vary: Origin` siempre que llegue `Origin`: la respuesta depende de él.
 * - Preflight de origen no listado → 403 sin headers CORS (el navegador bloquea).
 * - Defensa en profundidad: mutación con `Origin` presente y no listado →
 *   403 `ORIGIN_NOT_ALLOWED` antes de mirar la sesión. Sin `Origin` (CLI,
 *   tests, servidor a servidor) no cambia nada.
 */
export const CORS_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, OPTIONS';
export const CORS_ALLOWED_HEADERS = 'Content-Type, X-CSRF-Token, Idempotency-Key, X-Request-Id';
export const CORS_EXPOSED_HEADERS = 'X-Request-Id, Idempotent-Replayed, Retry-After';
export const CORS_MAX_AGE_SECONDS = 600;

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Parsea `TRUST_CORS_ORIGINS` (orígenes separados por coma). Falla al arrancar
 * ante `*`, `null`, algo que no sea un origen exacto (con path, query, barra
 * final o credenciales) y, en producción, `http:`.
 */
export function parseCorsOrigins(raw: string | undefined, opts: { production: boolean }): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const out: string[] = [];
  for (const parte of raw.split(',')) {
    const v = parte.trim();
    if (v === '') continue;
    if (v === '*' || v.toLowerCase() === 'null') throw new Error(`TRUST_CORS_ORIGINS: «${v}» no está permitido; la lista es de orígenes exactos`);
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      throw new Error(`TRUST_CORS_ORIGINS: «${v}» no es un origen válido (esquema://host[:puerto])`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`TRUST_CORS_ORIGINS: «${v}» tiene que ser http(s)`);
    if (u.origin !== v) throw new Error(`TRUST_CORS_ORIGINS: «${v}» no es un origen exacto (¿quisiste decir «${u.origin}»?)`);
    if (opts.production && u.protocol !== 'https:') throw new Error(`TRUST_CORS_ORIGINS: en producción solo https (recibido «${v}»)`);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function registerCors(app: FastifyInstance, origins: readonly string[]): void {
  if (origins.length === 0) return;
  const permitidos = new Set(origins);

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin === undefined) return;
    reply.header('vary', 'Origin');
    const permitido = permitidos.has(origin);
    const esPreflight = req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined;

    if (!permitido) {
      if (esPreflight || !SEGUROS.has(req.method)) {
        req.log.info({ event: 'cors.rejected', requestId: req.id, method: req.method, preflight: esPreflight }, 'origen no permitido');
        return reply
          .status(403)
          .send(ErrorResponseSchema.parse({ code: 'ORIGIN_NOT_ALLOWED', message: 'Origen no permitido.', requestId: String(req.id) }));
      }
      return; // GET/HEAD de otro origen: sin headers CORS, el navegador no deja leer
    }

    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-credentials', 'true');
    if (esPreflight) {
      reply.header('access-control-allow-methods', CORS_ALLOWED_METHODS);
      reply.header('access-control-allow-headers', CORS_ALLOWED_HEADERS);
      reply.header('access-control-max-age', String(CORS_MAX_AGE_SECONDS));
      return reply.status(204).send();
    }
    reply.header('access-control-expose-headers', CORS_EXPOSED_HEADERS);
  });
}
