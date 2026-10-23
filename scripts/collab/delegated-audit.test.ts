import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { CODEX_BOT_IDS, MAX_RONDAS, checkRun, cicloCi, compartidos, confirmarPass, estadoJobs, evaluar, evaluarPrCon, jobsDeGates, parsearBloque, riesgoDeSalida, shaProbado, sinVeredicto } from './delegated-audit.lib.mjs';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { clasificarRuta, gatesDesdeParalelo, raicesWorkspace, verificar } from './risk.lib.mjs';

/**
 * P-06 · `delegated-audit-gate` (report-only): la matriz del brief §5 que se puede probar
 * sin GitHub real. Cada forma de que una firma falsa, vieja, editada o fuera de alcance
 * salga PASS tiene que fallar. Los casos que necesitan Codex/Actions reales (1–3 con
 * Codex, 11, 13) van en los PR `poc/bridge-*` después del merge.
 */
const ROOT = path.resolve(__dirname, '../..');
const GATES_YML = readFileSync(path.join(ROOT, '.github/workflows/gates.yml'), 'utf8');
const JOBS = jobsDeGates(GATES_YML);
const REPO = 'fermalenoski86/dev';
const HEAD = 'a'.repeat(40);
const VIEJO = 'b'.repeat(40);
const CODEX = { id: CODEX_BOT_IDS[0], login: 'chatgpt-codex-connector[bot]', type: 'Bot' };
const RUN = 4242;
const MAIN = 'c'.repeat(40); // main evaluado (C)
const MAIN_B = 'e'.repeat(40); // main anterior (B)
const MERGE = 'd'.repeat(40); // merge sintético que ejecutó el run
const BODY = 'Riesgo: bajo';

const bloque = (o: Record<string, string> = {}) => [
  o.veredicto ?? 'AUDIT: APROBADO',
  o.repo ?? `repo: ${REPO} · pr: #7 · head: ${HEAD}`,
  o.brief ?? 'brief: docs/briefs/X.md · criterios: 5/5 revisados',
  o.gates ?? `gates: run ${RUN} attempt 1 · 7/7 sobre ${HEAD}`,
  o.abc ?? 'abc: A sí · B sí · C sí',
  o.hallazgos ?? 'hallazgos: P0 0 · P1 0 · P2 0',
  o.negativos ?? 'negativos: ninguno aplicable',
  o.noEjecutado ?? 'no-ejecutado: nada',
].join('\n');
const cuerpo = (b = bloque()) => `<!-- codex-review-receipt:v1 -->\n### Codex Review\nRevisé el diff.\n\n\`\`\`\n${b}\n\`\`\`\n\n<details>About Codex</details>\n`;
const badge = (p: string) => `**<sub><sub>![${p} Badge](https://img.shields.io/badge/${p}-orange?style=flat)</sub></sub>  Hallazgo sembrado**`;
// review de Codex CON sugerencias (la única forma en que publica review)
const review = (o: Record<string, unknown> = {}) => ({ id: 100, user: CODEX, state: 'COMMENTED', commit_id: HEAD, body: '<!-- codex-review-receipt:v1 -->\n### 💡 Codex Review\nHere are some automated review suggestions.', submitted_at: '2026-10-17T10:00:00Z', ...o });
const hilo = (p: string, o: Record<string, unknown> = {}) => ({ id: 4000, user: CODEX, body: `${badge(p)}\n\nrepro…\n\n<!-- codex-code-review-finding:v1 -->`, commit_id: HEAD, original_commit_id: HEAD, path: 'packages/timeline/src/index.ts', line: 73, ...o });
// comentario de resumen de Codex con el marcador (forma real de #90, comentario 6303180728)
const mk = (cr: Record<string, unknown> = {}, sr: Record<string, unknown> | null = null, id = 900, user: Record<string, unknown> = CODEX) => ({
  id,
  user,
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: HEAD, has_any_findings: false, has_unresolved_findings: false, status: 'completed', ...cr }, security_review: sr ?? { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null } })} -->\n\n## Codex Review Summary\n`,
});
const marcador = mk;
const gatesOk = (o: Record<string, unknown> = {}) => ({ id: RUN, attempt: 1, head_sha: HEAD, event: 'pull_request', status: 'completed', conclusion: 'success', jobs: JOBS.map((name: string) => ({ name, conclusion: 'success' })), probado: MERGE, base_probada: MAIN, head_probado: HEAD, ...o });
const riesgo = (nivel: string, o: Record<string, unknown> = {}) => ({ nivel, calculado: nivel, declarado: nivel, errores: [], ...o });
const estable = (o: Record<string, unknown> = {}) => ({ main: MAIN, head: HEAD, base_ref: 'main', body: BODY, ejecutada: MAIN, ...o });
const base = (o: Record<string, unknown> = {}) => ({ repo: REPO, pr: { number: 7, head_sha: HEAD, base_ref: 'main', state: 'open', body: BODY }, main: MAIN, ejecutada: MAIN, estabilidad: estable(), reviews: [], comentarios: [marcador()], hilos: [], riesgo: riesgo('bajo'), gates: gatesOk(), jobsEsperados: JOBS, ...o });
const motivos = (o: Record<string, unknown> = {}) => { const v = evaluar(base(o)); return { v: v.veredicto, m: v.motivos.join(' | ') }; };

