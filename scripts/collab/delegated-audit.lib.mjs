// P-06 · PoC de firma delegada — reglas puras de `delegated-audit-gate` (brief
// docs/briefs/P06_BRIDGE_POC.md §2–§3; decisión de #54 del 2026-10-12 18:15).
//
// Sin E/S: recibe lo que el CLI (delegated-audit.mjs) leyó de la API de GitHub y de git
// con la revisión de main, y devuelve un veredicto. REPORT-ONLY: el veredicto se publica
// como check `neutral`; nunca habilita un merge ni reemplaza el AUDIT de ChatGPT.
//
// Fail-closed: cualquier dato ausente, ambiguo o que no se pudo leer es un motivo de
// FAIL. `pass` solo si no hay ningún motivo.

/**
 * Allowlist inmutable (en el código de main, nunca del PR): `user.id` numérico de
 * `chatgpt-codex-connector[bot]`, verificado por API el 2026-10-17 (reviews de #82:
 * user.id 199175422, user.type "Bot"). El login NO se usa: una cuenta con nombre
 * parecido no cuenta.
 */
export const CODEX_BOT_IDS = Object.freeze([199175422]);

/** Máximo de rondas con marcador AUDIT por PR (brief §3.7); la 5.ª → bridge-paused. */
export const MAX_RONDAS = 4;

const SHA = '[0-9a-f]{40}';
// Una línea por campo, en este orden exacto (brief §2). Separador " · ".
const PLANTILLA = [
  ['veredicto', /^AUDIT: (APROBADO|CAMBIOS|INSUFICIENTE_EVIDENCIA)$/],
  ['repo', new RegExp(`^repo: (\\S+) · pr: #(\\d+) · head: (${SHA})$`)],
  ['brief', /^brief: (\S(?:.*\S)?) · criterios: (\d+)\/(\d+) revisados$/],
  ['gates', new RegExp(`^gates: run (\\d+) attempt (\\d+) · (\\d+)\\/(\\d+) sobre (${SHA})$`)],
  ['abc', /^abc: A (sí|no) · B (sí|no) · C (sí|no)$/],
  ['hallazgos', /^hallazgos: P0 (\d+) · P1 (\d+) · P2 (\d+)$/],
  ['negativos', /^negativos: (\S(?:.*\S)?)$/],
  ['noEjecutado', /^no-ejecutado: (\S(?:.*\S)?)$/],
];

/**
 * Parser estricto del bloque de §2. Exactamente UNA aparición de `AUDIT:` en todo el
 * cuerpo (prosa incluida) y, a partir de esa línea, las 8 líneas de la plantilla seguidas.
 * Se toleran espacios al principio/fin de cada línea y un \r (CRLF); nada más.
 * @returns {{ ok: true, bloque: object } | { ok: false, error: string }}
 */
export function parsearBloque(cuerpo) {
  if (typeof cuerpo !== 'string' || cuerpo === '') return { ok: false, error: 'review sin cuerpo' };
  const apariciones = cuerpo.match(/AUDIT:/g)?.length ?? 0;
  if (apariciones === 0) return { ok: false, error: 'sin bloque AUDIT' };
  if (apariciones > 1) return { ok: false, error: `${apariciones} apariciones de "AUDIT:" (debe haber un solo bloque)` };
  const lineas = cuerpo.split('\n').map((l) => l.replace(/\r$/, '').trim());
  const i = lineas.findIndex((l) => l.startsWith('AUDIT:'));
  if (i < 0) return { ok: false, error: '"AUDIT:" no abre una línea' };
  const b = {};
  for (let k = 0; k < PLANTILLA.length; k++) {
    const [campo, re] = PLANTILLA[k];
    const m = re.exec(lineas[i + k] ?? '');
    if (!m) return { ok: false, error: `línea ${k + 1} del bloque (${campo}) no respeta la plantilla: ${JSON.stringify((lineas[i + k] ?? '(falta)').slice(0, 120))}` };
    b[campo] = m.slice(1);
  }
  const n = (x) => Number.parseInt(x, 10);
  return {
    ok: true,
    bloque: {
      veredicto: b.veredicto[0],
      repo: b.repo[0], pr: n(b.repo[1]), head: b.repo[2],
      brief: b.brief[0], criterios: [n(b.brief[1]), n(b.brief[2])],
      run: n(b.gates[0]), attempt: n(b.gates[1]), jobs: [n(b.gates[2]), n(b.gates[3])], gatesSha: b.gates[4],
      abc: b.abc.map((x) => x === 'sí'),
      hallazgos: b.hallazgos.map(n),
      negativos: b.negativos[0], noEjecutado: b.noEjecutado[0],
    },
  };
}

