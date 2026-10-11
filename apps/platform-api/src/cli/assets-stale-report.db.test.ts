import { type TestDatabase, createTestDatabase, seedAsset, seedUser } from '@trust/platform-db/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_STALE_AFTER_MINUTES, parseStaleReportArgs, runStaleReport } from './assets-stale-report';

/**
 * BL-07 · reporte de Assets no terminales vencidos, contra PostgreSQL real.
 * Criterio del backlog: un Asset VALIDATING/UPLOADING con `updated_at` > TTL
 * aparece; uno reciente no. Además: terminales nunca, solo lectura (ni
 * estados, ni `updated_at`, ni audit cambian) y datos mínimos.
 */
let t: TestDatabase;
let userId: string;
const MIN = 60_000;

/** Atrasa `updated_at` como lo dejaría el tiempo: con los triggers apagados, desde el dueño del esquema. */
async function atrasar(assetId: string, minutos: number) {
  await t.owner.transaction().execute(async (trx) => {
    await sql`ALTER TABLE assets DISABLE TRIGGER assets_updated`.execute(trx);
    await sql`ALTER TABLE assets DISABLE TRIGGER assets_transition`.execute(trx);
    await sql`UPDATE assets SET updated_at = now() - make_interval(mins => ${minutos}) WHERE id = ${assetId}::uuid`.execute(trx);
    await sql`ALTER TABLE assets ENABLE TRIGGER assets_transition`.execute(trx);
    await sql`ALTER TABLE assets ENABLE TRIGGER assets_updated`.execute(trx);
  });
}

