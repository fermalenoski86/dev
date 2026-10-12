/**
 * P-02 · lógica pura del reporte de progreso verificable (sin I/O).
 * La CLI (`progress.mjs`) lee el manifiesto y el repo y llama a estas
 * funciones; `progreso.test.ts` las ejercita con negativos controlados.
 *
 * Entrada: el manifiesto (`entregables.mjs`) + un contexto con lo que el repo
 * ya sabe de forma estable: puntos §48 (`points.mjs`), ids de navegador y la
 * lista de archivos que existen. Nada consulta la red: el reporte es
 * reproducible byte a byte desde el checkout.
 */

export const TIPOS = ['producto', 'brief', 'proceso'];
const SHA = /^[0-9a-f]{40}$/;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const AGENTE = /^(claude|chatgpt|codex|gpt|copilot|bot)\b/i;
/** Lo que un `real` NUNCA puede citar ni describir: tests, specs, corridas de CI, simuladores. Se aplica a `referencia` Y a `condiciones`. */
const SIMULADO_ROTULADO_REAL = /(\.(test|spec)\.(ts|tsx|sh|mjs)\b|\/actions\/runs\/|\.github\/workflows|vitest|playwright|simulad|mock)/i;
const CAMPOS_REAL = ['referencia', 'condiciones', 'fecha', 'responsable'];

/** `AAAA-MM-DD` que además existe en el calendario gregoriano (RFC 3339 §5.6: mes 01–12, día según mes y año). */
export function fechaValida(s) {
  const m = FECHA.exec(s ?? '');
  if (!m) return false;
  const [, a, mes, d] = m.map(Number);
  if (mes < 1 || mes > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(a, mes, 0)).getUTCDate(); // día 0 del mes siguiente = último día del mes
}

/** Normaliza una evidencia real (strings recortados) y devuelve sus errores. Vacío = cuenta como equipo real. */
export function erroresReal(r) {
  const e = [];
  const v = Object.fromEntries(CAMPOS_REAL.map((c) => [c, r?.[c] == null ? '' : String(r[c]).trim()]));
  for (const c of CAMPOS_REAL) if (!v[c]) e.push(`evidencia real sin ${c}`);
  if (v.fecha && !fechaValida(v.fecha)) e.push(`evidencia real con fecha inválida «${v.fecha}» (AAAA-MM-DD del calendario)`);
  if (v.responsable && AGENTE.test(v.responsable)) e.push(`evidencia real con responsable «${v.responsable}»: tiene que ser una persona, no un agente`);
  for (const c of ['referencia', 'condiciones']) if (v[c] && SIMULADO_ROTULADO_REAL.test(v[c])) e.push(`evidencia real cuya ${c} describe una prueba simulada «${v[c]}»: un test, una corrida de CI o un simulador no son equipo real`);
  return e;
}

/** Job de CI que verifica un archivo de test, deducido de su nombre (misma regla que los configs de vitest y gates.yml). */
export function jobDe(archivo) {
  if (/^packages\/platform-storage\/src\/s3\.contract\.test\.ts$/.test(archivo)) return 'compose-smoke'; // en verify-build se SALTA (sin S3)
  if (/\.db\.test\.ts$/.test(archivo)) return 'postgres';
  if (/\.real\.test\.ts$/.test(archivo)) return 'media';
  if (/^e2e-platform\/[^/]+\.spec\.ts$/.test(archivo)) return 'e2e-platform';
  if (/^e2e\/(experience|builder)\.spec\.ts$/.test(archivo)) return 'e2e-m2c';
  if (/^(packages|apps|scripts)\/.*\.test\.tsx?$/.test(archivo)) return 'verify-build';
  if (/^scripts\/.*\.test\.sh$/.test(archivo)) return 'verify-build';
  return null;
}

function auditUrl(repo, numero) {
  return new RegExp(`^https://github\\.com/${repo.replace('/', '\\/')}/pull/${numero}#issuecomment-\\d+$`);
}

/**
 * Valida el manifiesto. Devuelve la lista de errores (vacía = OK).
 * ctx: { repo, pistas, points, navegador, existe(path) → boolean }.
 */
