/**
 * BL-23 · lógica pura de la matriz de aceptación ejecutable (sin I/O).
 * La CLI (`cli.mjs`) lee archivos y llama a estas funciones; los tests
 * (`matrix.test.ts`) las ejercitan con casos negativos controlados.
 */

const TITULO = /\b(?:it|test|describe)(?:\.(?:only|skip|each\([^)]*\)))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const TAG = /\[§48\.(\d+)\]/g;

/** Tests con tags `[§48.N]` en el título. `files`: [{ path, source }] (path relativo al repo). */
export function scanTags(files) {
  const out = [];
  for (const f of files) {
    for (const m of f.source.matchAll(TITULO)) {
      const title = m[2];
      const points = [...title.matchAll(TAG)].map((t) => Number(t[1]));
      if (points.length) out.push({ file: f.path, title, points });
    }
  }
  return out;
}

/** Cuenta los `test('…')` de un spec de Playwright (sin hooks ni describe). */
export function countPlaywrightTests(source) {
  return [...source.matchAll(/^\s*test\(\s*['"`]/gm)].length;
}

/**
 * Valida puntos + tags + evidencia Playwright. Devuelve la lista de errores
 * (vacía = OK). `playwrightSources`: { [path]: source | undefined }.
 */
export function validate({ points, tags, suite, playwrightSources = {} }) {
  const errores = [];
  const nums = new Set(points.map((p) => p.n));
  for (let n = 1; n <= 19; n++) if (!nums.has(n)) errores.push(`§48.${n}: falta en la lista de puntos`);
  if (points.length !== 19) errores.push(`la lista tiene ${points.length} puntos (§48 tiene 19)`);
  for (const t of tags) {
    for (const n of t.points) if (!nums.has(n)) errores.push(`${t.file} «${t.title}»: [§48.${n}] no es un punto de §48`);
    if (!suite.test(t.file)) errores.push(`${t.file} «${t.title}»: tag fuera de la suite verificada por CI (${suite})`);
  }
  for (const p of points) {
    const conTag = tags.filter((t) => t.points.includes(p.n));
    if (!['cubierto', 'pendiente', 'no-aplicable'].includes(p.estado)) errores.push(`§48.${p.n}: estado inválido «${p.estado}»`);
    if (p.estado === 'cubierto') {
      if (p.playwright) {
        let total = 0;
        for (const f of p.playwright.files) {
          const src = playwrightSources[f];
          if (src === undefined) errores.push(`§48.${p.n}: evidencia ${f} no existe`);
          else total += countPlaywrightTests(src);
        }
        if (total !== p.playwright.tests) errores.push(`§48.${p.n}: la evidencia Playwright tiene ${total} tests, se esperaban ${p.playwright.tests}`);
      } else if (conTag.length === 0) {
        errores.push(`§48.${p.n} («${p.texto}»): marcado cubierto pero ningún test tiene [§48.${p.n}]`);
      }
    } else if (!p.motivo) {
      errores.push(`§48.${p.n}: estado ${p.estado} sin motivo`);
    }
  }
  return errores;
}

/**
 * Cruza los tags con un reporte JSON de vitest (`--reporter=json`): cada test
 * etiquetado tiene que estar en el reporte y en estado `passed`. Un skip no es
 * cobertura.
 */
export function checkResults({ tags, report, root }) {
  const errores = [];
  const rel = (p) => (p.startsWith(root) ? p.slice(root.length).replace(/^\/+/, '') : p);
  const porArchivo = new Map();
  for (const tr of report.testResults ?? []) porArchivo.set(rel(tr.name), tr.assertionResults ?? []);
  for (const t of tags) {
    const res = porArchivo.get(t.file);
    if (!res) {
      errores.push(`${t.file}: no está en el reporte de resultados`);
      continue;
    }
    const hits = res.filter((a) => (a.fullName ?? '').includes(t.title) || (a.title ?? '') === t.title || (a.ancestorTitles ?? []).includes(t.title));
    if (hits.length === 0) errores.push(`${t.file} «${t.title}»: no aparece en el reporte`);
    else for (const a of hits) if (a.status !== 'passed') errores.push(`${t.file} «${a.fullName}»: ${a.status} (se exige passed)`);
  }
  return errores;
}

/** Markdown determinista (sin fechas): CI exige diff vacío contra lo generado. */
export function render({ points, tags, pendientes }) {
  const L = [];
  L.push('# M3A.1 — Matriz de aceptación (master §48)');
  L.push('');
  L.push('> **Generado** por `pnpm acceptance:generate` (`scripts/acceptance/`) desde la lista de');
  L.push('> puntos (`points.mjs`) y los tags `[§48.N]` en los nombres de los tests. No editar a mano:');
  L.push('> CI exige diff vacío y que cada test etiquetado haya **pasado** en el job `postgres`');
  L.push('> (reporte JSON de vitest). Un pendiente nunca cuenta como cubierto (BL-23).');
  L.push('');
  L.push('Recorrido principal: `apps/platform-api/src/e2e-flow.db.test.ts` (E2), por HTTP real con');
  L.push('PostgreSQL, ffprobe, login, cookie, CSRF y logout por rol. Lo único sembrado por la base son');
  L.push('los usuarios (no hay endpoint de alta: es el CLI de C1).');
  L.push('');
  L.push('| # | §48 | Rol | Estado | Evidencia |');
  L.push('|---|---|---|---|---|');
  for (const p of points) {
    const conTag = tags.filter((t) => t.points.includes(p.n));
    let evid;
    if (p.playwright) evid = `Playwright ${p.playwright.files.map((f) => `\`${f}\``).join(' + ')} (${p.playwright.tests} tests, job \`${p.playwright.job}\`)`;
    else if (conTag.length) evid = conTag.map((t) => `\`${t.file.split('/').pop()}\` › ${t.title.replace(/\s*\[§48\.\d+\]/g, '').replace(/\|/g, '\\|').trim()}`).join('<br>');
    else evid = '—';
    const estado = p.estado === 'cubierto' ? (p.playwright ? '**cubierto (CI)**' : '**cubierto**') : p.estado === 'pendiente' ? '⏳ **pendiente**' : 'no aplicable';
    const nota = p.nota ? `<br>_${p.nota}_` : p.motivo ? `<br>_${p.motivo}_` : '';
    L.push(`| ${p.n} | ${p.texto} | ${p.rol} | ${estado} | ${evid}${nota} |`);
  }
  L.push('');
  L.push('## Pendientes de navegador (no cuentan como cubiertos)');
  L.push('');
  L.push('| Id | Qué | Estado |');
  L.push('|---|---|---|');
  for (const x of pendientes) L.push(`| ${x.id} | ${x.texto} | ⏳ **pendiente**: ${x.motivo} |`);
  L.push('');
  const cubiertos = points.filter((p) => p.estado === 'cubierto').length;
  L.push(`**Resumen:** ${cubiertos}/19 puntos de §48 cubiertos a nivel plataforma; ${pendientes.length} pendientes de navegador.`);
  L.push('M3A.1 **no se declara cerrado** mientras haya pendientes de navegador.');
  L.push('');
  return L.join('\n');
}
