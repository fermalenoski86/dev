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

const NIVELES = ['bajo', 'medio', 'alto'];
const rango = (n) => NIVELES.indexOf(n);
const esSha = (x) => typeof x === 'string' && new RegExp(`^${SHA}$`).test(x);
const corto = (x) => String(x ?? '—').slice(0, 12);

/**
 * `run-name` de gates.yml: `gates · <evento> · probado <github.sha>`. En pull_request,
 * github.sha es el merge sintético que el run ejecutó (un re-run reusa el mismo): es la
 * única procedencia confiable de la base probada (la `pull_requests[].base.sha` de la API
 * del run no lo es: en #88 run 39079487711 decía b98571f y el merge probado era sobre
 * 59d2215). Se toma solo el sufijo anclado al final del título.
 */
export function shaProbado(titulo) {
  const m = /· probado ([0-9a-f]{40})$/.exec(String(titulo ?? ''));
  return m ? m[1] : null;
}

/**
 * Salida de `risk.mjs verificar` → riesgo para evaluar(). rc 0 = OK, 2 = rechazo (motivos en
 * stderr), otro = sin veredicto (null). Formato ilegible → null (fail-closed).
 */
export function riesgoDeSalida(rc, stdout, stderr) {
  if (rc !== 0 && rc !== 2) return null;
  const calc = /^riesgo calculado: (bajo|medio|alto)$/m.exec(String(stdout ?? ''));
  const ef = /^riesgo declarado: (bajo|medio|alto|\(ninguno\)) · efectivo: (bajo|medio|alto)$/m.exec(String(stdout ?? ''));
  if (!calc || !ef) return null;
  const errores = [...String(stderr ?? '').matchAll(/^risk: RECHAZADO — (.*)$/gm)].map((m) => m[1]);
  if (rc === 2 && errores.length === 0) errores.push('risk.mjs rechazó sin detalle');
  if (rc === 0 && errores.length) return null;
  return { nivel: ef[2], calculado: calc[1], declarado: ef[1] === '(ninguno)' ? null : ef[1], errores };
}

const esCodex = (r, allowlist) => r?.user?.type === 'Bot' && Number.isSafeInteger(r.user.id) && allowlist.includes(r.user.id);
const orden = (a, b) => (Date.parse(a.submitted_at) || 0) - (Date.parse(b.submitted_at) || 0) || a.id - b.id;

/**
 * Veredicto del gate para un PR.
 * @param {object} e
 * @param {string} e.repo                 owner/nombre
 * @param {{number:number, head_sha:string, base_ref:string, state:string}} e.pr  leído por API en el momento
 * @param {object[]|null} e.reviews       reviews REST del PR (todas las páginas) + `editada` (bool|null, GraphQL lastEditedAt)
 * @param {{nivel:string, calculado:string, declarado:string|null, errores:string[]}|null} e.riesgo
 *        risk.mjs verificar (política de main) sobre el diff real contra `main` y el CUERPO del
 *        PR: `nivel` = riesgo efectivo (máx. de declarado y calculado). null = sin veredicto.
 * @param {string|null} e.main            sha de main fijado al empezar la evaluación (la tupla)
 * @param {object|null} e.estabilidad     relectura al terminar: {main, head, base_ref, body}
 * @param {object|null} e.gates           último run pull_request de gates.yml para head_sha:
 *        {id, attempt, head_sha, event, status, conclusion, jobs, probado, base_probada, head_probado}
 * @param {string[]} e.jobsEsperados      jobsDeGates(gates.yml de main)
 * @param {number[]} [e.allowlist]
 */
