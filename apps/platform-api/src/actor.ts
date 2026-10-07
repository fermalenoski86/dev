import type { Database } from '@trust/platform-db';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { ApiError } from './errors';

/**
 * RequestActor — M3A.1 Fase B §19.
 *
 * Las rutas reciben un RequestActor resuelto por un ActorProvider; ningún
 * handler conoce de dónde sale. Fase C reemplaza el provider por sesión real
 * (platform-auth) sin tocar servicios ni rutas.
 */
export interface RequestActor {
  userId: string;
  /** De dónde salió la identidad: auditable en logs. */
  source: 'development' | 'session';
}

export interface ActorProvider {
  /** null = no autenticado (401). Nunca devuelve un actor por defecto. */
  resolve(headers: Record<string, string | string[] | undefined>): Promise<RequestActor | null>;
}

export const DEV_ACTOR_HEADER = 'x-dev-actor';
const Uuid = z.string().uuid();

/**
 * DEV ONLY. Lee el usuario de `X-Dev-Actor` y exige que exista y esté
 * habilitado en la base. No hay UUID mágico: sin header válido → 401.
 * `createServer` se niega a usarlo con NODE_ENV=production.
 */
export class DevelopmentActorProvider implements ActorProvider {
  constructor(private readonly db: Kysely<Database>) {}

  async resolve(headers: Record<string, string | string[] | undefined>): Promise<RequestActor | null> {
    const raw = headers[DEV_ACTOR_HEADER];
    if (raw === undefined) return null;
    const id = Uuid.safeParse(Array.isArray(raw) ? raw[0] : raw);
    if (!id.success) return null;
    const u = await this.db.selectFrom('users').select(['id', 'enabled']).where('id', '=', id.data).executeTakeFirst();
    if (!u || !u.enabled) return null;
    return { userId: u.id, source: 'development' };
  }
}

export async function requireActor(provider: ActorProvider, headers: Record<string, string | string[] | undefined>): Promise<RequestActor> {
  const actor = await provider.resolve(headers);
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Se requiere un actor autenticado.');
  return actor;
}
