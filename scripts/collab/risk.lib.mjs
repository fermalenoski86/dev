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
  [/(^|\/)(AGENTS|CLAUDE)\.md$/, 'reglas de los agentes (AGENTS.md / CLAUDE.md, a cualquier profundidad)'],
  [/^docs\/collab\/(HANDOFF|DECISIONES)\.md$/, 'transferencia de pelota o decisiones de Fer'],
  [/^docs\/ai-workflow\//, 'prompt y fundamento del auditor'],
  [/^\.gitattributes$|(^|\/)\.gitattributes$/, '.gitattributes (puede ocultar diffs o cambiar cómo se ve el contenido)'],
  [/(^|[/_.-])(hardware|dmx|art-?net|novastar|sacn|ltc|tb60|reloj)([/_.-]|$)/i, 'hardware / control físico'],
  [/^edge\//, 'edge (corre en el edificio)'],
  [/(^|\/)\.env[^/]*$/, 'archivo de entorno (.env*, también .envrc)'],
];

// MEDIO: producto y documentos que fijan criterio de auditoría.
const MEDIO = [
  [/^(apps|packages)\/[^/]+\//, 'producto (app o paquete del workspace)'],
  [/^docs\/(briefs|architecture|platform|protocols|cybersecurity|ops)\//, 'brief, ADR, contrato o doc operativo'],
  [/^docs\/collab\/(BACKLOG|PROGRESO)\.md$/, 'BACKLOG (habilita laterales) o PROGRESO (generado, con check)'],
  // la salida de gates es evidencia, no prosa: medio, el auditor la contrasta con la CI (Codex #82, P2)
  [/^docs\/reviews\/[^/]+_SALIDA\.txt$/, 'salida de gates de una fase (evidencia que el auditor contrasta con la CI)'],
];

// BAJO: solo editorial.
const BAJO = [
  [/^docs\/.+\.md$/, 'documentación'],
  [/^docs\/.+\.(png|jpe?g|gif|webp|svg)$/, 'imagen de documentación'],
  [/^[^/]+\.md$/, 'markdown de la raíz'],
];

const DOC = /^(docs\/|[^/]+\.md$)/;
const TEST = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|e2e|e2e-platform)\/|(^|\/)test_[^/]+\.py$|_test\.py$/;
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
// tokens de proveedor conocidos + formas genéricas (Codex #82, P2): Bearer, JWT, sk_live/sk_test,
// y asignación de un valor largo a un nombre de credencial (token/secret/password/api key)
const SECRETO = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abprs]-[A-Za-z0-9-]{10,}|\bsk_(live|test)_[A-Za-z0-9]{10,}|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.|\b[A-Za-z0-9_]*(token|secret|passw(or)?d|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*(["']?[^\s"'`]{16,}|["'][^"'\r\n]{16,}["']))/i; // con o sin comillas, cualquier puntuación; entre comillas también con espacios (Codex #82, P2 ×2; AUDIT: CAMBIOS @ e08a47b, P2)
const SECRETS_CTX = /\$\{\{\s*secrets\.|GITHUB_TOKEN|pull_request_target|permissions\s*:/;
const PROCESO = /\b(child_process|execFile(Sync)?|execSync|spawn(Sync)?|exec)\s*\(|from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]\s*\)|\b(shell|detached|argv0|uid|gid)\s*:\s*\S/;
// opciones de un spawn/execFile multilínea (`shell: true`) cambian el borde sin tocar la línea de la llamada (Codex #82, P2)
const DDL = /\b(CREATE|ALTER|DROP|TRUNCATE)\s+(OR\s+REPLACE\s+)?(TEMP(ORARY)?\s+|UNIQUE\s+|MATERIALIZED\s+)?(TABLE|INDEX|SCHEMA|TYPE|FUNCTION|PROCEDURE|TRIGGER|EXTENSION|ROLE|USER|POLICY|VIEW|SEQUENCE|DATABASE|DOMAIN|RULE|AGGREGATE|COLLATION|CONVERSION|OPERATOR|SERVER|PUBLICATION|SUBSCRIPTION|TABLESPACE)\b|\bGRANT\b|\bREVOKE\b/i;
// cualquier objeto: CREATE/ALTER/DROP <OBJETO> en mayúsculas, como se escribe SQL (VIEW, SEQUENCE, DATABASE…; Codex #82, P2)
const DDL_GENERICO = /\b(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+|IF\s+(NOT\s+)?EXISTS\s+|TEMP(ORARY)?\s+|UNIQUE\s+|MATERIALIZED\s+)*[A-Z]{3,}\b/;
// también acceso por corchetes (`test['skip'](`, Codex #82, P2) y la clave `"retries"` entre comillas
// (Codex #82, P2 sobre 6c96f82); una cadena partida en dos líneas
// cae igual: con -U0 la línea `  .skip(` también matchea
const SALTEO = /\.(skip|only|todo|fixme)\s*\(|\[\s*['"`](skip|only|todo|fixme)['"`]\s*\]|\b(xit|xdescribe|xtest)\s*\(|\bretries['"`]?\s*:\s*[1-9]/;
// sin punto ni letra antes: `re.test(` o `x.expect(` no cuentan como caso
const CASO = /(?<![.\w$])(it|test)(\.each\([^)]*\))?\s*\(|(?<![.\w$])expect\s*\(|(?<![.\w$])assert[.(]/g;
// matchers: una aserción multilínea pierde solo su `.toX(...)` y `expect(v);` queda sin afirmar nada (Codex #82, P2)
const MATCHER = /\.(not\.)?(to[A-Z]\w*|rejects|resolves)\b|\.to\.(be|equal|eql|have|include|throw|deep)\b/g;

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
    // agregadas Y quitadas: reemplazar `execFile(...)` por un helper indirecto también cambia el borde (Codex #82, P2)
    if ([...mas, ...menos].some((l) => PROCESO.test(l))) out.push('agrega, quita o cambia ejecución de procesos externos');
    if ([...mas, ...menos].some((l) => DDL.test(l) || DDL_GENERICO.test(l))) out.push('DDL o permisos SQL');
  }
  // AUDIT: CAMBIOS sobre c424b9c (P1): contar tokens no detecta un test que deja de
  // registrarse conservándolos (`false && it(...)`, un `if`, un wrapper). Sin análisis
  // estructural fiable, MODIFICAR un archivo de tests existente es alto por defecto; los
  // conteos de abajo quedan solo como detalle del motivo. Un archivo de tests NUEVO (A)
  // sigue medio salvo que traiga skip/only/todo/fixme o retries.
  if (TEST.test(ruta) && estado !== 'D' && estado !== 'A') out.push('modifica un archivo de tests existente (alto por defecto: sin análisis estructural, una desactivación puede conservar los tokens)');
  if (TEST.test(ruta) && estado !== 'D') {
    if (mas.some((l) => SALTEO.test(l))) out.push('agrega skip/only/todo/fixme o retries en tests');
    const quitados = contar(menos, CASO);
    const agregados = contar(mas, CASO);
    if (quitados > agregados) out.push(`reduce casos/aserciones de test (${quitados} quitados, ${agregados} agregados)`);
    const mq = contar(menos, MATCHER);
    const ma = contar(mas, MATCHER);
    if (mq > ma) out.push(`reduce matchers de aserción (${mq} quitados, ${ma} agregados)`);
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
    if (a.modoEspecial) extra.push('symlink o submódulo (el contenido real no está en el diff)');
    if (a.scriptsCambian) extra.push('cambia el bloque "scripts" de un package.json (lo que ejecutan los gates)');
    if (extra.length) { nivel = 'alto'; motivos.push(...extra); }
    return { ruta: a.ruta, nivel, motivos };
  });
  const nivel = detalle.reduce((n, d) => maximo(n, d.nivel), 'bajo');
  return { nivel, detalle };
}

/**
 * Texto que GitHub renderiza: saca comentarios HTML (`<!-- … -->`) y bloques de
 * código cercados (``` / ~~~). Sin cierre, la región sigue hasta el final (como
 * en CommonMark): ante la duda se descarta, nunca se cuenta (Codex #82, P2).
 */
export function visible(cuerpo) {
  const sinComentarios = (cuerpo ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  const out = [];
  let cerca = null;
  for (const l of sinComentarios.split('\n')) {
    if (cerca) {
      const c = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(l); // cierre: mismo carácter, igual o más largo, sin info
      if (c && c[1][0] === cerca[0] && c[1].length >= cerca.length) cerca = null;
      continue;
    }
    const a = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (a) { cerca = a[1]; continue; }
    out.push(l);
  }
  return out.join('\n');
}

/** Nivel declarado en el cuerpo del PR: `Riesgo: bajo|medio|alto` (una sola vez). */
export function declarado(cuerpo) {
  cuerpo = visible(cuerpo);
  const re = /^\s*[-*]?\s*(\*\*)?Riesgo(\*\*)?\s*:\s*(\*\*)?\s*`?(bajo|medio|alto)`?\s*(\*\*)?(\s|$|[.—(-])/gim;
  const ms = [...(cuerpo ?? '').matchAll(re)];
  const hallados = ms.map((m) => m[4].toLowerCase());
  // plantilla sin elegir (`Riesgo: bajo | medio | alto`): la línea nombra más de un nivel (Codex #82, P2)
  for (const m of ms) {
    const linea = (cuerpo.slice(m.index).split('\n')[0] ?? '').toLowerCase();
    const niveles = new Set(linea.match(/\b(bajo|medio|alto)\b/g) ?? []);
    if (niveles.size > 1) return { error: `la línea de riesgo nombra más de un nivel (${[...niveles].join(', ')}): elegí uno` };
  }
  if (hallados.length === 0) return { error: 'el PR no declara `Riesgo: bajo|medio|alto`' };
  // exactamente UNA línea: dos iguales (plantilla duplicada) tampoco valen (Codex #82, P2)
  if (hallados.length > 1) return { error: `el PR declara riesgo más de una vez (${hallados.join(', ')}); tiene que haber una sola línea` };
  return { nivel: hallados[0] };
}

/** ¿Tiene sección "Pruebas adversarias" con al menos un caso (ítem de lista o fila de tabla)? */
export function tieneAdversarias(cuerpo) {
  const ls = visible(cuerpo).split('\n');
  const i = ls.findIndex((l) => /^#{2,4}\s*Pruebas adversarias\b/i.test(l.trim()));
  if (i < 0) return false;
  let separador = false;
  for (let j = i + 1; j < ls.length; j++) {
    const l = ls[j].trim();
    if (/^#{1,6}\s/.test(l)) break;
    if (/^([-*]|\d+\.)\s+\S.{8,}/.test(l)) return true; // ítem de lista con contenido
    if (/^\|\s*:?-{3,}/.test(l)) { separador = true; continue; }
    // fila de tabla después del encabezado con al menos una celda no vacía (`| | |` no cuenta; Codex #82, P2)
    if (separador && /^\|.*\|$/.test(l) && l.slice(1, -1).split('|').some((c) => c.trim() !== '')) return true;
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
