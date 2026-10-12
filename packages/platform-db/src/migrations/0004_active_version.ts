import { type Kysely, sql } from 'kysely';

/**
 * 0004 — versión vigente administrativa (F3(a), brief `docs/briefs/F3A_REDEPLOY.md`,
 * ADR-064; Q0 = A y Q2 = A2.2 decididas por Fer en #52).
 *
 *   · `campaigns.active_version_id`: puntero de control plane a una versión
 *     APPROVED de ESTA campaña (FK compuesta + trigger). No implica Deploy.
 *   · Arranca en NULL para TODAS las campañas: no se copia
 *     `latest_approved_version_id` (A2.2: toda selección pide dos personas).
 *   · `active_version_changes`: pedido (PENDING) → CONFIRMED · CANCELLED · EXPIRED,
 *     una sola vez. Un solo PENDING por campaña. `requested_at` y `expires_at`
 *     los fija el reloj de la base.
 *   · La ÚNICA escritura de `active_version_id` es
 *     `trust_confirm_active_version_change` (SECURITY DEFINER, `search_path`
 *     terminado en `pg_temp`, sin EXECUTE para PUBLIC). `trust_app` pierde el
 *     UPDATE de tabla sobre `campaigns` y lo recupera columna por columna, sin
 *     `active_version_id`.
 *   · Cuatro ojos SIEMPRE (no depende de `four_eyes_required`): quien pidió no
 *     confirma. Lo chequea la app, la función y el trigger de la tabla.
 *
 * Reversible: el down borra lo nuevo sin tocar versiones ni aprobaciones y
 * devuelve el UPDATE de tabla que tenía `trust_app` en 0001.
 */
export const reversible = true;

/** Columnas de `campaigns` que `trust_app` sigue pudiendo actualizar (todas menos `active_version_id`, `id` y `created_at`). */
export const CAMPAIGN_APP_UPDATE_COLUMNS_0004 = ['contract_id', 'name', 'current_draft_id', 'latest_approved_version_id', 'lifecycle_status', 'updated_at'] as const;
const columnas = CAMPAIGN_APP_UPDATE_COLUMNS_0004.join(', ');