describe('P-06 · parser estricto del bloque (§2)', () => {
  it('acepta el bloque dentro de la review de Codex (con fence, CRLF y espacios)', () => {
    const p = parsearBloque(cuerpo().replace(/\n/g, '\r\n').replace('AUDIT:', '  AUDIT:'));
    expect(p.ok).toBe(true);
    expect(p.bloque).toMatchObject({ veredicto: 'APROBADO', pr: 7, head: HEAD, run: RUN, attempt: 1, hallazgos: [0, 0, 0], abc: [true, true, true] });
  });
  it.each([
    ['sin bloque', 'Todo bien 👍'],
    ['dos bloques', `${bloque()}\n\n${bloque()}`],
    ['"AUDIT:" en prosa además del bloque', `Esto no es un AUDIT: APROBADO de verdad.\n${bloque()}`],
    ['falta una línea', bloque().replace(/\nabc:.*\n/, '\n')],
    ['líneas en otro orden', bloque().replace(/(brief:.*)\n(gates:.*)/, '$2\n$1')],
    ['veredicto inventado', bloque({ veredicto: 'AUDIT: APROBADO_CON_RESERVAS' })],
    ['sha corto', bloque({ repo: `repo: ${REPO} · pr: #7 · head: aaaaaaa` })],
    ['separador distinto', bloque({ hallazgos: 'hallazgos: P0 0, P1 0, P2 0' })],
    ['minúsculas', bloque({ veredicto: 'audit: aprobado' })],
    ['"AUDIT:" no abre la línea', bloque().replace('AUDIT: APROBADO', '> AUDIT: APROBADO')],
  ])('rechaza: %s', (_n, texto) => {
    expect(parsearBloque(texto).ok).toBe(false);
  });
});

