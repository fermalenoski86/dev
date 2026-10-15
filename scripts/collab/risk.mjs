#!/usr/bin/env node
// P-03 · Auditoría basada en riesgo — CLI sobre git. Reglas en risk.lib.mjs.
//
//   node scripts/collab/risk.mjs calcular  <base> <head>            → imprime nivel y detalle (exit 0)
//   node scripts/collab/risk.mjs verificar <base> <head> <cuerpo>   → exit 0 OK · exit 2 rechazo
//   node scripts/collab/risk.mjs historial <sha>...                 → tabla markdown (sha^..sha)
//
// El diff es SIEMPRE contra el merge-base (base...head), con --no-renames (un rename
// cuenta como borrado del origen + alta del destino) y -z (rutas sin comillas).
// GATES_RE y las raíces del workspace se leen del ÁRBOL DONDE CORRE ESTE SCRIPT
// (en CI: el checkout de main, revisión confiable), nunca de la revisión del PR.
// Cualquier error de git o de lectura → exit 1 (sin veredicto; no hay "bajo" por omisión).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clasificar, gatesDesdeParalelo, informe, raicesWorkspace, verificar } from './risk.lib.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');

// GIT_LITERAL_PATHSPECS=1: una ruta del diff que parece magia de pathspec (`:(exclude)x.md`)
// se toma literal; si no, `git diff -- <ruta>` devolvería otro parche (o ninguno) y su
// contenido no se analizaría (AUDIT: CAMBIOS @ e08a47b, P1).
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts, env: { ...process.env, ...opts.env, GIT_LITERAL_PATHSPECS: '1' } });
const fallo = (m) => { console.error(`risk: ${m}`); process.exit(1); };

function reglas() {
  const par = readFileSync(path.join(AQUI, 'paralelo.sh'), 'utf8');
  let ws = '';
  try { ws = readFileSync(path.join(RAIZ, 'pnpm-workspace.yaml'), 'utf8'); } catch { /* sin archivo → apps|packages */ }
  return gatesDesdeParalelo(par, raicesWorkspace(ws));
}

function scriptsDe(rev, ruta) {
  try { return JSON.stringify(JSON.parse(git(['show', `${rev}:${ruta}`], { stdio: ['ignore', 'pipe', 'ignore'] })).scripts ?? {}); }
  catch { return '__sin-package-json__'; }
}

export function archivosDelDiff(desde, hasta) {
  // --raw: modos de archivo además del estado (symlink 120000 y submódulo 160000 → alto)
  const raw = git(['diff', '--no-renames', '--raw', '-z', desde, hasta, '--']).split('\0');
  const archivos = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) \S+ \S+ ([A-Z])/.exec(raw[i]);
    if (!m) break;
    archivos.push({ ruta: raw[i + 1], estado: m[3], modoEspecial: [m[1], m[2]].some((x) => x === '120000' || x === '160000') });
  }
  const bin = new Set();
  const num = git(['diff', '--no-renames', '--numstat', '-z', desde, hasta, '--']).split('\0');
  for (const l of num) { const m = /^-\t-\t(.*)$/s.exec(l); if (m) bin.add(m[1]); }
  for (const a of archivos) {
    a.binario = bin.has(a.ruta);
    if (/[\n\r\0]/.test(a.ruta)) continue; // anómala: clasificarRuta la manda a alto
    a.parche = a.binario ? '' : git(['diff', '--no-renames', '-U0', desde, hasta, '--', a.ruta]);
    if (/(^|\/)package\.json$/.test(a.ruta)) a.scriptsCambian = scriptsDe(desde, a.ruta) !== scriptsDe(hasta, a.ruta);
  }
  return archivos;
}

const resolver = (ref) => git(['rev-parse', '-q', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();

function calcular(base, head) {
  const b = resolver(base);
  const h = resolver(head);
  const mb = git(['merge-base', b, h]).trim();
  head = h;
  return clasificar(archivosDelDiff(mb, head), reglas());
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'calcular' && args.length === 2) {
    console.log(informe(calcular(args[0], args[1])));
  } else if (cmd === 'verificar' && args.length === 3) {
    const res = calcular(args[0], args[1]);
    const cuerpo = readFileSync(args[2], 'utf8');
    const v = verificar(res.nivel, cuerpo);
    console.log(informe(res));
    console.log(`riesgo declarado: ${v.declarado ?? '(ninguno)'} · efectivo: ${v.efectivo}`);
    if (v.errores.length) {
      for (const e of v.errores) console.error(`risk: RECHAZADO — ${e}`);
      process.exit(2);
    }
    console.log(`risk: OK — mínimo de auditoría: ${v.efectivo} (AGENTS.md §Auditoría por riesgo)`);
  } else if (cmd === 'historial' && args.length > 0) {
    const g = reglas();
    console.log('| commit | riesgo | archivos | motivo principal |\n|---|---|---|---|');
    for (const sha of args) {
      const res = clasificar(archivosDelDiff(`${sha}^`, sha), g);
      const top = res.detalle.filter((d) => d.nivel === res.nivel);
      console.log(`| ${sha.slice(0, 7)} | ${res.nivel} | ${res.detalle.length} | ${top[0].ruta} — ${top[0].motivos.at(-1)}${top.length > 1 ? ` (+${top.length - 1})` : ''} |`);
    }
  } else {
    console.error('uso: risk.mjs calcular <base> <head> | verificar <base> <head> <cuerpo.md> | historial <sha>...');
    process.exit(1);
  }
} catch (e) {
  fallo(`sin veredicto: ${e.message.split('\n')[0]}`);
}
