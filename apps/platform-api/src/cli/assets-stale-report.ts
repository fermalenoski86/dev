import { parseArgs } from 'node:util';
import { type StaleAssetsReport, STALE_REPORT_MAX_LIMIT, staleAssetsReport } from '@trust/platform-assets';
import type { Database } from '@trust/platform-db';
import type { Kysely } from 'kysely';

/**
 * CLI de operación — BL-07: reporte READ-ONLY de Assets UPLOADING/VALIDATING
 * vencidos. No cambia nada: ni estados, ni audit, ni storage.
 *
 *   pnpm --filter @trust/platform-api assets:stale-report -- --older-than-minutes 60 [--limit 500]
 *
 * Umbral por defecto: ASSET_STALE_AFTER_MINUTES o 60. Salida: JSON en stdout.
 * Código de salida 0 aunque haya vencidos (es un reporte, no una alarma).
 */
export const DEFAULT_STALE_AFTER_MINUTES = 60;
export const DEFAULT_STALE_LIMIT = 500;
const MAX_MINUTES = 60 * 24 * 365;

function entero(nombre: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${nombre} tiene que ser un entero (vino "${raw}")`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${nombre} tiene que estar entre ${min} y ${max} (vino ${raw})`);
  return n;
}

export function parseStaleReportArgs(argv: string[], env: NodeJS.ProcessEnv = {}): { olderThanMs: number; limit: number } {
  const { values } = parseArgs({
    args: argv,
    options: { 'older-than-minutes': { type: 'string' }, limit: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  const crudo = values['older-than-minutes'] ?? env.ASSET_STALE_AFTER_MINUTES ?? String(DEFAULT_STALE_AFTER_MINUTES);
  const minutos = entero('--older-than-minutes / ASSET_STALE_AFTER_MINUTES', crudo, 1, MAX_MINUTES);
  const limit = entero('--limit', values.limit ?? String(DEFAULT_STALE_LIMIT), 1, STALE_REPORT_MAX_LIMIT);
  return { olderThanMs: minutos * 60_000, limit };
}

export async function runStaleReport(db: Kysely<Database>, argv: string[], env: NodeJS.ProcessEnv = {}): Promise<StaleAssetsReport> {
  return staleAssetsReport(db, parseStaleReportArgs(argv, env));
}
