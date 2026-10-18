import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { CODEX_BOT_IDS, MAX_RONDAS, checkRun, cicloCi, compartidos, confirmarPass, evaluar, jobsDeGates, parsearBloque, riesgoDeSalida, shaProbado, sinVeredicto } from './delegated-audit.lib.mjs';
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
const BODY = 'Riesgo: medio';

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
const gatesOk = (o: Record<string, unknown> = {}) => ({ id: RUN, attempt: 1, head_sha: HEAD, event: 'pull_request', status: 'completed', conclusion: 'success', jobs: JOBS.map((name: string) => ({ name, conclusion: 'success' })), probado: MERGE, base_probada: MAIN, head_probado: HEAD, ...o });
const riesgo = (nivel: string, o: Record<string, unknown> = {}) => ({ nivel, calculado: nivel, declarado: nivel, errores: [], ...o });
const estable = (o: Record<string, unknown> = {}) => ({ main: MAIN, head: HEAD, base_ref: 'main', body: BODY, ...o });
const base = (o: Record<string, unknown> = {}) => ({ repo: REPO, pr: { number: 7, head_sha: HEAD, base_ref: 'main', state: 'open', body: BODY }, main: MAIN, estabilidad: estable(), reviews: [review()], riesgo: riesgo('medio'), gates: gatesOk(), jobsEsperados: JOBS, ...o });
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
    expect(motivos({ pr: { number: 7, head_sha: HEAD, base_ref: 'fase/x', state: 'open', body: BODY } }).m).toContain('≠ main');
    expect(motivos({ pr: { number: 7, head_sha: HEAD, base_ref: 'main', state: 'closed', body: BODY } }).m).toContain('no abierto');
    expect(motivos({ pr: { number: 7, head_sha: 'zz', base_ref: 'main', state: 'open', body: BODY } }).m).toContain('ilegible');
    expect(motivos({ reviews: null }).m).toContain('no se pudieron leer');
  });
});

describe('P-06 · publicación y workflows', () => {
  it('jobsDeGates lee los 7 jobs de gates.yml', () => {
    expect(JOBS).toEqual(['verify-build', 'postgres', 'compose-smoke', 'media', 'e2e-m2c', 'e2e-platform', 'mutations']);
  });
  it('el check es siempre neutral (report-only) y lleva review_id, author_id, sha, riesgo y run/attempt', () => {
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
    const r = motivos({ gates: gatesOk({ attempt: 2, base_probada: MAIN_B }), reviews: [review({ body: cuerpo(bloque({ gates: `gates: run ${RUN} attempt 2 · 7/7 sobre ${HEAD}` })) })] });
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
