import { type Kysely, sql } from 'kysely';

/**
 * 0003 — evidencia y aprobación (M3A.1 Fase C2, §17–20).
 *
 *   · La evidencia pertenece a UNA ShowVersion (`show_version_id`): se sube a
 *     `/show-versions/:id/evidence` y solo puede respaldar la decisión sobre esa
 *     versión. `NOT NULL`: en una base con evidencia previa (solo existían
 *     filas de prueba de Fase A) la migración falla en vez de inventar el dato.
 *   · Una Approval cita el HASH EXACTO de la versión (`version_hash`) y la base
 *     verifica que sea el de esa versión (§20 "siempre refiere a ShowVersion
 *     exacta", criterio 14 de §48).
 *   · La evidencia de una Approval es de la MISMA versión (FK compuesta).
 *   · Tipo y MIME de la evidencia coherentes y dentro de la allowlist cerrada
 *     (decisión 2 del brief C). La detección por bytes la hace la app; la base
 *     es la segunda barrera.
 *   · No se agrega evidencia a una versión ya decidida.
 *
 * Reversible para el smoke de CI.
 */
export const reversible = true;

/** Allowlist cerrada: tipo de evidencia → MIME detectado por bytes. */
export const EVIDENCE_MIME_BY_TYPE_0003: Readonly<Record<string, readonly string[]>> = {
  PDF: ['application/pdf'],
  EMAIL: ['message/rfc822'],
  MESSAGE: ['text/plain'],
  OTHER: ['image/png', 'image/jpeg'],
};

const pares = Object.entries(EVIDENCE_MIME_BY_TYPE_0003)
  .flatMap(([t, ms]) => ms.map((m) => `('${t}', '${m}')`))
  .join(', ');

const UP = String.raw`
ALTER TABLE approval_evidence ADD COLUMN show_version_id uuid NOT NULL REFERENCES show_versions(id);
ALTER TABLE approval_evidence ADD CONSTRAINT approval_evidence_id_version_uq UNIQUE (id, show_version_id);
CREATE INDEX approval_evidence_version_idx ON approval_evidence(show_version_id);

ALTER TABLE approvals ADD COLUMN version_hash char(64) NOT NULL CHECK (version_hash ~ '^[0-9a-f]{64}$');
-- MATCH SIMPLE: un REJECTED sin evidencia (evidence_id NULL) no se chequea.
ALTER TABLE approvals ADD CONSTRAINT approvals_evidence_same_version
  FOREIGN KEY (evidence_id, show_version_id) REFERENCES approval_evidence(id, show_version_id);

-- Tipo ↔ MIME del objeto físico (allowlist cerrada) y nada después de la decisión.
CREATE FUNCTION trust_evidence_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m text;
BEGIN
  SELECT mime_type INTO m FROM stored_objects WHERE id = NEW.stored_object_id;
  IF (NEW.type, m) NOT IN (${pares}) THEN
    RAISE EXCEPTION 'EVIDENCE_TYPE_MISMATCH: % no admite contenido %', NEW.type, coalesce(m, 'inexistente') USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM approvals WHERE show_version_id = NEW.show_version_id) THEN
    RAISE EXCEPTION 'EVIDENCE_AFTER_DECISION: la versión % ya tiene una decisión', NEW.show_version_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_insert BEFORE INSERT ON approval_evidence FOR EACH ROW EXECUTE FUNCTION trust_evidence_insert();

-- La Approval cita el hash EXACTO de su versión.
CREATE FUNCTION trust_approval_exact_hash() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h char(64);
BEGIN
  SELECT version_hash INTO h FROM show_versions WHERE id = NEW.show_version_id;
  IF h IS DISTINCT FROM NEW.version_hash THEN
    RAISE EXCEPTION 'APPROVAL_HASH_MISMATCH: la decisión no cita el hash de la versión %', NEW.show_version_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approvals_exact_hash BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION trust_approval_exact_hash();
`;

const DOWN = String.raw`
DROP TRIGGER IF EXISTS approvals_exact_hash ON approvals;
DROP FUNCTION IF EXISTS trust_approval_exact_hash();
DROP TRIGGER IF EXISTS evidence_insert ON approval_evidence;
DROP FUNCTION IF EXISTS trust_evidence_insert();
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_evidence_same_version, DROP COLUMN IF EXISTS version_hash;
DROP INDEX IF EXISTS approval_evidence_version_idx;
ALTER TABLE approval_evidence DROP CONSTRAINT IF EXISTS approval_evidence_id_version_uq, DROP COLUMN IF EXISTS show_version_id;
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(UP).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
