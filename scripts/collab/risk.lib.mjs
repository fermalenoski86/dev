// P-03 · Auditoría basada en riesgo — clasificador puro (sin git ni red).
//
// Acordado en #53 (P-03 con ajustes del auditor) y #54 (dictamen 2, ajuste 3):
//   - El nivel sale del DIFF REAL contra el merge-base: rutas (origen y destino de
//     renames, borrados incluidos) + naturaleza del contenido. La etiqueta o la
//     descripción del PR no rebajan nada.
//   - ALTO POR DEFECTO SI HAY DUDA: una ruta que ninguna regla reconoce es alto; un
//     archivo binario fuera de docs es alto; una ruta con caracteres que no se pueden
//     representar es alto.
//   - El PR puede ELEVAR el nivel a mano, nunca rebajarlo: si declara menos que lo
//     calculado, falla. Un PR alto (calculado o declarado) sin sección
//     "Pruebas adversarias" con al menos un caso, falla.
//   - Todos los gates corren siempre: esto fija el MÍNIMO de auditoría, no saltea
//     nada. CI verifica un mínimo por paths; nunca declara "seguro" un diff.
//
// Familias ALTO: el mapa de rutas de gates/proceso/migraciones/auth/aprobación/
// storage/procesos externos/apps/control vive en GATES_RE de paralelo.sh (un solo
// lugar, AGENTS.md §Paralelo); acá se lee de ese archivo y se le suman las familias
// que P-03 agrega: .github/ entero, AGENTS.md/CLAUDE.md, HANDOFF/DECISIONES, el prompt
// del auditor, hardware, .gitattributes, secretos, procesos externos y DDL por
// contenido, y reducción de tests.

export const NIVELES = ['bajo', 'medio', 'alto'];
export const rango = (n) => NIVELES.indexOf(n);
export const maximo = (a, b) => (rango(a) >= rango(b) ? a : b);

/** Extrae GATES_RE de paralelo.sh y reemplaza __WS__ por las raíces del workspace. */
export function gatesDesdeParalelo(textoParalelo, raices) {
  const m = /^GATES_RE='([^']+)'$/m.exec(textoParalelo ?? '');
  if (!m) throw new Error('risk: no encuentro GATES_RE en scripts/collab/paralelo.sh (fail-closed)');
  const ws = raices && raices.length ? raices.map((r) => r.replace(/\./g, '\\.')).join('|') : 'apps|packages';
  return new RegExp(m[1].replaceAll('__WS__', `(${ws})`));
}

