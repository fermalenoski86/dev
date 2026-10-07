import { type Kysely, sql } from 'kysely';

/**
 * 0002 — pipeline de Asset (M3A.1 Fase B3).
 *
 *   · `sha256` del upload (calculado durante el stream), `container` y
 *     `rejection_detail` (jsonb estructurado) en `assets`.
 *   · `rejection_code` solo puede ser un código conocido (platform-contracts).
 *   · READY exige la metadata completa y CONSISTENCIA con su StoredObject
 *     (§14 del brief): mismo sha256, mismo tamaño, mismo MIME, y MIME coherente
 *     con el contenedor inspeccionado. Lo verifica la base, no solo la app.
 *   · Los terminales congelan también las columnas nuevas.
 *
 * Reversible para el smoke de CI. El `down` restaura `trust_asset_transition`
 * exactamente como la dejó 0001.
 */
export const reversible = true;

const REJECTION_CODES = [
  'ASSET_TOO_LARGE', 'ASSET_EMPTY', 'ASSET_BAD_CONTAINER', 'ASSET_BAD_CODEC', 'ASSET_BAD_RESOLUTION', 'ASSET_BAD_FPS',
  'ASSET_TOO_SHORT', 'ASSET_NO_VIDEO', 'ASSET_MULTIPLE_VIDEO_STREAMS', 'ASSET_CORRUPT', 'ASSET_INSPECTION_TIMEOUT',
  'ASSET_STORAGE_ERROR',
] as const;
export const ASSET_REJECTION_CODES_0002: readonly string[] = REJECTION_CODES;

const UP = String.raw`
ALTER TABLE assets
  ADD COLUMN sha256 char(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN container text CHECK (container IS NULL OR length(container) BETWEEN 1 AND 32),
  ADD COLUMN rejection_detail jsonb CHECK (rejection_detail IS NULL OR jsonb_typeof(rejection_detail) = 'object');

ALTER TABLE assets
  ADD CONSTRAINT assets_rejection_code_known CHECK (rejection_code IS NULL OR rejection_code IN (${REJECTION_CODES.map((c) => `'${c}'`).join(', ')})),
  ADD CONSTRAINT assets_rejection_detail_only_rejected CHECK (rejection_detail IS NULL OR status = 'REJECTED'),
  ADD CONSTRAINT assets_ready_complete CHECK (status <> 'READY' OR (sha256 IS NOT NULL AND size_bytes IS NOT NULL
                                              AND mime_type IS NOT NULL AND container IS NOT NULL));

CREATE INDEX assets_sha256_idx ON assets(sha256);

-- Terminales: identidad y contenido técnico congelados, columnas nuevas incluidas.
CREATE OR REPLACE FUNCTION trust_asset_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('READY', 'REJECTED') THEN
    IF (NEW.stored_object_id, NEW.original_filename, NEW.mime_type, NEW.size_bytes, NEW.width, NEW.height, NEW.fps,
        NEW.codec, NEW.duration_ms, NEW.surface_type, NEW.status, NEW.rejection_code, NEW.created_by,
        NEW.sha256, NEW.container, NEW.rejection_detail)
       IS DISTINCT FROM
       (OLD.stored_object_id, OLD.original_filename, OLD.mime_type, OLD.size_bytes, OLD.width, OLD.height, OLD.fps,
        OLD.codec, OLD.duration_ms, OLD.surface_type, OLD.status, OLD.rejection_code, OLD.created_by,
        OLD.sha256, OLD.container, OLD.rejection_detail) THEN
      RAISE EXCEPTION 'ASSET_TERMINAL: el asset % está % y es inmutable', OLD.id, OLD.status USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN
     (('UPLOADING', 'VALIDATING'), ('VALIDATING', 'READY'), ('UPLOADING', 'REJECTED'), ('VALIDATING', 'REJECTED')) THEN
    RAISE EXCEPTION 'ASSET_TRANSITION: % → % no está permitido', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'ASSET_TRANSITION: un asset no cambia de autor' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- §14: antes de READY, el Asset y su StoredObject tienen que decir lo mismo.
-- El trigger se llama assets_transition_ready para correr DESPUÉS de
-- assets_transition (orden alfabético): una transición inválida se informa como tal.
CREATE FUNCTION trust_asset_ready_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o stored_objects%ROWTYPE;
BEGIN
  SELECT * INTO o FROM stored_objects WHERE id = NEW.stored_object_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSET_OBJECT_MISSING: READY exige un StoredObject real' USING ERRCODE = 'P0001';
  END IF;
  IF o.sha256 IS DISTINCT FROM NEW.sha256 THEN
    RAISE EXCEPTION 'ASSET_SHA_MISMATCH: el sha256 del asset no es el de su objeto físico' USING ERRCODE = 'P0001';
  END IF;
  IF o.size_bytes IS DISTINCT FROM NEW.size_bytes THEN
    RAISE EXCEPTION 'ASSET_SIZE_MISMATCH: el tamaño del asset no es el de su objeto físico' USING ERRCODE = 'P0001';
  END IF;
  IF o.mime_type IS DISTINCT FROM NEW.mime_type THEN
    RAISE EXCEPTION 'ASSET_MIME_MISMATCH: el MIME del asset no es el de su objeto físico' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.container = 'MP4' AND NEW.mime_type <> 'video/mp4' THEN
    RAISE EXCEPTION 'ASSET_MIME_MISMATCH: un contenedor MP4 se publica como video/mp4' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER assets_transition_ready BEFORE UPDATE ON assets FOR EACH ROW
  WHEN (NEW.status = 'READY' AND OLD.status IS DISTINCT FROM 'READY')
  EXECUTE FUNCTION trust_asset_ready_consistency();
`;

const DOWN = String.raw`
DROP TRIGGER IF EXISTS assets_transition_ready ON assets;
DROP FUNCTION IF EXISTS trust_asset_ready_consistency();
CREATE OR REPLACE FUNCTION trust_asset_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('READY', 'REJECTED') THEN
    IF (NEW.stored_object_id, NEW.original_filename, NEW.mime_type, NEW.size_bytes, NEW.width, NEW.height, NEW.fps,
        NEW.codec, NEW.duration_ms, NEW.surface_type, NEW.status, NEW.rejection_code, NEW.created_by)
       IS DISTINCT FROM
       (OLD.stored_object_id, OLD.original_filename, OLD.mime_type, OLD.size_bytes, OLD.width, OLD.height, OLD.fps,
        OLD.codec, OLD.duration_ms, OLD.surface_type, OLD.status, OLD.rejection_code, OLD.created_by) THEN
      RAISE EXCEPTION 'ASSET_TERMINAL: el asset % está % y es inmutable', OLD.id, OLD.status USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN
     (('UPLOADING', 'VALIDATING'), ('VALIDATING', 'READY'), ('UPLOADING', 'REJECTED'), ('VALIDATING', 'REJECTED')) THEN
    RAISE EXCEPTION 'ASSET_TRANSITION: % → % no está permitido', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'ASSET_TRANSITION: un asset no cambia de autor' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP INDEX IF EXISTS assets_sha256_idx;
ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_ready_complete,
  DROP CONSTRAINT IF EXISTS assets_rejection_detail_only_rejected,
  DROP CONSTRAINT IF EXISTS assets_rejection_code_known,
  DROP COLUMN IF EXISTS rejection_detail,
  DROP COLUMN IF EXISTS container,
  DROP COLUMN IF EXISTS sha256;
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(UP).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
