import { Readable } from 'node:stream';
import { verifyPassword } from '@trust/platform-auth';
import { type TestDatabase, createTestDatabase, seedContract } from '@trust/platform-db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseUserCreateArgs, readPassword, runUserCreate } from './user-create';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.close(); });

describe('CRITERIO C1: CLI user:create', () => {
  it('crea el usuario con roles, Argon2id y USER_CREATED con actor null', async () => {
    const u = await runUserCreate(t.app, ['--email', ' Ana@Affinitas.com', '--name', 'Ana', '--organization', 'Affinitas', '--role', 'OPERATOR', '--role', 'INTERNAL_APPROVER'], 'una contraseña larga y buena');
    expect(u.email).toBe('ana@affinitas.com');
    const row = await t.app.selectFrom('users').select('password_hash').where('id', '=', u.id).executeTakeFirstOrThrow();
    expect(await verifyPassword(row.password_hash, 'una contraseña larga y buena')).toBe(true);
    const roles = await t.app.selectFrom('user_roles').select('role').where('user_id', '=', u.id).orderBy('role').execute();
    expect(roles.map((r) => r.role)).toEqual(['INTERNAL_APPROVER', 'OPERATOR']);
    const ev = await t.app.selectFrom('audit_events').selectAll().where('action', '=', 'USER_CREATED').where('entity_id', '=', u.id).executeTakeFirstOrThrow();
    expect(ev.actor_user_id).toBeNull();
  });

  it('EXTERNAL_APPROVER exige contrato; los internos no lo aceptan; roles desconocidos o ninguno → error', async () => {
    const c = await seedContract(t.app);
    expect(parseUserCreateArgs(['--email', 'e@x.com', '--name', 'E', '--organization', 'X', '--role', `EXTERNAL_APPROVER:${c.id}`]).roles).toEqual([{ role: 'EXTERNAL_APPROVER', contractId: c.id }]);
    expect(() => parseUserCreateArgs(['--email', 'e@x.com', '--name', 'E', '--organization', 'X', '--role', 'EXTERNAL_APPROVER'])).toThrow();
    expect(() => parseUserCreateArgs(['--email', 'e@x.com', '--name', 'E', '--organization', 'X', '--role', `OPERATOR:${c.id}`])).toThrow(/no lleva contrato/);
    expect(() => parseUserCreateArgs(['--email', 'e@x.com', '--name', 'E', '--organization', 'X', '--role', 'ROOT'])).toThrow(/rol inválido/);
    expect(() => parseUserCreateArgs(['--email', 'e@x.com', '--name', 'E', '--organization', 'X'])).toThrow(/al menos un/);
    expect(() => parseUserCreateArgs(['--email', 'e@x.com', '--name', 'E', '--organization', 'X', '--role', 'OPERATOR', '--password', 'x'])).toThrow();
  });

  it('password: de la variable, de stdin (sin el salto final), nunca de una TTY; corta → no crea nada', async () => {
    expect(await readPassword({ TRUST_NEW_USER_PASSWORD: 'desde env 1234' }, Readable.from([]))).toBe('desde env 1234');
    expect(await readPassword({}, Readable.from([Buffer.from('desde stdin 1234\n')]))).toBe('desde stdin 1234');
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    await expect(readPassword({}, tty)).rejects.toThrow(/stdin/);
    await expect(runUserCreate(t.app, ['--email', 'c@x.com', '--name', 'C', '--organization', 'X', '--role', 'OPERATOR'], 'corta')).rejects.toThrow(/entre 12/);
    expect(await t.app.selectFrom('users').select('id').where('email', '=', 'c@x.com').executeTakeFirst()).toBeUndefined();
  });
});
