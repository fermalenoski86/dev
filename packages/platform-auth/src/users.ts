import { appendAuditEvent } from '@trust/platform-audit';
import type { Database, Role } from '@trust/platform-db';
import type { Kysely } from 'kysely';
import { hashPassword } from './password';
import { revokeAllSessions } from './sessions';

/**
 * Alta de usuarios y cambio de roles — §21, §22, §27.
 * Solo los usa la CLI de administración (por API no se crean usuarios).
 * Cada cambio va con su audit en la MISMA transacción; un cambio de roles
 * revoca todas las sesiones del usuario (rotación por cambio de privilegios).
 */
export const normalizeEmail = (email: string): string => email.normalize('NFC').trim().toLowerCase();

export interface RoleGrant {
  role: Role;
  contractId?: string | null;
}

export interface NewUser {
  name: string;
  email: string;
  password: string;
  organization: string;
  roles: RoleGrant[];
}

const grantKey = (g: RoleGrant) => `${g.role}:${g.contractId ?? ''}`;

export async function createUser(db: Kysely<Database>, input: NewUser, actorUserId: string | null = null): Promise<{ id: string; email: string }> {
  const email = normalizeEmail(input.email);
  const password_hash = await hashPassword(input.password);
  return db.transaction().execute(async (trx) => {
    const u = await trx
      .insertInto('users')
      .values({ name: input.name.trim(), email, password_hash, organization: input.organization.trim() })
      .returning(['id', 'email'])
      .executeTakeFirstOrThrow();
    const grants = dedupe(input.roles);
    if (grants.length > 0) {
      await trx.insertInto('user_roles').values(grants.map((g) => ({ user_id: u.id, role: g.role, contract_id: g.contractId ?? null }))).execute();
    }
    await appendAuditEvent(trx, {
      actorUserId,
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: u.id,
      // ni email ni hash: el id alcanza para rastrear, y el audit no es un directorio de personas
      metadata: { roles: grants.map(grantKey).sort() },
    });
    return u;
  });
}

/** Reemplaza el conjunto de roles. Revoca todas las sesiones si cambió algo. */
export async function setUserRoles(db: Kysely<Database>, userId: string, roles: RoleGrant[], actorUserId: string | null = null): Promise<{ changed: boolean; revokedSessions: number }> {
  return db.transaction().execute(async (trx) => {
    const before = (await trx.selectFrom('user_roles').select(['role', 'contract_id']).where('user_id', '=', userId).execute())
      .map((r) => grantKey({ role: r.role, contractId: r.contract_id }))
      .sort();
    const grants = dedupe(roles);
    const after = grants.map(grantKey).sort();
    if (before.join('|') === after.join('|')) return { changed: false, revokedSessions: 0 };
    await trx.deleteFrom('user_roles').where('user_id', '=', userId).execute();
    if (grants.length > 0) {
      await trx.insertInto('user_roles').values(grants.map((g) => ({ user_id: userId, role: g.role, contract_id: g.contractId ?? null }))).execute();
    }
    const revokedSessions = await revokeAllSessions(trx, userId);
    await appendAuditEvent(trx, { actorUserId, action: 'ROLE_CHANGED', entityType: 'user', entityId: userId, metadata: { before, after, revokedSessions } });
    return { changed: true, revokedSessions };
  });
}

function dedupe(gs: RoleGrant[]): RoleGrant[] {
  const m = new Map<string, RoleGrant>();
  for (const g of gs) m.set(grantKey(g), { role: g.role, contractId: g.contractId ?? null });
  return [...m.values()];
}
