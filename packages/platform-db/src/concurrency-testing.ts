import { type Kysely, type Transaction, sql } from 'kysely';
import type { Database } from './schema';

/**
 * Ayudas para tests de concurrencia DETERMINÍSTICOS (sin sleeps ni carreras a
 * la suerte): una transacción que queda abierta hasta que el test la suelta, y
 * una espera activa hasta que PostgreSQL muestra un backend bloqueado en un lock.
 */
export interface TransaccionRetenida {
  /** Confirma la transacción retenida (o la revierte si `work` falló). */
  soltar(): Promise<void>;
}

export async function retenerTransaccion(db: Kysely<Database>, work: (trx: Transaction<Database>) => Promise<unknown>): Promise<TransaccionRetenida> {
  let liberar!: () => void;
  const puerta = new Promise<void>((r) => { liberar = r; });
  let listo!: () => void;
  let fallo!: (e: unknown) => void;
  const lista = new Promise<void>((res, rej) => { listo = res; fallo = rej; });
  const fin = db.transaction().execute(async (trx) => {
    try {
      await work(trx);
    } catch (e) {
      fallo(e);
      throw e;
    }
    listo();
    await puerta;
  });
  fin.catch(() => undefined);
  await lista;
  return { soltar: async () => { liberar(); await fin; } };
}

/**
 * Espera hasta que haya `cantidad` backends de ESTA base esperando un lock cuyo
 * `wait_event` esté en `eventos` (p. ej. 'transactionid'/'tuple' para filas,
 * 'advisory' para pg_advisory_xact_lock). Falla si no ocurre en `timeoutMs`.
 */
export async function esperarBloqueados(db: Kysely<Database>, eventos: readonly string[], cantidad = 1, timeoutMs = 5000): Promise<void> {
  const hasta = Date.now() + timeoutMs;
  let visto = 0;
  while (Date.now() < hasta) {
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event IN (${sql.join(eventos.map((e) => sql.lit(e)))})
    `.execute(db);
    visto = r.rows[0]?.n ?? 0;
    if (visto >= cantidad) return;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error(`esperarBloqueados: ${visto}/${cantidad} backends esperando ${eventos.join('|')} tras ${timeoutMs} ms`);
}

export const LOCK_FILA = ['transactionid', 'tuple'] as const;
