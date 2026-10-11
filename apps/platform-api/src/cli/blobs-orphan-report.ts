import { parseArgs } from 'node:util';
import { ORPHAN_REPORT_MAX_LIMIT, type OrphanBlobsReport, orphanBlobsReport } from '@trust/platform-assets';
import type { Database } from '@trust/platform-db';
import type { ObjectStorage } from '@trust/platform-storage';
import type { Kysely } from 'kysely';

/**
 * CLI de operación — BL-08: reporte READ-ONLY de blobs finales sin StoredObject
 * más viejos que el período de gracia. No borra, no mueve, no escribe la base.
 *
 *   pnpm --filter @trust/platform-api blobs:orphan-report -- --grace-minutes 1440 [--limit 500]
 *
 * Gracia por defecto: BLOB_ORPHAN_GRACE_MINUTES o 1440 (24 h). Salida: JSON en
 * stdout. Código de salida 0 aunque haya huérfanos (es un reporte, no una alarma).
 */
export const DEFAULT_ORPHAN_GRACE_MINUTES = 1440;
export const DEFAULT_ORPHAN_LIMIT = 500;
const MAX_MINUTES = 60 * 24 * 365;

function entero(nombre: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${nombre} tiene que ser un entero (vino "${raw}")`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${nombre} tiene que estar entre ${min} y ${max} (vino ${raw})`);
  return n;
}

export function parseOrphanReportArgs(argv: string[], env: NodeJS.ProcessEnv = {}): { graceMs: number; limit: number } {
  const { values } = parseArgs({
    args: argv,
    options: { 'grace-minutes': { type: 'string' }, limit: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  const crudo = values['grace-minutes'] ?? env.BLOB_ORPHAN_GRACE_MINUTES ?? String(DEFAULT_ORPHAN_GRACE_MINUTES);
  const minutos = entero('--grace-minutes / BLOB_ORPHAN_GRACE_MINUTES', crudo, 1, MAX_MINUTES);
  const limit = entero('--limit', values.limit ?? String(DEFAULT_ORPHAN_LIMIT), 1, ORPHAN_REPORT_MAX_LIMIT);
  return { graceMs: minutos * 60_000, limit };
}

export async function runOrphanReport(db: Kysely<Database>, storage: ObjectStorage, argv: string[], env: NodeJS.ProcessEnv = {}): Promise<OrphanBlobsReport> {
  return orphanBlobsReport(db, storage, parseOrphanReportArgs(argv, env));
}
