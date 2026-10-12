#!/usr/bin/env node
// P-05 · R3b — "comparte dependencias" (Codex sobre b4aeebb, P2).
//
//   uso: node scripts/collab/paralelo-deps.mjs <sha>...   (cwd = repo git)
//   entrada por env: FASE_FILES y LAT_FILES (rutas, una por línea)
//   salida: una línea por conflicto "<workspace del lateral> ~ <workspace de la fase>: <motivo>"
//           (nada si no hay conflicto). Exit 0 salvo error de uso o de git (exit 1).
//
// Workspaces = directorios con package.json que coinciden con los patrones `dir/*` de
// pnpm-workspace.yaml. El grafo es la UNIÓN de las dependencias @workspace declaradas en
// todos los <sha> dados (main, HEAD de la fase y HEAD del lateral): un lateral que agrega
// una dependencia hacia un paquete de la fase también cuenta.
// Hay conflicto si un workspace tocado por el lateral y uno tocado por la fase son el
// mismo o uno depende del otro (transitivamente, en cualquier sentido).
// Solo lee con git (execFileSync con argumentos, sin shell).
import { execFileSync } from 'node:child_process';

const shas = process.argv.slice(2);
if (shas.length === 0) { console.error('paralelo-deps: falta al menos un sha'); process.exit(1); }
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const lista = (v) => (v || '').split('\n').filter(Boolean);

const dirs = new Map(); // dir -> nombre
const deps = new Map(); // nombre -> Set(nombre)
for (const sha of shas) {
  let ws = '';
  try { ws = git('show', `${sha}:pnpm-workspace.yaml`); } catch { continue; }
  const patrones = [...ws.matchAll(/^\s*-\s*['"]?([^'"*\s]+)\/\*['"]?\s*$/gm)].map((m) => m[1]);
  if (patrones.length === 0) continue;
  const archivos = lista(git('ls-tree', '-r', '--name-only', sha, '--', ...patrones));
  for (const f of archivos) {
    const m = f.match(/^(.+?\/[^/]+)\/package\.json$/);
    if (!m || !patrones.includes(m[1].slice(0, m[1].lastIndexOf('/')))) continue;
    let pkg;
    try { pkg = JSON.parse(git('show', `${sha}:${f}`)); } catch { continue; }
    if (!pkg.name) continue;
    dirs.set(m[1], pkg.name);
    const d = deps.get(pkg.name) || new Set();
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const n of Object.keys(pkg[k] || {})) d.add(n);
    }
    deps.set(pkg.name, d);
  }
}
const nombres = new Set(deps.keys());
const cierre = new Map();
const alcanza = (n) => {
  if (cierre.has(n)) return cierre.get(n);
  const vis = new Set(); const pila = [n];
  while (pila.length) {
    const x = pila.pop();
    for (const y of deps.get(x) || []) if (nombres.has(y) && !vis.has(y)) { vis.add(y); pila.push(y); }
  }
  cierre.set(n, vis); return vis;
};
const workspaceDe = (f) => {
  for (const [d, n] of dirs) if (f.startsWith(d + '/')) return n;
  return null;
};
const tocados = (v) => new Set(lista(v).map(workspaceDe).filter(Boolean));
const F = tocados(process.env.FASE_FILES);
const L = tocados(process.env.LAT_FILES);
const salida = [];
for (const l of [...L].sort()) for (const f of [...F].sort()) {
  if (l === f) salida.push(`${l} ~ ${f}: mismo paquete`);
  else if (alcanza(l).has(f)) salida.push(`${l} ~ ${f}: el lateral depende de un paquete que cambia la fase`);
  else if (alcanza(f).has(l)) salida.push(`${l} ~ ${f}: la fase depende de un paquete que cambia el lateral`);
}
if (salida.length) console.log(salida.join('\n'));