/** Jobs de nivel superior de gates.yml (de main): claves con 2 espacios bajo `jobs:`. */
export function jobsDeGates(yml) {
  const out = [];
  let dentro = false;
  for (const l of String(yml).split('\n')) {
    if (/^jobs:\s*$/.test(l)) { dentro = true; continue; }
    if (dentro && /^\S/.test(l)) break;
    const m = dentro && /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

const esCodex = (r, allowlist) => r?.user?.type === 'Bot' && Number.isSafeInteger(r.user.id) && allowlist.includes(r.user.id);
const orden = (a, b) => (Date.parse(a.submitted_at) || 0) - (Date.parse(b.submitted_at) || 0) || a.id - b.id;

/**
 * Veredicto del gate para un PR.
 * @param {object} e
 * @param {string} e.repo                 owner/nombre
 * @param {{number:number, head_sha:string, base_ref:string, state:string}} e.pr  leído por API en el momento
 * @param {object[]|null} e.reviews       reviews REST del PR (todas las páginas) + `editada` (bool|null, GraphQL lastEditedAt)
 * @param {{nivel:string}|null} e.riesgo  risk.mjs calcular con la política de main sobre el diff real; null = sin clasificación
 * @param {object|null} e.gates           último run de gates.yml para head_sha: {id, attempt, head_sha, status, conclusion, jobs:[{name, conclusion}]}
 * @param {string[]} e.jobsEsperados      jobsDeGates(gates.yml de main)
 * @param {number[]} [e.allowlist]
 */
export function evaluar({ repo, pr, reviews, riesgo, gates, jobsEsperados, allowlist = CODEX_BOT_IDS }) {
  const motivos = [];
  const info = { pr: pr?.number ?? null, sha: pr?.head_sha ?? null, review_id: null, author_id: null, riesgo: riesgo?.nivel ?? null, run: gates?.id ?? null, attempt: gates?.attempt ?? null, rondas: 0, ignoradas: [] };
  const fin = () => ({ veredicto: motivos.length ? 'fail' : 'pass', motivos, ...info });

  if (!pr || !Number.isSafeInteger(pr.number) || !new RegExp(`^${SHA}$`).test(pr.head_sha ?? '')) {
    motivos.push('PR ilegible (número o HEAD inválidos)');
    return fin();
  }
  if (pr.state !== 'open') motivos.push(`PR no abierto (${pr.state})`);
  if (pr.base_ref !== 'main') motivos.push(`base ${pr.base_ref} ≠ main: el gate solo evalúa PR hacia main`);

  // 4. Elegibilidad (política de main sobre el diff real; alto ante la duda)
  if (!riesgo || !['bajo', 'medio', 'alto'].includes(riesgo.nivel)) motivos.push('elegibilidad: sin clasificación de riesgo (risk.mjs no dio veredicto) → requiere auditoría formal');
  else if (riesgo.nivel === 'alto') motivos.push('elegibilidad: riesgo alto → requiere auditoría formal de ChatGPT (sin delegación, #54)');

  // 1–3, 6, 7. Review real del bot allowlisted sobre el HEAD exacto, con bloque válido
  if (!Array.isArray(reviews)) {
    motivos.push('reviews: no se pudieron leer por API');
  } else {
    for (const r of reviews) {
      if (!esCodex(r, allowlist) && typeof r?.body === 'string' && r.body.includes('AUDIT:')) {
        info.ignoradas.push(`review ${r.id} de ${r.user?.login ?? '?'} (id ${r.user?.id ?? '?'}, ${r.user?.type ?? '?'}): identidad no allowlisted`);
      }
    }
    const codex = reviews.filter((r) => esCodex(r, allowlist)).sort(orden);
    info.rondas = codex.filter((r) => typeof r.body === 'string' && r.body.includes('AUDIT:')).length;
    if (info.rondas > MAX_RONDAS) motivos.push(`rondas: ${info.rondas} > ${MAX_RONDAS} → corresponde bridge-paused (report-only: no se etiqueta)`);
    const sobreHead = codex.filter((r) => r.commit_id === pr.head_sha);
    const r = sobreHead.at(-1);
    if (!r) {
      const viejas = codex.filter((x) => x.commit_id !== pr.head_sha).length;
      motivos.push(`review: ninguna review de Codex sobre el HEAD ${pr.head_sha.slice(0, 12)}${viejas ? ` (${viejas} sobre shas anteriores: inválidas)` : ''}`);
    } else {
      info.review_id = r.id;
      info.author_id = r.user.id;
      if (!['COMMENTED', 'APPROVED'].includes(r.state)) motivos.push(`review ${r.id}: estado ${r.state} (solo cuenta COMMENTED/APPROVED; DISMISSED/PENDING/CHANGES_REQUESTED → fail)`);
      if (r.editada !== false) motivos.push(`review ${r.id}: ${r.editada === true ? 'editada después de emitida' : 'no se pudo verificar si fue editada'}`);
      const p = parsearBloque(r.body);
      if (!p.ok) {
        motivos.push(`review ${r.id}: marcador — ${p.error}`);
      } else {
        const b = p.bloque;
        if (b.veredicto !== 'APROBADO') motivos.push(`review ${r.id}: AUDIT: ${b.veredicto}`);
        if (b.repo !== repo) motivos.push(`bloque: repo ${b.repo} ≠ ${repo}`);
        if (b.pr !== pr.number) motivos.push(`bloque: pr #${b.pr} ≠ #${pr.number}`);
        if (b.head !== pr.head_sha) motivos.push(`bloque: head ${b.head.slice(0, 12)} ≠ HEAD actual ${pr.head_sha.slice(0, 12)}`);
        if (b.gatesSha !== pr.head_sha) motivos.push(`bloque: gates sobre ${b.gatesSha.slice(0, 12)} ≠ HEAD`);
        if (b.veredicto === 'APROBADO') {
          if (b.criterios[1] === 0 || b.criterios[0] !== b.criterios[1]) motivos.push(`bloque: criterios ${b.criterios.join('/')} (APROBADO exige todos revisados)`);
          if (b.jobs[1] === 0 || b.jobs[0] !== b.jobs[1]) motivos.push(`bloque: gates ${b.jobs.join('/')} (APROBADO exige todos verdes)`);
          if (!b.abc.every(Boolean)) motivos.push('bloque: A/B/C incompleto');
          if (b.hallazgos.some((x) => x !== 0)) motivos.push(`bloque: hallazgos P0 ${b.hallazgos[0]} · P1 ${b.hallazgos[1]} · P2 ${b.hallazgos[2]} (APROBADO exige 0 · 0 · 0)`);
          if (b.noEjecutado !== 'nada') motivos.push(`bloque: no-ejecutado "${b.noEjecutado}" (APROBADO exige "nada")`);
        }
        if (gates && (b.run !== gates.id || b.attempt !== gates.attempt)) motivos.push(`bloque: cita run ${b.run} attempt ${b.attempt}; el último run de gates del HEAD es ${gates.id} attempt ${gates.attempt}`);
      }
    }
  }

  // 5. Gates: todos los jobs de gates.yml de main verdes sobre el mismo sha
  if (!gates) {
    motivos.push('gates: sin run de gates.yml para el HEAD');
  } else {
    if (gates.head_sha !== pr.head_sha) motivos.push(`gates: run ${gates.id} es de ${String(gates.head_sha).slice(0, 12)}, no del HEAD`);
    if (gates.status !== 'completed') motivos.push(`gates: run ${gates.id} attempt ${gates.attempt} ${gates.status} (pendiente)`);
    else if (gates.conclusion !== 'success') motivos.push(`gates: run ${gates.id} attempt ${gates.attempt} → ${gates.conclusion}`);
    if (!Array.isArray(jobsEsperados) || jobsEsperados.length === 0) motivos.push('gates: no se pudo leer la lista de jobs de gates.yml de main');
    else {
      const jobs = Array.isArray(gates.jobs) ? gates.jobs : [];
      for (const j of jobsEsperados) {
        const hay = jobs.filter((x) => x.name === j);
        if (hay.length === 0) motivos.push(`gates: falta el job ${j}`);
        else if (hay.some((x) => x.conclusion !== 'success')) motivos.push(`gates: job ${j} → ${hay.map((x) => x.conclusion ?? 'pendiente').join(',')}`);
      }
      for (const x of jobs) if (!jobsEsperados.includes(x.name) && x.conclusion !== 'success') motivos.push(`gates: job extra ${x.name} → ${x.conclusion ?? 'pendiente'}`);
    }
  }
  return fin();
}

/** Check-run para el HEAD. Report-only: conclusión siempre `neutral`; el veredicto va en el título. */
export function checkRun(v) {
  const titulo = v.veredicto === 'pass'
    ? 'report-only: PASS — firma delegada válida (no habilita merge; manda el AUDIT de ChatGPT)'
    : `report-only: FAIL — ${v.motivos[0]}${v.motivos.length > 1 ? ` (+${v.motivos.length - 1})` : ''}`;
  const resumen = [
    `veredicto: **${v.veredicto.toUpperCase()}** (report-only, PoC P-06: nunca habilita merge)`,
    `pr: #${v.pr} · sha: ${v.sha} · review_id: ${v.review_id ?? '—'} · author_id: ${v.author_id ?? '—'}`,
    `riesgo: ${v.riesgo ?? '—'} · gates run: ${v.run ?? '—'} attempt ${v.attempt ?? '—'} · rondas: ${v.rondas}`,
    '',
    ...(v.motivos.length ? ['motivos:', ...v.motivos.map((m) => `- ${m}`)] : ['motivos: ninguno']),
    ...(v.ignoradas.length ? ['', 'ignoradas:', ...v.ignoradas.map((m) => `- ${m}`)] : []),
  ].join('\n');
  return { name: 'delegated-audit-gate', head_sha: v.sha, status: 'completed', conclusion: 'neutral', output: { title: titulo.slice(0, 255), summary: resumen.slice(0, 60000) } };
}
