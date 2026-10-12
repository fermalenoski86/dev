#!/usr/bin/env node
/**
 * P-02 · CLI del reporte de progreso verificable.
 *
 *   node scripts/collab/progress.mjs generate          → escribe docs/collab/PROGRESO.md
 *   node scripts/collab/progress.mjs check             → valida el manifiesto y que el doc esté al día (CI)
 *   node scripts/collab/progress.mjs verificar-github  → (fuera de CI) comprueba PRs y comentarios AUDIT
 *                                                        contra la API de GitHub con `gh api`
 *
 * `generate` y `check` no tocan la red: solo leen el manifiesto, points.mjs y
 * el árbol del repo. Salen con 1 y listan los errores si algo no cierra.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NAVEGADOR, POINTS } from '../acceptance/points.mjs';
import { ENTREGABLES, PISTAS, REPO } from './entregables.mjs';
import { render, validar } from './progreso.lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOC = 'docs/collab/PROGRESO.md';
const ctx = { repo: REPO, pistas: PISTAS, points: POINTS, navegador: NAVEGADOR, existe: (p) => existsSync(path.join(ROOT, p)) };

const [cmd] = process.argv.slice(2);
const errores = validar(ENTREGABLES, ctx);

if (cmd === 'generate') {
  if (errores.length) fallar(errores);
  writeFileSync(path.join(ROOT, DOC), render(ENTREGABLES, ctx));
  console.log(`${DOC} generado: ${ENTREGABLES.length} entradas (${ENTREGABLES.filter((x) => x.tipo === 'producto').length} de producto) en ${PISTAS.length} pistas`);
} else if (cmd === 'check') {
  const actual = existsSync(path.join(ROOT, DOC)) ? readFileSync(path.join(ROOT, DOC), 'utf8') : '';
  if (!errores.length && actual !== render(ENTREGABLES, ctx)) errores.push(`${DOC} desactualizado: correr \`pnpm progress:generate\``);
  if (errores.length) fallar(errores);
  console.log(`GATE progreso (P-02): manifiesto válido (${ENTREGABLES.length} entradas), ${DOC} al día`);
} else if (cmd === 'verificar-github') {
  if (errores.length) fallar(errores);
  verificarGithub().then((e) => (e.length ? fallar(e) : console.log('verificar-github: todos los PR y comentarios AUDIT citados existen y coinciden')));
} else {
  console.error('uso: progress.mjs generate | check | verificar-github');
  process.exit(2);
}

function fallar(e) {
  console.error(`✗ progreso (P-02): ${e.length} problema(s)`);
  for (const x of e) console.error(`  - ${x}`);
  process.exit(1);
}

/** Trazabilidad contra GitHub: `gh api` con argumentos, sin shell. No corre en CI (red, token). */
async function verificarGithub() {
  const gh = promisify(execFile);
  const api = async (ruta) => JSON.parse((await gh('gh', ['api', ruta], { maxBuffer: 1 << 24 })).stdout);
  const e = [];
  for (const x of ENTREGABLES) {
    for (const p of x.codigo.prs) {
      const pull = await api(`repos/${REPO}/pulls/${p.numero}`);
      if (!pull.merged_at) e.push(`${x.id}: PR #${p.numero} no está mergeado`);
      if (pull.merge_commit_sha !== p.merge) e.push(`${x.id}: PR #${p.numero} merge_commit_sha es ${pull.merge_commit_sha}, el manifiesto dice ${p.merge}`);
      if (pull.base?.ref !== 'main') e.push(`${x.id}: PR #${p.numero} no apunta a main (${pull.base?.ref})`);
      const id = p.audit.split('#issuecomment-')[1];
      let c;
      try {
        c = await api(`repos/${REPO}/issues/comments/${id}`);
      } catch {
        e.push(`${x.id}: comentario ${id} no existe`);
        continue;
      }
      if (!c.html_url?.startsWith(`https://github.com/${REPO}/pull/${p.numero}#`)) e.push(`${x.id}: comentario ${id} no pertenece al PR #${p.numero} (${c.html_url})`);
      if (!/^\s*(##\s*|\*\*)?AUDIT: APROBADO/.test(c.body ?? '')) e.push(`${x.id}: comentario ${id} no empieza con AUDIT: APROBADO`);
      if (!(c.body ?? '').includes(p.auditado)) e.push(`${x.id}: comentario ${id} no menciona el SHA auditado ${p.auditado}`);
      console.log(`${x.id}: PR #${p.numero} mergeado en ${p.merge.slice(0, 7)}, AUDIT ${id} sobre ${p.auditado.slice(0, 7)} ${e.some((m) => m.startsWith(`${x.id}:`)) ? '✗' : 'OK'}`);
    }
  }
  return e;
}
