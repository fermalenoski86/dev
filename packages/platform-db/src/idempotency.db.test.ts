import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdempotencyKeyReusedError, purgeExpiredIdempotencyKeys, requestFingerprint, withIdempotency } from './idempotency';
import { type TestDatabase, createTestDatabase, seedUser } from './testing';

let t: TestDatabase;
let actorId: string;
beforeAll(async () => {
  t = await createTestDatabase();
  actorId = (await seedUser(t.app, 'idem@affinitas.com')).id;
});
afterAll(async () => { await t?.close(); });

/** Vence una key ya existente (como si hubiera pasado su TTL). */
const vencer = (key: string) =>
  t.app.updateTable('idempotency_keys')
    .set({ created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), expires_at: new Date(Date.now() - 3600e3).toISOString() })
    .where('actor_id', '=', actorId).where('key', '=', key).execute();

describe('CRITERIO: idempotencia con fingerprint', () => {
  it('misma key + mismo fingerprint: replay seguro, la operación corre UNA vez', async () => {
    let corridas = 0;
    const fp = requestFingerprint('submit', { campaignId: 'c1', expectedRevision: 3 });
    const op = () => withIdempotency(t.app, { key: 'key-submit-0001', actorId, operation: 'submit', fingerprint: fp }, async () => {
      corridas += 1;
      return { status: 201, body: { versionId: 'v-123' } };
    });
    const a = await op();
    const b = await op();
    expect(corridas).toBe(1);
    expect(a).toEqual({ status: 201, body: { versionId: 'v-123' }, replayed: false });
    expect(b).toEqual({ status: 201, body: { versionId: 'v-123' }, replayed: true });
  });

  it('misma key + distinto fingerprint: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const args = { key: 'key-approve-0001', actorId, operation: 'approve' };
    await withIdempotency(t.app, { ...args, fingerprint: requestFingerprint('approve', { v: 1 }) }, async () => ({ status: 200, body: {} }));
    const err = await withIdempotency(t.app, { ...args, fingerprint: requestFingerprint('approve', { v: 2 }) }, async () => ({ status: 200, body: {} })).catch((e) => e);
    expect(err).toBeInstanceOf(IdempotencyKeyReusedError);
    expect(err.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(err.httpStatus).toBe(409);
  });

  it('la misma key para otra operación también es reuso', async () => {
    const fp = requestFingerprint('reject', { v: 1 });
    await withIdempotency(t.app, { key: 'key-cross-0001', actorId, operation: 'reject', fingerprint: fp }, async () => ({ status: 200, body: {} }));
    const err = await withIdempotency(t.app, { key: 'key-cross-0001', actorId, operation: 'approve', fingerprint: fp }, async () => ({ status: 200, body: {} })).catch((e) => e);
    expect(err).toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('si la operación falla, la key NO queda tomada: el reintento corre', async () => {
    const args = { key: 'key-fail-00001', actorId, operation: 'submit', fingerprint: requestFingerprint('submit', { x: 1 }) };
    await expect(withIdempotency(t.app, args, async () => { throw new Error('preflight falló'); })).rejects.toThrow('preflight falló');
    const ok = await withIdempotency(t.app, args, async () => ({ status: 201, body: { ok: true } }));
    expect(ok.replayed).toBe(false);
  });

  it('dos reintentos simultáneos: uno ejecuta, el otro hace replay', async () => {
    let corridas = 0;
    const args = { key: 'key-race-00001', actorId, operation: 'submit', fingerprint: requestFingerprint('submit', { r: 1 }) };
    const run = async () => { corridas += 1; await new Promise((r) => setTimeout(r, 150)); return { status: 201, body: { v: 'unica' } }; };
    const [a, b] = await Promise.all([withIdempotency(t.app, args, run), withIdempotency(t.app, args, run)]);
    expect(corridas).toBe(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.body).toEqual(b.body);
  });
});

describe('CRITERIO: vencimiento de keys', () => {
  it('vigente → replay; vigente + distinto fingerprint → 409', async () => {
    const args = { key: 'key-vigente-01', actorId, operation: 'submit' };
    const fp = requestFingerprint('submit', { a: 1 });
    await withIdempotency(t.app, { ...args, fingerprint: fp }, async () => ({ status: 201, body: { n: 1 } }));
    expect((await withIdempotency(t.app, { ...args, fingerprint: fp }, async () => ({ status: 201, body: { n: 2 } }))).replayed).toBe(true);
    await expect(withIdempotency(t.app, { ...args, fingerprint: requestFingerprint('submit', { a: 2 }) }, async () => ({ status: 201, body: {} }))).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('vencida → la key se recupera y corre una operación NUEVA (aun con otro fingerprint)', async () => {
    const args = { key: 'key-vencida-01', actorId, operation: 'submit' };
    await withIdempotency(t.app, { ...args, fingerprint: requestFingerprint('submit', { a: 1 }) }, async () => ({ status: 201, body: { vieja: true } }));
    await vencer(args.key);
    const r = await withIdempotency(t.app, { ...args, fingerprint: requestFingerprint('submit', { a: 99 }) }, async () => ({ status: 201, body: { nueva: true } }));
    expect(r).toEqual({ status: 201, body: { nueva: true }, replayed: false });
    // y ahora la key está vigente para la solicitud nueva
    const again = await withIdempotency(t.app, { ...args, fingerprint: requestFingerprint('submit', { a: 99 }) }, async () => ({ status: 201, body: { otra: true } }));
    expect(again).toEqual({ status: 201, body: { nueva: true }, replayed: true });
  });

  it('concurrencia sobre una key vencida: una sola ejecución', async () => {
    let corridas = 0;
    const args = { key: 'key-vencida-race', actorId, operation: 'approve', fingerprint: requestFingerprint('approve', { v: 1 }) };
    await withIdempotency(t.app, args, async () => ({ status: 200, body: { original: true } }));
    await vencer(args.key);
    const run = async () => { corridas += 1; await new Promise((r) => setTimeout(r, 150)); return { status: 200, body: { reejecutada: true } }; };
    const [a, b] = await Promise.all([withIdempotency(t.app, args, run), withIdempotency(t.app, args, run)]);
    expect(corridas).toBe(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.body).toEqual({ reejecutada: true });
    expect(b.body).toEqual({ reejecutada: true });
  });

  it('la limpieza borra solo las vencidas', async () => {
    await withIdempotency(t.app, { key: 'key-limpieza-v', actorId, operation: 'x', fingerprint: requestFingerprint('x', 1) }, async () => ({ status: 200, body: {} }));
    await withIdempotency(t.app, { key: 'key-limpieza-n', actorId, operation: 'x', fingerprint: requestFingerprint('x', 2) }, async () => ({ status: 200, body: {} }));
    await vencer('key-limpieza-v');
    expect(await purgeExpiredIdempotencyKeys(t.app)).toBeGreaterThanOrEqual(1);
    const quedan = await t.app.selectFrom('idempotency_keys').select('key').where('key', 'in', ['key-limpieza-v', 'key-limpieza-n']).execute();
    expect(quedan.map((q) => q.key)).toEqual(['key-limpieza-n']);
  });
});