export function validar(entregables, ctx) {
  const e = [];
  const ids = new Set();
  const pistas = new Set(ctx.pistas.map((p) => p.id));
  const puntos = new Map(ctx.points.map((p) => [p.n, p]));
  const nav = new Map(ctx.navegador.map((n) => [n.id, n]));
  for (const x of entregables) {
    const w = (m) => e.push(`${x.id ?? '(sin id)'}: ${m}`);
    if (!x.id) w('falta id');
    else if (ids.has(x.id)) w('id repetido');
    ids.add(x.id);
    if (!pistas.has(x.pista)) w(`pista desconocida «${x.pista}»`);
    if (!TIPOS.includes(x.tipo)) w(`tipo desconocido «${x.tipo}» (${TIPOS.join('|')})`);
    if (!x.texto) w('falta texto');
    if (!x.brief) w('falta brief (ruta en el repo)');
    else if (!ctx.existe(x.brief)) w(`brief no existe en el repo: ${x.brief}`);
    // código
    const prs = x.codigo?.prs;
    if (!Array.isArray(prs)) w('codigo.prs debe ser una lista (vacía si no hay PR)');
    else {
      if (prs.length === 0 && !x.codigo.sin) w('sin PR y sin motivo (codigo.sin)');
      if (prs.length > 0 && x.codigo.sin) w('tiene PR y a la vez un motivo de "sin PR": una de las dos');
      for (const p of prs) {
        if (!Number.isInteger(p.numero) || p.numero <= 0) w(`PR sin número válido`);
        if (!SHA.test(p.merge ?? '')) w(`PR #${p.numero}: merge debe ser un SHA completo (40 hex)`);
        if (!SHA.test(p.auditado ?? '')) w(`PR #${p.numero}: auditado debe ser un SHA completo (40 hex)`);
        if (!p.audit) w(`PR #${p.numero}: mergeado sin AUDIT enlazado — no cuenta; si no hubo auditoría, dejá el PR fuera y explicalo en codigo.sin`);
        else if (!auditUrl(ctx.repo, p.numero).test(p.audit)) w(`PR #${p.numero}: audit debe ser un comentario de ese mismo PR (https://github.com/${ctx.repo}/pull/${p.numero}#issuecomment-<id>), es «${p.audit}»`);
      }
    }
    // simulado
    if (!Array.isArray(x.simulado)) w('simulado debe ser una lista (vacía si no hay test)');
    else {
      for (const s of x.simulado) {
        if (s.tipo === 'tests') {
          if (!Array.isArray(s.archivos) || s.archivos.length === 0) w('evidencia tests sin archivos');
          else for (const a of s.archivos) {
            if (!ctx.existe(a)) w(`test no existe en el repo: ${a}`);
            if (!jobDe(a)) w(`${a}: no es un archivo de test que CI corra (ver jobDe)`);
          }
        } else if (s.tipo === 'acceptance') {
          if (!Array.isArray(s.puntos) || s.puntos.length === 0) w('evidencia acceptance sin puntos');
          else for (const n of s.puntos) if (!puntos.has(n)) w(`[§48.${n}] no es un punto de §48`);
        } else if (s.tipo === 'navegador') {
          if (!Array.isArray(s.ids) || s.ids.length === 0) w('evidencia navegador sin ids');
          else for (const id of s.ids) if (!nav.has(id)) w(`«${id}» no es un id de navegador de points.mjs`);
        } else w(`evidencia simulada de tipo desconocido «${s.tipo}» (tests|acceptance|navegador)`);
      }
      if (x.tipo === 'brief' && x.simulado.length) w('un brief no tiene evidencia simulada: un documento acordado no es funcionalidad');
    }
    // real
    if (!Array.isArray(x.real)) w('real debe ser una lista (vacía si no hay evidencia física)');
    else {
      for (const r of x.real) for (const m of erroresReal(r)) w(m);
      if (x.tipo !== 'producto' && x.real.length) w(`un ${x.tipo} no puede tener evidencia con equipo real`);
    }
  }
  return e;
}

