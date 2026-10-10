import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { MIN_SCREENSHOTS, RETENTION_DAYS, buildManifest, sha256, testsDelReporte, validateManifest } from './manifest.mjs';

/**
 * BL-29 · el manifest de la evidencia §47: negativos controlados. Cada forma de
 * que la evidencia mienta (archivo cambiado o faltante, test no passed,
 * reintento, hash o ids inválidos, roles iguales, retención distinta) falla.
 */
const tmp = mkdtempSync(path.join(os.tmpdir(), 'trust-bl29-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const COMMIT = 'a'.repeat(40);
const U = '11111111-2222-4333-8444-555555555555';
const report = {
  suites: [
    { title: 'flow-41.spec.ts', specs: [], suites: [], },
    ...['a11y.spec.ts', 'flow-41.spec.ts', 'session-multihost.spec.ts'].map((f, i) => ({
      title: f,
      specs: [{ title: `t${i} [E3-41]`, file: f, tests: [{ results: [{ status: 'passed', attachments: [{ name: 'video', path: `/no/existe/${i}.webm` }] }] }] }],
    })),
  ],
};
function base() {
  const shots = Array.from({ length: MIN_SCREENSHOTS }, (_, i) => ({ path: `screenshots/0-0${i}.png`, kind: 'screenshot', buf: Buffer.from(`png ${i}`) }));
  const files = [...shots, { path: 'videos/00-0-flow-41.webm', kind: 'video', buf: Buffer.from('webm') }];
  const flows = [{ test: 'x', roles: { operator: 'op-w0@e2e', approver: 'ap-w0@e2e' }, campaignId: U, versionId: U, versionHash: 'b'.repeat(64), screenshots: ['0-00.png'] }];
  return { files, m: buildManifest({ commit: COMMIT, browser: 'chromium 141.0', tests: testsDelReporte(report), flows, files }) };
}
const lector = (files: Array<{ path: string; buf: Buffer }>) => (p: string) => files.find((f) => f.path === p)?.buf ?? null;

describe('BL-29 · manifest de evidencia de e2e-platform', () => {
  it('lee el reporte de Playwright (specs anidados, intentos y videos) y arma un manifest válido', () => {
    const t = testsDelReporte(report);
    expect(t.map((x: { file: string; status: string }) => `${x.file}:${x.status}`)).toEqual(['a11y.spec.ts:passed', 'flow-41.spec.ts:passed', 'session-multihost.spec.ts:passed']);
    expect(t[0].videos).toEqual(['/no/existe/0.webm']);
    const { files, m } = base();
    expect(m).toMatchObject({ schema: 'trust.e2e-platform.evidence.v1', commit: COMMIT, retentionDays: RETENTION_DAYS, specs: ['a11y.spec.ts', 'flow-41.spec.ts', 'session-multihost.spec.ts'] });
    expect(m.files.find((f: { path: string }) => f.path === 'videos/00-0-flow-41.webm').sha256).toBe(sha256(Buffer.from('webm')));
    expect(validateManifest(m, lector(files))).toEqual([]);
  });

  it('NEGATIVO: un archivo cambiado o borrado después de armar el manifest falla', () => {
    const { files, m } = base();
    const cambiado = files.map((f) => (f.path === 'screenshots/0-03.png' ? { ...f, buf: Buffer.from('otro') } : f));
    expect(validateManifest(m, lector(cambiado))).toEqual(['screenshots/0-03.png: SHA-256 no coincide']);
    expect(validateManifest(m, lector(files.filter((f) => f.kind !== 'video')))).toEqual(['videos/00-0-flow-41.webm: no existe']);
  });

  it('NEGATIVO: un test no passed o con reintentos, un spec faltante o sin tests falla', () => {
    const { files, m } = base();
    const fallido = { ...m, tests: m.tests.map((t: { file: string }, i: number) => (i === 1 ? { ...t, status: 'passed', attempts: ['failed', 'passed'] } : t)) };
    expect(validateManifest(fallido, lector(files))).toEqual([expect.stringContaining('failed, passed (se exige passed sin reintentos)')]);
    expect(validateManifest({ ...m, specs: m.specs.filter((s: string) => s !== 'a11y.spec.ts') }, lector(files))).toEqual(['falta el spec a11y.spec.ts']);
    expect(validateManifest({ ...m, tests: [] }, lector(files))).toEqual(['sin tests']);
  });

  it('NEGATIVO: commit, navegador, retención, ids, hash, roles, screenshots y videos inválidos fallan', () => {
    const { files, m } = base();
    const v = (x: object) => validateManifest({ ...m, ...x }, lector(files));
    expect(v({ commit: 'abc' })).toEqual([expect.stringContaining('commit inválido')]);
    expect(v({ browser: '' })).toEqual(['falta el navegador']);
    expect(v({ retentionDays: 30 })).toEqual([`retentionDays tiene que ser ${RETENTION_DAYS}`]);
    const flujo = (o: object) => v({ flows: [{ ...m.flows[0], ...o }] });
    expect(flujo({ campaignId: 'x' })).toEqual([expect.stringContaining('campaignId inválido')]);
    expect(flujo({ versionHash: 'z'.repeat(64) })).toEqual([expect.stringContaining('versionHash inválido')]);
    expect(flujo({ roles: { operator: 'a', approver: 'a' } })).toEqual(['flujo: roles operator/approver ausentes o iguales']);
    expect(flujo({ screenshots: ['no-esta.png'] })).toEqual(['flujo: screenshot no-esta.png no está en files']);
    expect(v({ flows: [] })).toEqual(['sin flujos §41 registrados']);
    const sinVideo = m.files.filter((f: { kind: string }) => f.kind !== 'video');
    expect(v({ files: sinVideo })).toEqual(['sin videos']);
    expect(v({ files: m.files.filter((f: { path: string }) => f.path !== 'screenshots/0-07.png') })).toEqual([`menos de ${MIN_SCREENSHOTS} screenshots`]);
  });

  it('la retención del manifest es la misma que la del artifact en gates.yml', () => {
    const yml = readFileSync('.github/workflows/gates.yml', 'utf8');
    const bloque = yml.slice(yml.indexOf('name: e2e-platform-evidence'));
    expect(bloque).toMatch(new RegExp(`retention-days: ${RETENTION_DAYS}\\b`));
  });

  it('CLI real: build + validate sobre archivos en disco; con un archivo alterado, validate sale con 1', () => {
    const ev = path.join(tmp, 'ev');
    mkdirSync(path.join(ev, 'screenshots'), { recursive: true });
    mkdirSync(path.join(ev, 'parts'), { recursive: true });
    for (let i = 0; i < MIN_SCREENSHOTS; i++) writeFileSync(path.join(ev, 'screenshots', `0-0${i}.png`), `png ${i}`);
    const video = path.join(tmp, 'v.webm');
    writeFileSync(video, 'webm');
    writeFileSync(path.join(ev, 'parts', 'f.json'), JSON.stringify({ browser: 'chromium 141', roles: { operator: 'op', approver: 'ap' }, campaignId: U, versionId: U, versionHash: 'c'.repeat(64), screenshots: ['0-00.png'] }));
    const rep = JSON.parse(JSON.stringify(report).replaceAll('/no/existe/0.webm', video));
    writeFileSync(path.join(tmp, 'r.json'), JSON.stringify(rep));
    const out = path.join(tmp, 'out');
    const env = { ...process.env, GITHUB_SHA: COMMIT };
    const b = spawnSync(process.execPath, ['scripts/e2e-platform/manifest.mjs', 'build', '--report', path.join(tmp, 'r.json'), '--evidence', ev, '--out', out], { encoding: 'utf8', env });
    expect(b.status, b.stderr).toBe(0);
    const ok = spawnSync(process.execPath, ['scripts/e2e-platform/manifest.mjs', 'validate', out], { encoding: 'utf8' });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('GATE evidencia: 3 tests passed, 1 flujo(s) §41, 8 screenshots, 1 videos');
    writeFileSync(path.join(out, 'screenshots', '0-01.png'), 'alterado');
    const mal = spawnSync(process.execPath, ['scripts/e2e-platform/manifest.mjs', 'validate', out], { encoding: 'utf8' });
    expect(mal.status).toBe(1);
    expect(mal.stderr).toContain('screenshots/0-01.png: SHA-256 no coincide');
  });
});
