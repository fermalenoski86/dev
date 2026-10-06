import { type Kysely, sql } from 'kysely';
import type { Database } from './schema';

/**
 * createShowVersion — Integrity Gate A.1, punto 1.
 *
 * ÚNICO camino para crear una ShowVersion: la versión y su manifiesto COMPLETO
 * se crean en una sola llamada atómica a `trust_create_show_version` (trust_app
 * no tiene INSERT directo sobre esas tablas), y la auditoría se registra en la
 * misma transacción. Al hacer commit, el manifiesto queda sellado: la base
 * rechaza cualquier logicalRef nuevo, incluso del dueño del esquema.
 *
 * `audit` es obligatorio a propósito: no existe forma de crear una versión
 * sin registrarla.
 */
export interface ManifestEntry {
  logicalRef: string;
  assetId: string;
  sha256: string;
}

export interface CreateShowVersionInput {
  campaignId: string;
  sourceDraftId: string;
  sourceDraftRevision: number;
  showPackage: unknown;
  versionHash: string;
  hashAlgorithm: string;
  canonicalizationVersion: string;
  hashEnvelopeVersion: number;
  showPackageSchemaVersion: number;
  compilerVersion: string;
  submittedBy: string;
  assets: readonly ManifestEntry[];
}

export interface CreatedShowVersion {
  id: string;
  versionNumber: number;
}

export async function createShowVersion(
  trx: Kysely<Database>,
  input: CreateShowVersionInput,
  audit: (trx: Kysely<Database>, version: CreatedShowVersion) => Promise<unknown>,
): Promise<CreatedShowVersion> {
  if (!trx.isTransaction) throw new Error('createShowVersion exige una transacción: versión, manifiesto y auditoría van juntos');
  const r = await sql<{ out_id: string; out_version_number: number }>`
    SELECT out_id, out_version_number FROM trust_create_show_version(
      ${input.campaignId}::uuid, ${input.sourceDraftId}::uuid, ${input.sourceDraftRevision}::integer,
      ${JSON.stringify(input.showPackage)}::jsonb, ${input.versionHash}, ${input.hashAlgorithm},
      ${input.canonicalizationVersion}, ${input.hashEnvelopeVersion}::integer, ${input.showPackageSchemaVersion}::integer,
      ${input.compilerVersion}, ${input.submittedBy}::uuid, ${JSON.stringify(input.assets)}::jsonb
    )`.execute(trx);
  const row = r.rows[0];
  if (!row) throw new Error('trust_create_show_version no devolvió la versión');
  const created = { id: row.out_id, versionNumber: Number(row.out_version_number) };
  await audit(trx, created);
  return created;
}
