#!/usr/bin/env node
// PoC P-06 caso 7: comentario inocuo en el validador para probar el rechazo por riesgo alto; este PR no se mergea.
// P-06 · `delegated-audit-gate` — CLI sobre la API de GitHub (gh) y git. Reglas en
// delegated-audit.lib.mjs; brief docs/briefs/P06_BRIDGE_POC.md §3.
//
//   node scripts/collab/delegated-audit.mjs evaluar <pr>   → imprime el veredicto (JSON), no publica
//   node scripts/collab/delegated-audit.mjs ci              → evalúa TODOS los PR abiertos hacia main
//                                                             y publica el check sobre cada HEAD
//
// Fuente de autoridad: API de GitHub (PR, reviews, comentarios e hilos del bot allowlisted,
// runs de gates.yml, padres del merge probado) + `risk.mjs verificar` de ESTE árbol (en CI:
// el checkout de main) sobre el diff contra el main fijado y el cuerpo del PR (solo para su
// declaración de riesgo: se lee como texto, nunca se ejecuta). Nunca archivos del PR. El
// único issue_comment que cuenta es el marcador del bot por user.id (adaptador A, #54).
// PASS = preauditoría Codex limpia en riesgo bajo; nunca aprobación formal.
// Tupla (AUDIT: CAMBIOS @ 9332156): main se fija al empezar y todo se relee al terminar;
// y la revisión en ejecución tiene que ser ese main (AUDIT: CAMBIOS @ f097a29).
// REPORT-ONLY: el check sale siempre `neutral` y el comando termina 0 aunque el veredicto
// sea FAIL; solo un error de lectura de la lista de PR o de publicación da exit 1.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRun, cicloCi, evaluarPrCon, riesgoDeSalida, shaProbado } from './delegated-audit.lib.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');
const REPO = process.env.GITHUB_REPOSITORY || 'fermalenoski86/dev';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const api = (ruta, ...extra) => JSON.parse(run('gh', ['api', ruta, ...extra]));
const apiLista = (ruta, jq = '.[]') => run('gh', ['api', '--paginate', ruta, '--jq', jq]).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const intentar = (f) => { try { return f(); } catch { return null; } };

// Revisión del código/política EN EJECUCIÓN (AUDIT: CAMBIOS @ f097a29, P2): se fija al
// arrancar, con los módulos ya cargados, y se exige árbol limpio en lo que decide (este CLI,
// su biblioteca, risk.mjs y gates.yml). evaluar() exige que sea el main evaluado; un checkout
// atrasado o modificado da FAIL. Se relee al terminar cada PR (alguien hizo checkout en medio).
const POLITICA = ['scripts/collab', '.github/workflows'];
function revisionEjecutada() {
  const h = run('git', ['rev-parse', 'HEAD'], { cwd: RAIZ }).trim();
  run('git', ['diff', '--quiet', 'HEAD', '--', ...POLITICA], { cwd: RAIZ }); // exit 1 si hay cambios → null
  return h;
}
const EJECUTADA = intentar(revisionEjecutada);

function leerPr(n) {
  const p = api(`repos/${REPO}/pulls/${n}`);
  return { number: p.number, head_sha: p.head?.sha, base_ref: p.base?.ref, state: p.state, body: typeof p.body === 'string' ? p.body : '' };
}

const SHA_RE = /^[0-9a-f]{40}$/;
function mainActual() {
  const s = api(`repos/${REPO}/git/ref/heads/main`).object?.sha;
  if (!SHA_RE.test(s ?? '')) throw new Error('sha de main ilegible');
  return s;
}
// TODOS los PR abiertos (cualquier base): el HEAD compartido se mira contra todos (ADR-065)
const listarAbiertos = () => apiLista(`repos/${REPO}/pulls?state=open&per_page=100`).map((p) => ({ number: p.number, head_sha: p.head?.sha, base_ref: p.base?.ref }));

// Adaptador A (#54, 2026-10-20): reviews, comentarios del PR (marcador codex-review-state:v1)
// y comentarios en línea (badges P0–P2), TODAS las páginas (--paginate): si una página falla,
// gh sale ≠ 0 → excepción → null en evaluarPrCon → FAIL. Solo se leen; la identidad la
// decide user.id contra la allowlist de main. Sin GraphQL.
const leerReviews = (n) => apiLista(`repos/${REPO}/pulls/${n}/reviews?per_page=100`).map((r) => ({ id: r.id, user: r.user, state: r.state, commit_id: r.commit_id, body: r.body, submitted_at: r.submitted_at }));
const leerComentarios = (n) => apiLista(`repos/${REPO}/issues/${n}/comments?per_page=100`).map((c) => ({ id: c.id, user: c.user, body: c.body }));
const leerHilos = (n) => apiLista(`repos/${REPO}/pulls/${n}/comments?per_page=100`).map((c) => ({ id: c.id, user: c.user, body: c.body, commit_id: c.commit_id, original_commit_id: c.original_commit_id, path: c.path, line: c.line }));