export function evaluar({ repo, pr, reviews, riesgo, main = null, estabilidad = null, gates, jobsEsperados, allowlist = CODEX_BOT_IDS }) {
  const motivos = [];
  // Tupla del veredicto (AUDIT: CAMBIOS @ 9332156): (pr, head, main evaluado, riesgo efectivo,
  // run/attempt) + base y merge probados. PASS solo si cada componente se COMPROBÓ.
  const info = { pr: pr?.number ?? null, sha: pr?.head_sha ?? null, main: esSha(main) ? main : null, review_id: null, author_id: null, riesgo: riesgo?.nivel ?? null, calculado: riesgo?.calculado ?? null, declarado: riesgo?.declarado ?? null, run: gates?.id ?? null, attempt: gates?.attempt ?? null, probado: gates?.probado ?? null, base_probada: gates?.base_probada ?? null, rondas: 0, ignoradas: [] };
  const fin = () => ({ veredicto: motivos.length ? 'fail' : 'pass', motivos, ...info });

  if (!pr || !Number.isSafeInteger(pr.number) || !new RegExp(`^${SHA}$`).test(pr.head_sha ?? '')) {
    motivos.push('PR ilegible (número o HEAD inválidos)');
    return fin();
  }
  if (pr.state !== 'open') motivos.push(`PR no abierto (${pr.state})`);
  if (pr.base_ref !== 'main') motivos.push(`base ${pr.base_ref} ≠ main: el gate solo evalúa PR hacia main`);

  if (!esSha(main)) motivos.push('tupla: main evaluado desconocido (no se pudo fijar el sha de main)');

  // 4. Elegibilidad: riesgo EFECTIVO de la política de main (diff real + declaración del
  // cuerpo del PR). Declaración ausente/inválida → fail; elevación a alto → formal; nunca
  // rebajar el calculado (AUDIT: CAMBIOS @ 9332156, P2 1).
  if (!riesgo || !NIVELES.includes(riesgo.nivel) || !NIVELES.includes(riesgo.calculado)) {
    motivos.push('elegibilidad: sin clasificación de riesgo (risk.mjs no dio veredicto) → requiere auditoría formal');
  } else {
    if (rango(riesgo.nivel) < rango(riesgo.calculado)) motivos.push(`elegibilidad: riesgo efectivo ${riesgo.nivel} < calculado ${riesgo.calculado} (nunca se rebaja)`);
    if (!Array.isArray(riesgo.errores)) motivos.push('elegibilidad: no se pudo validar la declaración de riesgo del PR');
    else for (const e of riesgo.errores) motivos.push(`elegibilidad: declaración de riesgo rechazada — ${e}`);
    if (riesgo.nivel === 'alto') motivos.push(`elegibilidad: riesgo efectivo alto${riesgo.calculado !== 'alto' ? ` (declarado; calculado ${riesgo.calculado})` : ''} → requiere auditoría formal de ChatGPT (sin delegación, #54)`);
  }

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
    // Procedencia (AUDIT: CAMBIOS @ 9332156, P2 2): el run tiene que haber probado el merge
    // de ESTE HEAD con ESTE main. Un timestamp no alcanza (un re-run ejecuta el merge viejo):
    // se compara el merge commit que el run ejecutó (run-name) y sus padres.
    if (gates.event !== 'pull_request') motivos.push(`procedencia: run ${gates.id} es de evento ${gates.event ?? '?'} (solo cuenta pull_request: merge con main)`);
    if (!esSha(gates.probado)) motivos.push(`procedencia: run ${gates.id} no declara el commit probado (run-name sin "probado <sha>") → base no verificable`);
    else if (!esSha(gates.base_probada) || !esSha(gates.head_probado)) motivos.push(`procedencia: no se pudieron leer los padres del merge probado ${corto(gates.probado)} → base no verificable`);
    else {
      if (gates.head_probado !== pr.head_sha) motivos.push(`procedencia: el merge probado ${corto(gates.probado)} no es del HEAD (${corto(gates.head_probado)})`);
      if (esSha(main) && gates.base_probada !== main) motivos.push(`procedencia: gates probados contra main ${corto(gates.base_probada)} ≠ main evaluado ${corto(main)} (base anterior o distinta: hace falta CI fresca)`);
    }
  }

  // Cambio durante la evaluación: main, HEAD, base o cuerpo releídos al final → iguales.
  if (!estabilidad) motivos.push('estabilidad: no se pudo releer PR/main al terminar la evaluación');
  else {
    if (estabilidad.main !== main) motivos.push(`estabilidad: main cambió durante la evaluación (${corto(main)} → ${corto(estabilidad.main)})`);
    if (estabilidad.head !== pr.head_sha) motivos.push(`estabilidad: HEAD cambió durante la evaluación (${corto(pr.head_sha)} → ${corto(estabilidad.head)})`);
    if (estabilidad.base_ref !== pr.base_ref) motivos.push(`estabilidad: base cambió durante la evaluación (${pr.base_ref} → ${estabilidad.base_ref ?? '—'})`);
    if (estabilidad.body !== pr.body) motivos.push('estabilidad: el cuerpo del PR (declaración de riesgo) cambió durante la evaluación');
  }
  return fin();
}

