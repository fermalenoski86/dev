import { verifyChain } from '@trust/platform-audit';
import { type TestDatabase, createTestDatabase, seedContract } from '@trust/platform-db/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canAccessContract, hasAnyRole } from './access';
import { login } from './login';
import { ARGON2_PARAMS, WeakPasswordError, hashPassword, verifyPassword } from './password';
import { LoginRateLimiter } from './rate-limit';
import { csrfMatches, issueSession, loadPrincipal, lookupSession, revokeAllSessions, revokeSession } from './sessions';
import { sha256Hex } from './tokens';
import { createUser, setUserRoles } from './users';

let t: TestDatabase;
const PW = 'correct horse battery staple';
let op: { id: string };
beforeAll(async () => {
  t = await createTestDatabase();
  op = await createUser(t.app, { name: 'Op', email: '  Operadora@Affinitas.COM ', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
});
afterAll(async () => { await t?.close(); });

const limiter = () => new LoginRateLimiter({ windowMs: 60_000, maxPerEmail: 5, maxPerAddress: 50 });
const auditDe = (action: string) => t.app.selectFrom('audit_events').selectAll().where('action', '=', action).orderBy('seq').execute();

describe('CRITERIO C1: passwords Argon2id', () => {
  it('hash con parámetros explícitos (m=19456,t=2,p=1) y verificación', async () => {
    const h = await hashPassword(PW);
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(ARGON2_PARAMS).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    expect(await verifyPassword(h, PW)).toBe(true);
    expect(await verifyPassword(h, `${PW}!`)).toBe(false);
    expect(await verifyPassword(null, PW)).toBe(false);
    expect(await verifyPassword('basura', PW)).toBe(false);
  });

  it('política: mínimo 12, máximo 256', async () => {
    await expect(hashPassword('corta')).rejects.toBeInstanceOf(WeakPasswordError);
    await expect(hashPassword('x'.repeat(257))).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it('createUser normaliza el email, guarda Argon2id, audita sin email ni hash', async () => {
    const u = await t.app.selectFrom('users').selectAll().where('id', '=', op.id).executeTakeFirstOrThrow();
    expect(u.email).toBe('operadora@affinitas.com');
    expect(u.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const [ev] = await auditDe('USER_CREATED');
    expect(ev?.entity_id).toBe(op.id);
    expect(JSON.stringify(ev?.metadata)).not.toMatch(/affinitas|argon/i);
    expect(ev?.metadata).toEqual({ roles: ['OPERATOR:'] });
  });
});

describe('CRITERIO C1: login', () => {
  it('éxito: sesión nueva, token solo hasheado en la base, audit sin secretos', async () => {
    const r = await login({ db: t.app, limiter: limiter() }, { email: 'OPERADORA@affinitas.com', password: PW, ip: '10.0.0.1' });
    if (!r.ok) throw new Error(`login falló: ${r.kind}`);
    const row = await t.app.selectFrom('sessions').selectAll().where('id', '=', r.session.sessionId).executeTakeFirstOrThrow();
    expect(row.token_hash).toBe(sha256Hex(r.session.token));
    expect(row.csrf_token_hash).toBe(sha256Hex(r.session.csrfToken));
    const dump = JSON.stringify(await t.app.selectFrom('sessions').selectAll().execute());
    expect(dump).not.toContain(r.session.token);
    expect(dump).not.toContain(r.session.csrfToken);
    const ev = (await auditDe('AUTH_LOGIN_SUCCEEDED')).at(-1);
    expect(ev?.actor_user_id).toBe(op.id);
    const evDump = JSON.stringify(ev);
    for (const s of [r.session.token, r.session.csrfToken, 'operadora', '10.0.0.1', PW]) expect(evDump).not.toContain(s);
  });

  it('cada login rota: dos logins, dos sesiones distintas y ambas vigentes', async () => {
    const d = { db: t.app, limiter: limiter() };
    const a = await login(d, { email: 'operadora@affinitas.com', password: PW, ip: '10.0.0.1' });
    const b = await login(d, { email: 'operadora@affinitas.com', password: PW, ip: '10.0.0.1' });
    if (!a.ok || !b.ok) throw new Error('login');
    expect(a.session.token).not.toBe(b.session.token);
    expect(a.session.sessionId).not.toBe(b.session.sessionId);
  });

  it('inexistente, password mala y deshabilitado: misma respuesta; audit con motivo, actor null si no existe, sin email/IP/password', async () => {
    const dis = await createUser(t.app, { name: 'Dis', email: 'dis@affinitas.com', password: PW, organization: 'Affinitas', roles: [] });
    await t.app.updateTable('users').set({ enabled: false }).where('id', '=', dis.id).execute();
    const d = { db: t.app, limiter: limiter() };
    const r1 = await login(d, { email: 'nadie@affinitas.com', password: PW, ip: '10.0.0.2' });
    const r2 = await login(d, { email: 'operadora@affinitas.com', password: 'otra password larga', ip: '10.0.0.2' });
    const r3 = await login(d, { email: 'dis@affinitas.com', password: PW, ip: '10.0.0.2' });
    expect([r1, r2, r3]).toEqual([{ ok: false, kind: 'INVALID_CREDENTIALS' }, { ok: false, kind: 'INVALID_CREDENTIALS' }, { ok: false, kind: 'INVALID_CREDENTIALS' }]);
    const evs = (await auditDe('AUTH_LOGIN_FAILED')).slice(-3);
    expect(evs.map((e) => [e.actor_user_id, e.metadata])).toEqual([
      [null, { reason: 'UNKNOWN_USER' }],
      [op.id, { reason: 'BAD_PASSWORD' }],
      [dis.id, { reason: 'USER_DISABLED' }],
    ]);
    const dump = JSON.stringify(evs);
    for (const s of ['nadie', 'operadora', '10.0.0.2', PW, 'otra password']) expect(dump).not.toContain(s);
  });

  it('rate limit: el intento cortado NO verifica ni escribe audit', async () => {
    const l = new LoginRateLimiter({ windowMs: 60_000, maxPerEmail: 2, maxPerAddress: 100 });
    const d = { db: t.app, limiter: l };
    const antes = (await auditDe('AUTH_LOGIN_FAILED')).length;
    for (let i = 0; i < 2; i++) await login(d, { email: 'operadora@affinitas.com', password: 'mala mala mala', ip: '10.0.0.3' });
    const r = await login(d, { email: 'operadora@affinitas.com', password: PW, ip: '10.0.0.3' });
    expect(r).toMatchObject({ ok: false, kind: 'RATE_LIMITED' });
    if (r.ok || r.kind !== 'RATE_LIMITED') throw new Error('esperaba 429');
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect((await auditDe('AUTH_LOGIN_FAILED')).length).toBe(antes + 2);
    expect(await verifyChain(t.app)).toMatchObject({ ok: true });
  });
});

describe('CRITERIO C1: sesiones server-side', () => {
  it('lookup: válida → sí; token desconocido, mal formado, revocado, vencido o usuario deshabilitado → no', async () => {
    const u = await createUser(t.app, { name: 'S', email: 's@affinitas.com', password: PW, organization: 'Affinitas', roles: [] });
    const s = await issueSession(t.app, u.id, 60_000);
    expect(await lookupSession(t.app, s.token)).toMatchObject({ sessionId: s.sessionId, userId: u.id, csrfToken: s.csrfToken });
    expect(await lookupSession(t.app, 'A'.repeat(43))).toBeNull();
    expect(await lookupSession(t.app, `${s.token}x`)).toBeNull();
    expect(await lookupSession(t.app, undefined)).toBeNull();

    const v = await issueSession(t.app, u.id, 60_000);
    // vencimiento server-side: se mueve el reloj de la sesión, no el de la cookie
    await t.owner.updateTable('sessions').set({ created_at: sql<Date>`now() - interval '2 hours'`, expires_at: sql<Date>`now() - interval '1 second'` }).where('id', '=', v.sessionId).execute();
    expect(await lookupSession(t.app, v.token)).toBeNull();

    await revokeSession(t.app, s.sessionId);
    expect(await lookupSession(t.app, s.token)).toBeNull();

    const w = await issueSession(t.app, u.id, 60_000);
    await t.app.updateTable('users').set({ enabled: false }).where('id', '=', u.id).execute();
    expect(await lookupSession(t.app, w.token)).toBeNull();
  });

  it('CSRF: solo el token derivado de esta sesión', async () => {
    const a = await issueSession(t.app, op.id, 60_000);
    const b = await issueSession(t.app, op.id, 60_000);
    const sa = await lookupSession(t.app, a.token);
    if (!sa) throw new Error('sesión');
    expect(csrfMatches(sa, a.csrfToken)).toBe(true);
    expect(csrfMatches(sa, b.csrfToken)).toBe(false);
    expect(csrfMatches(sa, '')).toBe(false);
    expect(csrfMatches(sa, undefined)).toBe(false);
    expect(csrfMatches(sa, a.token)).toBe(false);
  });

  it('cambio de roles: revoca TODAS las sesiones del usuario y audita ROLE_CHANGED', async () => {
    const u = await createUser(t.app, { name: 'R', email: 'r@affinitas.com', password: PW, organization: 'Affinitas', roles: [{ role: 'OPERATOR' }] });
    const s1 = await issueSession(t.app, u.id, 60_000);
    const s2 = await issueSession(t.app, u.id, 60_000);
    const otra = await issueSession(t.app, op.id, 60_000);
    expect(await setUserRoles(t.app, u.id, [{ role: 'OPERATOR' }])).toEqual({ changed: false, revokedSessions: 0 });
    expect(await setUserRoles(t.app, u.id, [{ role: 'OPERATOR' }, { role: 'INTERNAL_APPROVER' }])).toEqual({ changed: true, revokedSessions: 2 });
    expect(await lookupSession(t.app, s1.token)).toBeNull();
    expect(await lookupSession(t.app, s2.token)).toBeNull();
    expect(await lookupSession(t.app, otra.token)).not.toBeNull();
    const ev = (await auditDe('ROLE_CHANGED')).at(-1);
    expect(ev?.metadata).toEqual({ before: ['OPERATOR:'], after: ['INTERNAL_APPROVER:', 'OPERATOR:'], revokedSessions: 2 });
    expect(await revokeAllSessions(t.app, u.id)).toBe(0);
  });
});

describe('CRITERIO C1: roles y scope por contrato (§22, §24)', () => {
  it('EXTERNAL_APPROVER: modelado pero sin permisos salvo flag global + contrato habilitado; solo sus contratos', async () => {
    const c1 = await seedContract(t.app);
    const c2 = await seedContract(t.app);
    const ext = await createUser(t.app, { name: 'E', email: 'e@cliente.com', password: PW, organization: 'Cliente', roles: [{ role: 'EXTERNAL_APPROVER', contractId: c1.id }] });

    const off = await loadPrincipal(t.app, ext.id, { externalApprovalEnabled: false });
    expect([...off.roles]).toEqual([]);
    expect(canAccessContract(off, c1.id, ['EXTERNAL_APPROVER'])).toBe(false);

    const flagSinContrato = await loadPrincipal(t.app, ext.id, { externalApprovalEnabled: true });
    expect([...flagSinContrato.roles]).toEqual([]); // contrato con external_approval_enabled=false

    await t.app.updateTable('contracts').set({ external_approval_enabled: true }).where('id', 'in', [c1.id, c2.id]).execute();
    const on = await loadPrincipal(t.app, ext.id, { externalApprovalEnabled: true });
    expect([...on.roles]).toEqual(['EXTERNAL_APPROVER']);
    expect(on.externalContractIds).toEqual([c1.id]);
    expect(canAccessContract(on, c1.id, ['INTERNAL_APPROVER', 'EXTERNAL_APPROVER'])).toBe(true);
    // acceso cruzado: el otro contrato también está habilitado, pero no es suyo
    expect(canAccessContract(on, c2.id, ['INTERNAL_APPROVER', 'EXTERNAL_APPROVER'])).toBe(false);
    expect(hasAnyRole(on, ['OPERATOR', 'ADMIN'])).toBe(false);
  });

  it('roles internos: alcanzan a cualquier contrato solo con un rol permitido', async () => {
    const c = await seedContract(t.app);
    const p = await loadPrincipal(t.app, op.id, { externalApprovalEnabled: true });
    expect([...p.roles]).toEqual(['OPERATOR']);
    expect(canAccessContract(p, c.id, ['OPERATOR'])).toBe(true);
    expect(canAccessContract(p, c.id, ['INTERNAL_APPROVER'])).toBe(false);
    expect(hasAnyRole(p, ['INTERNAL_APPROVER', 'ADMIN'])).toBe(false);
  });
});