// Riesgo EFECTIVO: risk.mjs verificar <main fijado> <head> <cuerpo> (exit 0 OK, 2 rechazo
// con motivos, 1 sin veredicto → null). Mismo contrato que el job `riesgo` (P-03).
function verificarRiesgo(n, head, main, cuerpo) {
  run('git', ['fetch', '-q', 'origin', `+refs/pull/${n}/head:refs/remotes/pr/${n}`, main], { cwd: RAIZ });
  run('git', ['cat-file', '-e', `${head}^{commit}`], { cwd: RAIZ });
  run('git', ['cat-file', '-e', `${main}^{commit}`], { cwd: RAIZ });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'p06-cuerpo-'));
  try {
    const f = path.join(dir, 'cuerpo.md');
    writeFileSync(f, cuerpo);
    try { return riesgoDeSalida(0, run('node', [path.join(AQUI, 'risk.mjs'), 'verificar', main, head, f], { cwd: RAIZ }), ''); } catch (e) {
      return riesgoDeSalida(e?.status, e?.stdout, e?.stderr);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Último run pull_request de gates.yml para el HEAD + procedencia: el merge que ejecutó
// (run-name "· probado <github.sha>") y sus padres por API (base probada, HEAD probado).
function leerGates(head) {
  const runs = api(`repos/${REPO}/actions/workflows/gates.yml/runs?head_sha=${head}&event=pull_request&per_page=20`).workflow_runs ?? [];
  const ult = runs.filter((r) => r.head_sha === head).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
  if (!ult) return null;
  const jobs = apiLista(`repos/${REPO}/actions/runs/${ult.id}/attempts/${ult.run_attempt}/jobs?per_page=100`, '.jobs[]');
  const probado = shaProbado(ult.display_title);
  const padres = probado ? intentar(() => api(`repos/${REPO}/git/commits/${probado}`).parents?.map((x) => x.sha)) : null;
  const dos = Array.isArray(padres) && padres.length === 2;
  return {
    id: ult.id, attempt: ult.run_attempt, head_sha: ult.head_sha, event: ult.event, status: ult.status, conclusion: ult.conclusion,
    jobs: jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion })),
    probado, base_probada: dos ? padres[0] : null, head_probado: dos ? padres[1] : null,
  };
}

const evaluarPr = (n) => evaluarPrCon(n, {
  repo: REPO,
  ejecutada: EJECUTADA,
  ejecutadaAhora: revisionEjecutada,
  mainActual, leerPr, leerReviews, leerComentarios, leerHilos, verificarRiesgo, leerGates,
  // gates.yml de la revisión ejecutada (no del árbol de trabajo)
  gatesYml: () => run('git', ['show', `${EJECUTADA}:.github/workflows/gates.yml`], { cwd: RAIZ }),
});

function publicar(v) {
  const cuerpo = JSON.stringify(checkRun(v));
  for (let i = 1; i <= 3; i++) {
    try { return run('gh', ['api', '-X', 'POST', `repos/${REPO}/check-runs`, '--input', '-', '--jq', '.html_url'], { input: cuerpo }).trim(); } catch { /* reintento */ }
  }
  return null;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'evaluar' && args.length === 1 && /^\d+$/.test(args[0])) {
  console.log(JSON.stringify(evaluarPr(Number(args[0])), null, 2));
} else if (cmd === 'ci' && args.length === 0) {
  let prs, abiertos;
  // número + HEAD de la lista: si después falla la lectura del PR, igual hay HEAD donde
  // publicar el FAIL "sin veredicto" (Codex #88, P2)
  try { abiertos = listarAbiertos(); prs = abiertos.filter((p) => p.base_ref === 'main'); } catch (e) {
    console.log(`::error title=delegated-audit-gate::no se pudo listar los PR abiertos: ${String(e.message).split('\n')[0]}`);
    process.exit(1);
  }
  const rc = cicloCi(prs, { evaluarPr, publicar, relistar: listarAbiertos, abiertos });
  if (prs.length === 0) console.log('delegated-audit-gate: sin PR abiertos hacia main');
  process.exit(rc);
} else {
  console.error('uso: delegated-audit.mjs evaluar <pr> | ci');
  process.exit(1);
}