/** Check-run para el HEAD. Report-only: conclusión siempre `neutral`; el veredicto va en el título. */
export function checkRun(v) {
  const titulo = v.veredicto === 'pass'
    ? `report-only: PASS — firma delegada válida para #${v.pr} @ ${corto(v.sha)} sobre main ${corto(v.main)} (no habilita merge; manda el AUDIT de ChatGPT)`
    : `report-only: FAIL — ${v.motivos[0]}${v.motivos.length > 1 ? ` (+${v.motivos.length - 1})` : ''}`;
  const resumen = [
    `veredicto: **${v.veredicto.toUpperCase()}** (report-only, PoC P-06: nunca habilita merge)`,
    `pr: #${v.pr} · sha: ${v.sha} · review_id: ${v.review_id ?? '—'} · author_id: ${v.author_id ?? '—'}`,
    `tupla: pr #${v.pr} · head ${v.sha} · main ${v.main ?? '—'} · riesgo efectivo ${v.riesgo ?? '—'} · run ${v.run ?? '—'} attempt ${v.attempt ?? '—'}`,
    `riesgo: efectivo ${v.riesgo ?? '—'} · calculado ${v.calculado ?? '—'} · declarado ${v.declarado ?? '—'} · probado ${v.probado ?? '—'} sobre main ${v.base_probada ?? '—'} · rondas: ${v.rondas}`,
    '',
    ...(v.motivos.length ? ['motivos:', ...v.motivos.map((m) => `- ${m}`)] : ['motivos: ninguno']),
    ...(v.ignoradas.length ? ['', 'ignoradas:', ...v.ignoradas.map((m) => `- ${m}`)] : []),
  ].join('\n');
  return { name: 'delegated-audit-gate', head_sha: v.sha, status: 'completed', conclusion: 'neutral', output: { title: titulo.slice(0, 255), summary: resumen.slice(0, 60000) } };
}

/**
 * Veredicto FAIL para un PR listado que no se pudo evaluar (Codex #88, P2): el check se
 * publica igual sobre el HEAD de la lista, así un PASS anterior de ese HEAD no queda vigente
 * sin verificar. null si el HEAD de la lista no es un sha válido (no hay dónde publicar).
 */
export function sinVeredicto({ number, head_sha }, error) {
  if (!Number.isSafeInteger(number) || !new RegExp(`^${SHA}$`).test(head_sha ?? '')) return null;
  const motivo = `sin veredicto: no se pudo evaluar el PR (${String(error ?? 'error desconocido').split('\n')[0].slice(0, 200)}); el PASS anterior de este HEAD no vale`;
  return failSobre({ number, head_sha }, motivo);
}

const failSobre = ({ number, head_sha }, motivo) => ({ veredicto: 'fail', motivos: [motivo], pr: number, sha: head_sha, main: null, review_id: null, author_id: null, riesgo: null, calculado: null, declarado: null, run: null, attempt: null, probado: null, base_probada: null, rondas: 0, ignoradas: [] });

