#!/usr/bin/env node
// P-06 · PoC-1 de la Claude Action en SOLO LECTURA — CLI de `bridge-claude.yml`.
// Reglas en bridge-claude.lib.mjs; brief docs/briefs/P06_BRIDGE_POC.md §4 (PR 2).
//
//   node scripts/collab/bridge-claude.mjs decidir    → lee evento + API (GH_TOKEN de solo
//        lectura), escribe bridge-input/{decision.json,contexto.md} y `actuar=` en GITHUB_OUTPUT
//   node scripts/collab/bridge-claude.mjs claude     → corre `claude -p` en solo lectura con
//        un entorno mínimo (solo el token de Claude; NUNCA un token de GitHub)
//   node scripts/collab/bridge-claude.mjs informar   → anotación + resumen con las métricas
//
// Nunca escribe en GitHub. Fallas de lectura → no actúa (warning), exit 0.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anotacion, argsClaude, contexto, decidirComentario, decidirReview, metricas, tapar } from './bridge-claude.lib.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');
const DIR = path.join(RAIZ, 'bridge-input');
const REPO = process.env.GITHUB_REPOSITORY || 'fermalenoski86/dev';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const api = (ruta) => JSON.parse(run('gh', ['api', ruta]));
const apiLista = (ruta) => run('gh', ['api', '--paginate', ruta, '--jq', '.[]']).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const salida = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const leerJson = (f) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));

// GraphQL lastEditedAt por review (REST no expone edición), igual que delegated-audit.mjs.
// Más de 100 reviews o error → null: la review queda `editada: null` y no actúa.
function edicionesDe(n) {
  const [owner, name] = REPO.split('/');
  const q = 'query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviews(first:100){pageInfo{hasNextPage} nodes{fullDatabaseId lastEditedAt}}}}}';
  const r = JSON.parse(run('gh', ['api', 'graphql', '-f', `query=${q}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `n=${n}`]));
  const rv = r?.data?.repository?.pullRequest?.reviews;
  if (!rv || rv.pageInfo?.hasNextPage) return null;
  return new Map(rv.nodes.map((x) => [String(x.fullDatabaseId), x.lastEditedAt !== null]));
}
function leerReviews(n) {
  const rs = apiLista(`repos/${REPO}/pulls/${n}/reviews?per_page=100`);
  let ed = null;
  try { ed = edicionesDe(n); } catch { ed = null; }
  return rs.map((r) => ({ ...r, editada: ed && ed.has(String(r.id)) ? ed.get(String(r.id)) : null }));
}

function decidir() {
  const nombre = process.env.GITHUB_EVENT_NAME;
  const evento = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let d;
  let pr = null;
  if (nombre === 'issue_comment') {
    pr = evento.issue?.pull_request ? api(`repos/${REPO}/pulls/${evento.issue.number}`) : null;
    d = decidirComentario({ evento, pr, repo: REPO });
  } else if (nombre === 'workflow_run') {
    const r = evento.workflow_run ?? {};
    const prs = apiLista(`repos/${REPO}/pulls?state=open&per_page=100`);
    const cand = prs.filter((p) => p.head?.ref === r.head_branch && p.head?.sha === r.head_sha);
    const reviews = cand.length === 1 ? leerReviews(cand[0].number) : [];
    d = decidirReview({ run: r, prs, reviews, repo: REPO });
    pr = cand.length === 1 ? cand[0] : null;
  } else {
    d = { actuar: false, motivo: `evento ${nombre} no soportado` };
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, 'decision.json'), JSON.stringify(d, null, 2));
  if (d.actuar) {
    const archivos = apiLista(`repos/${REPO}/pulls/${d.pr}/files?per_page=100`);
    const comentarios = d.tipo === 'review' ? apiLista(`repos/${REPO}/pulls/${d.pr}/reviews/${d.evento_id}/comments?per_page=100`) : [];
    writeFileSync(path.join(DIR, 'contexto.md'), contexto({ decision: d, pr, archivos, comentarios }));
  }
  console.log(`bridge-claude: ${d.actuar ? 'ACTÚA' : 'no actúa'} — ${d.motivo}`);
  salida('actuar', d.actuar ? 'true' : 'false');
}

function claude() {
  const d = leerJson('decision.json');
  if (!d.actuar) throw new Error('decision.json no habilita a Claude');
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('falta CLAUDE_CODE_OAUTH_TOKEN (secret)');
  const prompt = readFileSync(path.join(AQUI, 'bridge-claude.prompt.md'), 'utf8');
  // Entorno mínimo: ni GITHUB_TOKEN/GH_TOKEN ni variables del runner (ACTIONS_*).
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN, DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1' };
  const inicio = new Date().toISOString();
  const r = spawnSync('claude', argsClaude(prompt), { cwd: RAIZ, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  const fin = new Date().toISOString();
  writeFileSync(path.join(DIR, 'salida.json'), r.stdout ?? '');
  writeFileSync(path.join(DIR, 'tiempos.json'), JSON.stringify({ inicioClaude: inicio, finClaude: fin, status: r.status, signal: r.signal }));
  if (r.stderr) console.error(tapar(r.stderr).slice(-4000));
  console.log(`claude: exit ${r.status}${r.signal ? ` (${r.signal})` : ''}`);
}

function informar() {
  const d = leerJson('decision.json');
  const ti = existsSync(path.join(DIR, 'tiempos.json')) ? leerJson('tiempos.json') : {};
  const s = existsSync(path.join(DIR, 'salida.json')) ? readFileSync(path.join(DIR, 'salida.json'), 'utf8') : '';
  const m = metricas({ decision: d, inicioJob: process.env.BRIDGE_INICIO_JOB, inicioClaude: ti.inicioClaude, finClaude: ti.finClaude, salida: s });
  console.log(anotacion(m));
  const { respuesta, ...num } = m;
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## bridge-claude (solo lectura)\n\n\`\`\`json\n${JSON.stringify(num, null, 2)}\n\`\`\`\n\n${(respuesta ?? '(sin respuesta)').replaceAll('```', "'''")}\n`);
  }
  if (!m.ok) process.exitCode = 1;
}

const cmd = process.argv[2];
try {
  if (cmd === 'decidir') decidir();
  else if (cmd === 'claude') claude();
  else if (cmd === 'informar') informar();
  else { console.error('uso: bridge-claude.mjs decidir | claude | informar'); process.exit(2); }
} catch (e) {
  if (cmd === 'decidir') {
    console.log(`::warning title=bridge-claude::no actúa (fail-closed): ${tapar(e.message).split('\n')[0]}`);
    salida('actuar', 'false');
  } else {
    console.error(`bridge-claude ${cmd}: ${tapar(e.message)}`);
    process.exit(1);
  }
}
