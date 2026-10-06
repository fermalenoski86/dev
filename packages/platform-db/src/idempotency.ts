import { canonicalize, sha256Hex } from '@trust/platform-contracts';
import { type Kysely, sql } from 'kysely';
import type { Database } from './schema';

/**
 * Idempotencia — revisión M3A.1 punto 6 + Integrity Gate A.1 puntos 5 y 6.
 *
 *   key vigente + mismo fingerprint    → replay de la respuesta guardada
 *   key vigente + distinto fingerprint → 409 IDEMPOTENCY_KEY_REUSED
 *   key VENCIDA (expires_at <= now())  → se recupera y la operación corre de nuevo
 *
 * Reserva, recuperación y operación van en la MISMA transacción, con la fila
 * bloqueada: dos reintentos simultáneos (también sobre una key vencida)
 * ejecutan una sola vez.
 */
export class IdempotencyKeyReusedError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED' as const;
  readonly httpStatus = 409 as const;
  constructor() {
    super('La Idempotency-Key ya se usó con otra solicitud');
  }
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** SHA256(JCS({ operation, payload })): el orden de las claves no importa. */
export function requestFingerprint(operation: string, payload: unknown): string {
  return sha256Hex(canonicalize({ operation, payload: payload ?? null }));
}

export async function withIdempotency<T>(
  db: Kysely<Database>,
  args: { key: string; actorId: string; operation: string; fingerprint: string; ttlHours?: number },
  run: (trx: Kysely<Database>) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const ttl = args.ttlHours ?? 24;
  return db.transaction().execute(async (trx) => {
    const insertado = await trx
      .insertInto('idempotency_keys')
      .values({
        key: args.key,
        actor_id: args.actorId,
        operation: args.operation,
        request_fingerprint: args.fingerprint,
        expires_at: sql<string>`now() + make_interval(hours => ${ttl})` as unknown as string,
      })
      .onConflict((oc) => oc.columns(['actor_id', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();

    if (!insertado) {
      // La key existe: bloquear la fila. Si otro reintento la está usando, esto
      // espera a que termine y después ve su resultado.
      const previo = await trx
        .selectFrom('idempotency_keys')
        .select(['operation', 'request_fingerprint', 'response_status', 'response_body', sql<boolean>`expires_at <= now()`.as('vencida')])
        .where('actor_id', '=', args.actorId)
        .where('key', '=', args.key)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (previo.vencida) {
        // Recuperación segura: la key vencida se reasigna a esta solicitud.
        await trx
          .updateTable('idempotency_keys')
          .set({
            operation: args.operation,
            request_fingerprint: args.fingerprint,
            response_status: null,
            response_body: null,
            created_at: sql<string>`now()` as unknown as string,
            expires_at: sql<string>`now() + make_interval(hours => ${ttl})` as unknown as string,
          })
          .where('actor_id', '=', args.actorId)
          .where('key', '=', args.key)
          .execute();
      } else {
        if (previo.request_fingerprint !== args.fingerprint || previo.operation !== args.operation) {
          throw new IdempotencyKeyReusedError();
        }
        if (previo.response_status !== null) {
          return { status: previo.response_status, body: previo.response_body as T, replayed: true };
        }
        throw new Error('idempotency: reserva vigente sin respuesta');
      }
    }

    const r = await run(trx);
    await trx
      .updateTable('idempotency_keys')
      .set({ response_status: r.status, response_body: JSON.stringify(r.body) })
      .where('actor_id', '=', args.actorId)
      .where('key', '=', args.key)
      .execute();
    return { ...r, replayed: false };
  });
}

/** Limpieza periódica: borra keys vencidas. La recuperación no depende de esto. */
export async function purgeExpiredIdempotencyKeys(db: Kysely<Database>): Promise<number> {
  const r = await db.deleteFrom('idempotency_keys').where(sql<boolean>`expires_at <= now()`).executeTakeFirst();
  return Number(r.numDeletedRows ?? 0);
}