/**
 * HEAD compartido (AUDIT: CAMBIOS @ 9332156, P2 3): el check tiene alcance de commit, no de
 * PR. Si más de un PR abierto (hacia main o hacia cualquier otra base: el check se ve en todos)
 * tiene el mismo HEAD, ninguno recibe PASS.
 */
export function compartidos(prs) {
  const por = new Map();
  for (const p of prs) if (esSha(p?.head_sha)) por.set(p.head_sha, [...(por.get(p.head_sha) ?? []), p.number]);
  return new Map([...por].filter(([, ns]) => ns.length > 1));
}
const motivoCompartido = (head, ns) => `HEAD compartido: ${corto(head)} es el HEAD de ${ns.map((n) => `#${n}`).join(', ')} (el check es por commit, no por PR) → sin PASS`;

/**
 * Confirmación antes de publicar un PASS: relista TODOS los PR abiertos ({number, head_sha,
 * base_ref}) y exige que el PR siga abierto hacia main con el mismo HEAD y que ningún otro PR
 * (de cualquier base) lo comparta. Sin relista o con error → FAIL.
 */
export function confirmarPass(v, relistar) {
  if (v.veredicto !== 'pass') return v;
  let lista;
  try { lista = typeof relistar === 'function' ? relistar() : null; } catch { lista = null; }
  if (!Array.isArray(lista)) return { ...v, veredicto: 'fail', motivos: ['confirmación: no se pudo relistar los PR para descartar un HEAD compartido → sin PASS'] };
  const yo = lista.find((p) => p.number === v.pr);
  if (!yo || yo.head_sha !== v.sha || yo.base_ref !== 'main') return { ...v, veredicto: 'fail', motivos: [`confirmación: el PR #${v.pr} ya no está abierto hacia main con HEAD ${corto(v.sha)} → sin PASS`] };
  const ns = lista.filter((p) => p.head_sha === v.sha).map((p) => p.number);
  if (ns.length > 1) return { ...v, veredicto: 'fail', motivos: [motivoCompartido(v.sha, ns)] };
  return v;
}

/**
 * Carril `ci`: evalúa y publica cada PR listado hacia main ({number, head_sha} de la lista de la
 * API); `abiertos` = todos los PR abiertos de cualquier base, para el HEAD compartido.
 * Todo PR listado recibe un check sobre su HEAD: si la evaluación falla, FAIL "sin veredicto".
 * Devuelve el exit code (1 si algún PR quedó sin evaluar o sin publicar). Report-only.
 */
export function cicloCi(prs, { evaluarPr, publicar, relistar, abiertos = prs, log = console.log }) {
  let rc = 0;
  const dup = compartidos(abiertos);
  for (const p of prs) {
    let v;
    if (dup.has(p.head_sha)) {
      v = failSobre(p, motivoCompartido(p.head_sha, dup.get(p.head_sha)));
    } else {
      try { v = confirmarPass(evaluarPr(p.number), relistar); } catch (e) {
        rc = 1;
        v = sinVeredicto(p, e?.message);
        log(`::warning title=delegated-audit-gate #${p.number}::sin veredicto (no se pudo leer el PR): ${String(e?.message).split('\n')[0]}`);
        if (!v) { log(`::error title=delegated-audit-gate #${p.number}::HEAD de la lista inválido: no hay dónde publicar`); continue; }
      }
    }
    const url = publicar(v);
    const linea = `#${p.number} @ ${String(v.sha).slice(0, 12)}: ${v.veredicto.toUpperCase()} (report-only) — riesgo ${v.riesgo ?? '—'} · review ${v.review_id ?? '—'} · gates ${v.run ?? '—'}/${v.attempt ?? '—'}${v.motivos.length ? ` · ${v.motivos.join(' | ')}` : ''}`;
    log(`::notice title=delegated-audit-gate #${p.number}::${linea.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    if (!url) { log(`::error title=delegated-audit-gate #${p.number}::no se pudo publicar el check tras 3 intentos`); rc = 1; }
  }
  return rc;
}
