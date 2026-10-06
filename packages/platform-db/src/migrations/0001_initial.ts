import { type Kysely, sql } from 'kysely';

/**
 * 0001 — esquema inicial de M3A.1 (Fase A).
 *
 * Reversible: es la migración fundacional sobre una base vacía. En producción
 * no se baja nunca (forward migration + backup); el `down` existe para el
 * smoke test de CI sobre una base descartable.
 *
 * Supone que el rol de runtime `trust_app` ya existe (bootstrap.sql). La
 * migración la corre `trust_owner`, dueño de las tablas.
 */
export const reversible = true;

const DDL = String.raw`
-- ── utilidades ─────────────────────────────────────────────────────────
CREATE FUNCTION trust_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Filas inmutables: ni UPDATE ni DELETE ni TRUNCATE, para nadie que pase por
-- la tabla. Es la segunda barrera: la primera es que trust_app no tiene esos
-- permisos.
CREATE FUNCTION trust_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_ROW: % sobre % no está permitido', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

-- ── identidad ──────────────────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  organization  text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── comercial ──────────────────────────────────────────────────────────
CREATE TABLE advertisers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      text NOT NULL CHECK (length(btrim(legal_name)) > 0),
  tax_id          text NOT NULL UNIQUE CHECK (length(btrim(tax_id)) > 0),
  commercial_name text,
  contacts        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contacts) = 'array'),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- allowed_surfaces: ids de pantalla del MODELO DEL EDIFICIO. La base no los
-- redefine (no hay CHECK con la lista): los valida la app contra EL_TRUST.
CREATE TABLE contracts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id             uuid NOT NULL REFERENCES advertisers(id),
  name                      text NOT NULL CHECK (length(btrim(name)) > 0),
  starts_at                 timestamptz NOT NULL,
  ends_at                   timestamptz NOT NULL,
  status                    text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED')),
  allowed_surfaces          text[] NOT NULL CHECK (cardinality(allowed_surfaces) > 0),
  four_eyes_required        boolean NOT NULL DEFAULT true,
  external_approval_enabled boolean NOT NULL DEFAULT false,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX contracts_advertiser_idx ON contracts(advertiser_id);

CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('OPERATOR', 'INTERNAL_APPROVER', 'ADMIN', 'EXTERNAL_APPROVER')),
  contract_id uuid REFERENCES contracts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- el aprobador externo existe SOLO atado a un contrato; los internos, nunca
  CHECK ((role = 'EXTERNAL_APPROVER') = (contract_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (user_id, role, contract_id)
);

CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  token_hash      char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_token_hash char(64) NOT NULL CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ── objetos físicos (content-addressed) ────────────────────────────────
CREATE TABLE stored_objects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256      char(64) NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- la clave SE DERIVA del contenido: sha256/ab/abcd…[.ext]. Nunca un nombre libre.
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ ('^sha256/' || substr(sha256, 1, 2) || '/' || sha256 || '(\.[a-z0-9]{1,8})?$')),
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── campañas ───────────────────────────────────────────────────────────
CREATE TABLE campaigns (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id                uuid NOT NULL REFERENCES contracts(id),
  name                       text NOT NULL CHECK (length(btrim(name)) > 0),
  current_draft_id           uuid,
  latest_approved_version_id uuid,
  lifecycle_status           text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_status IN ('ACTIVE', 'ARCHIVED')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_contract_idx ON campaigns(contract_id);

CREATE TABLE campaign_drafts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL REFERENCES campaigns(id),
  takeover_draft jsonb NOT NULL CHECK (jsonb_typeof(takeover_draft) = 'object'),
  revision       integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, campaign_id)            -- destino de FKs compuestas: el draft es de ESA campaña
);
CREATE INDEX campaign_drafts_campaign_idx ON campaign_drafts(campaign_id);

-- revisión monotónica: cada UPDATE avanza exactamente 1. Nunca last-write-wins.
CREATE FUNCTION trust_draft_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'DRAFT_REVISION: la revisión tiene que avanzar de a 1 (% → %)', OLD.revision, NEW.revision
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.campaign_id <> OLD.campaign_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'DRAFT_IDENTITY: un draft no cambia de campaña ni de autor' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ── assets ─────────────────────────────────────────────────────────────
-- surface_type: un formato derivado del modelo del edificio (towers_ab,
-- screen_a, ...). Lo valida la app con deriveSurfaceFormats(); la base no
-- repite la lista.
CREATE TABLE assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stored_object_id  uuid REFERENCES stored_objects(id),
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  mime_type         text,
  size_bytes        bigint CHECK (size_bytes > 0),
  width             integer CHECK (width > 0),
  height            integer CHECK (height > 0),
  fps               numeric(6, 3) CHECK (fps > 0),
  codec             text,
  duration_ms       integer CHECK (duration_ms > 0),
  surface_type      text NOT NULL,
  status            text NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING', 'VALIDATING', 'READY', 'REJECTED')),
  rejection_code    text,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'READY' OR (stored_object_id IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL
                               AND fps IS NOT NULL AND codec IS NOT NULL AND duration_ms IS NOT NULL)),
  CHECK ((status = 'REJECTED') = (rejection_code IS NOT NULL))
);
CREATE INDEX assets_stored_object_idx ON assets(stored_object_id);

-- ── versiones (inmutables) ─────────────────────────────────────────────
-- Sin columna de estado: SUBMITTED = sin Approval; APPROVED/REJECTED = la
-- decisión de su única Approval.
CREATE TABLE show_versions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                 uuid NOT NULL REFERENCES campaigns(id),
  source_draft_id             uuid NOT NULL,
  source_draft_revision       integer NOT NULL CHECK (source_draft_revision >= 1),
  version_number              integer NOT NULL CHECK (version_number >= 1),
  show_package                jsonb NOT NULL CHECK (jsonb_typeof(show_package) = 'object'),
  -- NO es único global: el mismo contenido en dos campañas son dos versiones
  -- comerciales distintas con el mismo hash.
  version_hash                char(64) NOT NULL CHECK (version_hash ~ '^[0-9a-f]{64}$'),
  hash_algorithm              text NOT NULL CHECK (hash_algorithm = 'sha256'),
  canonicalization_version    text NOT NULL,
  hash_envelope_version       integer NOT NULL CHECK (hash_envelope_version >= 1),
  show_package_schema_version integer NOT NULL CHECK (show_package_schema_version >= 1),
  compiler_version            text NOT NULL,
  submitted_by                uuid NOT NULL REFERENCES users(id),
  submitted_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version_number),
  UNIQUE (id, campaign_id),           -- destino de FKs compuestas
  FOREIGN KEY (source_draft_id, campaign_id) REFERENCES campaign_drafts(id, campaign_id)
);
CREATE INDEX show_versions_hash_idx ON show_versions(version_hash);

CREATE TABLE show_version_assets (
  show_version_id uuid NOT NULL REFERENCES show_versions(id),
  logical_ref     text NOT NULL CHECK (length(logical_ref) > 0),
  asset_id        uuid NOT NULL REFERENCES assets(id),
  -- Deploy resuelve el blob físico inmutable directo desde acá.
  stored_object_id uuid NOT NULL REFERENCES stored_objects(id),
  sha256          char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (show_version_id, logical_ref)
);

-- Un asset solo entra a una versión si está READY, y el manifiesto declara
-- exactamente SU objeto físico y SU sha256.
-- SELLADO: solo se pueden agregar entradas a una versión creada en ESTA misma
-- transacción (xmin de la fila = transacción actual). Después del commit, ni
-- trust_app ni el dueño del esquema pueden agregar un logicalRef.
CREATE FUNCTION trust_version_asset_ready() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; obj uuid; sha char(64);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM show_versions sv
     WHERE sv.id = NEW.show_version_id
       AND sv.xmin = (pg_current_xact_id()::text::bigint % 4294967296)::text::xid
  ) THEN
    RAISE EXCEPTION 'VERSION_SEALED: la versión % ya está sellada; su manifiesto no admite entradas nuevas', NEW.show_version_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT a.status, a.stored_object_id, o.sha256 INTO st, obj, sha
    FROM assets a LEFT JOIN stored_objects o ON o.id = a.stored_object_id WHERE a.id = NEW.asset_id;
  IF st IS DISTINCT FROM 'READY' THEN
    RAISE EXCEPTION 'ASSET_NOT_READY: el asset % está %', NEW.asset_id, coalesce(st, 'inexistente') USING ERRCODE = 'P0001';
  END IF;
  IF obj IS DISTINCT FROM NEW.stored_object_id THEN
    RAISE EXCEPTION 'ASSET_OBJECT_MISMATCH: el objeto físico declarado no es el del asset' USING ERRCODE = 'P0001';
  END IF;
  IF sha IS DISTINCT FROM NEW.sha256 THEN
    RAISE EXCEPTION 'ASSET_SHA_MISMATCH: el sha256 declarado no es el del objeto físico' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- 2D: la versión fotografía la revisión EXACTA del draft en ese instante.
CREATE FUNCTION trust_version_draft_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r integer;
BEGIN
  SELECT revision INTO r FROM campaign_drafts WHERE id = NEW.source_draft_id FOR SHARE;
  IF r IS DISTINCT FROM NEW.source_draft_revision THEN
    RAISE EXCEPTION 'VERSION_DRAFT_REVISION_MISMATCH: el draft está en revisión %, la versión dice %', r, NEW.source_draft_revision
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- 3: transiciones de Asset. UPLOADING → VALIDATING → READY;
-- UPLOADING/VALIDATING → REJECTED. READY y REJECTED son terminales: la
-- identidad y el contenido técnico quedan congelados.
CREATE FUNCTION trust_asset_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'UPLOADING' THEN
    RAISE EXCEPTION 'ASSET_TRANSITION: un asset nace UPLOADING, no %', NEW.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION trust_asset_transition() RETURNS trigger LANGUAGE plpgsql AS $$
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

-- ── evidencia y aprobaciones (inmutables) ──────────────────────────────
CREATE TABLE approval_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              text NOT NULL CHECK (type IN ('EMAIL', 'PDF', 'MESSAGE', 'OTHER')),
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  stored_object_id  uuid NOT NULL REFERENCES stored_objects(id),
  uploaded_by       uuid NOT NULL REFERENCES users(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_version_id uuid NOT NULL UNIQUE REFERENCES show_versions(id), -- una decisión final por versión
  decision        text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  evidence_id     uuid REFERENCES approval_evidence(id),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'APPROVED' OR evidence_id IS NOT NULL),
  CHECK (decision <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0))
);

-- Cuatro ojos POR CONTRATO: quien envió no aprueba su propia versión si el
-- contrato lo exige (default: lo exige).
CREATE FUNCTION trust_four_eyes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submitter uuid; required boolean;
BEGIN
  SELECT v.submitted_by, c.four_eyes_required INTO submitter, required
    FROM show_versions v
    JOIN campaigns cp ON cp.id = v.campaign_id
    JOIN contracts c ON c.id = cp.contract_id
   WHERE v.id = NEW.show_version_id;
  IF NEW.decision = 'APPROVED' AND required AND NEW.actor_user_id = submitter THEN
    RAISE EXCEPTION 'FOUR_EYES_VIOLATION: quien envió la versión no puede aprobarla' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- 2A/2B: el draft actual y la última versión aprobada son de ESTA campaña.
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_current_draft_fk FOREIGN KEY (current_draft_id, id)
      REFERENCES campaign_drafts(id, campaign_id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT campaigns_latest_approved_fk FOREIGN KEY (latest_approved_version_id, id)
      REFERENCES show_versions(id, campaign_id) DEFERRABLE INITIALLY DEFERRED;

-- 2B: y la "última aprobada" tiene que tener una Approval APPROVED. Como las
-- aprobaciones son inmutables, una vez cierto, sigue siendo cierto.
CREATE FUNCTION trust_campaign_latest_approved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latest_approved_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM approvals ap WHERE ap.show_version_id = NEW.latest_approved_version_id AND ap.decision = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'LATEST_NOT_APPROVED: la versión % no tiene una aprobación APPROVED', NEW.latest_approved_version_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- 1: ÚNICO camino para crear una versión: versión + manifiesto completo, en
-- una sola llamada atómica. trust_app no tiene INSERT directo sobre
-- show_versions ni show_version_assets. El número de versión se asigna con la
-- campaña bloqueada (sin carreras).
CREATE FUNCTION trust_create_show_version(
  p_campaign_id uuid, p_source_draft_id uuid, p_source_draft_revision integer, p_show_package jsonb,
  p_version_hash text, p_hash_algorithm text, p_canonicalization_version text, p_hash_envelope_version integer,
  p_show_package_schema_version integer, p_compiler_version text, p_submitted_by uuid, p_assets jsonb
) RETURNS TABLE (out_id uuid, out_version_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_n integer; a jsonb; n_ins integer;
BEGIN
  PERFORM 1 FROM campaigns c WHERE c.id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND: %', p_campaign_id USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(p_assets) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'MANIFEST_INVALID: el manifiesto tiene que ser un arreglo' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(max(sv.version_number), 0) + 1 INTO v_n FROM show_versions sv WHERE sv.campaign_id = p_campaign_id;
  INSERT INTO show_versions (campaign_id, source_draft_id, source_draft_revision, version_number, show_package, version_hash,
                             hash_algorithm, canonicalization_version, hash_envelope_version, show_package_schema_version,
                             compiler_version, submitted_by)
  VALUES (p_campaign_id, p_source_draft_id, p_source_draft_revision, v_n, p_show_package, p_version_hash,
          p_hash_algorithm, p_canonicalization_version, p_hash_envelope_version, p_show_package_schema_version,
          p_compiler_version, p_submitted_by)
  RETURNING show_versions.id INTO v_id;
  FOR a IN SELECT value FROM jsonb_array_elements(p_assets) LOOP
    INSERT INTO show_version_assets (show_version_id, logical_ref, asset_id, stored_object_id, sha256)
    SELECT v_id, a->>'logicalRef', ast.id, ast.stored_object_id, a->>'sha256'
      FROM assets ast WHERE ast.id = (a->>'assetId')::uuid;
    GET DIAGNOSTICS n_ins = ROW_COUNT;
    IF n_ins <> 1 THEN RAISE EXCEPTION 'ASSET_NOT_FOUND: %', a->>'assetId' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  RETURN QUERY SELECT v_id, v_n;
END $$;

-- ── idempotencia ───────────────────────────────────────────────────────
CREATE TABLE idempotency_keys (
  key                 text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  actor_id            uuid NOT NULL REFERENCES users(id),
  operation           text NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  response_status     integer,
  response_body       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  PRIMARY KEY (actor_id, key),
  CHECK (expires_at > created_at)
);

-- ── auditoría (append-only, tamper-evident, serializada) ───────────────
CREATE TABLE audit_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint NOT NULL UNIQUE CHECK (seq >= 1),
  actor_user_id       uuid REFERENCES users(id),
  action              text NOT NULL,
  entity_type         text NOT NULL,
  entity_id           uuid,
  occurred_at         timestamptz NOT NULL,
  before_hash         text,
  after_hash          text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  previous_event_hash char(64) NOT NULL UNIQUE CHECK (previous_event_hash ~ '^[0-9a-f]{64}$'), -- sin forks
  event_hash          char(64) NOT NULL UNIQUE CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

-- Cabeza de la cadena: una sola fila. La mantiene el trigger, no la app.
CREATE TABLE audit_head (
  id       smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_seq bigint NOT NULL CHECK (last_seq >= 0),
  last_hash char(64) NOT NULL CHECK (last_hash ~ '^[0-9a-f]{64}$')
);
INSERT INTO audit_head (id, last_seq, last_hash) VALUES (1, 0, repeat('0', 64));

-- Serializa la cadena dentro de la transacción y exige secuencia continua y
-- predecesor correcto. La app toma el MISMO lock antes de leer la cabeza, así
-- que dos transacciones nunca calculan sobre el mismo predecesor; si una lo
-- intentara igual, este trigger (y el UNIQUE de previous_event_hash) la frena.
CREATE FUNCTION trust_audit_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h audit_head%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(7243100001);
  SELECT * INTO h FROM audit_head WHERE id = 1 FOR UPDATE;
  IF NEW.seq <> h.last_seq + 1 THEN
    RAISE EXCEPTION 'AUDIT_SEQ: se esperaba seq % y llegó %', h.last_seq + 1, NEW.seq USING ERRCODE = 'P0001';
  END IF;
  IF NEW.previous_event_hash <> h.last_hash THEN
    RAISE EXCEPTION 'AUDIT_FORK: el predecesor no es la cabeza de la cadena' USING ERRCODE = 'P0001';
  END IF;
  UPDATE audit_head SET last_seq = NEW.seq, last_hash = NEW.event_hash WHERE id = 1;
  RETURN NEW;
END $$;

-- ── triggers ───────────────────────────────────────────────────────────
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trust_set_updated_at();
CREATE TRIGGER advertisers_updated BEFORE UPDATE ON advertisers FOR EACH ROW EXECUTE FUNCTION trust_set_updated_at();
CREATE TRIGGER contracts_updated BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION trust_set_updated_at();
CREATE TRIGGER campaigns_updated BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION trust_set_updated_at();
CREATE TRIGGER assets_updated BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION trust_set_updated_at();
CREATE TRIGGER drafts_revision BEFORE UPDATE ON campaign_drafts FOR EACH ROW EXECUTE FUNCTION trust_draft_revision();
CREATE TRIGGER drafts_updated BEFORE UPDATE ON campaign_drafts FOR EACH ROW EXECUTE FUNCTION trust_set_updated_at();
CREATE TRIGGER version_assets_ready BEFORE INSERT ON show_version_assets FOR EACH ROW EXECUTE FUNCTION trust_version_asset_ready();
CREATE TRIGGER versions_draft_snapshot BEFORE INSERT ON show_versions FOR EACH ROW EXECUTE FUNCTION trust_version_draft_snapshot();
CREATE TRIGGER assets_insert BEFORE INSERT ON assets FOR EACH ROW EXECUTE FUNCTION trust_asset_insert();
CREATE TRIGGER assets_transition BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION trust_asset_transition();
CREATE TRIGGER campaigns_latest_approved BEFORE INSERT OR UPDATE OF latest_approved_version_id ON campaigns FOR EACH ROW EXECUTE FUNCTION trust_campaign_latest_approved();
CREATE TRIGGER approvals_four_eyes BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION trust_four_eyes();
CREATE TRIGGER audit_append BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION trust_audit_append();

CREATE TRIGGER stored_objects_immutable BEFORE UPDATE OR DELETE ON stored_objects FOR EACH ROW EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER show_versions_immutable BEFORE UPDATE OR DELETE ON show_versions FOR EACH ROW EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER version_assets_immutable BEFORE UPDATE OR DELETE ON show_version_assets FOR EACH ROW EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON approval_evidence FOR EACH ROW EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER approvals_immutable BEFORE UPDATE OR DELETE ON approvals FOR EACH ROW EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION trust_forbid_mutation();

CREATE TRIGGER stored_objects_no_truncate BEFORE TRUNCATE ON stored_objects FOR EACH STATEMENT EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER show_versions_no_truncate BEFORE TRUNCATE ON show_versions FOR EACH STATEMENT EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER version_assets_no_truncate BEFORE TRUNCATE ON show_version_assets FOR EACH STATEMENT EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER evidence_no_truncate BEFORE TRUNCATE ON approval_evidence FOR EACH STATEMENT EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON approvals FOR EACH STATEMENT EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION trust_forbid_mutation();

-- ── permisos del usuario de runtime ────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO trust_app;
GRANT SELECT, INSERT, UPDATE ON users, advertisers, contracts, campaigns, campaign_drafts, assets TO trust_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles, sessions, idempotency_keys TO trust_app;
-- inmutables: solo leer y agregar
GRANT SELECT, INSERT ON stored_objects, approval_evidence, approvals, audit_events TO trust_app;
-- versión y manifiesto: solo lectura directa; se crean por la función atómica
GRANT SELECT ON show_versions, show_version_assets TO trust_app;
REVOKE ALL ON FUNCTION trust_create_show_version(uuid, uuid, integer, jsonb, text, text, text, integer, integer, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trust_create_show_version(uuid, uuid, integer, jsonb, text, text, text, integer, integer, text, uuid, jsonb) TO trust_app;
GRANT SELECT ON audit_head TO trust_app;
`;

const DOWN = String.raw`
DROP TABLE IF EXISTS audit_head, audit_events, idempotency_keys, approvals, approval_evidence,
  show_version_assets, show_versions, assets, campaign_drafts, campaigns, stored_objects,
  sessions, user_roles, contracts, advertisers, users CASCADE;
DROP FUNCTION IF EXISTS trust_create_show_version(uuid, uuid, integer, jsonb, text, text, text, integer, integer, text, uuid, jsonb);
DROP FUNCTION IF EXISTS trust_audit_append(), trust_four_eyes(), trust_version_asset_ready(), trust_version_draft_snapshot(),
  trust_asset_insert(), trust_asset_transition(), trust_campaign_latest_approved(),
  trust_draft_revision(), trust_forbid_mutation(), trust_set_updated_at();
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(DDL).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
