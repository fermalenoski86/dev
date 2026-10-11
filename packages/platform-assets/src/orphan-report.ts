import type { Database } from '@trust/platform-db';
import { CONTENT_KEY_RE, type ObjectStorage } from '@trust/platform-storage';
import { type Kysely, sql } from 'kysely';

/**
 * BL-08 · reporte de blobs huérfanos (aceptada, auditoría B3 #1). SOLO reporte:
 *
 *   · huérfano = blob final `sha256/<2>/<64>` sin StoredObject con ese sha256,
 *     cuya fecha de escritura en storage es más vieja que el período de gracia.
 *     Es lo que deja el fallo de la base después del commit de storage (§33);
 *   · el período de gracia cubre el upload en curso: el blob ya está en storage
 *     y su StoredObject todavía no se confirmó;
 *   · orden list → query: cada tanda se lista ANTES de consultar la base, así un
 *     StoredObject confirmado antes de la consulta siempre se ve;
 *   · la base se consulta en transacciones READ ONLY y el storage solo se
 *     enumera: no se abre, no se hashea, no se mueve ni se BORRA nada;
 *   · lo que no es una clave canónica (o no es archivo regular) no se cruza con
 *     la base: va aparte, en `unrecognized`, para que un humano lo mire.
 *
 * Datos mínimos: clave, sha256, tamaño y fechas. Sin rutas absolutas, sin
 * nombres de archivo del cliente.
 */
export const ORPHAN_REPORT_MAX_LIMIT = 10_000;
const TANDA = 500;

export interface OrphanBlobItem {
  key: string;
  sha256: string;
  sizeBytes: number;
  lastModified: string;
  /** Antigüedad respecto de `generatedAt`, en ms. */
  ageMs: number;
}

export interface UnrecognizedItem {
  key: string;
  regularFile: boolean;
}

export interface OrphanBlobsReport {
  /** Reloj del host que corre el reporte (el mismo con que se mide la gracia). */
  generatedAt: string;
  graceMs: number;
  storageDriver: 'local' | 's3';
  /** Objetos vistos en `sha256/`. */
  scanned: number;
  /** Claves canónicas con StoredObject. */
  referenced: number;
  /** Claves canónicas sin StoredObject pero dentro del período de gracia (no se informan). */
  withinGrace: number;
  /** Total de huérfanos (aunque la lista se corte en `limit`). */
  total: number;
  totalBytes: number;
  truncated: boolean;
  /** Del más viejo al más nuevo (desempate por clave). */
  items: OrphanBlobItem[];
  unrecognized: { total: number; truncated: boolean; items: UnrecognizedItem[] };
}

export async function orphanBlobsReport(
  db: Kysely<Database>,
  storage: ObjectStorage,
  o: { graceMs: number; limit: number },
): Promise<OrphanBlobsReport> {
  if (!Number.isSafeInteger(o.graceMs) || o.graceMs < 1) throw new Error(`graceMs tiene que ser un entero >= 1 (vino ${o.graceMs})`);
  if (!Number.isSafeInteger(o.limit) || o.limit < 1 || o.limit > ORPHAN_REPORT_MAX_LIMIT) throw new Error(`limit tiene que estar entre 1 y ${ORPHAN_REPORT_MAX_LIMIT} (vino ${o.limit})`);
  const t0 = Date.now();
  const corte = t0 - o.graceMs;

  let scanned = 0;
  let referenced = 0;
  let withinGrace = 0;
  let total = 0;
  let totalBytes = 0;
  const huerfanos: OrphanBlobItem[] = [];
  const raros: UnrecognizedItem[] = [];
  let rarosTotal = 0;

  /** Candidatos ya listados (sha → objeto) que esperan la consulta a la base. */
  let tanda = new Map<string, { key: string; sizeBytes: number; lastModified: Date }>();

  const cruzar = async () => {
    if (tanda.size === 0) return;
    const shas = [...tanda.keys()];
    const conObjeto = await db.transaction().execute(async (trx) => {
      await sql`SET TRANSACTION READ ONLY`.execute(trx);
      return trx.selectFrom('stored_objects').select('sha256').where('sha256', 'in', shas).execute();
    });
    const vistos = new Set(conObjeto.map((r) => r.sha256));
    for (const [sha, b] of tanda) {
      if (vistos.has(sha)) {
        referenced += 1;
        continue;
      }
      if (b.lastModified.getTime() > corte) {
        withinGrace += 1;
        continue;
      }
      total += 1;
      totalBytes += b.sizeBytes;
      huerfanos.push({ key: b.key, sha256: sha, sizeBytes: b.sizeBytes, lastModified: b.lastModified.toISOString(), ageMs: t0 - b.lastModified.getTime() });
    }
    // Solo se guardan los `limit` más viejos: memoria acotada aunque haya muchos.
    huerfanos.sort((a, b) => a.lastModified.localeCompare(b.lastModified) || a.key.localeCompare(b.key));
    huerfanos.length = Math.min(huerfanos.length, o.limit);
    tanda = new Map();
  };

  for await (const obj of storage.listContentObjects()) {
    scanned += 1;
    const m = CONTENT_KEY_RE.exec(obj.key);
    const sha = m?.[2];
    if (!obj.regularFile || !m || !sha || sha.slice(0, 2) !== m[1]) {
      rarosTotal += 1;
      if (raros.length < o.limit) raros.push({ key: obj.key, regularFile: obj.regularFile });
      continue;
    }
    tanda.set(sha, { key: obj.key, sizeBytes: obj.sizeBytes, lastModified: obj.lastModified });
    if (tanda.size >= TANDA) await cruzar();
  }
  await cruzar();

  return {
    generatedAt: new Date(t0).toISOString(),
    graceMs: o.graceMs,
    storageDriver: storage.driver,
    scanned,
    referenced,
    withinGrace,
    total,
    totalBytes,
    truncated: total > huerfanos.length,
    items: huerfanos,
    unrecognized: { total: rarosTotal, truncated: rarosTotal > raros.length, items: raros.sort((a, b) => a.key.localeCompare(b.key)) },
  };
}
