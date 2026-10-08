import { appendAuditEvent } from '@trust/platform-audit';
import { type Principal, type Role, hasAnyRole } from '@trust/platform-auth';
import { exigirSuperficies } from '@trust/platform-campaigns';
import { SHOW_AUTHORING_VERSION, type SurfaceFormatId, computeVersionHash } from '@trust/platform-contracts';
import { type Database, type ManifestEntry, createShowVersion, requestFingerprint, withIdempotency } from '@trust/platform-db';
import { AssetRegistry, type CampaignSurfaces, safeParseTakeoverDraft, validateDraft } from '@trust/show-authoring';
import { DEMO_SCENES, EL_TRUST } from '@trust/show-engine';
import type { Kysely } from 'kysely';
import { ApprovalError } from './errors';
import type { ApprovalService, ShowVersionView } from './service';

/**
 * Submit — M3A.1 Fase C3 (§17 "Enviar", §27, §28), decisión 1 del brief C.
 *
 * `POST /campaigns/:id/submit` sobre el Draft que YA está en la base (sin CRUD
 * de Campaign ni sync del Builder: eso es Fase D). En UNA transacción, con la
 * campaña bloqueada:
 *
 *   1. campaña ACTIVE con draft actual, en la revisión que el cliente dice
 *      haber visto (`draftRevision`): si no, 409 DRAFT_REVISION_MISMATCH;
 *   2. esa revisión no se envió todavía (otra vez → 409 INVALID_STATE_TRANSITION:
 *      "nueva edición → SUBMITTED nuevo");
 *   3. el draft parsea contra TakeoverDraftSchema (422 DRAFT_INVALID) y no usa
 *      pantallas fuera de `allowed_surfaces` del contrato (master §6, D1:
 *      422 SURFACE_NOT_CONTRACTED);
 *   4. cada ranura de asset apunta a un Asset READY de la superficie que le
 *      corresponde (422 ASSET_NOT_READY / ASSET_SURFACE_MISMATCH);
 *   5. COMPILA y corre el PREFLIGHT server-side con el mismo código que el
 *      Builder (`validateDraft`: compilador + `preflightShow` del motor) contra
 *      el modelo real del edificio; cualquier error → 422 PREFLIGHT_FAILED;
 *   6. hash determinista (sobre del punto 8: ShowPackage + [logicalRef, sha256]);
 *   7. `createShowVersion` (función atómica: versión + manifiesto sellado) +
 *      `VERSION_SUBMITTED` en la misma transacción.
 *
 * Idempotency-Key obligatoria: un retry devuelve la misma versión y nunca
 * crea dos.
 *
 * El `source` de cada asset en el ShowPackage se DERIVA del contenido
 * (`/assets/sha256/<sha256>.mp4`), nunca del UUID ni del nombre de archivo:
 * así el hash depende de los bytes y no de identificadores de la base.
 */
export const SUBMIT_OPERATION = 'campaign.submit';
export const SUBMIT_ROLES: readonly Role[] = ['OPERATOR', 'ADMIN'];

/** Ranura del draft → formato de superficie (derivado del modelo del edificio). */
export const SLOT_SURFACE: Readonly<Record<keyof Omit<CampaignSurfaces, 'upperMode' | 'includeHorizontalInMaster'>, SurfaceFormatId>> = {
  masterAssetId: 'towers_ab',
  corrientesAssetId: 'screen_a',
  pellegriniAssetId: 'screen_b',
  horizontalAssetId: 'horizontal',
};

export const assetSourceFor = (sha256: string): string => `/assets/sha256/${sha256}.mp4`;

export interface SubmitInput {
  actor: Principal;
  campaignId: string;
  draftRevision: number;
  idempotencyKey: string;
}

