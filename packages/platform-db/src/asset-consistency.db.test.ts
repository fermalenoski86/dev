import { AssetRejectionCodeSchema } from '@trust/platform-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSET_REJECTION_CODES_0002 } from './migrations/0002_asset_pipeline';
import { seedStoredObject, seedUser, sha } from './fixtures';
import { type TestDatabase, createTestDatabase } from './testing';

/**
 * Migración 0002 — §14 del brief: no hay READY con metadata contradictoria.
 * La base lo impide aunque la app se equivoque (PostgreSQL real, trust_app).
 */
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.close(); });

const falla = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message);
const u = () => `c-${Math.random().toString(36).slice(2)}@trust.test`;

async function validando(over: Record<string, unknown> = {}) {
  const op = await seedUser(t.app, u());
  const contenido = `asset-${Math.random()}`;
  const o = await seedStoredObject(t.app, contenido); // size 1000, video/mp4
  const a = await t.app.insertInto('assets').values({ original_filename: 'm.mp4', surface_type: 'horizontal', created_by: op.id }).returning('id').executeTakeFirstOrThrow();
  await t.app.updateTable('assets').set({ status: 'VALIDATING', sha256: o.sha256, size_bytes: 1000 }).where('id', '=', a.id).execute();
  const ready = { status: 'READY' as const, stored_object_id: o.storedObjectId, mime_type: 'video/mp4', container: 'MP4', width: 1920, height: 412, fps: 25, codec: 'h264', duration_ms: 15000, ...over };
  return { id: a.id, o, ready };
}
const aReady = (id: string, set: Record<string, unknown>) => t.app.updateTable('assets').set(set).where('id', '=', id).execute();

describe('CRITERIO: READY ↔ StoredObject consistentes (§14)', () => {
  it('consistente → READY', async () => {
    const a = await validando();
    await aReady(a.id, a.ready);
    const fila = await t.app.selectFrom('assets').select('status').where('id', '=', a.id).executeTakeFirstOrThrow();
    expect(fila.status).toBe('READY');
  });

  it('READY sin StoredObject → rechazado', async () => {
    const a = await validando();
    expect(await falla(aReady(a.id, { ...a.ready, stored_object_id: null }))).toMatch(/ASSET_OBJECT_MISSING/);
  });

  it('sha256 del asset ≠ sha256 del StoredObject → ASSET_SHA_MISMATCH', async () => {
    const a = await validando();
    const otro = await seedStoredObject(t.app, `otro-${Math.random()}`);
    expect(await falla(aReady(a.id, { ...a.ready, stored_object_id: otro.storedObjectId }))).toMatch(/ASSET_SHA_MISMATCH/);
  });

  it('tamaño distinto → ASSET_SIZE_MISMATCH', async () => {
    const a = await validando();
    expect(await falla(aReady(a.id, { ...a.ready, size_bytes: 999 }))).toMatch(/ASSET_SIZE_MISMATCH/);
  });

  it('MIME distinto del objeto físico → ASSET_MIME_MISMATCH', async () => {
    const a = await validando();
    expect(await falla(aReady(a.id, { ...a.ready, mime_type: 'video/quicktime' }))).toMatch(/ASSET_MIME_MISMATCH/);
  });

  it('contenedor MP4 publicado con otro MIME → ASSET_MIME_MISMATCH', async () => {
    const op = await seedUser(t.app, u());
    const h = sha(`x-${Math.random()}`);
    const o = await t.app.insertInto('stored_objects').values({ sha256: h, storage_key: `sha256/${h.slice(0, 2)}/${h}`, mime_type: 'application/octet-stream', size_bytes: 10 }).returning('id').executeTakeFirstOrThrow();
    const a = await t.app.insertInto('assets').values({ original_filename: 'm.mp4', surface_type: 'horizontal', created_by: op.id }).returning('id').executeTakeFirstOrThrow();
    await t.app.updateTable('assets').set({ status: 'VALIDATING', sha256: h, size_bytes: 10 }).where('id', '=', a.id).execute();
    expect(await falla(aReady(a.id, { status: 'READY', stored_object_id: o.id, mime_type: 'application/octet-stream', container: 'MP4', width: 1, height: 1, fps: 25, codec: 'h264', duration_ms: 40 }))).toMatch(/ASSET_MIME_MISMATCH/);
  });

  it('READY sin sha256 / sin contenedor → rechazado por la base', async () => {
    const a = await validando();
    expect(await falla(aReady(a.id, { ...a.ready, container: null }))).toMatch(/assets_ready_complete/);
  });

  it('una transición inválida se sigue informando como tal (UPLOADING → READY)', async () => {
    const op = await seedUser(t.app, u());
    const a = await t.app.insertInto('assets').values({ original_filename: 'm.mp4', surface_type: 'horizontal', created_by: op.id }).returning('id').executeTakeFirstOrThrow();
    expect(await falla(aReady(a.id, { status: 'READY' }))).toMatch(/ASSET_TRANSITION/);
  });
});

describe('CRITERIO: rechazo estructurado (§17)', () => {
  it('rejection_code solo acepta códigos conocidos; la lista de 0002 es la de platform-contracts', async () => {
    expect([...ASSET_REJECTION_CODES_0002]).toEqual(AssetRejectionCodeSchema.options);
    const op = await seedUser(t.app, u());
    const a = await t.app.insertInto('assets').values({ original_filename: 'm.mp4', surface_type: 'horizontal', created_by: op.id }).returning('id').executeTakeFirstOrThrow();
    expect(await falla(aReady(a.id, { status: 'REJECTED', rejection_code: 'TEXTO_LIBRE' }))).toMatch(/assets_rejection_code_known/);
    await aReady(a.id, { status: 'REJECTED', rejection_code: 'ASSET_BAD_FPS', rejection_detail: JSON.stringify({ message: 'fps', details: { fps: '30000/1001' } }) });
  });

  it('rejection_detail solo en REJECTED y siempre objeto', async () => {
    const op = await seedUser(t.app, u());
    const a = await t.app.insertInto('assets').values({ original_filename: 'm.mp4', surface_type: 'horizontal', created_by: op.id }).returning('id').executeTakeFirstOrThrow();
    expect(await falla(aReady(a.id, { rejection_detail: '{"message":"x"}' }))).toMatch(/assets_rejection_detail_only_rejected/);
    expect(await falla(aReady(a.id, { status: 'REJECTED', rejection_code: 'ASSET_CORRUPT', rejection_detail: '"texto"' }))).toMatch(/23514|check/);
  });
});
