import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { CODEX_BOT_IDS, MAX_RONDAS, checkRun, evaluar, jobsDeGates, parsearBloque } from './delegated-audit.lib.mjs';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { clasificarRuta, gatesDesdeParalelo, raicesWorkspace } from './risk.lib.mjs';

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
const review = (o: Record<string, unknown> = {}) => ({ id: 100, user: CODEX, state: 'COMMENTED', commit_id: HEAD, body: cuerpo(), submitted_at: '2026-10-17T10:00:00Z', editada: false, ...o });
const gatesOk = (o: Record<string, unknown> = {}) => ({ id: RUN, attempt: 1, head_sha: HEAD, status: 'completed', conclusion: 'success', jobs: JOBS.map((name: string) => ({ name, conclusion: 'success' })), ...o });
const base = (o: Record<string, unknown> = {}) => ({ repo: REPO, pr: { number: 7, head_sha: HEAD, base_ref: 'main', state: 'open' }, reviews: [review()], riesgo: { nivel: 'medio' }, gates: gatesOk(), jobsEsperados: JOBS, ...o });
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

describe('P-06 · delegated-audit-gate (matriz §5, report-only)', () => {
  it('1 · PR elegible con review real de Codex, bloque APROBADO y gates verdes → pass', () => {
    const v = evaluar(base());
    expect(v.motivos).toEqual([]);
    expect(v).toMatchObject({ veredicto: 'pass', review_id: 100, author_id: CODEX_BOT_IDS[0], sha: HEAD, riesgo: 'medio', run: RUN, attempt: 1 });
  });
  it('2 · AUDIT: CAMBIOS con P1 → fail', () => {
    expect(motivos({ reviews: [review({ body: cuerpo(bloque({ veredicto: 'AUDIT: CAMBIOS', hallazgos: 'hallazgos: P0 0 · P1 1 · P2 0' })) })] }).m).toContain('AUDIT: CAMBIOS');
  });
  it('2b · INSUFICIENTE_EVIDENCIA → fail', () => {
    expect(motivos({ reviews: [review({ body: cuerpo(bloque({ veredicto: 'AUDIT: INSUFICIENTE_EVIDENCIA' })) })] }).v).toBe('fail');
  });
  it.each([
    ['P2 abierto', { hallazgos: 'hallazgos: P0 0 · P1 0 · P2 1' }, 'P2 1'],
    ['P0 abierto', { hallazgos: 'hallazgos: P0 1 · P1 0 · P2 0' }, 'P0 1'],
    ['A/B/C incompleto', { abc: 'abc: A sí · B no · C sí' }, 'A/B/C'],
    ['algo no ejecutado', { noEjecutado: 'no-ejecutado: media (sin ffmpeg)' }, 'no-ejecutado'],
    ['criterios parciales', { brief: 'brief: x · criterios: 4/5 revisados' }, 'criterios 4/5'],
    ['gates parciales en el bloque', { gates: `gates: run ${RUN} attempt 1 · 6/7 sobre ${HEAD}` }, 'gates 6/7'],
    ['bloque con head viejo', { repo: `repo: ${REPO} · pr: #7 · head: ${VIEJO}` }, 'bloque: head'],
    ['bloque de otro PR', { repo: `repo: ${REPO} · pr: #8 · head: ${HEAD}` }, 'pr #8'],
    ['bloque de otro repo', { repo: `repo: otro/dev · pr: #7 · head: ${HEAD}` }, 'repo otro/dev'],
    ['cita un run que no es el último del HEAD', { gates: `gates: run 999 attempt 1 · 7/7 sobre ${HEAD}` }, 'cita run 999'],
    ['cita un attempt anterior', { gates: `gates: run ${RUN} attempt 1 · 7/7 sobre ${HEAD}` }, null],
  ])('3 · APROBADO con %s → fail', (_n, o, esperado) => {
    if (esperado === null) {
      expect(motivos({ gates: gatesOk({ attempt: 2 }) }).m).toContain('attempt 1');
      return;
    }
    const r = motivos({ reviews: [review({ body: cuerpo(bloque(o)) })] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain(esperado);
  });
  it('4 · push después de la review (review sobre sha anterior) → fail', () => {
    const r = motivos({ reviews: [review({ commit_id: VIEJO })] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('ninguna review de Codex sobre el HEAD');
  });
  it('4b · la review más reciente de Codex sobre el HEAD manda: una posterior sin bloque anula la APROBADO', () => {
    const r = motivos({ reviews: [review(), review({ id: 101, submitted_at: '2026-10-17T11:00:00Z', body: 'Sugerencias automáticas' })] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('review 101');
  });
  it.each([
    ['usuario humano con login parecido', { id: 1, login: 'chatgpt-codex-connector', type: 'User' }],
    ['otro bot', { id: 41898282, login: 'github-actions[bot]', type: 'Bot' }],
    ['bot con login idéntico pero otro id', { id: 123, login: 'chatgpt-codex-connector[bot]', type: 'Bot' }],
    ['id allowlisted pero tipo User', { id: CODEX_BOT_IDS[0], login: 'x', type: 'User' }],
    ['id como string', { id: String(CODEX_BOT_IDS[0]), login: 'chatgpt-codex-connector[bot]', type: 'Bot' }],
  ])('5 · AUDIT: APROBADO de %s → fail (identidad)', (_n, user) => {
    const v = evaluar(base({ reviews: [review({ user })] }));
    expect(v.veredicto).toBe('fail');
    expect(v.motivos.join(' | ')).toContain('ninguna review de Codex');
    if (typeof user.id === 'number' && user.type !== 'Bot') expect(v.ignoradas.join(' ')).toContain('identidad no allowlisted');
  });
  it('6 · AUDIT: APROBADO en issue_comment → no existe para el gate (solo lee reviews) → fail', () => {
    expect(motivos({ reviews: [] }).m).toContain('ninguna review de Codex');
  });
  it('7 · riesgo alto o sin clasificación → fail "requiere auditoría formal"', () => {
    expect(motivos({ riesgo: { nivel: 'alto' } }).m).toContain('requiere auditoría formal');
    expect(motivos({ riesgo: null }).m).toContain('sin clasificación');
    expect(motivos({ riesgo: { nivel: 'bajito' } }).v).toBe('fail');
  });
  it('7b · el validador, sus workflows, AGENTS.md y el clasificador son riesgo alto por la política de main', () => {
    const g = gatesDesdeParalelo(readFileSync(path.join(ROOT, 'scripts/collab/paralelo.sh'), 'utf8'), raicesWorkspace(readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')));
    for (const r of ['scripts/collab/delegated-audit.mjs', 'scripts/collab/delegated-audit.lib.mjs', 'scripts/collab/delegated-audit.test.ts', '.github/workflows/delegated-audit-gate.yml', '.github/workflows/delegated-audit-senal.yml', 'AGENTS.md', 'scripts/collab/risk.lib.mjs']) {
      expect(clasificarRuta(r, g).nivel, r).toBe('alto');
    }
  });
  it.each([['DISMISSED'], ['PENDING'], ['CHANGES_REQUESTED']])('9 · review %s → fail', (state) => {
    expect(motivos({ reviews: [review({ state })] }).m).toContain(`estado ${state}`);
  });
  it('9b · review editada, o sin poder verificar la edición → fail', () => {
    expect(motivos({ reviews: [review({ editada: true })] }).m).toContain('editada después de emitida');
    expect(motivos({ reviews: [review({ editada: null })] }).m).toContain('no se pudo verificar');
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
  it(`12 · ${MAX_RONDAS} rondas pasan; la ${MAX_RONDAS + 1}.ª → fail + bridge-paused`, () => {
    const previas = (k: number) => Array.from({ length: k }, (_, i) => review({ id: 10 + i, commit_id: VIEJO, submitted_at: `2026-10-1${i}T00:00:00Z`, body: cuerpo(bloque({ veredicto: 'AUDIT: CAMBIOS' })) }));
    expect(motivos({ reviews: [...previas(MAX_RONDAS - 1), review()] }).v).toBe('pass');
    const r = motivos({ reviews: [...previas(MAX_RONDAS), review()] });
    expect(r.v).toBe('fail');
    expect(r.m).toContain('bridge-paused');
  });
  it('PR hacia otra base, cerrado o ilegible → fail', () => {
    expect(motivos({ pr: { number: 7, head_sha: HEAD, base_ref: 'fase/x', state: 'open' } }).m).toContain('≠ main');
    expect(motivos({ pr: { number: 7, head_sha: HEAD, base_ref: 'main', state: 'closed' } }).m).toContain('no abierto');
    expect(motivos({ pr: { number: 7, head_sha: 'zz', base_ref: 'main', state: 'open' } }).m).toContain('ilegible');
    expect(motivos({ reviews: null }).m).toContain('no se pudieron leer');
  });
});

describe('P-06 · publicación y workflows', () => {
  it('jobsDeGates lee los 7 jobs de gates.yml', () => {
    expect(JOBS).toEqual(['verify-build', 'postgres', 'compose-smoke', 'media', 'e2e-m2c', 'e2e-platform', 'mutations']);
  });
  it('el check es siempre neutral (report-only) y lleva review_id, author_id, sha, riesgo y run/attempt', () => {
    for (const o of [{}, { riesgo: { nivel: 'alto' } }]) {
      const c = checkRun(evaluar(base(o)));
      expect(c).toMatchObject({ name: 'delegated-audit-gate', head_sha: HEAD, status: 'completed', conclusion: 'neutral' });
      expect(c.output.title).toMatch(/^report-only: (PASS|FAIL)/);
      expect(c.output.summary).toContain(`sha: ${HEAD}`);
      expect(c.output.summary).toContain(`gates run: ${RUN} attempt 1`);
    }
  });
  it('el gate no corre con YAML del PR: sin pull_request_target ni pull_request_review; checkout de main sin credenciales', () => {
    const y = readFileSync(path.join(ROOT, '.github/workflows/delegated-audit-gate.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(y).not.toMatch(/pull_request_target|pull_request_review|pull_request:|secrets\./);
    expect(y).toMatch(/workflow_run:\s*\n\s*workflows: \[gates, delegated-audit-senal\]/);
    expect(y).toContain('persist-credentials: false');
    expect(y).toContain('git checkout -q --detach origin/main');
  });
  it('la señal de review no tiene permisos, no hace checkout y no interpola datos del evento', () => {
    const y = readFileSync(path.join(ROOT, '.github/workflows/delegated-audit-senal.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(y).toContain('permissions: {}');
    expect(y).not.toMatch(/checkout|\$\{\{|secrets\.|GH_TOKEN/);
    expect(y).toMatch(/^name: delegated-audit-senal$/m);
  });
});