export async function submitCampaign(
  deps: { db: Kysely<Database>; approvals: ApprovalService },
  input: SubmitInput,
): Promise<{ version: ShowVersionView; replayed: boolean }> {
  if (!hasAnyRole(input.actor, SUBMIT_ROLES)) throw new ApprovalError(403, 'FORBIDDEN', 'Enviar requiere OPERATOR o ADMIN.');
  const fingerprint = requestFingerprint(SUBMIT_OPERATION, { campaignId: input.campaignId, draftRevision: input.draftRevision });
  const r = await withIdempotency(deps.db, { key: input.idempotencyKey, actorId: input.actor.userId, operation: SUBMIT_OPERATION, fingerprint }, async (trx) => {
    const cp = await trx
      .selectFrom('campaigns')
      .select(['id', 'contract_id', 'current_draft_id', 'lifecycle_status'])
      .where('id', '=', input.campaignId)
      .forUpdate()
      .executeTakeFirst();
    if (!cp) throw new ApprovalError(404, 'CAMPAIGN_NOT_FOUND', 'La campaña no existe.');
    if (cp.lifecycle_status !== 'ACTIVE') {
      throw new ApprovalError(409, 'INVALID_STATE_TRANSITION', 'La campaña está archivada: no se envía.', { lifecycleStatus: cp.lifecycle_status });
    }
    if (!cp.current_draft_id) throw new ApprovalError(409, 'DRAFT_NOT_FOUND', 'La campaña no tiene un draft para enviar.');
    const d = await trx.selectFrom('campaign_drafts').select(['id', 'revision', 'takeover_draft']).where('id', '=', cp.current_draft_id).executeTakeFirstOrThrow();
    if (d.revision !== input.draftRevision) {
      throw new ApprovalError(409, 'DRAFT_REVISION_MISMATCH', 'El draft cambió: se envía la revisión que se vio.', { currentRevision: d.revision });
    }
    const previa = await trx
      .selectFrom('show_versions')
      .select(['id', 'version_number'])
      .where('source_draft_id', '=', d.id)
      .where('source_draft_revision', '=', d.revision)
      .executeTakeFirst();
    if (previa) {
      throw new ApprovalError(409, 'INVALID_STATE_TRANSITION', 'Esa revisión del draft ya se envió: editá el draft para enviar una versión nueva.', {
        showVersionId: previa.id, versionNumber: previa.version_number,
      });
    }

    const parsed = safeParseTakeoverDraft(d.takeover_draft);
    if (!parsed.success) {
      throw new ApprovalError(422, 'DRAFT_INVALID', 'El draft guardado no es un TakeoverDraft válido.', {
        issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const draft = parsed.data;

    // §6 (D1): el draft no usa pantallas fuera del contrato VIGENTE al enviar.
    const ct = await trx.selectFrom('contracts').select('allowed_surfaces').where('id', '=', cp.contract_id).executeTakeFirstOrThrow();
    exigirSuperficies(draft, ct.allowed_surfaces);

    // Ranuras usadas → Assets READY de la superficie correcta.
    const slots = (Object.keys(SLOT_SURFACE) as Array<keyof typeof SLOT_SURFACE>)
      .map((slot) => ({ slot, assetId: draft.surfaces[slot] }))
      .filter((s): s is { slot: keyof typeof SLOT_SURFACE; assetId: string } => typeof s.assetId === 'string' && s.assetId.length > 0);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = [...new Set(slots.map((s) => s.assetId).filter((id) => uuid.test(id)))];
    const filas = ids.length
      ? await trx
          .selectFrom('assets as a')
          .leftJoin('stored_objects as o', 'o.id', 'a.stored_object_id')
          .select(['a.id', 'a.status', 'a.surface_type', 'a.original_filename', 'a.width', 'a.height', 'a.duration_ms', 'o.sha256'])
          .where('a.id', 'in', ids)
          .execute()
      : [];
    const porId = new Map(filas.map((f) => [f.id, f]));
    const manifest: ManifestEntry[] = [];
    const registry = new AssetRegistry();
    for (const { slot, assetId } of slots) {
      const a = porId.get(assetId);
      if (!a || a.status !== 'READY' || !a.sha256 || !a.width || !a.height) {
        throw new ApprovalError(422, 'ASSET_NOT_READY', 'Un asset del draft no existe o no está READY.', { logicalRef: slot, status: a?.status ?? null });
      }
      if (a.surface_type !== SLOT_SURFACE[slot]) {
        throw new ApprovalError(422, 'ASSET_SURFACE_MISMATCH', 'El asset no es de la superficie de su ranura.', {
          logicalRef: slot, expected: SLOT_SURFACE[slot], actual: a.surface_type,
        });
      }
      manifest.push({ logicalRef: slot, assetId: a.id, sha256: a.sha256 });
      if (!registry.has(a.id)) {
        registry.register({
          id: a.id, name: a.original_filename, type: 'video', source: assetSourceFor(a.sha256),
          width: a.width, height: a.height, durationMs: a.duration_ms ?? undefined, tags: [], unmanaged: false,
        });
      }
    }

    // Compilación + preflight server-side: el MISMO código que el Builder, contra el edificio real.
    const v = validateDraft(draft, { building: EL_TRUST, assets: registry, sceneIds: new Set(DEMO_SCENES.keys()), preflight: { building: EL_TRUST, scenes: DEMO_SCENES } });
    if (!v.exportable || !v.compile.showPackage) {
      throw new ApprovalError(422, 'PREFLIGHT_FAILED', 'El draft no pasa el preflight: no se crea la versión.', {
        errors: v.errors.slice(0, 50).map((e) => ({ code: e.code, origin: e.origin, message: e.message, ...(e.momentId ? { momentId: e.momentId } : {}) })),
      });
    }
    const showPackage = v.compile.showPackage;
    const h = computeVersionHash(showPackage, manifest.map((m) => ({ logicalRef: m.logicalRef, sha256: m.sha256 })));

    const created = await createShowVersion(
      trx,
      {
        campaignId: cp.id, sourceDraftId: d.id, sourceDraftRevision: d.revision, showPackage, versionHash: h.versionHash,
        hashAlgorithm: h.hashAlgorithm, canonicalizationVersion: h.canonicalizationVersion, hashEnvelopeVersion: h.hashEnvelopeVersion,
        showPackageSchemaVersion: h.showPackageSchemaVersion, compilerVersion: SHOW_AUTHORING_VERSION, submittedBy: input.actor.userId, assets: manifest,
      },
      (t, ver) =>
        appendAuditEvent(t, {
          actorUserId: input.actor.userId, action: 'VERSION_SUBMITTED', entityType: 'show_version', entityId: ver.id, afterHash: h.versionHash,
          metadata: {
            campaignId: cp.id, contractId: cp.contract_id, versionNumber: ver.versionNumber, sourceDraftId: d.id, sourceDraftRevision: d.revision,
            compilerVersion: SHOW_AUTHORING_VERSION, assets: manifest.length, preflightWarnings: v.warnings.length,
          },
        }),
    );
    return { status: 201, body: await deps.approvals.viewVersion(trx, created.id) };
  });
  return { version: r.body, replayed: r.replayed };
}
