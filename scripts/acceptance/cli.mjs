#!/usr/bin/env node
/**
 * BL-23 · CLI de la matriz de aceptación.
 *
 *   node scripts/acceptance/cli.mjs generate            → escribe docs/reviews/M3A1_ACEPTACION.md
 *   node scripts/acceptance/cli.mjs check               → valida puntos/tags/evidencia y que el doc esté al día
 *   node scripts/acceptance/cli.mjs check --results r.json
 *                                                       → además: cada test etiquetado PASÓ en ese reporte
 *
 * Sale con 1 y lista los errores si algo no cierra.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PENDIENTES_NAVEGADOR, POINTS, SUITE_VERIFICADA } from './points.mjs';
import { checkResults, render, scanTags, validate } from './matrix.mjs';

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

const [cmd, ...rest] = process.argv.slice(2);
const errores = validate({ points: POINTS, tags, suite: SUITE_VERIFICADA, playwrightSources });
const doc = render({ points: POINTS, tags, pendientes: PENDIENTES_NAVEGADOR });

if (cmd === 'generate') {
  if (errores.length) fallar(errores);
  writeFileSync(path.join(ROOT, DOC), doc);
  console.log(`${DOC} generado: ${tags.length} tests etiquetados, ${POINTS.filter((p) => p.estado === 'cubierto').length}/19 cubiertos, ${PENDIENTES_NAVEGADOR.length} pendientes de navegador`);
} else if (cmd === 'check') {
  const actual = existsSync(path.join(ROOT, DOC)) ? readFileSync(path.join(ROOT, DOC), 'utf8') : '';
  if (actual !== doc) errores.push(`${DOC} desactualizado: correr \`pnpm acceptance:generate\``);
  const i = rest.indexOf('--results');
  if (i >= 0) {
    const report = JSON.parse(readFileSync(path.resolve(rest[i + 1]), 'utf8'));
    errores.push(...checkResults({ tags, report, root: ROOT }));
  }
  if (errores.length) fallar(errores);
  console.log(`GATE acceptance: 19 puntos, ${tags.length} tests etiquetados${i >= 0 ? ', todos passed en el reporte' : ''}; ${DOC} al día`);
} else {
  console.error('uso: cli.mjs generate | check [--results reporte.json]');
  process.exit(2);
}

function fallar(e) {
  console.error(`✗ matriz de aceptación (BL-23): ${e.length} problema(s)`);
  for (const x of e) console.error(`  - ${x}`);
  process.exit(1);
}
