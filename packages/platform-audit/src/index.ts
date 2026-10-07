import { randomUUID } from 'node:crypto';
import { canonicalize, sha256Hex } from '@trust/platform-contracts';
import type { Database } from '@trust/platform-db';
import { type Kysely, sql } from 'kysely';

/**
 * Auditoría — append-only y TAMPER-EVIDENT (revisión M3A.1, punto 2).
 *
 *   eventHash = SHA256( previousEventHash + canonicalEvent )      (JCS RFC 8785)
 *
 * La cadena se serializa: el append toma un lock exclusivo de transacción
 * ANTES de leer la cabeza, así que dos transacciones nunca calculan sobre el
 * mismo predecesor. La base lo garantiza además por su cuenta (trigger que
 * exige seq y predecesor correctos, y previous_event_hash UNIQUE).
 *
 * Qué NO promete: que sea imposible de alterar para alguien con control total
 * de la infraestructura. Promete que una alteración se DETECTA con verifyChain().
 */
export const AUDIT_LOCK_KEY = 7243100001;
export const GENESIS_HASH = '0'.repeat(64);

export type AuditAction =
  | 'ADVERTISER_CREATED' | 'CONTRACT_CREATED' | 'CONTRACT_UPDATED' | 'CAMPAIGN_CREATED' | 'DRAFT_UPDATED'
  | 'ASSET_UPLOADED' | 'ASSET_VALIDATION_STARTED' | 'ASSET_VALIDATED' | 'ASSET_REJECTED' | 'VERSION_SUBMITTED' | 'VERSION_APPROVED'
  | 'VERSION_REJECTED' | 'USER_CREATED' | 'ROLE_CHANGED' | 'FOUR_EYES_DISABLED';

export interface AuditInput {
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditRecord {
  id: string;
  seq: number;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  beforeHash: string | null;
  afterHash: string | null;
  metadata: Record<string, unknown>;
  previousEventHash: string;
  eventHash: string;
}

/** Lo que se hashea de un evento: todo menos los propios hashes de la cadena. */
export function canonicalEvent(e: Omit<AuditRecord, 'previousEventHash' | 'eventHash'>): string {
  return canonicalize({
    id: e.id,
    seq: e.seq,
    actorUserId: e.actorUserId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    occurredAt: e.occurredAt,
    beforeHash: e.beforeHash,
    afterHash: e.afterHash,
    metadata: e.metadata,
  });
}

export function eventHashOf(previousEventHash: string, canonical: string): string {
  return sha256Hex(previousEventHash + canonical);
}

/** Agrega un evento. Tiene que correr DENTRO de una transacción. */
export async function appendAuditEvent(trx: Kysely<Database>, input: AuditInput): Promise<AuditRecord> {
  if (!trx.isTransaction) throw new Error('appendAuditEvent exige una transacción: el lock vive lo que vive la transacción');
  await sql`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`.execute(trx);
  const head = await trx.selectFrom('audit_head').select(['last_seq', 'last_hash']).where('id', '=', 1).executeTakeFirstOrThrow();
  const base = {
    id: randomUUID(),
    seq: Number(head.last_seq) + 1,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    occurredAt: new Date().toISOString(),
    beforeHash: input.beforeHash ?? null,
    afterHash: input.afterHash ?? null,
    metadata: input.metadata ?? {},
  };
  const previousEventHash = head.last_hash;
  const eventHash = eventHashOf(previousEventHash, canonicalEvent(base));
  await trx
    .insertInto('audit_events')
    .values({
      id: base.id,
      seq: base.seq,
      actor_user_id: base.actorUserId,
      action: base.action,
      entity_type: base.entityType,
      entity_id: base.entityId,
      occurred_at: base.occurredAt,
      before_hash: base.beforeHash,
      after_hash: base.afterHash,
      metadata: JSON.stringify(base.metadata),
      previous_event_hash: previousEventHash,
      event_hash: eventHash,
    })
    .execute();
  return { ...base, previousEventHash, eventHash };
}

export interface ChainReport {
  ok: boolean;
  length: number;
  problems: string[];
}

/**
 * Verifica la cadena completa: secuencia continua desde 1, cada predecesor es
 * el hash del evento anterior (génesis = 64 ceros), cada eventHash se
 * recalcula igual, ningún predecesor se repite (sin forks) y la cabeza
 * coincide con el último evento.
 */
export async function verifyChain(db: Kysely<Database>): Promise<ChainReport> {
  const filas = await db.selectFrom('audit_events').selectAll().orderBy('seq', 'asc').execute();
  const head = await db.selectFrom('audit_head').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
  const problems: string[] = [];
  const predecesores = new Set<string>();
  let anterior = GENESIS_HASH;
  filas.forEach((f, i) => {
    const seq = Number(f.seq);
    if (seq !== i + 1) problems.push(`seq ${seq}: se esperaba ${i + 1} (secuencia discontinua)`);
    if (predecesores.has(f.previous_event_hash)) problems.push(`seq ${seq}: fork — predecesor repetido`);
    predecesores.add(f.previous_event_hash);
    if (f.previous_event_hash !== anterior) problems.push(`seq ${seq}: previousEventHash no es el hash del evento anterior`);
    const recalculado = eventHashOf(
      f.previous_event_hash,
      canonicalEvent({
        id: f.id,
        seq,
        actorUserId: f.actor_user_id,
        action: f.action,
        entityType: f.entity_type,
        entityId: f.entity_id,
        occurredAt: new Date(f.occurred_at as unknown as string).toISOString(),
        beforeHash: f.before_hash,
        afterHash: f.after_hash,
        metadata: f.metadata as unknown as Record<string, unknown>,
      }),
    );
    if (recalculado !== f.event_hash) problems.push(`seq ${seq}: eventHash no coincide (evento alterado)`);
    anterior = f.event_hash;
  });
  if (Number(head.last_seq) !== filas.length || head.last_hash !== anterior) problems.push('la cabeza de la cadena no coincide con el último evento');
  return { ok: problems.length === 0, length: filas.length, problems };
}
