import { parseArgs } from 'node:util';
import { type RoleGrant, createUser } from '@trust/platform-auth';
import type { Database, Role } from '@trust/platform-db';
import type { Kysely } from 'kysely';
import { z } from 'zod';

/**
 * CLI de administración — alta de usuarios (§21, brief C1 punto 1). Por API no
 * se crean usuarios. La contraseña NUNCA va por argumento (quedaría en el
 * historial y en `ps`): sale de TRUST_NEW_USER_PASSWORD o de stdin.
 *
 *   pnpm --filter @trust/platform-api user:create -- \
 *     --email ana@affinitas.com --name "Ana" --organization Affinitas \
 *     --role OPERATOR --role INTERNAL_APPROVER  < archivo-o-pipe-con-la-password
 *
 *   EXTERNAL_APPROVER va atado a un contrato: --role EXTERNAL_APPROVER:<contractId>
 */
const ROLES = ['OPERATOR', 'INTERNAL_APPROVER', 'ADMIN', 'EXTERNAL_APPROVER'] as const;

export function parseUserCreateArgs(argv: string[]): { email: string; name: string; organization: string; roles: RoleGrant[] } {
  const { values } = parseArgs({
    args: argv,
    options: { email: { type: 'string' }, name: { type: 'string' }, organization: { type: 'string' }, role: { type: 'string', multiple: true } },
    strict: true,
    allowPositionals: false,
  });
  const base = z.object({ email: z.string().min(3), name: z.string().min(1), organization: z.string().min(1) }).parse(values);
  const roles = (values.role ?? []).map((r): RoleGrant => {
    const [role, contractId, ...resto] = r.split(':');
    if (resto.length > 0 || !ROLES.includes(role as Role)) throw new Error(`rol inválido: ${r}`);
    if (role === 'EXTERNAL_APPROVER') return { role, contractId: z.string().uuid().parse(contractId) };
    if (contractId !== undefined) throw new Error(`${role} no lleva contrato`);
    return { role: role as Role };
  });
  if (roles.length === 0) throw new Error('falta al menos un --role');
  return { ...base, roles };
}

export async function readPassword(env: NodeJS.ProcessEnv, stdin: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<string> {
  if (env.TRUST_NEW_USER_PASSWORD) return env.TRUST_NEW_USER_PASSWORD;
  if (stdin.isTTY) throw new Error('pasá la contraseña por stdin (pipe) o por TRUST_NEW_USER_PASSWORD');
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export async function runUserCreate(db: Kysely<Database>, argv: string[], password: string): Promise<{ id: string; email: string }> {
  const a = parseUserCreateArgs(argv);
  return createUser(db, { ...a, password }, null); // actor null: alta por consola de administración
}
