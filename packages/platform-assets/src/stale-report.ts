import type { Database } from '@trust/platform-db';
import { type Kysely, sql } from 'kysely';

/**
 * BL-07 · reporte operativo de Assets no terminales vencidos (aceptada con
 * ajuste, auditoría B3 #1). SOLO reporte:
 *
 *   · lista los Assets `UPLOADING` / `VALIDATING` cuyo `updated_at` es más
 *     viejo que el umbral, medido con el reloj de PostgreSQL (`now()`), el
 *     mismo que escribe `updated_at` (trigger `trust_set_updated_at`);
 *   · corre en una transacción READ ONLY: no transiciona, no rechaza, no
 *     audita, no toca storage. Un fallo de infraestructura NO se convierte en
 *     `REJECTED` de contenido (no hay código contractual nuevo);
 *   · mínimos datos: id, estado, superficie, creador y tiempos. Sin nombre
 *     de archivo ni metadatos de medios.
 *
 * READY y REJECTED son terminales y nunca aparecen.
 */
export const STALE_STATUSES = ['UPLOADING', 'VALIDATING'] as const;
export type StaleStatus = (typeof STALE_STATUSES)[number];

export const STALE_REPORT_MAX_LIMIT = 10_000;

export interface StaleAssetItem {
  assetId: string;
  status: StaleStatus;
  surfaceType: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Antigüedad de `updated_at` respecto de `generatedAt`, en ms. */
  staleForMs: number;
}

export interface StaleAssetsReport {
  /** `now()` de PostgreSQL al generar el reporte. */
  generatedAt: string;
  olderThanMs: number;
  /** Total de vencidos (aunque la lista se corte en `limit`). */
  total: number;
  byStatus: Record<StaleStatus, number>;
  truncated: boolean;
  /** Del más viejo al más nuevo (`updated_at` asc, desempate por id). */
  items: StaleAssetItem[];
}

export async function staleAssetsReport(db: Kysely<Database>, o: { olderThanMs: number; limit: number }): Promise<StaleAssetsReport> {
  if (!Number.isSafeInteger(o.olderThanMs) || o.olderThanMs < 1) throw new Error(`olderThanMs tiene que ser un entero >= 1 (vino ${o.olderThanMs})`);
  if (!Number.isSafeInteger(o.limit) || o.limit < 1 || o.limit > STALE_REPORT_MAX_LIMIT) throw new Error(`limit tiene que estar entre 1 y ${STALE_REPORT_MAX_LIMIT} (vino ${o.limit})`);
  return db.transaction().execute(async (trx) => {
    // Primera sentencia de la transacción: PostgreSQL rechaza cualquier escritura y
    // conteo y lista salen del mismo snapshot (REPEATABLE READ).
    await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(trx);
    const { ahora } = await trx.selectNoFrom(sql<Date>`now()`.as('ahora')).executeTakeFirstOrThrow();
    // now() es constante dentro de la transacción: el mismo instante que `ahora`.
    const corte = sql<Date>`now() - make_interval(secs => ${o.olderThanMs / 1000})`;
    const vencidos = trx.selectFrom('assets').where('status', 'in', [...STALE_STATUSES]).where('updated_at', '<', corte);
    const conteo = await vencidos.select(['status', sql<string>`count(*)`.as('n')]).groupBy('status').execute();
    const filas = await vencidos
      .select(['id', 'status', 'surface_type', 'created_by', 'created_at', 'updated_at'])
      .orderBy('updated_at', 'asc')
      .orderBy('id', 'asc')
      .limit(o.limit)
      .execute();
    const byStatus: Record<StaleStatus, number> = { UPLOADING: 0, VALIDATING: 0 };
    for (const c of conteo) byStatus[c.status as StaleStatus] = Number(c.n);
    const total = byStatus.UPLOADING + byStatus.VALIDATING;
    const t0 = new Date(ahora).getTime();
    return {
      generatedAt: new Date(ahora).toISOString(),
      olderThanMs: o.olderThanMs,
      total,
      byStatus,
      truncated: total > filas.length,
      items: filas.map((f) => ({
        assetId: f.id,
        status: f.status as StaleStatus,
        surfaceType: f.surface_type,
        createdBy: f.created_by,
        createdAt: new Date(f.created_at).toISOString(),
        updatedAt: new Date(f.updated_at).toISOString(),
        staleForMs: t0 - new Date(f.updated_at).getTime(),
      })),
    };
  });
}
