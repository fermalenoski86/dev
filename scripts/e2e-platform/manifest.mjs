#!/usr/bin/env node
/**
 * BL-29 · manifest de la evidencia §47 del job `e2e-platform`.
 *
 *   node scripts/e2e-platform/manifest.mjs build --report <playwright.json> --evidence <dir> --out <artifact-dir>
 *   node scripts/e2e-platform/manifest.mjs validate <artifact-dir>
 *
 * `build` copia screenshots (los que guardan los specs) y videos (attachments
 * del reporte) al directorio del artifact y escribe `evidence-manifest.json`
 * con: commit, navegador, roles, campaignId, versionId/hash, specs con su
 * resultado y el SHA-256 de cada archivo. `validate` lo verifica antes de
 * subirlo (CI falla si algo no cierra). Retención del artifact: 90 días
 * (`RETENTION_DAYS`, igual que `retention-days` en gates.yml). Sin dependencias.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETENTION_DAYS = 90;
export const SPECS_REQUERIDOS = ['a11y.spec.ts', 'flow-41.spec.ts', 'session-multihost.spec.ts'];
export const MIN_SCREENSHOTS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Specs del reporte JSON de Playwright: archivo, título, estado final y todos los intentos. */
export function testsDelReporte(report) {
  const out = [];
  const recorrer = (suite) => {
    for (const sp of suite.specs ?? []) {
      for (const t of sp.tests ?? []) {
        const intentos = (t.results ?? []).map((r) => r.status);
        const videos = (t.results ?? []).flatMap((r) => (r.attachments ?? []).filter((a) => a.name === 'video' && a.path).map((a) => a.path));
        out.push({ file: (sp.file ?? '').split('/').pop(), title: sp.title, status: intentos.at(-1) ?? 'sin resultados', attempts: intentos, videos });
      }
    }
    for (const s of suite.suites ?? []) recorrer(s);
  };
  for (const s of report.suites ?? []) recorrer(s);
  return out;
}

