#!/usr/bin/env node
// P-06 · `delegated-audit-gate` — CLI sobre la API de GitHub (gh) y git. Reglas en
// delegated-audit.lib.mjs; brief docs/briefs/P06_BRIDGE_POC.md §3.
//
//   node scripts/collab/delegated-audit.mjs evaluar <pr>   → imprime el veredicto (JSON), no publica
//   node scripts/collab/delegated-audit.mjs ci              → evalúa TODOS los PR abiertos hacia main
//                                                             y publica el check sobre cada HEAD
//
// Fuente de autoridad: API de GitHub (PR, reviews, runs de gates.yml) + `git diff` contra
// el merge-base con risk.mjs de ESTE árbol (en CI: el checkout de main). Nunca el cuerpo
// del PR, un issue_comment ni archivos del PR: el código del PR no se ejecuta.
// REPORT-ONLY: el check sale siempre `neutral` y el comando termina 0 aunque el veredicto
// sea FAIL; solo un error de lectura de la lista de PR o de publicación da exit 1.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRun, cicloCi, evaluar, jobsDeGates } from './delegated-audit.lib.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');
const REPO = process.env.GITHUB_REPOSITORY || 'fermalenoski86/dev';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const api = (ruta, ...extra) => JSON.parse(run('gh', ['api', ruta, ...extra]));
const apiLista = (ruta, jq = '.[]') => run('gh', ['api', '--paginate', ruta, '--jq', jq]).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const intentar = (f) => { try { return f(); } catch { return null; } };

function leerPr(n) {
  const p = api(`repos/${REPO}/pulls/${n}`);
  return { number: p.number, head_sha: p.head?.sha, base_ref: p.base?.ref, state: p.state };
}

// GraphQL: lastEditedAt por review (REST no expone edición). Falta de dato → null (fail).
function edicionesDe(n) {
  const [owner, name] = REPO.split('/');
  const q = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviews(first:100){pageInfo{hasNextPage} nodes{fullDatabaseId lastEditedAt}}}}}';
  const r = JSON.parse(run('gh', ['api', 'graphql', '-f', `query=${q}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `n=${n}`]));
  const rv = r?.data?.repository?.pullRequest?.reviews;
  if (!rv || rv.pageInfo?.hasNextPage) return null; // más de 100 reviews: no se puede verificar → fail
  return new Map(rv.nodes.map((x) => [String(x.fullDatabaseId), x.lastEditedAt !== null]));
}

function leerReviews(n) {
  const rs = apiLista(`repos/${REPO}/pulls/${n}/reviews?per_page=100`);
  const ed = intentar(() => edicionesDe(n));
  return rs.map((r) => ({ ...r, editada: ed && ed.has(String(r.id)) ? ed.get(String(r.id)) : null }));
}

function calcularRiesgo(n, head) {
  run('git', ['fetch', '-q', 'origin', `+refs/pull/${n}/head:refs/remotes/pr/${n}`, '+refs/heads/main:refs/remotes/origin/main'], { cwd: RAIZ });
  run('git', ['cat-file', '-e', `${head}^{commit}`], { cwd: RAIZ });
  const out = run('node', [path.join(AQUI, 'risk.mjs'), 'calcular', 'refs/remotes/origin/main', head], { cwd: RAIZ });
  const m = /^riesgo calculado: (bajo|medio|alto)$/m.exec(out);
  return m ? { nivel: m[1] } : null;
}

function leerGates(head) {
  const runs = api(`repos/${REPO}/actions/workflows/gates.yml/runs?head_sha=${head}&per_page=20`).workflow_runs ?? [];
  const ult = runs.filter((r) => r.head_sha === head).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
  if (!ult) return null;
  const jobs = apiLista(`repos/${REPO}/actions/runs/${ult.id}/attempts/${ult.run_attempt}/jobs?per_page=100`, '.jobs[]');
  return { id: ult.id, attempt: ult.run_attempt, head_sha: ult.head_sha, status: ult.status, conclusion: ult.conclusion, jobs: jobs.map((j) => ({ name: j.name, conclusion: j.conclusion })) };
}

function evaluarPr(n) {
  const pr = leerPr(n);
  const ok = pr && /^[0-9a-f]{40}$/.test(pr.head_sha ?? '');
  return evaluar({
    repo: REPO,
    pr,
    reviews: ok ? intentar(() => leerReviews(n)) : null,
    riesgo: ok ? intentar(() => calcularRiesgo(n, pr.head_sha)) : null,
    gates: ok ? intentar(() => leerGates(pr.head_sha)) : null,
    jobsEsperados: intentar(() => jobsDeGates(readFileSync(path.join(RAIZ, '.github/workflows/gates.yml'), 'utf8'))) ?? [],
  });
}

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
  let prs;
  // número + HEAD de la lista: si después falla la lectura del PR, igual hay HEAD donde
  // publicar el FAIL "sin veredicto" (Codex #88, P2)
  try { prs = apiLista(`repos/${REPO}/pulls?state=open&base=main&per_page=100`).map((p) => ({ number: p.number, head_sha: p.head?.sha })); } catch (e) {
    console.log(`::error title=delegated-audit-gate::no se pudo listar los PR abiertos: ${String(e.message).split('\n')[0]}`);
    process.exit(1);
  }
  const rc = cicloCi(prs, { evaluarPr, publicar });
  if (prs.length === 0) console.log('delegated-audit-gate: sin PR abiertos hacia main');
  process.exit(rc);
} else {
  console.error('uso: delegated-audit.mjs evaluar <pr> | ci');
  process.exit(1);
}