describe('P-06 · adaptador A (#54, 2026-10-20): marcador codex-review-state + badges, report-only', () => {
  it('1 · caso limpio SIN objeto review: marcador del HEAD completed, sin hallazgos, riesgo bajo, gates verdes → pass', () => {
    const v = evaluar(base());
    expect(v.motivos).toEqual([]);
    expect(v).toMatchObject({ veredicto: 'pass', marcador_id: 900, author_id: CODEX_BOT_IDS[0], sha: HEAD, riesgo: 'bajo', run: RUN, attempt: 1 });
  });
  it('2 · P1 por marcador (has_unresolved_findings) y por badge en review + hilo sobre el HEAD → fail', () => {
    const r = motivos({ comentarios: [marcador({ has_any_findings: true, has_unresolved_findings: true })], reviews: [review()], hilos: [hilo('P1')] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('hallazgos sin resolver');
    expect(r.m).toContain('review 100 (COMMENTED) sobre el HEAD');
    expect(r.m).toContain('hilo 4000 con P1');
  });
  it.each([['P0'], ['P1'], ['P2']])('2b · solo el badge %s en un hilo del bot sobre el HEAD (marcador limpio) → fail', (p) => {
    expect(motivos({ hilos: [hilo(p)] }).m).toContain(`hilo 4000 con ${p}`);
  });
  it('2c · cualquier review del bot sobre el HEAD es un hallazgo (Codex no publica review limpia), con cualquier estado', () => {
    for (const state of ['COMMENTED', 'APPROVED', 'DISMISSED', 'CHANGES_REQUESTED']) expect(motivos({ reviews: [review({ state })] }).m).toContain(`(${state}) sobre el HEAD`);
  });
  it('2d · hilo con badge cuyo commit original es el HEAD (o vigente en el HEAD) cuenta; uno de un sha viejo y ya desplazado no', () => {
    expect(motivos({ hilos: [hilo('P2', { commit_id: VIEJO, original_commit_id: HEAD })] }).v).toBe('fail');
    expect(motivos({ hilos: [hilo('P2', { commit_id: HEAD, original_commit_id: VIEJO })] }).v).toBe('fail');
    expect(motivos({ hilos: [hilo('P2', { commit_id: VIEJO, original_commit_id: VIEJO })], reviews: [review({ commit_id: VIEJO })] }).v).toBe('pass');
  });
  it('3 · el marcador declara hallazgos aunque estén resueltos, o security_review con hallazgos o sin terminar → fail', () => {
    expect(motivos({ comentarios: [marcador({ has_any_findings: true })] }).m).toContain('has_any_findings');
    expect(motivos({ comentarios: [marcador({}, { commit_sha: HEAD, status: 'in_progress', has_any_findings: null, has_unresolved_findings: null })] }).m).toMatch(/security_review en un estado no aceptado .*in_progress/);
    expect(motivos({ comentarios: [marcador({}, { commit_sha: HEAD, status: 'completed', has_any_findings: true, has_unresolved_findings: true })] }).m).toContain('security_review');
  });
  it.each([
    ['booleano como string (repro de Codex #98)', { commit_sha: HEAD, status: 'completed', has_any_findings: 'true', has_unresolved_findings: false }],
    ['objeto vacío', {}],
    ['campo de más', { commit_sha: null, status: null, has_any_findings: null, has_unresolved_findings: null, extra: 1 }],
    ['completed sin sha', { commit_sha: null, status: 'completed', has_any_findings: false, has_unresolved_findings: false }],
    ['mezcla de null y valores', { commit_sha: null, status: 'completed', has_any_findings: null, has_unresolved_findings: null }],
    ['un array', []],
  ])('3b · security_review mal formado: %s → fail (Codex #98, P2)', (_n, sr) => {
    const r = motivos({ comentarios: [marcador({}, sr as Record<string, unknown>)] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('security_review');
  });
  it('3c · security_review completed limpia: del HEAD → pass; de otro commit → fail; sin correr (todo null o ausente) → pass', () => {
    expect(motivos({ comentarios: [marcador({}, { commit_sha: HEAD, status: 'completed', has_any_findings: false, has_unresolved_findings: false })] }).v).toBe('pass');
    expect(motivos({ comentarios: [marcador({}, { commit_sha: VIEJO, status: 'completed', has_any_findings: false, has_unresolved_findings: false })] }).m).toContain('security_review del commit');
    expect(motivos().v).toBe('pass');
    const sinClave = { ...marcador(), body: marcador().body.replace(/,"security_review":\{[^}]*\}/, '') };
    expect(sinClave.body).not.toContain('security_review');
    expect(motivos({ comentarios: [sinClave] }).v).toBe('pass');
  });
  it('4 · SHA viejo: el marcador es de un commit anterior (push después de la review) → fail', () => {
    const r = motivos({ comentarios: [marcador({ commit_sha: VIEJO })] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain(`no del HEAD ${HEAD.slice(0, 12)}`);
  });
  it('4b · review en curso o sin terminar → fail', () => {
    for (const status of ['in_progress', 'queued', 'failed']) expect(motivos({ comentarios: [marcador({ status })] }).m).toContain(`code_review ${status}`);
  });
  it.each([
    ['sin marcador', [], 'sin comentario con el marcador'],
    ['dos marcadores del bot (ambiguo)', [mk(), mk({}, null, 901)], 'ambiguo'],
    ['marcador repetido dentro del cuerpo', [{ ...mk(), body: `${mk().body}\n${mk().body}` }], '2 apariciones'],
    ['JSON roto', [{ ...mk(), body: '<!-- codex-review-state:v1 {"code_review": --> x' }], 'formato'],
    ['JSON ilegible', [{ ...mk(), body: '<!-- codex-review-state:v1 {"code_review":{,}} -->' }], 'ilegible'],
    ['sin code_review', [{ ...mk(), body: '<!-- codex-review-state:v1 {"otra":1} -->' }], 'sin code_review'],
    ['booleanos como string', [marcador({ has_unresolved_findings: 'false' })], 'no son booleanos'],
    ['sha corto', [marcador({ commit_sha: 'abc1234' })], 'sha de 40'],
  ])('5 · ambigüedad: %s → fail', (_n, comentarios, esperado) => {
    const r = motivos({ comentarios });
    expect(r.v).toBe('fail');
    expect(r.m).toContain(esperado);
  });
  it.each([
    ['usuario humano con login parecido', { id: 1, login: 'chatgpt-codex-connector', type: 'User' }],
    ['otro bot', { id: 41898282, login: 'github-actions[bot]', type: 'Bot' }],
    ['bot con login idéntico pero otro id', { id: 123, login: 'chatgpt-codex-connector[bot]', type: 'Bot' }],
    ['id allowlisted pero tipo User', { id: CODEX_BOT_IDS[0], login: 'x', type: 'User' }],
    ['id como string', { id: String(CODEX_BOT_IDS[0]), login: 'chatgpt-codex-connector[bot]', type: 'Bot' }],
  ])('6 · marcador limpio de %s → no existe para el gate → fail (identidad)', (_n, user) => {
    const v = evaluar(base({ comentarios: [marcador({}, null, 900, user)] }));
    expect(v.veredicto).toBe('fail');
    expect(v.motivos.join(' | ')).toContain('sin comentario con el marcador');
    if (typeof user.id === 'number' && user.type !== 'Bot') expect(v.ignoradas.join(' ')).toContain('identidad no allowlisted');
  });
  it('6b · un impostor no tapa al bot real: el marcador real con hallazgos manda', () => {
    const r = motivos({ comentarios: [marcador({}, null, 1, { id: 1, login: 'x', type: 'User' }), marcador({ has_unresolved_findings: true, has_any_findings: true })] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('hallazgos sin resolver');
  });
  it('7 · solo riesgo bajo: medio, alto o sin clasificación → fail "requiere auditoría formal"', () => {
    expect(motivos({ riesgo: riesgo('medio') }).m).toContain('el adaptador solo cubre riesgo bajo');
    expect(motivos({ riesgo: riesgo('alto') }).m).toContain('requiere auditoría formal');
    expect(motivos({ riesgo: null }).m).toContain('sin clasificación');
    expect(motivos({ riesgo: riesgo('bajito') }).v).toBe('fail');
    expect(motivos({ riesgo: { nivel: 'medio' } }).m).toContain('sin clasificación');
  });
  it('7b · el validador, sus workflows, AGENTS.md y el clasificador son riesgo alto por la política de main', () => {
    const g = gatesDesdeParalelo(readFileSync(path.join(ROOT, 'scripts/collab/paralelo.sh'), 'utf8'), raicesWorkspace(readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')));
    for (const r of ['scripts/collab/delegated-audit.mjs', 'scripts/collab/delegated-audit.lib.mjs', 'scripts/collab/delegated-audit.test.ts', '.github/workflows/delegated-audit-gate.yml', '.github/workflows/delegated-audit-senal.yml', 'AGENTS.md', 'scripts/collab/risk.lib.mjs']) {
      expect(clasificarRuta(r, g).nivel, r).toBe('alto');
    }
  });
  it('8 · paginación incompleta (cualquiera de las tres lecturas en null) → fail', () => {
    expect(motivos({ comentarios: null }).m).toContain('comentarios del PR');
    expect(motivos({ hilos: null }).m).toContain('comentarios de review');
    expect(motivos({ reviews: null }).m).toContain('no se pudieron leer completas');
  });
  it('8b · el CLI lee las tres listas con --paginate (una página que falla → excepción → null), sin GraphQL', () => {
    const cli = readFileSync(path.join(ROOT, 'scripts/collab/delegated-audit.mjs'), 'utf8');
    expect(cli).toMatch(/const apiLista = .*'--paginate'/);
    for (const r of ['pulls/${n}/reviews', 'issues/${n}/comments', 'pulls/${n}/comments']) expect(cli).toContain(`apiLista(\`repos/\${REPO}/${r}?per_page=100\`)`);
    expect(cli).not.toMatch(/'graphql'/);
  });
  it.each([
    ['sin run', null, 'sin run de gates'],
    ['pendiente', { status: 'in_progress', conclusion: null }, 'pendiente'],
    ['rojo', { conclusion: 'failure' }, '→ failure'],
    ['de otro sha', { head_sha: VIEJO }, 'no del HEAD'],
    ['falta un job', { jobs: JOBS.slice(1).map((name: string) => ({ name, conclusion: 'success' })) }, `falta el job ${JOBS[0]}`],
    ['un job salteado', { jobs: JOBS.map((name: string, i: number) => ({ name, conclusion: i === 0 ? 'skipped' : 'success' })) }, 'skipped'],
  ])('10 · CI %s → fail', (_n, g, esperado) => {
    const r = motivos({ gates: g === null ? null : gatesOk(g as Record<string, unknown>) });
    expect(r.v).toBe('fail');
    expect(r.m).toContain(esperado);
  });
  it('10b · sin la lista de jobs de gates.yml de main → fail', () => {
    expect(motivos({ jobsEsperados: [] }).m).toContain('lista de jobs');
  });
  it(`12 · ${MAX_RONDAS} commits revisados por Codex pasan; el ${MAX_RONDAS + 1}.º → fail + bridge-paused`, () => {
    const previas = (k: number) => Array.from({ length: k }, (_, i) => review({ id: 10 + i, commit_id: String(i).repeat(40), submitted_at: `2026-10-1${i}T00:00:00Z` }));
    expect(motivos({ reviews: previas(MAX_RONDAS) }).v).toBe('pass');
    const r = motivos({ reviews: previas(MAX_RONDAS + 1) });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('bridge-paused');
  });
  it('PR hacia otra base, cerrado o ilegible → fail', () => {
    expect(motivos({ pr: { number: 7, head_sha: HEAD, base_ref: 'fase/x', state: 'open', body: BODY } }).m).toContain('≠ main');
    expect(motivos({ pr: { number: 7, head_sha: HEAD, base_ref: 'main', state: 'closed', body: BODY } }).m).toContain('no abierto');
    expect(motivos({ pr: { number: 7, head_sha: 'zz', base_ref: 'main', state: 'open', body: BODY } }).m).toContain('ilegible');
  });
});

/**
 * Hallazgo 4 (#54): la API de jobs del run de gates devuelve también los check-runs publicados
 * por API sobre el mismo commit (este gate, `riesgo`, `paralelo`) con todo su historial. Repro
 * con la forma real del run 39181224827 (#95): ~180 motivos "job extra".
 */
describe('P-06 · hallazgo 4: deduplicación de checks por nombre y autoexclusión', () => {
  const reales = () => JOBS.map((name: string, i: number) => ({ id: 1000 + i, name, status: 'completed', conclusion: 'success' }));
  const historial = [
    { id: 2001, name: 'delegated-audit-gate', status: 'completed', conclusion: 'neutral' },
    { id: 2002, name: 'paralelo', status: 'in_progress', conclusion: null },
    { id: 2003, name: 'paralelo', status: 'completed', conclusion: 'success' },
    { id: 2004, name: 'riesgo', status: 'in_progress', conclusion: null },
    { id: 2005, name: 'riesgo', status: 'completed', conclusion: 'failure' },
    { id: 2006, name: 'riesgo', status: 'in_progress', conclusion: null },
    { id: 2007, name: 'riesgo', status: 'completed', conclusion: 'success' },
    { id: 2008, name: 'delegated-audit-gate', status: 'completed', conclusion: 'neutral' },
    { id: 2009, name: 'delegated-audit-gate', status: 'in_progress', conclusion: null },
  ];
  it('repro: historial republicado de gate/riesgo/paralelo con los 7 jobs verdes → pass (antes: "job extra …")', () => {
    const v = evaluar(base({ gates: gatesOk({ jobs: [...reales(), ...historial] }) }));
    expect(v.motivos).toEqual([]);
    expect(v.veredicto).toBe('pass');
  });
  it('autoexclusión: el check propio nunca cuenta, ni siquiera un failure', () => {
    const v = evaluar(base({ gates: gatesOk({ jobs: [...reales(), { id: 3000, name: 'delegated-audit-gate', status: 'completed', conclusion: 'failure' }] }) }));
    expect(v.veredicto).toBe('pass');
  });
  it('el último resultado terminal manda: riesgo success → failure → fail; failure → success → pass', () => {
    const sec = (cs: string[]) => cs.map((conclusion, i) => ({ id: 5000 + i, name: 'riesgo', status: 'completed', conclusion }));
    expect(motivos({ gates: gatesOk({ jobs: [...reales(), ...sec(['success', 'failure'])] }) }).m).toContain('job extra riesgo → failure');
    expect(motivos({ gates: gatesOk({ jobs: [...reales(), ...sec(['failure', 'success'])] }) }).v).toBe('pass');
    // el orden lo da el id (creciente), no la posición en la lista
    expect(motivos({ gates: gatesOk({ jobs: [...reales(), ...sec(['success', 'failure']).reverse()] }) }).m).toContain('job extra riesgo → failure');
  });
  it('un job esperado con una entrada pendiente más nueva que su terminal → fail (pendiente)', () => {
    const jobs = [...reales(), { id: 6000, name: JOBS[0], status: 'in_progress', conclusion: null }];
    expect(motivos({ gates: gatesOk({ jobs }) }).m).toContain(`job ${JOBS[0]} → pendiente`);
  });
  it('un job esperado cuyo último terminal es failure → fail aunque haya un success anterior', () => {
    const jobs = [...reales(), { id: 6001, name: JOBS[1], status: 'completed', conclusion: 'failure' }];
    expect(motivos({ gates: gatesOk({ jobs }) }).m).toContain(`job ${JOBS[1]} → failure`);
  });
  it('estadoJobs: entrada sin nombre → null (fail-closed)', () => {
    expect(estadoJobs([{ id: 1 }])).toBeNull();
    expect(motivos({ gates: gatesOk({ jobs: [{ id: 1 }] }) }).m).toContain('ilegible');
    expect(estadoJobs(null)).toBeNull();
  });
});

describe('P-06 · publicación y workflows', () => {
  it('jobsDeGates lee los 7 jobs de gates.yml', () => {
    expect(JOBS).toEqual(['verify-build', 'postgres', 'compose-smoke', 'media', 'e2e-m2c', 'e2e-platform', 'mutations']);
  });
  it('el check es siempre neutral (report-only) y lleva marcador_id, author_id, sha, riesgo y run/attempt', () => {
    for (const o of [{}, { riesgo: riesgo('alto') }]) {
      const c = checkRun(evaluar(base(o)));
      expect(c).toMatchObject({ name: 'delegated-audit-gate', head_sha: HEAD, status: 'completed', conclusion: 'neutral' });
      expect(c.output.title).toMatch(/^report-only: (PASS|FAIL)/);
      expect(c.output.summary).toContain(`sha: ${HEAD}`);
      expect(c.output.summary).toContain(`run ${RUN} attempt 1`);
      expect(c.output.summary).toContain(`tupla: pr #7 · head ${HEAD} · main ${MAIN}`);
    }
    expect(checkRun(evaluar(base())).output.title).toContain(`#7 @ ${HEAD.slice(0, 12)} sobre main ${MAIN.slice(0, 12)}`);
  });
  it('el gate no corre con YAML del PR: sin pull_request_target ni pull_request_review; checkout de main sin credenciales', () => {
    const y = readFileSync(path.join(ROOT, '.github/workflows/delegated-audit-gate.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(y).not.toMatch(/pull_request_target|pull_request_review|pull_request:|secrets\./);
    expect(y).toMatch(/workflow_run:\s*\n\s*workflows: \[gates, delegated-audit-senal, riesgo\]/);
    expect(y).toContain('persist-credentials: false');
    expect(y).toContain('git checkout -q --detach origin/main');
  });
  it('un marcador de Codex que llega después de gates/riesgo re-evalúa: issue_comment created/edited filtrado por bot + marcador (Codex #98, P1)', () => {
    const y = readFileSync(path.join(ROOT, '.github/workflows/delegated-audit-gate.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    // `deleted` y sin filtro por contenido: borrar el marcador o quitarlo al editar también re-evalúa (Codex #98, P2)
    expect(y).toMatch(/issue_comment:\s*\n\s*types: \[created, edited, deleted\]/);
    const si = /^\s*if: (.*)$/m.exec(y)?.[1] ?? '';
    expect(si).toContain("github.event_name != 'issue_comment' ||");
    expect(si).toContain(`github.event.comment.user.id == ${CODEX_BOT_IDS[0]}`);
    expect(si).not.toContain('contains(');
    expect(si).toContain('github.event.issue.pull_request');
    // el carril serial va en el job: un run salteado no puede desplazar al pendiente real
    expect(y).not.toMatch(/^concurrency:/m);
    expect(y).toMatch(/^ {4}concurrency:\s*\n\s+group: delegated-audit-gate\s*\n\s+cancel-in-progress: false/m);
  });
  it('un retarget hacia main re-evalúa: escucha el fin de `riesgo`, que corre con pull_request_target edited (Codex #88, P2)', () => {
    const r = readFileSync(path.join(ROOT, '.github/workflows/riesgo.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(r).toMatch(/^name: riesgo$/m);
    expect(r).toMatch(/pull_request_target:\s*\n\s*types: \[[^\]]*\bedited\b[^\]]*\]/);
    const y = readFileSync(path.join(ROOT, '.github/workflows/delegated-audit-gate.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(y).toMatch(/workflows: \[[^\]]*\briesgo\b[^\]]*\]/);
  });
  it('un PR listado cuya lectura falla recibe FAIL sobre el HEAD de la lista: no queda vigente un PASS viejo (Codex #88, P2)', () => {
    const publicados: Array<Record<string, unknown>> = [];
    const ok = evaluar(base());
    const rc = cicloCi([{ number: 7, head_sha: HEAD }, { number: 8, head_sha: VIEJO }], {
      evaluarPr: (n: number) => { if (n === 8) throw new Error('HTTP 502 al leer el PR'); return ok; },
      publicar: (v: unknown) => { publicados.push(checkRun(v)); return 'https://x'; },
      relistar: () => [{ number: 7, head_sha: HEAD, base_ref: 'main' }, { number: 8, head_sha: VIEJO, base_ref: 'main' }],
      log: () => {},
    });
    expect(rc).toBe(1);
    expect(publicados).toHaveLength(2);
    expect(String((publicados[0].output as { title: string }).title)).toMatch(/^report-only: PASS/);
    expect(publicados[1]).toMatchObject({ name: 'delegated-audit-gate', head_sha: VIEJO, conclusion: 'neutral' });
    expect(String((publicados[1].output as { title: string }).title)).toMatch(/^report-only: FAIL — sin veredicto: no se pudo evaluar el PR \(HTTP 502/);
  });
  it('sinVeredicto no publica sobre un HEAD inválido de la lista', () => {
    expect(sinVeredicto({ number: 8, head_sha: 'xyz' }, 'e')).toBeNull();
    const publicados: unknown[] = [];
    const rc = cicloCi([{ number: 8, head_sha: undefined }], { evaluarPr: () => { throw new Error('x'); }, publicar: (v: unknown) => { publicados.push(v); return 'u'; }, log: () => {} });
    expect(rc).toBe(1);
    expect(publicados).toHaveLength(0);
  });
  it('la señal de review no tiene permisos, no hace checkout y no interpola datos del evento', () => {
    const y = readFileSync(path.join(ROOT, '.github/workflows/delegated-audit-senal.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(y).toContain('permissions: {}');
    expect(y).not.toMatch(/checkout|\$\{\{|secrets\.|GH_TOKEN/);
    expect(y).toMatch(/^name: delegated-audit-senal$/m);
  });
});

/**
 * AUDIT: CAMBIOS @ 9332156 (3 × P2): la tupla (pr, head, main evaluado, riesgo efectivo,
 * run/attempt) + base probada se COMPRUEBA; cualquier componente ausente, viejo o ambiguo → FAIL.
 */
describe('P-06 · P2 1: riesgo efectivo (cuerpo del PR + política de main), nunca el calculado solo', () => {
  const ADV = '\n\n## Pruebas adversarias\n- elevar a mano un diff de docs\n';
  it('repro del auditor: diff bajo + `Riesgo: alto` en el cuerpo → efectivo alto → fail "auditoría formal" (antes: PASS/bajo)', () => {
    const v = verificar('bajo', `Riesgo: alto${ADV}`);
    expect(v).toMatchObject({ efectivo: 'alto', declarado: 'alto', errores: [] });
    const r = motivos({ riesgo: { nivel: v.efectivo, calculado: 'bajo', declarado: v.declarado, errores: v.errores } });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('riesgo efectivo alto (declarado; calculado bajo) → requiere auditoría formal');
  });
  it('repro del auditor: sin declaración → verificar da errores → fail (antes: PASS/bajo)', () => {
    const v = verificar('bajo', '');
    expect(v.errores.length).toBeGreaterThan(0);
    const r = motivos({ riesgo: { nivel: v.efectivo, calculado: 'bajo', declarado: null, errores: v.errores } });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('declaración de riesgo rechazada — el PR no declara');
  });
  it('declaración inválida (plantilla sin elegir, duplicada) o rebaja → fail', () => {
    for (const c of ['Riesgo: bajo | medio | alto', 'Riesgo: bajo\nRiesgo: bajo']) {
      const v = verificar('bajo', c);
      expect(motivos({ riesgo: { nivel: v.efectivo, calculado: 'bajo', declarado: null, errores: v.errores } }).v, c).toBe('fail');
    }
    const rebaja = verificar('medio', 'Riesgo: bajo');
    expect(motivos({ riesgo: { nivel: rebaja.efectivo, calculado: 'medio', declarado: 'bajo', errores: rebaja.errores } }).m).toContain('nunca rebajar');
    expect(motivos({ riesgo: riesgo('bajo', { calculado: 'medio' }) }).m).toContain('nunca se rebaja');
    expect(motivos({ riesgo: riesgo('bajo', { errores: undefined }) }).m).toContain('no se pudo validar');
  });
  it('positivo: declaración válida igual al calculado → pass con riesgo efectivo en la tupla', () => {
    const v = verificar('bajo', 'Riesgo: bajo');
    const e = evaluar(base({ riesgo: { nivel: v.efectivo, calculado: 'bajo', declarado: v.declarado, errores: v.errores } }));
    expect(e.motivos).toEqual([]);
    expect(e).toMatchObject({ veredicto: 'pass', riesgo: 'bajo', calculado: 'bajo', declarado: 'bajo' });
  });
  it('riesgoDeSalida parsea risk.mjs verificar: rc 0 OK, rc 2 con motivos, rc 1 o formato raro → null', () => {
    const out = (d: string, e: string) => `riesgo calculado: bajo\n  bajo docs/x.md — doc\nriesgo declarado: ${d} · efectivo: ${e}\n`;
    expect(riesgoDeSalida(0, out('alto', 'alto'), '')).toEqual({ nivel: 'alto', calculado: 'bajo', declarado: 'alto', errores: [] });
    expect(riesgoDeSalida(2, out('(ninguno)', 'bajo'), 'risk: RECHAZADO — el PR no declara `Riesgo: bajo|medio|alto`\n')).toMatchObject({ declarado: null, errores: ['el PR no declara `Riesgo: bajo|medio|alto`'] });
    expect(riesgoDeSalida(2, out('bajo', 'bajo'), '').errores).toEqual(['risk.mjs rechazó sin detalle']);
    expect(riesgoDeSalida(1, out('bajo', 'bajo'), '')).toBeNull();
    expect(riesgoDeSalida(undefined, '', '')).toBeNull();
    expect(riesgoDeSalida(0, 'riesgo calculado: bajo\n', '')).toBeNull();
  });
});

describe('P-06 · P2 2: los gates tienen que haber probado ESTE HEAD contra ESTE main', () => {
  it('repro del auditor: run verde de H sobre base B, main avanza a C con H igual → fail (antes: PASS/run 4242)', () => {
    const r = motivos({ gates: gatesOk({ base_probada: MAIN_B }) });
    expect(r.v).toBe('fail');
    expect(r.m).toContain(`gates probados contra main ${MAIN_B.slice(0, 12)} ≠ main evaluado ${MAIN.slice(0, 12)}`);
  });
  it('un re-run (attempt 2) del merge viejo sigue siendo base B → fail: no alcanza un timestamp posterior', () => {
    const r = motivos({ gates: gatesOk({ attempt: 2, base_probada: MAIN_B }) });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('gates probados contra main');
  });
  it.each([
    ['run sin "probado <sha>" (run-name viejo)', { probado: null }, 'no declara el commit probado'],
    ['padres del merge ilegibles', { base_probada: null, head_probado: null }, 'no se pudieron leer los padres'],
    ['el merge probado es de otro HEAD', { head_probado: VIEJO }, 'no es del HEAD'],
    ['run de workflow_dispatch/push (sin merge con main)', { event: 'workflow_dispatch' }, 'evento workflow_dispatch'],
  ])('procedencia desconocida: %s → fail', (_n, g, esperado) => {
    const r = motivos({ gates: gatesOk(g) });
    expect(r.v).toBe('fail');
    expect(r.m).toContain(esperado);
  });
  it('main evaluado desconocido → fail', () => {
    expect(motivos({ main: null, estabilidad: estable({ main: null }) }).m).toContain('main evaluado desconocido');
  });
  it.each([
    ['main avanza', { main: MAIN_B }, 'main cambió durante la evaluación'],
    ['push al PR', { head: VIEJO }, 'HEAD cambió durante la evaluación'],
    ['retarget', { base_ref: 'fase/x' }, 'base cambió durante la evaluación'],
    ['editan la declaración de riesgo', { body: 'Riesgo: alto' }, 'cuerpo del PR'],
  ])('cambio durante la evaluación (%s) → fail', (_n, e, esperado) => {
    const r = motivos({ estabilidad: estable(e) });
    expect(r.v).toBe('fail');
    expect(r.m).toContain(esperado);
  });
  it('sin relectura final → fail', () => {
    expect(motivos({ estabilidad: null }).m).toContain('no se pudo releer');
  });
  it('positivo: evidencia fresca (merge de H con el main evaluado) → pass', () => {
    expect(evaluar(base()).veredicto).toBe('pass');
  });
  it('shaProbado toma solo el sufijo anclado del run-name; gates.yml lo declara con github.sha', () => {
    expect(shaProbado(`gates · pull_request · probado ${MERGE}`)).toBe(MERGE);
    expect(shaProbado(`gates · probado ${MERGE} · otra cosa`)).toBeNull();
    expect(shaProbado('feat: algo')).toBeNull();
    expect(shaProbado(undefined)).toBeNull();
    expect(GATES_YML).toMatch(/^run-name: gates · \$\{\{ github\.event_name \}\} · probado \$\{\{ github\.sha \}\}$/m);
    expect(jobsDeGates(GATES_YML)).toEqual(JOBS);
  });
});

describe('P-06 · P2 3: HEAD compartido por más de un PR hacia main → sin PASS', () => {
  const SIN = Symbol('lista original');
  type P = { number: number; head_sha: string; base_ref?: string };
  const conBase = (ps: P[]) => ps.map((p) => ({ base_ref: 'main', ...p }));
  const corrida = (prs: P[], rel: unknown = SIN, abiertos: P[] = prs) => {
    const relistar = rel === SIN ? () => conBase(abiertos) : rel;
    const publicados: Array<{ pr: number; t: string }> = [];
    const ok = (n: number) => ({ ...evaluar(base()), pr: n });
    cicloCi(prs, { evaluarPr: ok, publicar: (v: { pr: number }) => { publicados.push({ pr: v.pr, t: checkRun(v).output.title }); return 'u'; }, relistar, abiertos: conBase(abiertos), log: () => {} });
    return publicados;
  };
  it.each([[[8, 7]], [[7, 8]]])('repro del auditor: #7 y #8 con el mismo HEAD, orden %j → FAIL para los dos, ningún PASS', (orden) => {
    const p = corrida((orden as number[]).map((number) => ({ number, head_sha: HEAD })));
    expect(p).toHaveLength(2);
    for (const x of p) expect(x.t).toMatch(/^report-only: FAIL — HEAD compartido: aaaaaaaaaaaa es el HEAD de #\d, #\d/);
  });
  it('aparece otro PR con el mismo HEAD durante la evaluación → FAIL al confirmar', () => {
    const p = corrida([{ number: 7, head_sha: HEAD }], () => conBase([{ number: 7, head_sha: HEAD }, { number: 9, head_sha: HEAD, base_ref: 'fase/x' }]));
    expect(p[0].t).toContain('HEAD compartido');
  });
  it('un PR abierto hacia OTRA base con el mismo HEAD también lo vuelve compartido (el check se ve en los dos)', () => {
    const p = corrida([{ number: 7, head_sha: HEAD }], SIN, [{ number: 7, head_sha: HEAD }, { number: 12, head_sha: HEAD, base_ref: 'fase/x' }]);
    expect(p).toHaveLength(1);
    expect(p[0].t).toContain('HEAD compartido: aaaaaaaaaaaa es el HEAD de #7, #12');
  });
  it('el HEAD del PR cambia o el PR deja de estar abierto hacia main antes de publicar → FAIL', () => {
    expect(corrida([{ number: 7, head_sha: HEAD }], () => conBase([{ number: 7, head_sha: VIEJO }]))[0].t).toContain('ya no está abierto hacia main');
    expect(corrida([{ number: 7, head_sha: HEAD }], () => [{ number: 7, head_sha: HEAD, base_ref: 'fase/x' }])[0].t).toContain('ya no está abierto hacia main');
    expect(corrida([{ number: 7, head_sha: HEAD }], () => [{ number: 7, head_sha: HEAD }])[0].t).toContain('ya no está abierto hacia main');
    expect(corrida([{ number: 7, head_sha: HEAD }], () => [])[0].t).toContain('ya no está abierto hacia main');
  });
  it('sin relista (ausente o con error) → FAIL', () => {
    expect(corrida([{ number: 7, head_sha: HEAD }], null)[0].t).toContain('no se pudo relistar');
    expect(confirmarPass(evaluar(base()), undefined).motivos[0]).toContain('no se pudo relistar');
    expect(corrida([{ number: 7, head_sha: HEAD }], () => { throw new Error('502'); })[0].t).toContain('no se pudo relistar');
  });
  it('positivo: HEAD único → PASS; un FAIL no se toca al confirmar', () => {
    expect(corrida([{ number: 7, head_sha: HEAD }, { number: 8, head_sha: VIEJO }])[0].t).toMatch(/^report-only: PASS/);
    const f = evaluar(base({ riesgo: riesgo('alto') }));
    expect(confirmarPass(f, () => { throw new Error('no se llama'); })).toBe(f);
    expect([...compartidos([{ number: 7, head_sha: HEAD }, { number: 8, head_sha: HEAD }, { number: 9, head_sha: VIEJO }])]).toEqual([[HEAD, [7, 8]]]);
  });
});

describe('P-06 · P2 (AUDIT: CAMBIOS @ f097a29): la política ejecutada tiene que ser el main evaluado', () => {
  // Reproducción del auditor con E/S controladas sobre la orquestación real del CLI
  // (evaluarPrCon): checkout A (scripts cargados), main por API B, PR único con HEAD H, review
  // válida sobre H, run 4242/1 verde con merge [B, H]. La política de A clasifica bajo; la de B,
  // más restrictiva, clasificaría alto. Antes: PASS con main=B calculado con la política de A.
  const A = 'f'.repeat(40);
  const B = MAIN;
  const clasificador = (rev: string) => (rev === A ? riesgo('bajo') : riesgo('alto')); // B endurece la regla
  const io = (o: { ejecutada?: string | null; ahora?: () => string | null; mains?: string[] } = {}) => {
    const ejecutada = o.ejecutada === undefined ? A : o.ejecutada;
    const mains = [...(o.mains ?? [B, B])];
    return {
      repo: REPO,
      ejecutada,
      ejecutadaAhora: o.ahora ?? (() => ejecutada),
      mainActual: () => (mains.length > 1 ? mains.shift() : mains[0]),
      leerPr: () => ({ number: 7, head_sha: HEAD, base_ref: 'main', state: 'open', body: 'Riesgo: bajo' }),
      leerReviews: () => [],
      leerComentarios: () => [marcador()],
      leerHilos: () => [],
      // el riesgo lo calcula el risk.mjs del checkout EJECUTADO, no el del main evaluado
      verificarRiesgo: () => clasificador(String(ejecutada)),
      leerGates: () => gatesOk({ base_probada: B }),
      gatesYml: () => GATES_YML,
    };
  };
  it('repro del auditor: checkout A + main B (política B más restrictiva) → FAIL "checkout desactualizado" (antes: PASS con main=B)', () => {
    const v = evaluarPrCon(7, io());
    expect(v.veredicto).toBe('fail');
    expect(v.main).toBe(B);
    expect(v.politica).toBe(A);
    expect(v.riesgo).toBe('bajo'); // lo que A permitió: justamente lo que no se puede atribuir a B
    expect(v.motivos).toEqual([`política: los scripts en ejecución son de ${A.slice(0, 12)} y el main evaluado es ${B.slice(0, 12)} (checkout desactualizado: sin PASS hasta una corrida con la política vigente)`]);
    expect(checkRun(v).output.summary).toContain(`política ${A}`);
  });
  it('positivo A/A: la revisión ejecutada ES el main evaluado → PASS, con la política en la tupla', () => {
    const v = evaluarPrCon(7, { ...io({ ejecutada: B }), verificarRiesgo: () => riesgo('bajo') });
    expect(v.motivos).toEqual([]);
    expect(v.veredicto).toBe('pass');
    expect(v.politica).toBe(B);
    expect(checkRun(v).output.summary).toContain(`main ${B} · política ${B}`);
  });
  it('main avanza entre dos PR del mismo ciclo: el primero (A/A) PASS, el segundo (A vs B) FAIL', () => {
    const mains = [A, A, B, B]; // PR #7: inicio y fin en A; PR #8: inicio y fin en B
    const prs = [{ number: 7, head_sha: HEAD }, { number: 8, head_sha: VIEJO }];
    const pub: Array<{ pr: number; v: string; m: string }> = [];
    const base_ = io({ ejecutada: A });
    cicloCi(prs, {
      evaluarPr: (n: number) => evaluarPrCon(n, {
        ...base_,
        mainActual: () => mains.shift(),
        leerPr: () => ({ number: n, head_sha: n === 7 ? HEAD : VIEJO, base_ref: 'main', state: 'open', body: 'Riesgo: bajo' }),
        leerComentarios: () => [n === 7 ? marcador() : marcador({ commit_sha: VIEJO })],
        leerGates: () => gatesOk(n === 7 ? { base_probada: A } : { head_sha: VIEJO, head_probado: VIEJO, base_probada: B }),
      }),
      publicar: (v: { pr: number; veredicto: string; motivos: string[] }) => { pub.push({ pr: v.pr, v: v.veredicto, m: v.motivos.join(' | ') }); return 'u'; },
      relistar: () => prs.map((p) => ({ ...p, base_ref: 'main' })),
      log: () => {},
    });
    expect(pub.map((p) => [p.pr, p.v])).toEqual([[7, 'pass'], [8, 'fail']]);
    expect(pub[1].m).toBe(`política: los scripts en ejecución son de ${A.slice(0, 12)} y el main evaluado es ${B.slice(0, 12)} (checkout desactualizado: sin PASS hasta una corrida con la política vigente)`);
  });
  it('revisión ejecutada ilegible o con cambios locales (null) → FAIL', () => {
    const v = evaluarPrCon(7, io({ ejecutada: null, ahora: () => null }));
    expect(v.veredicto).toBe('fail');
    expect(v.motivos[0]).toContain('política: no se pudo verificar la revisión de los scripts en ejecución');
    expect(motivos({ ejecutada: 'f'.repeat(7) }).m).toContain('política: no se pudo verificar');
  });
  it('la revisión ejecutada cambia o queda ilegible durante la evaluación (checkout en medio) → FAIL', () => {
    expect(evaluarPrCon(7, io({ ejecutada: B, ahora: () => A })).motivos.join(' | ')).toContain('estabilidad: la revisión de los scripts en ejecución cambió');
    expect(evaluarPrCon(7, io({ ejecutada: B, ahora: () => { throw new Error('git'); } })).motivos.join(' | ')).toContain('estabilidad: no se pudo releer');
  });
  it('se conservan los controles cerrados: elevación manual alta, base probada A, main que cambia en medio → FAIL', () => {
    const ok = { ...io({ ejecutada: B }), verificarRiesgo: () => riesgo('bajo') };
    expect(evaluarPrCon(7, { ...ok, verificarRiesgo: () => riesgo('alto', { calculado: 'bajo' }) }).motivos.join(' | ')).toContain('requiere auditoría formal');
    expect(evaluarPrCon(7, { ...ok, leerGates: () => gatesOk({ base_probada: A }) }).motivos.join(' | ')).toContain('procedencia: gates probados contra main');
    const m = [B, A];
    expect(evaluarPrCon(7, { ...ok, mainActual: () => m.shift() }).motivos.join(' | ')).toContain('estabilidad: main cambió durante la evaluación');
  });
  it('el CLI fija la revisión ejecutada (rev-parse + árbol limpio), lee gates.yml de esa revisión y delega en evaluarPrCon', () => {
    const cli = readFileSync(path.join(ROOT, 'scripts/collab/delegated-audit.mjs'), 'utf8');
    expect(cli).toMatch(/const EJECUTADA = intentar\(revisionEjecutada\);/);
    expect(cli).toMatch(/'rev-parse', 'HEAD'/);
    expect(cli).toMatch(/'diff', '--quiet', 'HEAD', '--', \.\.\.POLITICA/);
    expect(cli).toContain("['show', `${EJECUTADA}:.github/workflows/gates.yml`]");
    expect(cli).toContain('ejecutadaAhora: revisionEjecutada');
    expect(cli).not.toMatch(/readFileSync/);
  });
});