/** Arma el manifest (puro: recibe los archivos ya copiados con su contenido). */
export function buildManifest({ commit, headSha = commit, browser, tests, flows, files }) {
  return {
    schema: 'trust.e2e-platform.evidence.v1',
    commit,
    headSha,
    browser,
    retentionDays: RETENTION_DAYS,
    specs: [...new Set(tests.map((t) => t.file))].sort(),
    tests: tests.map(({ file, title, status, attempts }) => ({ file, title, status, attempts })),
    flows,
    files: files.map(({ path: p, kind, buf }) => ({ path: p, kind, bytes: buf.length, sha256: sha256(buf) })).sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Errores del manifest (vacío = OK). `leer(path)` devuelve el Buffer o null si no existe. */
export function validateManifest(m, leer) {
  const e = [];
  if (m?.schema !== 'trust.e2e-platform.evidence.v1') e.push('schema inválido');
  if (!/^[0-9a-f]{40}$/.test(m?.commit ?? '')) e.push(`commit inválido: «${m?.commit}»`);
  if (!/^[0-9a-f]{40}$/.test(m?.headSha ?? '')) e.push(`headSha inválido: «${m?.headSha}»`);
  if (!m?.browser || typeof m.browser !== 'string') e.push('falta el navegador');
  if (m?.retentionDays !== RETENTION_DAYS) e.push(`retentionDays tiene que ser ${RETENTION_DAYS}`);
  for (const s of SPECS_REQUERIDOS) if (!(m?.specs ?? []).includes(s)) e.push(`falta el spec ${s}`);
  if (!(m?.tests ?? []).length) e.push('sin tests');
  for (const t of m?.tests ?? []) {
    if (t.status !== 'passed' || (t.attempts ?? []).some((a) => a !== 'passed')) e.push(`${t.file} «${t.title}»: ${(t.attempts ?? [t.status]).join(', ')} (se exige passed sin reintentos)`);
  }
  if (!(m?.flows ?? []).length) e.push('sin flujos §41 registrados');
  for (const f of m?.flows ?? []) {
    if (!UUID.test(f.campaignId ?? '')) e.push(`flujo: campaignId inválido «${f.campaignId}»`);
    if (!UUID.test(f.versionId ?? '')) e.push(`flujo: versionId inválido «${f.versionId}»`);
    if (!SHA.test(f.versionHash ?? '')) e.push(`flujo: versionHash inválido «${f.versionHash}»`);
    if (!f.roles?.operator || !f.roles?.approver || f.roles.operator === f.roles.approver) e.push('flujo: roles operator/approver ausentes o iguales');
    if ((f.screenshots ?? []).length < MIN_SCREENSHOTS) e.push(`flujo: ${(f.screenshots ?? []).length} screenshots de §47 (se exigen ${MIN_SCREENSHOTS})`);
    for (const s of f.screenshots ?? []) if (!(m.files ?? []).some((x) => x.path === `screenshots/${s}`)) e.push(`flujo: screenshot ${s} no está en files`);
  }
  const files = m?.files ?? [];
  if (files.filter((x) => x.kind === 'screenshot').length < MIN_SCREENSHOTS) e.push(`menos de ${MIN_SCREENSHOTS} screenshots`);
  if (!files.some((x) => x.kind === 'video')) e.push('sin videos');
  for (const x of files) {
    const buf = leer(x.path);
    if (!buf) e.push(`${x.path}: no existe`);
    else if (sha256(buf) !== x.sha256) e.push(`${x.path}: SHA-256 no coincide`);
    else if (buf.length !== x.bytes) e.push(`${x.path}: tamaño no coincide`);
  }
  return e;
}

function arg(nombre, args) {
  const i = args.indexOf(nombre);
  if (i < 0 || !args[i + 1]) throw new Error(`falta ${nombre}`);
  return args[i + 1];
}

function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === 'build') {
    const report = JSON.parse(readFileSync(arg('--report', args), 'utf8'));
    const evidencia = arg('--evidence', args);
    const out = arg('--out', args);
    mkdirSync(path.join(out, 'screenshots'), { recursive: true });
    mkdirSync(path.join(out, 'videos'), { recursive: true });
    const tests = testsDelReporte(report);
    const files = [];
    const dirShots = path.join(evidencia, 'screenshots');
    for (const s of existsSync(dirShots) ? readdirSync(dirShots).sort() : []) {
      copyFileSync(path.join(dirShots, s), path.join(out, 'screenshots', s));
      files.push({ path: `screenshots/${s}`, kind: 'screenshot', buf: readFileSync(path.join(out, 'screenshots', s)) });
    }
    tests.forEach((t, i) => t.videos.forEach((v, j) => {
      if (!existsSync(v)) return;
      const nombre = `${String(i).padStart(2, '0')}-${j}-${t.file.replace(/\.spec\.ts$/, '')}.webm`;
      copyFileSync(v, path.join(out, 'videos', nombre));
      files.push({ path: `videos/${nombre}`, kind: 'video', buf: readFileSync(path.join(out, 'videos', nombre)) });
    }));
    const dirParts = path.join(evidencia, 'parts');
    const flows = (existsSync(dirParts) ? readdirSync(dirParts).sort() : []).map((p) => JSON.parse(readFileSync(path.join(dirParts, p), 'utf8')));
    // `commit`: el árbol que corrió (en pull_request, GITHUB_SHA es el merge commit sintético);
    // `headSha`: el HEAD del PR que se audita (E2E_HEAD_SHA en gates.yml). Fuera de CI, ambos son HEAD.
    const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const headSha = process.env.E2E_HEAD_SHA || commit;
    const browser = flows.find((f) => f.browser)?.browser ?? '';
    const m = buildManifest({ commit, headSha, browser, tests, flows, files });
    writeFileSync(path.join(out, 'evidence-manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
    console.log(`manifest: ${m.tests.length} tests, ${m.flows.length} flujos, ${m.files.length} archivos → ${path.join(out, 'evidence-manifest.json')}`);
  } else if (cmd === 'validate') {
    const dir = args[0];
    if (!dir) throw new Error('uso: validate <artifact-dir>');
    const m = JSON.parse(readFileSync(path.join(dir, 'evidence-manifest.json'), 'utf8'));
    const errores = validateManifest(m, (p) => (existsSync(path.join(dir, p)) ? readFileSync(path.join(dir, p)) : null));
    if (errores.length) {
      console.error(`✗ manifest de evidencia (BL-29): ${errores.length} problema(s)`);
      for (const x of errores) console.error(`  - ${x}`);
      process.exit(1);
    }
    console.log(`GATE evidencia: ${m.tests.length} tests passed, ${m.flows.length} flujo(s) §41, ${m.files.filter((f) => f.kind === 'screenshot').length} screenshots, ${m.files.filter((f) => f.kind === 'video').length} videos, SHA-256 verificados (head ${m.headSha.slice(0, 7)}, árbol ${m.commit.slice(0, 7)}, ${m.browser})`);
  } else {
    console.error('uso: manifest.mjs build --report r.json --evidence dir --out dir | validate dir');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
