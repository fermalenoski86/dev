import type { ColumnType, Generated } from 'kysely';

/** Tipos de tabla para Kysely. La fuente de verdad es la migración. */
type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsReq = ColumnType<Date, Date | string, Date | string>;
type Json<T = unknown> = ColumnType<T, string, string>;

export interface UsersTable { id: Generated<string>; name: string; email: string; password_hash: string; organization: string; enabled: Generated<boolean>; created_at: Ts; updated_at: Ts }
export interface AdvertisersTable { id: Generated<string>; legal_name: string; tax_id: string; commercial_name: string | null; contacts: Json; status: Generated<'ACTIVE' | 'INACTIVE'>; created_at: Ts; updated_at: Ts }
export interface ContractsTable { id: Generated<string>; advertiser_id: string; name: string; starts_at: TsReq; ends_at: TsReq; status: Generated<'DRAFT' | 'ACTIVE' | 'ENDED' | 'CANCELLED'>; allowed_surfaces: string[]; four_eyes_required: Generated<boolean>; external_approval_enabled: Generated<boolean>; metadata: Json; created_at: Ts; updated_at: Ts }
export type Role = 'OPERATOR' | 'INTERNAL_APPROVER' | 'ADMIN' | 'EXTERNAL_APPROVER';
export interface UserRolesTable { id: Generated<string>; user_id: string; role: Role; contract_id: string | null; created_at: Ts }
export interface SessionsTable { id: Generated<string>; user_id: string; token_hash: string; csrf_token_hash: string; created_at: Ts; expires_at: TsReq; revoked_at: Date | null }
export interface StoredObjectsTable { id: Generated<string>; sha256: string; storage_key: string; mime_type: string; size_bytes: ColumnType<string, number | string, never>; created_at: Ts }
export interface CampaignsTable { id: Generated<string>; contract_id: string; name: string; current_draft_id: string | null; latest_approved_version_id: string | null; lifecycle_status: Generated<'ACTIVE' | 'ARCHIVED'>; created_at: Ts; updated_at: Ts }
export interface CampaignDraftsTable { id: Generated<string>; campaign_id: string; takeover_draft: Json; revision: Generated<number>; created_by: string; created_at: Ts; updated_at: Ts }
export type AssetStatus = 'UPLOADING' | 'VALIDATING' | 'READY' | 'REJECTED';
export interface AssetsTable { id: Generated<string>; stored_object_id: string | null; original_filename: string; mime_type: string | null; size_bytes: string | number | null; width: number | null; height: number | null; fps: string | number | null; codec: string | null; duration_ms: number | null; surface_type: string; status: Generated<AssetStatus>; rejection_code: string | null; created_by: string; created_at: Ts; updated_at: Ts }
export interface ShowVersionsTable { id: Generated<string>; campaign_id: string; source_draft_id: string; source_draft_revision: number; version_number: number; show_package: Json; version_hash: string; hash_algorithm: string; canonicalization_version: string; hash_envelope_version: number; show_package_schema_version: number; compiler_version: string; submitted_by: string; submitted_at: Ts }
export interface ShowVersionAssetsTable { show_version_id: string; logical_ref: string; asset_id: string; stored_object_id: string; sha256: string }
export interface ApprovalEvidenceTable { id: Generated<string>; type: 'EMAIL' | 'PDF' | 'MESSAGE' | 'OTHER'; original_filename: string; stored_object_id: string; uploaded_by: string; uploaded_at: Ts }
export interface ApprovalsTable { id: Generated<string>; show_version_id: string; decision: 'APPROVED' | 'REJECTED'; actor_user_id: string; evidence_id: string | null; reason: string | null; created_at: Ts }
export interface IdempotencyKeysTable { key: string; actor_id: string; operation: string; request_fingerprint: string; response_status: number | null; response_body: Json | null; created_at: Ts; expires_at: TsReq }
export interface AuditEventsTable { id: Generated<string>; seq: ColumnType<string, number | string, never>; actor_user_id: string | null; action: string; entity_type: string; entity_id: string | null; occurred_at: TsReq; before_hash: string | null; after_hash: string | null; metadata: Json; previous_event_hash: string; event_hash: string }
export interface AuditHeadTable { id: number; last_seq: string; last_hash: string }

export interface Database {
  users: UsersTable; advertisers: AdvertisersTable; contracts: ContractsTable; user_roles: UserRolesTable; sessions: SessionsTable;
  stored_objects: StoredObjectsTable; campaigns: CampaignsTable; campaign_drafts: CampaignDraftsTable; assets: AssetsTable;
  show_versions: ShowVersionsTable; show_version_assets: ShowVersionAssetsTable; approval_evidence: ApprovalEvidenceTable;
  approvals: ApprovalsTable; idempotency_keys: IdempotencyKeysTable; audit_events: AuditEventsTable; audit_head: AuditHeadTable;
}
