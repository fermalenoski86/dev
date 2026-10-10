import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { checkPlaywrightResults, checkResults, countPlaywrightTests, render, scanPlaywrightTags, scanTags, validate, validateNavegador } from './matrix.mjs';
// @ts-expect-error módulo .mjs sin tipos
import { NAVEGADOR, POINTS, SUITE_VERIFICADA } from './points.mjs';

/**
 * BL-23 · negativos controlados de la matriz ejecutable: cada forma de que la
 * matriz mienta tiene que hacer fallar el gate.
 */
type Tag = { file: string; title: string; points: number[] };
const PW = { 'e2e/experience.spec.ts': "test('a', () => {});\n".repeat(12), 'e2e/builder.spec.ts': "test.describe('x', () => {\n  test.beforeEach(() => {});\n  test('b', () => {});\n  test('c', () => {});\n});" };
const todos = (): Tag[] => Array.from({ length: 18 }, (_, i) => ({ file: 'apps/platform-api/src/e2e-flow.db.test.ts', title: `paso [§48.${i + 1}]`, points: [i + 1] }));

describe('BL-23 · matriz de aceptación ejecutable', () => {
  it('scanTags lee los tags de it/test/describe, con varias por título', () => {
    const tags = scanTags([{ path: 'a.db.test.ts', source: "describe('x', () => {\n  it('uno [§48.3] [§48.7]', async () => {});\n  it(\"sin tag\", () => {});\n  test(`tres [§48.18]`, () => {});\n});" }]);
    expect(tags).toEqual([
      { file: 'a.db.test.ts', title: 'uno [§48.3] [§48.7]', points: [3, 7] },
      { file: 'a.db.test.ts', title: 'tres [§48.18]', points: [18] },
    ]);
  });

  it('la lista real de puntos con un tag por punto valida sin errores', () => {
    expect(validate({ points: POINTS, tags: todos(), suite: SUITE_VERIFICADA, playwrightSources: PW })).toEqual([]);
  });

  it('NEGATIVO: un punto cubierto sin test etiquetado falla', () => {
    const tags = todos().filter((t) => !t.points.includes(13));
    expect(validate({ points: POINTS, tags, suite: SUITE_VERIFICADA, playwrightSources: PW })).toEqual([expect.stringContaining('§48.13')]);
  });

  it('NEGATIVO: un tag a un punto que no existe falla', () => {
    const tags = [...todos(), { file: 'apps/platform-api/src/x.db.test.ts', title: 'raro [§48.20]', points: [20] }];
    expect(validate({ points: POINTS, tags, suite: SUITE_VERIFICADA, playwrightSources: PW })).toEqual([expect.stringContaining('[§48.20] no es un punto')]);
  });

  it('NEGATIVO: un tag fuera de la suite que CI verifica con resultados falla', () => {
    const tags = [...todos(), { file: 'packages/x/src/a.test.ts', title: 'unitario [§48.1]', points: [1] }];
    expect(validate({ points: POINTS, tags, suite: SUITE_VERIFICADA, playwrightSources: PW })).toEqual([expect.stringContaining('fuera de la suite verificada')]);
  });

  it('NEGATIVO: pendiente o no-aplicable sin motivo falla; con motivo, se muestra pendiente y nunca verde', () => {
    const sinMotivo = POINTS.map((p: { n: number }) => (p.n === 5 ? { ...p, estado: 'pendiente' } : p));
    const tags = todos().filter((t) => !t.points.includes(5));
    expect(validate({ points: sinMotivo, tags, suite: SUITE_VERIFICADA, playwrightSources: PW })).toEqual(['§48.5: estado pendiente sin motivo']);
    const conMotivo = POINTS.map((p: { n: number }) => (p.n === 5 ? { ...p, estado: 'pendiente', motivo: 'falta X' } : p));
    expect(validate({ points: conMotivo, tags, suite: SUITE_VERIFICADA, playwrightSources: PW })).toEqual([]);
    const md = render({ points: conMotivo, tags, navegador: NAVEGADOR });
    expect(md).toContain('| 5 | ffprobe los valida realmente | OPERATOR | ⏳ **pendiente** |');
    expect(md).toContain('18/19 puntos de §48 cubiertos');
  });

  it('NEGATIVO: la evidencia de M2C sin sus 14 tests o sin archivo falla', () => {
    expect(countPlaywrightTests(PW['e2e/builder.spec.ts'])).toBe(2);
    const menos = { ...PW, 'e2e/builder.spec.ts': "test('b', () => {});" };
    expect(validate({ points: POINTS, tags: todos(), suite: SUITE_VERIFICADA, playwrightSources: menos })).toEqual([expect.stringContaining('13 tests, se esperaban 14')]);
    const sin = { 'e2e/experience.spec.ts': PW['e2e/experience.spec.ts'] };
    expect(validate({ points: POINTS, tags: todos(), suite: SUITE_VERIFICADA, playwrightSources: sin })).toEqual(expect.arrayContaining([expect.stringContaining('e2e/builder.spec.ts no existe')]));
  });

  it('NEGATIVO: un test etiquetado que no pasó (skip, fail) o que no está en el reporte falla', () => {
    const tags: Tag[] = [
      { file: 'apps/a.db.test.ts', title: 'ok [§48.1]', points: [1] },
      { file: 'apps/a.db.test.ts', title: 'salteado [§48.2]', points: [2] },
      { file: 'apps/b.db.test.ts', title: 'ausente [§48.3]', points: [3] },
    ];
    const report = { testResults: [{ name: '/repo/apps/a.db.test.ts', assertionResults: [
      { fullName: 'suite ok [§48.1]', status: 'passed' },
      { fullName: 'suite salteado [§48.2]', status: 'skipped' },
    ] }] };
    expect(checkResults({ tags, report, root: '/repo' })).toEqual([
      'apps/a.db.test.ts «suite salteado [§48.2]»: skipped (se exige passed)',
      'apps/b.db.test.ts: no está en el reporte de resultados',
    ]);
  });

  it('E3c · scanPlaywrightTags lee `[E3-N]` de test(...) en los specs de e2e-platform', () => {
    const pw = scanPlaywrightTags([{ path: 'e2e-platform/a.spec.ts', source: "test('uno [E3-41] [E3-47]', async () => {});\ntest.describe.configure({ mode: 'serial' });\ntest(`sin tag`, () => {});\ntest('dos [E3-41]', () => {});" }]);
    expect(pw).toEqual([
      { file: 'e2e-platform/a.spec.ts', title: 'uno [E3-41] [E3-47]', ids: ['E3-41', 'E3-47'] },
      { file: 'e2e-platform/a.spec.ts', title: 'dos [E3-41]', ids: ['E3-41'] },
    ]);
  });

  it('E3c · NEGATIVO: navegador cubierto sin test de Playwright, tag a un ítem inexistente o pendiente sin motivo fallan', () => {
    const pwTags = [{ file: 'e2e-platform/a.spec.ts', title: 'x [E3-41]', ids: ['E3-41'] }];
    expect(validateNavegador({ navegador: NAVEGADOR, pwTags })).toEqual([expect.stringContaining('E3-47 («§47 screenshots y video del flujo»): marcado cubierto pero ningún test de Playwright tiene [E3-47]')]);
    expect(validateNavegador({ navegador: NAVEGADOR, pwTags: [...pwTags, { file: 'e2e-platform/a.spec.ts', title: 'y [E3-47] [E3-99]', ids: ['E3-47', 'E3-99'] }] })).toEqual([expect.stringContaining('[E3-99] no es un ítem de navegador')]);
    const pendiente = NAVEGADOR.map((x: { id: string }) => (x.id === 'E3-47' ? { ...x, estado: 'pendiente', motivo: undefined } : x));
    expect(validateNavegador({ navegador: pendiente, pwTags })).toEqual(['E3-47: estado pendiente sin motivo']);
    const md = render({ points: POINTS, tags: todos(), navegador: pendiente.map((x: { id: string }) => (x.id === 'E3-47' ? { ...x, motivo: 'falta el artifact' } : x)), pwTags });
    expect(md).toContain('| E3-47 | §47 screenshots y video del flujo | ⏳ **pendiente**: falta el artifact |');
    expect(md).toContain('navegador: 1/2 cubiertos, 1 pendientes');
    expect(md).toContain('M3A.1 **no se declara cerrado**');
  });

  it('E3c · NEGATIVO: un test [E3-N] que no pasó en Playwright (skip, fail, reintento) o que falta en el reporte falla', () => {
    const pwTags = [
      { file: 'e2e-platform/a.spec.ts', title: 'ok [E3-41]', ids: ['E3-41'] },
      { file: 'e2e-platform/a.spec.ts', title: 'salteado [E3-41]', ids: ['E3-41'] },
      { file: 'e2e-platform/a.spec.ts', title: 'flaky [E3-47]', ids: ['E3-47'] },
      { file: 'e2e-platform/b.spec.ts', title: 'ausente [E3-47]', ids: ['E3-47'] },
    ];
    const report = { suites: [{ title: 'a.spec.ts', specs: [], suites: [{ title: 'd', specs: [
      { title: 'ok [E3-41]', file: 'a.spec.ts', tests: [{ results: [{ status: 'passed' }] }] },
      { title: 'salteado [E3-41]', file: 'a.spec.ts', tests: [{ results: [{ status: 'skipped' }] }] },
      { title: 'flaky [E3-47]', file: 'a.spec.ts', tests: [{ results: [{ status: 'failed' }, { status: 'passed' }] }] },
    ] }] }] };
    expect(checkPlaywrightResults({ pwTags, report })).toEqual([
      'e2e-platform/a.spec.ts «salteado [E3-41]»: skipped (se exige passed)',
      'e2e-platform/a.spec.ts «flaky [E3-47]»: failed, passed (se exige passed)',
      'e2e-platform/b.spec.ts «ausente [E3-47]»: no aparece en el reporte de Playwright',
    ]);
  });

  it('el repo real: 19 puntos con test o estado declarado y el documento generado al día', () => {
    const r = spawnSync(process.execPath, ['scripts/acceptance/cli.mjs', 'check'], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('GATE acceptance: 19 puntos');
  });
});