const UP = String.raw`
-- ── puntero ────────────────────────────────────────────────────────────
-- Sin DEFAULT ni backfill: todas las campañas quedan sin versión vigente.
ALTER TABLE campaigns ADD COLUMN active_version_id uuid;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_active_version_fk
  FOREIGN KEY (active_version_id, id) REFERENCES show_versions(id, campaign_id);

-- Segunda barrera: la vigente tiene una Approval APPROVED (las Approvals son inmutables).
CREATE FUNCTION trust_campaign_active_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM approvals ap WHERE ap.show_version_id = NEW.active_version_id AND ap.decision = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'ACTIVE_NOT_APPROVED: la versión % no tiene una aprobación APPROVED', NEW.active_version_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaigns_active_version BEFORE INSERT OR UPDATE OF active_version_id ON campaigns
  FOR EACH ROW EXECUTE FUNCTION trust_campaign_active_version();

-- ── pedidos de cambio ──────────────────────────────────────────────────
CREATE TABLE active_version_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id),
  from_version_id uuid,
  to_version_id   uuid NOT NULL,
  to_version_hash char(64) NOT NULL CHECK (to_version_hash ~ '^[0-9a-f]{64}$'),
  reason          text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  requested_by    uuid NOT NULL REFERENCES users(id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  -- origen y destino son de ESTA campaña (MATCH SIMPLE: from NULL = primera selección)
  CONSTRAINT avc_from_same_campaign FOREIGN KEY (from_version_id, campaign_id) REFERENCES show_versions(id, campaign_id),
  CONSTRAINT avc_to_same_campaign FOREIGN KEY (to_version_id, campaign_id) REFERENCES show_versions(id, campaign_id),
  CONSTRAINT avc_changes_something CHECK (to_version_id IS DISTINCT FROM from_version_id),
  CONSTRAINT avc_expiry_after_request CHECK (expires_at > requested_at),
  CONSTRAINT avc_decided_iff_terminal CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CONSTRAINT avc_decider CHECK (CASE status WHEN 'PENDING' THEN decided_by IS NULL
                                            WHEN 'EXPIRED' THEN decided_by IS NULL
                                            ELSE decided_by IS NOT NULL END),
  CONSTRAINT avc_four_eyes CHECK (status <> 'CONFIRMED' OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX avc_one_pending_per_campaign ON active_version_changes(campaign_id) WHERE status = 'PENDING';
CREATE INDEX avc_campaign_history_idx ON active_version_changes(campaign_id, requested_at DESC, id DESC);

-- Alta: siempre PENDING, con el reloj de la base, hacia una versión APPROVED con su hash exacto.
CREATE FUNCTION trust_avc_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h char(64);
BEGIN
  IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: un pedido nace PENDING' USING ERRCODE = 'P0001';
  END IF;
  NEW.requested_at := now();
  -- quien pide es un usuario habilitado con OPERATOR o ADMIN (misma regla que la ruta)
  IF NOT EXISTS (SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
                  WHERE u.id = NEW.requested_by AND u.enabled AND ur.role IN ('OPERATOR', 'ADMIN') AND ur.contract_id IS NULL) THEN
    RAISE EXCEPTION 'REQUESTER_NOT_AUTHORIZED: el usuario % no puede pedir cambios de versión vigente', NEW.requested_by USING ERRCODE = 'P0001';
  END IF;
  IF NEW.expires_at <= NEW.requested_at THEN
    RAISE EXCEPTION 'INVALID_EXPIRY: el pedido vence después de pedirse' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM approvals ap WHERE ap.show_version_id = NEW.to_version_id AND ap.decision = 'APPROVED') THEN
    RAISE EXCEPTION 'ACTIVE_NOT_APPROVED: la versión % no tiene una aprobación APPROVED', NEW.to_version_id USING ERRCODE = 'P0001';
  END IF;
  SELECT version_hash INTO h FROM show_versions WHERE id = NEW.to_version_id;
  IF h IS DISTINCT FROM NEW.to_version_hash THEN
    RAISE EXCEPTION 'VERSION_HASH_MISMATCH: el pedido no cita el hash de la versión %', NEW.to_version_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER avc_insert BEFORE INSERT ON active_version_changes FOR EACH ROW EXECUTE FUNCTION trust_avc_insert();

-- Una sola transición PENDING → terminal; nada más cambia. CONFIRMED solo desde
-- la función de confirmación (corre como el dueño de la tabla).
CREATE FUNCTION trust_avc_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' OR NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: el pedido % ya está %', OLD.id, OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW.campaign_id, NEW.from_version_id, NEW.to_version_id, NEW.to_version_hash, NEW.reason, NEW.requested_by, NEW.requested_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.campaign_id, OLD.from_version_id, OLD.to_version_id, OLD.to_version_hash, OLD.reason, OLD.requested_by, OLD.requested_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW: solo cambia el estado del pedido %', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'CONFIRMED' THEN
    IF NEW.decided_by = OLD.requested_by THEN
      RAISE EXCEPTION 'FOUR_EYES_VIOLATION: quien pidió el cambio no puede confirmarlo' USING ERRCODE = 'P0001';
    END IF;
    IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
      RAISE EXCEPTION 'CONFIRM_ONLY_VIA_FUNCTION: un pedido se confirma solo con trust_confirm_active_version_change' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.status = 'EXPIRED' AND OLD.expires_at > now() THEN
    RAISE EXCEPTION 'NOT_EXPIRED: el pedido % todavía no venció', OLD.id USING ERRCODE = 'P0001';
  END IF;
  NEW.decided_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER avc_transition BEFORE UPDATE ON active_version_changes FOR EACH ROW EXECUTE FUNCTION trust_avc_transition();
CREATE TRIGGER avc_no_delete BEFORE DELETE ON active_version_changes FOR EACH ROW EXECUTE FUNCTION trust_forbid_mutation();
CREATE TRIGGER avc_no_truncate BEFORE TRUNCATE ON active_version_changes FOR EACH STATEMENT EXECUTE FUNCTION trust_forbid_mutation();

-- ── confirmación: ÚNICA escritura de la vigente ────────────────────────
-- Devuelve el resultado en vez de fallar en los dos casos que terminalizan el
-- pedido (para que la app registre el audit y responda 409 con COMMIT):
-- Quien confirma tiene que ser un usuario habilitado con INTERNAL_APPROVER o
-- ADMIN: la función no confía en el UUID que le pasa la app (auditoría F3A #1).
--   'CONFIRMED' · 'EXPIRED' (venció según now()) · 'CONFLICT' (la vigente ya no
--   es la del pedido → CANCELLED). Lo demás es un error y no cambia nada.
CREATE FUNCTION trust_confirm_active_version_change(p_change_id uuid, p_actor uuid, p_version_hash text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_campaign uuid; r active_version_changes%ROWTYPE; v_active uuid;
BEGIN
  SELECT c.campaign_id INTO v_campaign FROM active_version_changes c WHERE c.id = p_change_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHANGE_NOT_FOUND: %', p_change_id USING ERRCODE = 'P0001'; END IF;
  -- mismo orden de locks que la app: campaña → pedido
  SELECT cp.active_version_id INTO v_active FROM campaigns cp WHERE cp.id = v_campaign FOR UPDATE;
  SELECT * INTO r FROM active_version_changes c WHERE c.id = p_change_id FOR UPDATE;
  IF r.status <> 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: el pedido % ya está %', r.id, r.status USING ERRCODE = 'P0001';
  END IF;
  IF p_actor IS NULL OR p_actor = r.requested_by THEN
    RAISE EXCEPTION 'FOUR_EYES_VIOLATION: quien pidió el cambio no puede confirmarlo' USING ERRCODE = 'P0001';
  END IF;
  -- "segunda persona AUTORIZADA" (A2.2): usuario habilitado con INTERNAL_APPROVER o ADMIN (roles internos, sin contrato)
  IF NOT EXISTS (SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
                  WHERE u.id = p_actor AND u.enabled AND ur.role IN ('INTERNAL_APPROVER', 'ADMIN') AND ur.contract_id IS NULL) THEN
    RAISE EXCEPTION 'CONFIRMER_NOT_AUTHORIZED: el usuario % no puede confirmar cambios de versión vigente', p_actor USING ERRCODE = 'P0001';
  END IF;
  IF p_version_hash IS DISTINCT FROM r.to_version_hash THEN
    RAISE EXCEPTION 'VERSION_HASH_MISMATCH: el hash no es el del pedido %', r.id USING ERRCODE = 'P0001';
  END IF;
  IF r.expires_at <= now() THEN
    UPDATE active_version_changes SET status = 'EXPIRED' WHERE id = r.id;
    RETURN 'EXPIRED';
  END IF;
  IF v_active IS DISTINCT FROM r.from_version_id THEN
    UPDATE active_version_changes SET status = 'CANCELLED', decided_by = p_actor WHERE id = r.id;
    RETURN 'CONFLICT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM approvals ap WHERE ap.show_version_id = r.to_version_id AND ap.decision = 'APPROVED'
                   AND ap.version_hash = r.to_version_hash) THEN
    RAISE EXCEPTION 'ACTIVE_NOT_APPROVED: la versión % no tiene una aprobación APPROVED', r.to_version_id USING ERRCODE = 'P0001';
  END IF;
  UPDATE campaigns SET active_version_id = r.to_version_id WHERE id = v_campaign;
  UPDATE active_version_changes SET status = 'CONFIRMED', decided_by = p_actor WHERE id = r.id;
  RETURN 'CONFIRMED';
END $$;

-- ── permisos ───────────────────────────────────────────────────────────
-- trust_app deja de poder escribir active_version_id: UPDATE por columna.
REVOKE UPDATE ON campaigns FROM trust_app;
GRANT UPDATE (${columnas}) ON campaigns TO trust_app;
-- pedidos: leer, crear y terminalizar (CANCELLED/EXPIRED); CONFIRMED solo por la función
GRANT SELECT, INSERT, UPDATE ON active_version_changes TO trust_app;
REVOKE ALL ON FUNCTION trust_confirm_active_version_change(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trust_confirm_active_version_change(uuid, uuid, text) TO trust_app;
`;

const DOWN = String.raw`
DROP FUNCTION IF EXISTS trust_confirm_active_version_change(uuid, uuid, text);
DROP TABLE IF EXISTS active_version_changes;
DROP FUNCTION IF EXISTS trust_avc_transition(), trust_avc_insert();
DROP TRIGGER IF EXISTS campaigns_active_version ON campaigns;
DROP FUNCTION IF EXISTS trust_campaign_active_version();
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_active_version_fk, DROP COLUMN IF EXISTS active_version_id;
REVOKE UPDATE (${columnas}) ON campaigns FROM trust_app;
GRANT UPDATE ON campaigns TO trust_app;
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(UP).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(DOWN).execute(db);
}
