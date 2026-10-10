#!/usr/bin/env node
/**
 * BL-23 · CLI de la matriz de aceptación.
 *
 *   node scripts/acceptance/cli.mjs generate            → escribe docs/reviews/M3A1_ACEPTACION.md
 *   node scripts/acceptance/cli.mjs check               → valida puntos/tags/evidencia y que el doc esté al día
 *   node scripts/acceptance/cli.mjs check --results r.json
 *                                                       → además: cada test etiquetado PASÓ en ese reporte
 *   node scripts/acceptance/cli.mjs check --playwright-results pw.json
 *                                                       → además: cada test [E3-N] de e2e-platform PASÓ (Playwright)
 *
 * Sale con 1 y lista los errores si algo no cierra.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAVEGADOR, POINTS, SUITE_NAVEGADOR, SUITE_VERIFICADA } from './points.mjs';
import { checkPlaywrightResults, checkResults, render, scanPlaywrightTags, scanTags, validate, validateNavegador } from './matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = 'docs/reviews/M3A1_ACEPTACION.md';

function testFiles(dir, out = []) {
  for (const e of readdirSync(path.join(ROOT, dir))) {
    if (e === 'node_modules' || e === '.next' || e === 'dist') continue;
    const rel = path.join(dir, e);
    if (statSync(path.join(ROOT, rel)).isDirectory()) testFiles(rel, out);
    else if (/\.test\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
}

const files = ['packages', 'apps'].flatMap((d) => testFiles(d)).sort().map((p) => ({ path: p, source: readFileSync(path.join(ROOT, p), 'utf8') }));
const tags = scanTags(files);
const playwrightSources = {};
for (const p of POINTS) for (const f of p.playwright?.files ?? []) playwrightSources[f] = existsSync(path.join(ROOT, f)) ? readFileSync(path.join(ROOT, f), 'utf8') : undefined;

const pwFiles = existsSync(path.join(ROOT, SUITE_NAVEGADOR))
  ? readdirSync(path.join(ROOT, SUITE_NAVEGADOR)).filter((e) => e.endsWith('.spec.ts')).sort().map((e) => ({ path: `${SUITE_NAVEGADOR}/${e}`, source: readFileSync(path.join(ROOT, SUITE_NAVEGADOR, e), 'utf8') }))
  : [];
const pwTags = scanPlaywrightTags(pwFiles);

const [cmd, ...rest] = process.argv.slice(2);
const errores = [...validate({ points: POINTS, tags, suite: SUITE_VERIFICADA, playwrightSources }), ...validateNavegador({ navegador: NAVEGADOR, pwTags })];
const doc = render({ points: POINTS, tags, navegador: NAVEGADOR, pwTags });

if (cmd === 'generate') {
  if (errores.length) fallar(errores);
  writeFileSync(path.join(ROOT, DOC), doc);
  console.log(`${DOC} generado: ${tags.length} tests etiquetados, ${POINTS.filter((p) => p.estado === 'cubierto').length}/19 cubiertos, navegador ${NAVEGADOR.filter((x) => x.estado === 'cubierto').length}/${NAVEGADOR.length} (${pwTags.length} tests de Playwright etiquetados)`);
} else if (cmd === 'check') {
  const actual = existsSync(path.join(ROOT, DOC)) ? readFileSync(path.join(ROOT, DOC), 'utf8') : '';
  if (actual !== doc) errores.push(`${DOC} desactualizado: correr \`pnpm acceptance:generate\``);
  const i = rest.indexOf('--results');
  if (i >= 0) {
    const report = JSON.parse(readFileSync(path.resolve(rest[i + 1]), 'utf8'));
    errores.push(...checkResults({ tags, report, root: ROOT }));
  }
  const j = rest.indexOf('--playwright-results');
  if (j >= 0) {
    const report = JSON.parse(readFileSync(path.resolve(rest[j + 1]), 'utf8'));
    errores.push(...checkPlaywrightResults({ pwTags, report }));
  }
  if (errores.length) fallar(errores);
  console.log(`GATE acceptance: 19 puntos, ${tags.length} tests etiquetados${i >= 0 ? ', todos passed en el reporte' : ''}; navegador ${pwTags.length} tests [E3-N]${j >= 0 ? ', todos passed en Playwright' : ''}; ${DOC} al día`);
} else {
  console.error('uso: cli.mjs generate | check [--results reporte.json] [--playwright-results pw.json]');
  process.exit(2);
}

function fallar(e) {
  console.error(`✗ matriz de aceptación (BL-23): ${e.length} problema(s)`);
  for (const x of e) console.error(`  - ${x}`);
  process.exit(1);
}