/** `packages/platform-auth/src/auth.db.test.ts` → `platform-auth/auth.db.test.ts`: corto pero sin ambigüedad entre paquetes. */
const corto = (a) => a.replace(/^(packages|apps)\//, '').replace(/\/src\//, '/').replace(/\/components\/|\/lib\/|\/cli\/|\/state\//, '/');

/** Estado de las tres columnas de un entregable (ya validado). */
export function evaluar(x, ctx) {
  const puntos = new Map(ctx.points.map((p) => [p.n, p]));
  const nav = new Map(ctx.navegador.map((n) => [n.id, n]));
  const prs = x.codigo.prs;
  const codigo = prs.length > 0 && prs.every((p) => p.audit)
    ? { ok: true, prs }
    : { ok: false, motivo: prs.length === 0 ? x.codigo.sin : 'PR sin AUDIT' };
  const faltan = [];
  const partes = [];
  for (const s of x.simulado) {
    if (s.tipo === 'tests') {
      const porJob = new Map();
      for (const a of s.archivos) porJob.set(jobDe(a), [...(porJob.get(jobDe(a)) ?? []), a]);
      for (const [job, archivos] of porJob) partes.push(`${job}: ${archivos.map((a) => `\`${corto(a)}\``).join(', ')}`);
    } else if (s.tipo === 'acceptance') {
      const pend = s.puntos.filter((n) => puntos.get(n).estado !== 'cubierto');
      faltan.push(...pend.map((n) => `§48.${n} ${puntos.get(n).estado}`));
      partes.push(`§48: ${s.puntos.map((n) => `${n}${puntos.get(n).estado === 'cubierto' ? '' : '⏳'}`).join(', ')}`);
    } else if (s.tipo === 'navegador') {
      const pend = s.ids.filter((id) => nav.get(id).estado !== 'cubierto');
      faltan.push(...pend.map((id) => `${id} ${nav.get(id).estado}`));
      partes.push(`navegador: ${s.ids.map((id) => `${id}${nav.get(id).estado === 'cubierto' ? '' : '⏳'}`).join(', ')}`);
    }
  }
  const simulado = x.simulado.length === 0 ? { ok: false, motivo: 'sin test' } : faltan.length ? { ok: false, motivo: `pendiente: ${faltan.join('; ')}`, partes } : { ok: true, partes };
  // Solo cuenta la evidencia que pasa `erroresReal`: aunque alguien llame a evaluar/contar sin validar
  // antes (#67, AUDIT: CAMBIOS), una entrada inválida nunca habilita la celda ni el contador.
  const validas = x.real.filter((r) => erroresReal(r).length === 0);
  const real = validas.length ? { ok: true, evidencias: validas } : { ok: false, motivo: x.real.length ? 'evidencia inválida (ver validar)' : 'sin evidencia' };
  return { codigo, simulado, real };
}

/** Conteos por pista (solo `producto`): { definidos, codigo, simulado, real }. */
export function contar(entregables, ctx) {
  const out = new Map(ctx.pistas.map((p) => [p.id, { definidos: 0, codigo: 0, simulado: 0, real: 0 }]));
  for (const x of entregables) {
    if (x.tipo !== 'producto') continue;
    const c = out.get(x.pista);
    const ev = evaluar(x, ctx);
    c.definidos++;
    if (ev.codigo.ok) c.codigo++;
    if (ev.simulado.ok) c.simulado++;
    if (ev.real.ok) c.real++;
  }
  return out;
}

const esc = (s) => String(s).replace(/\|/g, '\\|');

function celdaCodigo(ev, repo) {
  if (!ev.ok) return `✗ ${esc(ev.motivo)}`;
  return `✔ ${ev.prs.map((p) => `[#${p.numero}](https://github.com/${repo}/pull/${p.numero}) \`${p.merge.slice(0, 7)}\` · [AUDIT](${p.audit}) sobre \`${p.auditado.slice(0, 7)}\``).join(' · ')}`;
}
function celdaSimulado(ev) {
  if (ev.ok) return `✔ ${esc(ev.partes.join(' · '))}`;
  return `✗ ${esc(ev.motivo)}${ev.partes?.length ? ` (${esc(ev.partes.join(' · '))})` : ''}`;
}
function celdaReal(ev) {
  if (!ev.ok) return `— ${ev.motivo}`;
  const t = (v) => esc(String(v).trim());
  return `✔ ${ev.evidencias.map((r) => `${t(r.referencia)} (${t(r.condiciones)}; ${t(r.fecha)}; ${t(r.responsable)})`).join(' · ')}`;
}

/** Markdown completo de PROGRESO.md. Determinista: sin fechas ni porcentajes. */
export function render(entregables, ctx) {
  const L = [];
  const conteos = contar(entregables, ctx);
  const totalReal = [...conteos.values()].reduce((a, c) => a + c.real, 0);
  const totalDef = [...conteos.values()].reduce((a, c) => a + c.definidos, 0);
  L.push('# PROGRESO — reporte verificable por pista');
  L.push('');
  L.push('> Generado por `pnpm progress:generate` desde `scripts/collab/entregables.mjs` (P-02). No editar a mano:');
  L.push('> CI corre `pnpm progress:check` y falla si este archivo no coincide con lo generado.');
  L.push('> No es un archivo de memoria: es un reporte derivado de datos que se pueden comprobar.');
  L.push('');
  L.push('**Cómo leerlo.** Cada entregable tiene tres columnas independientes; ninguna implica otra:');
  L.push('`código` = PR mergeado en `main` con comentario `AUDIT: APROBADO` enlazado (sin AUDIT no cuenta);');
  L.push('`probado simulado` = tests que CI corre, citados por archivo (un test acredita solo lo que prueba);');
  L.push('`probado con equipo real` = evidencia física con referencia, condiciones, fecha y responsable (nunca se marca desde el repo solo).');
  L.push('Solo conteos `n/N` por pista y columna; **no hay porcentaje global**. `0/0` significa que todavía no hay entregables definidos, que no es lo mismo que `0/N` (definidos y pendientes).');
  L.push('Los briefs aprobados y las herramientas de proceso se listan al final y **no cuentan** como funcionalidad.');
  L.push('');
  L.push('## Resumen por pista');
  L.push('');
  L.push('| Pista | Entregables definidos | Código (PR + AUDIT) | Probado simulado | Probado con equipo real |');
  L.push('|---|---|---|---|---|');
  for (const p of ctx.pistas) {
    const c = conteos.get(p.id);
    if (c.definidos === 0) L.push(`| ${p.nombre} | **0/0 — entregables todavía no definidos** | — | — | — |`);
    else L.push(`| ${p.nombre} | ${c.definidos} | ${c.codigo}/${c.definidos} | ${c.simulado}/${c.definidos} | ${c.real}/${c.definidos} |`);
  }
  L.push('');
  if (totalReal === 0) L.push(`**Equipo real: 0/${totalDef} en todo el repo.** Nada de lo listado se probó con el procesador LED, las pantallas, la iluminación ni el reloj reales; todo lo verde de arriba es software probado en simulación/CI.`);
  else L.push(`**Equipo real: ${totalReal}/${totalDef} en todo el repo.**`);
  L.push('');
  for (const p of ctx.pistas) {
    L.push(`## ${p.nombre}`);
    L.push('');
    const xs = entregables.filter((x) => x.pista === p.id && x.tipo === 'producto');
    if (xs.length === 0) {
      L.push(`**0/0 — entregables todavía no definidos.** ${p.sinPlan ?? 'Sin plan registrado.'}`);
      L.push('');
      continue;
    }
    const c = conteos.get(p.id);
    L.push(`Código ${c.codigo}/${c.definidos} · Probado simulado ${c.simulado}/${c.definidos} · Probado con equipo real ${c.real}/${c.definidos}`);
    L.push('');
    L.push('| Id | Entregable | Brief / referencia | Código (PR + AUDIT) | Probado simulado | Probado con equipo real |');
    L.push('|---|---|---|---|---|---|');
    for (const x of xs) {
      const ev = evaluar(x, ctx);
      L.push(`| ${x.id} | ${esc(x.texto)} | \`${x.brief}\` | ${celdaCodigo(ev.codigo, ctx.repo)} | ${celdaSimulado(ev.simulado)} | ${celdaReal(ev.real)} |`);
    }
    L.push('');
  }
  const briefs = entregables.filter((x) => x.tipo === 'brief');
  const proceso = entregables.filter((x) => x.tipo === 'proceso');
  L.push('## Fuera de las pistas (no cuentan como funcionalidad)');
  L.push('');
  L.push('**Briefs acordados.** Un brief aprobado define qué se va a construir; no prueba que exista.');
  L.push('');
  L.push('| Id | Brief | Archivo | Acordado (PR + AUDIT) |');
  L.push('|---|---|---|---|');
  for (const x of briefs) L.push(`| ${x.id} | ${esc(x.texto)} | \`${x.brief}\` | ${celdaCodigo(evaluar(x, ctx).codigo, ctx.repo)} |`);
  L.push('');
  L.push('**Proceso y herramientas de colaboración.** Software del repo que no es producto.');
  L.push('');
  L.push('| Id | Qué | Referencia | Código (PR + AUDIT) | Probado simulado |');
  L.push('|---|---|---|---|---|');
  for (const x of proceso) {
    const ev = evaluar(x, ctx);
    L.push(`| ${x.id} | ${esc(x.texto)} | \`${x.brief}\` | ${celdaCodigo(ev.codigo, ctx.repo)} | ${celdaSimulado(ev.simulado)} |`);
  }
  L.push('');
  L.push('## Cómo se mantiene');
  L.push('');
  L.push('- Un entregable nuevo se agrega a `scripts/collab/entregables.mjs` cuando su PR se mergea con `AUDIT: APROBADO`; antes de eso no existe para este reporte.');
  L.push('- Evidencia con equipo real: la carga una persona en `real: [{ referencia, condiciones, fecha, responsable }]` de ese entregable; el validador rechaza referencias a tests, corridas de CI o simuladores y responsables que sean agentes.');
  L.push('- `node scripts/collab/progress.mjs verificar-github` comprueba contra la API de GitHub (fuera de CI) que cada PR citado está mergeado con ese SHA y que cada comentario AUDIT existe en ese PR, empieza con `AUDIT: APROBADO` y menciona el SHA auditado.');
  L.push('');
  return L.join('\n');
}