async function uploading() {
  return (await t.app.insertInto('assets').values({ original_filename: 'secreto-cliente.mp4', surface_type: 'horizontal', created_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
}
async function validating() {
  const id = await uploading();
  await t.app.updateTable('assets').set({ status: 'VALIDATING' }).where('id', '=', id).execute();
  return id;
}

const A: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestDatabase();
  userId = (await seedUser(t.app, `ops-${Date.now()}@affinitas.com`)).id;
  A.uplViejo = await uploading();
  A.valViejo = await validating();
  A.valMuyViejo = await validating();
  A.uplReciente = await uploading();
  A.valReciente = await validating();
  A.valBorde = await validating(); // 59 min con TTL 60 → no aparece
  A.readyViejo = (await seedAsset(t.app, userId, `ready-${Math.random()}`)).assetId;
  A.rejViejo = (await seedAsset(t.app, userId, 'x', 'REJECTED')).assetId;
  await atrasar(A.uplViejo, 90);
  await atrasar(A.valViejo, 120);
  await atrasar(A.valMuyViejo, 60 * 24 * 3);
  await atrasar(A.valBorde, 59);
  await atrasar(A.readyViejo, 600);
  await atrasar(A.rejViejo, 600);
});
afterAll(async () => { await t?.close(); });

const estado = async () => ({
  assets: await t.app.selectFrom('assets').select(['id', 'status', 'updated_at', 'rejection_code']).orderBy('id').execute(),
  audit: Number((await t.app.selectFrom('audit_events').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n),
});

describe('BL-07 · reporte de Assets UPLOADING/VALIDATING vencidos', () => {
  it('criterio: los no terminales con updated_at más viejo que el TTL aparecen; los recientes, el borde y los terminales no', async () => {
    const r = await runStaleReport(t.app, ['--older-than-minutes', '60']);
    const ids = r.items.map((i) => i.assetId);
    expect(ids).toEqual([A.valMuyViejo, A.valViejo, A.uplViejo]); // del más viejo al más nuevo
    for (const no of [A.uplReciente, A.valReciente, A.valBorde, A.readyViejo, A.rejViejo]) expect(ids).not.toContain(no);
    expect(r.total).toBe(3);
    expect(r.byStatus).toEqual({ UPLOADING: 1, VALIDATING: 2 });
    expect(r.truncated).toBe(false);
    expect(r.olderThanMs).toBe(60 * MIN);
    const viejo = r.items.find((i) => i.assetId === A.valViejo)!;
    expect(viejo.status).toBe('VALIDATING');
    expect(viejo.staleForMs).toBeGreaterThanOrEqual(120 * MIN);
    expect(viejo.staleForMs).toBeLessThan(121 * MIN);
    expect(new Date(r.generatedAt).getTime() - new Date(viejo.updatedAt).getTime()).toBe(viejo.staleForMs);
  });

  it('el umbral manda: con 30 min entra el borde (59 min); con 3 días, solo el de 3 días; con 4 días, nada', async () => {
    expect((await runStaleReport(t.app, ['--older-than-minutes', '30'])).items.map((i) => i.assetId)).toContain(A.valBorde);
    expect((await runStaleReport(t.app, ['--older-than-minutes', String(60 * 24 * 3 - 1)])).items.map((i) => i.assetId)).toEqual([A.valMuyViejo]);
    const nada = await runStaleReport(t.app, ['--older-than-minutes', String(60 * 24 * 4)]);
    expect(nada).toMatchObject({ total: 0, items: [], truncated: false, byStatus: { UPLOADING: 0, VALIDATING: 0 } });
  });

  it('limit corta la lista pero el total y el conteo por estado siguen completos (truncated)', async () => {
    const r = await runStaleReport(t.app, ['--older-than-minutes', '60', '--limit', '2']);
    expect(r.items.map((i) => i.assetId)).toEqual([A.valMuyViejo, A.valViejo]);
    expect([r.total, r.truncated]).toEqual([3, true]);
  });

  it('solo lectura: no cambia estados, updated_at, rechazos ni audit (un fallo de infraestructura no es un REJECTED)', async () => {
    const antes = await estado();
    await runStaleReport(t.app, ['--older-than-minutes', '1']);
    await runStaleReport(t.app, []);
    expect(await estado()).toEqual(antes);
  });

  it('corre en una transacción READ ONLY de PostgreSQL: es lo primero que ejecuta y después solo hay SELECT', async () => {
    const vistas: string[] = [];
    const espia = t.app.withPlugin({
      transformQuery: (a) => {
        vistas.push(t.app.getExecutor().compileQuery(a.node, a.queryId).sql.trim().replace(/\s+/g, ' '));
        return a.node;
      },
      transformResult: async (a) => a.result,
    });
    await runStaleReport(espia, ['--older-than-minutes', '60']);
    expect(vistas[0]).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    expect(vistas.length).toBeGreaterThan(1);
    for (const q of vistas.slice(1)) expect(q, q).toMatch(/^select /i);
    // y PostgreSQL de verdad rechaza escribir en una transacción así
    await expect(
      t.app.transaction().execute(async (trx) => {
        await sql`SET TRANSACTION READ ONLY`.execute(trx);
        await trx.updateTable('assets').set({ status: 'REJECTED', rejection_code: 'ASSET_CORRUPT' }).where('id', '=', A.valViejo as string).execute();
      }),
    ).rejects.toThrow(/read-only transaction/);
  });

  it('datos mínimos: exactamente id, estado, superficie, creador y tiempos; nunca el nombre de archivo', async () => {
    const r = await runStaleReport(t.app, ['--older-than-minutes', '60']);
    for (const i of r.items) expect(Object.keys(i).sort()).toEqual(['assetId', 'createdAt', 'createdBy', 'staleForMs', 'status', 'surfaceType', 'updatedAt']);
    expect(JSON.stringify(r)).not.toContain('secreto-cliente');
    expect(r.items[0]).toMatchObject({ surfaceType: 'horizontal', createdBy: userId });
  });
});

describe('BL-07 · argumentos del CLI', () => {
  it('default 60 min (o ASSET_STALE_AFTER_MINUTES) y limit 500; el argumento gana a la variable', () => {
    expect(DEFAULT_STALE_AFTER_MINUTES).toBe(60);
    expect(parseStaleReportArgs([])).toEqual({ olderThanMs: 60 * MIN, limit: 500 });
    expect(parseStaleReportArgs([], { ASSET_STALE_AFTER_MINUTES: '15' })).toEqual({ olderThanMs: 15 * MIN, limit: 500 });
    expect(parseStaleReportArgs(['--older-than-minutes', '5', '--limit', '10'], { ASSET_STALE_AFTER_MINUTES: '15' })).toEqual({ olderThanMs: 5 * MIN, limit: 10 });
  });

  it('rechaza umbrales y límites inválidos, opciones desconocidas y posicionales', () => {
    for (const argv of [['--older-than-minutes', '0'], ['--older-than-minutes', '-5'], ['--older-than-minutes', '1.5'], ['--older-than-minutes', 'abc'], ['--older-than-minutes', ''], ['--older-than-minutes', '999999999'], ['--limit', '0'], ['--limit', '10001'], ['--fix'], ['--reject'], ['extra']]) {
      expect(() => parseStaleReportArgs(argv), argv.join(' ')).toThrow();
    }
    expect(() => parseStaleReportArgs([], { ASSET_STALE_AFTER_MINUTES: 'nunca' })).toThrow(/entero/);
  });
});