/** Raíces `x/*` de pnpm-workspace.yaml (mismo criterio que paralelo.sh). */
export function raicesWorkspace(yaml) {
  const out = [];
  for (const l of (yaml ?? '').split('\n')) {
    const m = /^\s*-\s*['"]?([A-Za-z0-9_.@-]+)\/\*['"]?\s*$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

// Familias ALTO que P-03 suma a GATES_RE (por ruta).
const ALTO_EXTRA = [
  [/^\.github\//, 'configuración de GitHub (workflows, CODEOWNERS, acciones)'],
  [/^(AGENTS|CLAUDE)\.md$/, 'reglas de los agentes (AGENTS.md / CLAUDE.md)'],
  [/^docs\/collab\/(HANDOFF|DECISIONES)\.md$/, 'transferencia de pelota o decisiones de Fer'],
  [/^docs\/ai-workflow\//, 'prompt y fundamento del auditor'],
  [/^\.gitattributes$|(^|\/)\.gitattributes$/, '.gitattributes (puede ocultar diffs o cambiar cómo se ve el contenido)'],
  [/(^|[/_.-])(hardware|dmx|art-?net|novastar|sacn|ltc|tb60|reloj)([/_.-]|$)/i, 'hardware / control físico'],
  [/^edge\//, 'edge (corre en el edificio)'],
  [/(^|\/)\.env(\.|$)/, 'archivo de entorno'],
];

// MEDIO: producto y documentos que fijan criterio de auditoría.
const MEDIO = [
  [/^(apps|packages)\/[^/]+\//, 'producto (app o paquete del workspace)'],
  [/^docs\/(briefs|architecture|platform|protocols|cybersecurity|ops)\//, 'brief, ADR, contrato o doc operativo'],
  [/^docs\/collab\/(BACKLOG|PROGRESO)\.md$/, 'BACKLOG (habilita laterales) o PROGRESO (generado, con check)'],
  [/^scripts\/[^/]+\.(ts|mjs|js|py)$/, 'script suelto de scripts/'],
  [/^\.gitignore$/, '.gitignore'],
];

// BAJO: solo editorial.
const BAJO = [
  [/^docs\/.+\.(md|txt)$/, 'documentación'],
  [/^docs\/.+\.(png|jpe?g|gif|webp|svg)$/, 'imagen de documentación'],
  [/^[^/]+\.md$/, 'markdown de la raíz'],
];

const DOC = /^(docs\/|[^/]+\.md$)/;
const TEST = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|e2e|e2e-platform)\//;
const CODIGO = /\.(c|m)?[jt]sx?$|\.(py|sh|sql|ya?ml)$/;

/** Clasifica una ruta sola. → { nivel, motivo } */
export function clasificarRuta(ruta, gatesRe) {
  if (typeof ruta !== 'string' || ruta === '' || /[\n\r\t\0"\\]/.test(ruta) || ruta.startsWith('/') || ruta.split('/').includes('..')) {
    return { nivel: 'alto', motivo: 'ruta no representable o anómala (alto por defecto)' };
  }
  if (gatesRe.test(ruta)) return { nivel: 'alto', motivo: 'familia de riesgo alto de GATES_RE (paralelo.sh): gates/proceso, migraciones, auth, aprobación, storage, procesos externos o apps/control' };
  for (const [re, m] of ALTO_EXTRA) if (re.test(ruta)) return { nivel: 'alto', motivo: m };
  for (const [re, m] of MEDIO) if (re.test(ruta)) return { nivel: 'medio', motivo: m };
  for (const [re, m] of BAJO) if (re.test(ruta)) return { nivel: 'bajo', motivo: m };
  return { nivel: 'alto', motivo: 'ruta sin regla (alto por defecto si hay duda)' };
}

// Contenido: patrones en líneas AGREGADAS o QUITADAS del parche (-U0).
const SECRETO = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abprs]-[A-Za-z0-9-]{10,})/;
const SECRETS_CTX = /\$\{\{\s*secrets\.|GITHUB_TOKEN|pull_request_target|permissions\s*:/;
const PROCESO = /\b(child_process|execFile(Sync)?|execSync|spawn(Sync)?|exec)\s*\(|from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]\s*\)/;
const DDL = /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|INDEX|SCHEMA|TYPE|FUNCTION|TRIGGER|EXTENSION|ROLE|POLICY)\b|\bGRANT\b|\bREVOKE\b/i;
const SALTEO = /\.(skip|only|todo|fixme)\s*\(|\b(xit|xdescribe|xtest)\s*\(|\bretries\s*:\s*[1-9]/;
const CASO = /\b(it|test)(\.each\([^)]*\))?\s*\(|\bexpect\s*\(|\bassert[.(]/g;

function lineas(parche, signo) {
  const out = [];
  for (const l of (parche ?? '').split('\n')) {
    if (l.startsWith(signo) && !l.startsWith(signo.repeat(3))) out.push(l.slice(1));
  }
  return out;
}
const contar = (ls, re) => ls.reduce((n, l) => n + (l.match(new RegExp(re.source, 'g')) || []).length, 0);

/** Motivos de contenido que elevan un archivo a alto. */
export function motivosContenido(ruta, estado, parche, binario) {
  const out = [];
  const esDoc = DOC.test(ruta);
  if (binario && !/^docs\/.+\.(png|jpe?g|gif|webp|svg|mp4|pdf)$/.test(ruta)) out.push('binario fuera de docs (contenido no revisable en el diff)');
  if (TEST.test(ruta) && estado === 'D') out.push('borra un archivo de tests');
  const mas = lineas(parche, '+');
  const menos = lineas(parche, '-');
  if ([...mas, ...menos].some((l) => SECRETO.test(l))) out.push('parece un token o clave privada');
  if (esDoc) return out;
  if (CODIGO.test(ruta)) {
    if (mas.some((l) => SECRETS_CTX.test(l)) || menos.some((l) => SECRETS_CTX.test(l))) out.push('toca secrets, GITHUB_TOKEN, permisos o pull_request_target');
    if (mas.some((l) => PROCESO.test(l))) out.push('agrega ejecución de procesos externos');
    if (mas.some((l) => DDL.test(l)) || menos.some((l) => DDL.test(l))) out.push('DDL o permisos SQL');
  }
  if (TEST.test(ruta) && estado !== 'D') {
    if (mas.some((l) => SALTEO.test(l))) out.push('agrega skip/only/todo/fixme o retries en tests');
    const quitados = contar(menos, CASO);
    const agregados = contar(mas, CASO);
    if (quitados > agregados) out.push(`reduce casos/aserciones de test (${quitados} quitados, ${agregados} agregados)`);
  }
  return out;
}

/**
 * Clasifica un diff.
 * @param {{ruta:string, estado:string, parche?:string, binario?:boolean, scriptsCambian?:boolean}[]} archivos
 *   estado: A|M|D|T (renames ya llegan como D + A: `--no-renames`)
 * @param {RegExp} gatesRe
 * @returns {{nivel:string, detalle:{ruta:string, nivel:string, motivos:string[]}[]}}
 */
export function clasificar(archivos, gatesRe) {
  if (!Array.isArray(archivos) || archivos.length === 0) {
    return { nivel: 'alto', detalle: [{ ruta: '(ninguno)', nivel: 'alto', motivos: ['diff vacío o ilegible (alto por defecto)'] }] };
  }
  const detalle = archivos.map((a) => {
    const r = clasificarRuta(a.ruta, gatesRe);
    const motivos = [r.motivo];
    let nivel = r.nivel;
    const extra = motivosContenido(a.ruta, a.estado, a.parche, a.binario);
    if (a.scriptsCambian) extra.push('cambia el bloque "scripts" de un package.json (lo que ejecutan los gates)');
    if (extra.length) { nivel = 'alto'; motivos.push(...extra); }
    return { ruta: a.ruta, nivel, motivos };
  });
  const nivel = detalle.reduce((n, d) => maximo(n, d.nivel), 'bajo');
  return { nivel, detalle };
}

/** Nivel declarado en el cuerpo del PR: `Riesgo: bajo|medio|alto` (una sola vez). */
export function declarado(cuerpo) {
  const re = /^\s*[-*]?\s*(\*\*)?Riesgo(\*\*)?\s*:\s*(\*\*)?\s*`?(bajo|medio|alto)`?\s*(\*\*)?(\s|$|[.—(-])/gim;
  const hallados = [...(cuerpo ?? '').matchAll(re)].map((m) => m[4].toLowerCase());
  if (hallados.length === 0) return { error: 'el PR no declara `Riesgo: bajo|medio|alto`' };
  if (new Set(hallados).size > 1) return { error: `el PR declara más de un riesgo distinto (${hallados.join(', ')})` };
  return { nivel: hallados[0] };
}

/** ¿Tiene sección "Pruebas adversarias" con al menos un caso (ítem de lista o fila de tabla)? */
export function tieneAdversarias(cuerpo) {
  const ls = (cuerpo ?? '').split('\n');
  const i = ls.findIndex((l) => /^#{2,4}\s*Pruebas adversarias\b/i.test(l.trim()));
  if (i < 0) return false;
  let separador = false;
  for (let j = i + 1; j < ls.length; j++) {
    const l = ls[j].trim();
    if (/^#{1,6}\s/.test(l)) break;
    if (/^([-*]|\d+\.)\s+\S.{8,}/.test(l)) return true; // ítem de lista con contenido
    if (/^\|\s*:?-{3,}/.test(l)) { separador = true; continue; }
    if (separador && /^\|.*\S.*\|$/.test(l)) return true; // fila de tabla después del encabezado
  }
  return false;
}

/** Verifica declarado vs calculado. → { efectivo, errores[] } */
export function verificar(calculado, cuerpo) {
  const errores = [];
  const d = declarado(cuerpo);
  if (d.error) errores.push(d.error);
  const efectivo = d.nivel ? maximo(d.nivel, calculado) : calculado;
  if (d.nivel && rango(d.nivel) < rango(calculado)) {
    errores.push(`declara riesgo ${d.nivel} pero el diff calcula ${calculado}: se puede elevar a mano, nunca rebajar`);
  }
  if (efectivo === 'alto' && !tieneAdversarias(cuerpo)) {
    errores.push('riesgo alto sin sección "## Pruebas adversarias" con al menos un caso (ejes en AGENTS.md §Auditoría por riesgo)');
  }
  return { efectivo, declarado: d.nivel ?? null, errores };
}

export function informe(res) {
  const ls = [`riesgo calculado: ${res.nivel}`];
  for (const d of res.detalle) ls.push(`  ${d.nivel.padEnd(5)} ${d.ruta} — ${d.motivos.join('; ')}`);
  return ls.join('\n');
}
