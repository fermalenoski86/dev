// P-06 · PoC de firma delegada — reglas puras de `delegated-audit-gate` (brief
// docs/briefs/P06_BRIDGE_POC.md §2–§3; decisión de #54 del 2026-10-12 18:15).
//
// Sin E/S: recibe lo que el CLI (delegated-audit.mjs) leyó de la API de GitHub y de git
// con la revisión de main, y devuelve un veredicto. REPORT-ONLY: el veredicto se publica
// como check `neutral`; nunca habilita un merge ni reemplaza el AUDIT de ChatGPT.
// Decisión A del auditor (#54, 2026-10-20 23:53): adaptador fail-closed sobre lo que Codex
// SÍ emite (marcador codex-review-state:v1 + badges), solo riesgo bajo, preauditoría: no
// acredita brief, A/B/C, negativos ni gates y nunca es una aprobación formal.
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
 * Parser estricto del bloque de §2. Desde la decisión A (#54) el gate NO lo usa: Codex no
 * emite el bloque (3/3 muestras). Queda exportado para el formato de AGENTS.md; retirarlo
 * va en BACKLOG. Exactamente UNA aparición de `AUDIT:` en todo el
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
 * Adaptador fail-closed (decisión A del auditor, #54 2026-10-20 23:53): Codex NO emite el
 * bloque `AUDIT:`. Sin hallazgos no publica review: deja el comentario de resumen con el
 * marcador `<!-- codex-review-state:v1 {json} -->`; con hallazgos publica una review con
 * comentarios en línea que llevan el badge P0/P1/P2. Se lee eso, nada más.
 */
export const MARCADOR = 'codex-review-state:v1';
const MARCADOR_RE = /<!-- codex-review-state:v1 (\{.*?\}) -->/s;
/** Badge de severidad de Codex (`![P1 Badge](https://img.shields.io/badge/P1-…)`). */
const BADGE_RE = /!\[(P[0-2]) Badge\]\(https:\/\/img\.shields\.io\/badge\/P[0-2]-/g;
export const badges = (texto) => [...String(texto ?? '').matchAll(BADGE_RE)].map((m) => m[1]);

/**
 * Parser estricto del marcador. Una sola aparición de la cadena en el cuerpo, JSON válido,
 * `code_review` con los cuatro campos y tipos exactos. Cualquier otra cosa → error.
 * @returns {{ ok: true, estado: object } | { ok: false, error: string }}
 */
const CAMPOS_NULOS = (sr) => Object.values(sr).every((v) => v === null);
export function parsearMarcador(cuerpo) {
  if (typeof cuerpo !== 'string') return { ok: false, error: 'comentario sin cuerpo' };
  const n = cuerpo.split(MARCADOR).length - 1;
  if (n !== 1) return { ok: false, error: `${n} apariciones de "${MARCADOR}" en el comentario (debe haber una)` };
  const m = MARCADOR_RE.exec(cuerpo);
  if (!m) return { ok: false, error: 'marcador sin el formato <!-- codex-review-state:v1 {json} -->' };
  let j;
  try { j = JSON.parse(m[1]); } catch { return { ok: false, error: 'JSON del marcador ilegible' }; }
  const cr = j?.code_review;
  if (!cr || typeof cr !== 'object') return { ok: false, error: 'marcador sin code_review' };
  if (!esSha(cr.commit_sha)) return { ok: false, error: 'code_review.commit_sha no es un sha de 40' };
  if (typeof cr.status !== 'string') return { ok: false, error: 'code_review.status ilegible' };
  if (typeof cr.has_any_findings !== 'boolean' || typeof cr.has_unresolved_findings !== 'boolean') return { ok: false, error: 'code_review.has_*_findings no son booleanos' };
  // security_review (Codex #98, P2): solo dos formas aceptadas, con tipos exactos; cualquier
  // otra (objeto vacío, strings, campos de más o de menos) es ambigua → error.
  //   sin correr:  los cuatro campos en null (o la clave ausente)
  //   completada:  {commit_sha: <sha>, status: 'completed', has_any_findings: false, has_unresolved_findings: false}
  const sr = j.security_review === undefined ? null : j.security_review;
  if (sr !== null) {
    const CAMPOS = ['commit_sha', 'has_any_findings', 'has_unresolved_findings', 'status'];
    if (typeof sr !== 'object' || Array.isArray(sr) || Object.keys(sr).sort().join() !== CAMPOS.join()) return { ok: false, error: 'security_review ilegible (campos distintos de commit_sha/status/has_*_findings)' };
    const vacia = CAMPOS.every((k) => sr[k] === null);
    const limpia = esSha(sr.commit_sha) && sr.status === 'completed' && sr.has_any_findings === false && sr.has_unresolved_findings === false;
    if (!vacia && !limpia) return { ok: false, error: `security_review en un estado no aceptado (${JSON.stringify(sr).slice(0, 160)}): solo sin correr (todo null) o completed sin hallazgos` };
  }
  return { ok: true, estado: { code_review: cr, security_review: sr && CAMPOS_NULOS(sr) ? null : sr } };
}

/**
 * Veredicto del gate para un PR (preauditoría report-only: nunca es una aprobación formal).
 * @param {object} e
 * @param {string} e.repo                 owner/nombre
 * @param {{number:number, head_sha:string, base_ref:string, state:string}} e.pr  leído por API en el momento
 * @param {object[]|null} e.reviews       reviews REST del PR (todas las páginas; null = lectura incompleta)
 * @param {object[]|null} e.comentarios   comentarios de issue del PR (todas las páginas; null = incompleta)
 * @param {object[]|null} e.hilos         comentarios en línea de review (todas las páginas; null = incompleta)
 * @param {{nivel:string, calculado:string, declarado:string|null, errores:string[]}|null} e.riesgo
 *        risk.mjs verificar (política de main) sobre el diff real contra `main` y el CUERPO del
 *        PR: `nivel` = riesgo efectivo (máx. de declarado y calculado). null = sin veredicto.
 * @param {string|null} e.main            sha de main fijado al empezar la evaluación (la tupla)
 * @param {string|null} e.ejecutada       revisión del código/política EN EJECUCIÓN (checkout limpio
 *        cuyos módulos están cargados y cuyos risk.mjs/gates.yml se usan); tiene que ser `main`
 * @param {object|null} e.estabilidad     relectura al terminar: {main, head, base_ref, body, ejecutada}
 * @param {object|null} e.gates           último run pull_request de gates.yml para head_sha:
 *        {id, attempt, head_sha, event, status, conclusion, jobs, probado, base_probada, head_probado}
 * @param {string[]} e.jobsEsperados      jobsDeGates(gates.yml de main)
 * @param {number[]} [e.allowlist]
 */
export function evaluar({ repo, pr, reviews, comentarios, hilos, riesgo, main = null, ejecutada = null, estabilidad = null, gates, jobsEsperados, allowlist = CODEX_BOT_IDS }) {
  const motivos = [];
  // Tupla del veredicto (AUDIT: CAMBIOS @ 9332156): (pr, head, main evaluado, riesgo efectivo,
  // run/attempt) + base y merge probados. PASS solo si cada componente se COMPROBÓ.
  const info = { pr: pr?.number ?? null, sha: pr?.head_sha ?? null, main: esSha(main) ? main : null, politica: esSha(ejecutada) ? ejecutada : null, marcador_id: null, author_id: null, riesgo: riesgo?.nivel ?? null, calculado: riesgo?.calculado ?? null, declarado: riesgo?.declarado ?? null, run: gates?.id ?? null, attempt: gates?.attempt ?? null, probado: gates?.probado ?? null, base_probada: gates?.base_probada ?? null, rondas: 0, ignoradas: [] };
  const fin = () => ({ veredicto: motivos.length ? 'fail' : 'pass', motivos, ...info });

  if (!pr || !Number.isSafeInteger(pr.number) || !new RegExp(`^${SHA}$`).test(pr.head_sha ?? '')) {
    motivos.push('PR ilegible (número o HEAD inválidos)');
    return fin();
  }
  if (pr.state !== 'open') motivos.push(`PR no abierto (${pr.state})`);
  if (pr.base_ref !== 'main') motivos.push(`base ${pr.base_ref} ≠ main: el gate solo evalúa PR hacia main`);

  if (!esSha(main)) motivos.push('tupla: main evaluado desconocido (no se pudo fijar el sha de main)');
  // Política ejecutada (AUDIT: CAMBIOS @ f097a29, P2): el riesgo, los jobs esperados, la
  // allowlist y estas mismas reglas salen del checkout que corre, no del main que se lee por
  // API. Un fetch no actualiza ni el árbol ni los módulos ya cargados: si el checkout no ES el
  // main evaluado, el veredicto se calculó con otra política → FAIL hasta una corrida vigente.
  if (!esSha(ejecutada)) motivos.push('política: no se pudo verificar la revisión de los scripts en ejecución (checkout ilegible o con cambios locales) → sin PASS');
  else if (esSha(main) && ejecutada !== main) motivos.push(`política: los scripts en ejecución son de ${corto(ejecutada)} y el main evaluado es ${corto(main)} (checkout desactualizado: sin PASS hasta una corrida con la política vigente)`);

  // 4. Elegibilidad: riesgo EFECTIVO de la política de main (diff real + declaración del
  // cuerpo del PR). Declaración ausente/inválida → fail; nunca rebajar el calculado (AUDIT:
  // CAMBIOS @ 9332156, P2 1). Decisión A (#54, 2026-10-20): el adaptador es SOLO para riesgo
  // bajo durante la PoC/piloto; medio y alto → auditoría formal de ChatGPT.
  if (!riesgo || !NIVELES.includes(riesgo.nivel) || !NIVELES.includes(riesgo.calculado)) {
    motivos.push('elegibilidad: sin clasificación de riesgo (risk.mjs no dio veredicto) → requiere auditoría formal');
  } else {
    if (rango(riesgo.nivel) < rango(riesgo.calculado)) motivos.push(`elegibilidad: riesgo efectivo ${riesgo.nivel} < calculado ${riesgo.calculado} (nunca se rebaja)`);
    if (!Array.isArray(riesgo.errores)) motivos.push('elegibilidad: no se pudo validar la declaración de riesgo del PR');
    else for (const e of riesgo.errores) motivos.push(`elegibilidad: declaración de riesgo rechazada — ${e}`);
    if (riesgo.nivel !== 'bajo') motivos.push(`elegibilidad: riesgo efectivo ${riesgo.nivel}${riesgo.calculado !== riesgo.nivel ? ` (declarado; calculado ${riesgo.calculado})` : ''} → requiere auditoría formal de ChatGPT (el adaptador solo cubre riesgo bajo, #54)`);
  }

  // 1–3. Señal de Codex sobre el HEAD exacto (adaptador A). Lectura incompleta → FAIL.
  if (!Array.isArray(reviews) || !Array.isArray(comentarios) || !Array.isArray(hilos)) {
    const faltan = [[reviews, 'reviews'], [comentarios, 'comentarios del PR'], [hilos, 'comentarios de review']].filter(([x]) => !Array.isArray(x)).map(([, n]) => n);
    motivos.push(`codex: no se pudieron leer completas (todas las páginas) por API: ${faltan.join(', ')}`);
  } else {
    // 1. Marcador: exactamente UN comentario del bot allowlisted con el marcador.
    for (const c of comentarios) {
      if (!esCodex(c, allowlist) && typeof c?.body === 'string' && c.body.includes(MARCADOR)) {
        info.ignoradas.push(`comentario ${c.id} de ${c.user?.login ?? '?'} (id ${c.user?.id ?? '?'}, ${c.user?.type ?? '?'}): marcador de identidad no allowlisted`);
      }
    }
    const marcas = comentarios.filter((c) => esCodex(c, allowlist) && typeof c?.body === 'string' && c.body.includes(MARCADOR));
    if (marcas.length === 0) motivos.push('codex: sin comentario con el marcador codex-review-state:v1 del bot allowlisted');
    else if (marcas.length > 1) motivos.push(`codex: ${marcas.length} comentarios con el marcador (ambiguo: ${marcas.map((c) => c.id).join(', ')})`);
    else {
      const c = marcas[0];
      info.marcador_id = c.id;
      info.author_id = c.user.id;
      const p = parsearMarcador(c.body);
      if (!p.ok) motivos.push(`codex: marcador ${c.id} — ${p.error}`);
      else {
        const { code_review: cr, security_review: sr } = p.estado;
        if (cr.commit_sha !== pr.head_sha) motivos.push(`codex: el marcador es del commit ${corto(cr.commit_sha)}, no del HEAD ${corto(pr.head_sha)} (review vieja o pendiente)`);
        if (cr.status !== 'completed') motivos.push(`codex: code_review ${cr.status} (solo cuenta completed)`);
        if (cr.has_unresolved_findings !== false) motivos.push('codex: el marcador declara hallazgos sin resolver');
        // estados contradictorios (hallazgos que el marcador da por resueltos sin una review
        // limpia del HEAD) no se interpretan: FAIL
        if (cr.has_any_findings !== false) motivos.push('codex: el marcador declara hallazgos en la review (has_any_findings) → no hay preauditoría limpia');
        // el parser ya dejó solo «sin correr» (null) o «completed sin hallazgos»; completada
        // tiene que ser del HEAD
        if (sr && sr.commit_sha !== pr.head_sha) {
          motivos.push(`codex: security_review del commit ${corto(sr.commit_sha)}, no del HEAD`);
        }
      }
    }
    // 2. Reviews e hilos del bot sobre el HEAD: Codex solo publica review cuando tiene
    // sugerencias, así que CUALQUIER review suya sobre el HEAD, o un hilo con badge P0–P2
    // cuyo commit vigente es el HEAD, es un hallazgo abierto → FAIL (no se interpreta si está
    // resuelto: REST no lo expone; fail-closed).
    const codexRv = reviews.filter((r) => esCodex(r, allowlist)).sort(orden);
    info.rondas = new Set(codexRv.map((r) => r.commit_id)).size;
    if (info.rondas > MAX_RONDAS) motivos.push(`rondas: ${info.rondas} commits revisados por Codex > ${MAX_RONDAS} → corresponde bridge-paused (report-only: no se etiqueta)`);
    for (const r of codexRv.filter((x) => x.commit_id === pr.head_sha)) {
      const b = badges(r.body);
      motivos.push(`codex: review ${r.id} (${r.state}) sobre el HEAD${b.length ? ` con ${[...new Set(b)].join('/')}` : ''} → Codex publicó sugerencias`);
    }
    for (const h of hilos.filter((x) => esCodex(x, allowlist) && (x.commit_id === pr.head_sha || x.original_commit_id === pr.head_sha))) {
      const b = badges(h.body);
      if (b.length) motivos.push(`codex: hilo ${h.id} con ${[...new Set(b)].join('/')} en ${h.path ?? '?'}:${h.line ?? '?'} sobre el HEAD`);
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
      // Hallazgo 4 (#54): la API de jobs del run también devuelve los check-runs publicados por
      // API sobre el mismo commit (este gate, `riesgo`, `paralelo`, con todo su historial).
      // Se deduplica por nombre y se excluye el propio check: ver estadoJobs().
      const est = estadoJobs(gates.jobs);
      if (!est) motivos.push('gates: lista de jobs del run ilegible');
      else {
        for (const j of jobsEsperados) {
          const e = est.get(j);
          if (!e) motivos.push(`gates: falta el job ${j}`);
          else if (e.pendiente) motivos.push(`gates: job ${j} → pendiente`);
          else if (e.conclusion !== 'success') motivos.push(`gates: job ${j} → ${e.conclusion}`);
        }
        for (const [nombre, e] of est) {
          if (jobsEsperados.includes(nombre) || !e.terminal) continue; // un extra solo pendiente no cuenta
          if (!EXTRA_OK.includes(e.conclusion)) motivos.push(`gates: job extra ${nombre} → ${e.conclusion}`);
        }
      }
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
    if (estabilidad.ejecutada !== ejecutada) motivos.push(`estabilidad: la revisión de los scripts en ejecución cambió o quedó ilegible durante la evaluación (${corto(ejecutada)} → ${corto(estabilidad.ejecutada)})`);
  }
  return fin();
}

/** Nombre del check que publica este gate: nunca cuenta como job de gates (hallazgo 4). */
export const CHECK_PROPIO = 'delegated-audit-gate';
const EXTRA_OK = ['success', 'neutral', 'skipped'];
const idNum = (x) => (Number.isSafeInteger(x?.id) ? x.id : -1);

/**
 * Estado vigente por nombre de los jobs/checks que la API asocia al run (hallazgo 4, #54):
 * por cada nombre (menos CHECK_PROPIO) se toma el ÚLTIMO resultado terminal (mayor id: los
 * ids de check-run son crecientes) y se marca `pendiente` si hay una entrada no terminal más
 * nueva que ese terminal (para un job esperado, eso es FAIL). El historial republicado,
 * pendientes o neutrales viejos no cuentan. Entrada ilegible → null (FAIL).
 * @returns {Map<string, {conclusion: string|null, terminal: boolean, pendiente: boolean}>|null}
 */
export function estadoJobs(jobs) {
  if (!Array.isArray(jobs)) return null;
  const por = new Map();
  for (const j of jobs) {
    if (typeof j?.name !== 'string') return null;
    if (j.name === CHECK_PROPIO) continue;
    por.set(j.name, [...(por.get(j.name) ?? []), j]);
  }
  const out = new Map();
  for (const [nombre, xs] of por) {
    const terminal = (x) => (x.status === undefined ? x.conclusion != null : x.status === 'completed' && x.conclusion != null);
    const term = xs.filter(terminal).sort((a, b) => idNum(a) - idNum(b)).at(-1);
    const nuevoPendiente = xs.some((x) => !terminal(x) && (!term || idNum(x) > idNum(term)));
    out.set(nombre, { conclusion: term ? term.conclusion : null, terminal: Boolean(term), pendiente: !term || nuevoPendiente });
  }
  return out;
}

/**
 * Orquestación de UNA evaluación (antes en el CLI; acá con E/S inyectada para poder probar el
 * CLI con respuestas controladas). `io`:
 *   repo, ejecutada (sha de la revisión en ejecución, fijado al arrancar el proceso, o null),
 *   ejecutadaAhora() (relectura al terminar), mainActual(), leerPr(n), leerReviews(n),
 *   leerComentarios(n), leerHilos(n) (todas las páginas o excepción),
 *   verificarRiesgo(n, head, main, cuerpo), leerGates(head), gatesYml() (gates.yml de la
 *   revisión ejecutada).
 * Un error de leerPr al empezar se propaga (cicloCi publica FAIL "sin veredicto"); el resto
 * de los errores dejan su componente en null → FAIL.
 */
export function evaluarPrCon(n, io) {
  const t = (f) => { try { return f(); } catch { return null; } };
  const main = t(io.mainActual);
  const pr = io.leerPr(n);
  const ok = pr && esSha(pr.head_sha);
  const entrada = {
    repo: io.repo,
    pr,
    main,
    ejecutada: esSha(io.ejecutada) ? io.ejecutada : null,
    reviews: ok ? t(() => io.leerReviews(n)) : null,
    comentarios: ok ? t(() => io.leerComentarios(n)) : null,
    hilos: ok ? t(() => io.leerHilos(n)) : null,
    riesgo: ok && main ? t(() => io.verificarRiesgo(n, pr.head_sha, main, pr.body)) : null,
    gates: ok ? t(() => io.leerGates(pr.head_sha)) : null,
    jobsEsperados: t(() => jobsDeGates(io.gatesYml())) ?? [],
  };
  // relectura al terminar: si algo de la tupla cambió en el medio, FAIL (lo decide evaluar)
  const fin = t(() => { const p = io.leerPr(n); return { main: io.mainActual(), head: p.head_sha, base_ref: p.base_ref, body: p.body, ejecutada: io.ejecutadaAhora() }; });
  return evaluar({ ...entrada, estabilidad: fin });
}

/** Check-run para el HEAD. Report-only: conclusión siempre `neutral`; el veredicto va en el título. */
export function checkRun(v) {
  const titulo = v.veredicto === 'pass'
    ? `report-only: PASS — preauditoría Codex sin hallazgos para #${v.pr} @ ${corto(v.sha)} sobre main ${corto(v.main)} (no es aprobación: manda el AUDIT de ChatGPT)`
    : `report-only: FAIL — ${v.motivos[0]}${v.motivos.length > 1 ? ` (+${v.motivos.length - 1})` : ''}`;
  const resumen = [
    `veredicto: **${v.veredicto.toUpperCase()}** (report-only, PoC P-06: preauditoría, nunca aprobación formal ni habilita merge)`,
    `pr: #${v.pr} · sha: ${v.sha} · marcador_id: ${v.marcador_id ?? '—'} · author_id: ${v.author_id ?? '—'}`,
    `tupla: pr #${v.pr} · head ${v.sha} · main ${v.main ?? '—'} · política ${v.politica ?? '—'} · riesgo efectivo ${v.riesgo ?? '—'} · run ${v.run ?? '—'} attempt ${v.attempt ?? '—'}`,
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

const failSobre = ({ number, head_sha }, motivo) => ({ veredicto: 'fail', motivos: [motivo], pr: number, sha: head_sha, main: null, politica: null, marcador_id: null, author_id: null, riesgo: null, calculado: null, declarado: null, run: null, attempt: null, probado: null, base_probada: null, rondas: 0, ignoradas: [] });

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
    const linea = `#${p.number} @ ${String(v.sha).slice(0, 12)}: ${v.veredicto.toUpperCase()} (report-only) — riesgo ${v.riesgo ?? '—'} · marcador ${v.marcador_id ?? '—'} · gates ${v.run ?? '—'}/${v.attempt ?? '—'}${v.motivos.length ? ` · ${v.motivos.join(' | ')}` : ''}`;
    log(`::notice title=delegated-audit-gate #${p.number}::${linea.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    if (!url) { log(`::error title=delegated-audit-gate #${p.number}::no se pudo publicar el check tras 3 intentos`); rc = 1; }
  }
  return rc;
}
