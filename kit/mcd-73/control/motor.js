// TRUST Control — motor de la simulación (sin DOM, determinista).
// SIMULACIÓN CONCEPTUAL — NO CONECTADA A EQUIPOS REALES. Este archivo no abre red ni emite DMX/Art-Net/sACN.
// Capa de control/visualización del kit #73: no importa ni modifica packages/ (ShowEngine, M2C.2, M3A).
//
// Subsistemas independientes (cada uno con su propio estado; ninguno lee ni escribe el de otro):
//   pantallas: master + Corrientes + Pellegrini + media          (0–100)  ← SCREEN DIMMER
//   luces:     master + ZONAS + 46 equipos RGBW                   (0–100)  ← ARCHITECTURAL LIGHTING DIMMER (nunca un master común)
//   reloj:     nivel propio (CLOCK ACCENT · próxima fase, no instalado)
// Vista Día/Noche: SOLO representación. No toca ningún nivel.
//
// ZONAS (visual polish, 14/10): las 46 siguen direccionables, pero se operan como zonas arquitectónicas:
//   superior 16 · medio 16 · inferior 14  (las filas reales del plano de Fer)
//   ochava  (13 equipos de las 3 filas que miran la esquina curva; su dimmer y su RGBW mandan sobre los de la fila)
//   cúpula  (baño de la cúpula, antes atado al reloj) · cornisas (PROPUESTA: equipos adicionales, fuera de las 46)
//
// Salida de una luminaria = base(t) × individual × fila × ochava(si pertenece) × master × ON × (sin blackout)
//   - "base" = preset activo (con transición suave) o el show de 15 s. Los ajustes son TRIMS que se multiplican:
//     cargar un preset o el show NO los borra. «Volver a escena» quita los overrides; «Restaurar niveles» deja todo en 100.
//   - Color: equipo propio > zona (ochava > fila) > escena.
//   - El master escala la intensidad: NUNCA cambia la mezcla RGBW relativa.
(function () {
  'use strict';
  const DUR = 15;
  const GRUPOS = [
    { id: 'superior', nombre: 'Nivel superior', n: 16, pref: 'SUP' },
    { id: 'medio', nombre: 'Nivel medio', n: 16, pref: 'MED' },
    { id: 'inferior', nombre: 'Nivel inferior', n: 14, pref: 'INF' },
  ];
  const PANTALLAS = ['corrientes', 'pellegrini', 'media'];
  const ZONAS = [
    { id: 'superior', nombre: 'Fachada superior', fila: true },
    { id: 'medio', nombre: 'Fachada media', fila: true },
    { id: 'inferior', nombre: 'Fachada inferior', fila: true },
    { id: 'cupula', nombre: 'Cúpula' },
    { id: 'cornisas', nombre: 'Cornisas', propuesta: true },
    { id: 'ochava', nombre: 'Esquina / ochava' },
  ];
  // Ochava: los equipos frente a la esquina curva (posiciones del plano de Fer; inferior por simetría, fuera de cuadro).
  const OCHAVA = ['SUP-07', 'SUP-08', 'SUP-09', 'SUP-10', 'SUP-11', 'MED-09', 'MED-10', 'MED-11', 'MED-12', 'INF-07', 'INF-08', 'INF-09', 'INF-10'];
  const enOchava = new Set(OCHAVA);
  const TRANSICIONES = [0.5, 1, 2, 3, 5];
  const CREATIVIDADES = ['A', 'B', 'C', 'D', 'E', 'F', 'P'];   // P = la idea del prompt (paleta, texto y producto pedidos)
  // Apertura visual del haz (°), configurable por luminaria. Valor de SIMULACIÓN: la real depende de la óptica del equipo.
  const APERTURA = { superior: 40, medio: 50, inferior: 50 };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const suave = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  const mezclaRGBW = (a, b, k) => ({ r: lerp(a.r, b.r, k), g: lerp(a.g, b.g, k), b: lerp(a.b, b.b, k), w: lerp(a.w, b.w, k) });
  const mezclar = (a, b, k) => ({ nivel: lerp(a.nivel, b.nivel, k), rgbw: mezclaRGBW(a.rgbw, b.rgbw, k) });
  const rgbwOk = (q) => ({ r: clamp(+q.r, 0, 1), g: clamp(+q.g, 0, 1), b: clamp(+q.b, 0, 1), w: clamp(+q.w, 0, 1) });

  // Colores (canales RGBW 0..1) de PREVISUALIZACIÓN, no un patch DMX.
  // Regla comercial (brief 14/10): nunca R, G y B juntos; siempre 2 canales + W. Los puros quedan para diagnóstico.
  const C = {
    calido: { r: 0.30, g: 0.07, b: 0.00, w: 0.78 },    // blanco cálido: W dominante + R leve + G mínimo (≈3000–3200 K visual)
    blancoArq: { r: 0.00, g: 0.00, b: 0.02, w: 0.95 },  // blanco arquitectónico: el W del equipo, limpio
    ambar: { r: 1.00, g: 0.40, b: 0.00, w: 0.18 },
    rojo: { r: 1.00, g: 0.03, b: 0.00, w: 0.10 },       // rojo McDonald's: R alto, W bajo, G/B mínimos
    oro: { r: 1.00, g: 0.55, b: 0.00, w: 0.35 },        // oro: R alto, G medio, W moderado
    neutro: { r: 0.00, g: 0.00, b: 0.00, w: 0.85 },
    azul: { r: 0.00, g: 0.25, b: 1.00, w: 0.00 },       // solo diagnóstico
    verde: { r: 0.00, g: 1.00, b: 0.15, w: 0.00 },      // solo diagnóstico
    magenta: { r: 1.00, g: 0.00, b: 0.75, w: 0.00 },    // solo diagnóstico
  };
  const L_ = (nivel, rgbw) => ({ nivel, rgbw });

  // Presets. f(grupo, i, n, id) → { nivel 0..1, rgbw }; zonas = cúpula y cornisas; reloj; contenido de pantallas.
  // Intensidades VISUALES de referencia (brief 14/10), no potencias DMX calibradas.
  const sector = (patron, g, i) => patron[(Math.floor(i / 2) + (g === 'medio' ? 1 : g === 'inferior' ? 2 : 0)) % patron.length];
  const PAT_MCD = [L_(0.70, C.rojo), L_(0.40, C.oro), L_(0.22, C.calido), L_(0.70, C.rojo), L_(0.40, C.oro), L_(0.22, C.calido), L_(0.40, C.oro)];
  const PAT_FIRMA = [L_(0.50, C.oro), L_(0.45, C.calido), L_(0.30, C.rojo), L_(0.45, C.calido), L_(0.50, C.oro), L_(0.45, C.calido)];
  const DIAG = { 'SUP-04': C.azul, 'SUP-11': C.verde, 'MED-08': C.magenta };
  const calida = (base, och) => (g, i, n, id) => L_(enOchava.has(id) ? och : base, C.calido);
  const ESCENAS = {
    arquitectonica: { clave: 'ARCHITECTURAL_WARM', nombre: 'Arquitectónica cálida', comercial: true, f: calida(0.40, 0.46),
      zonas: { cupula: L_(0.5, C.calido), cornisas: L_(0.35, C.calido) }, reloj: L_(0.85, C.neutro), pantallas: 'reposo' },
    nocheIdle: { clave: 'NIGHT_IDLE', nombre: 'Noche sin campaña', comercial: true, f: calida(0.37, 0.42),
      zonas: { cupula: L_(0.45, C.calido), cornisas: L_(0.32, C.calido) }, reloj: L_(0.9, C.calido), pantallas: 'institucional' },
    mcd: { clave: 'MCD_TAKEOVER', nombre: "McDonald's takeover", comercial: true, f: (g, i) => sector(PAT_MCD, g, i),
      zonas: { cupula: L_(0.4, C.oro), cornisas: L_(0.22, C.calido) }, reloj: L_(1, C.oro), pantallas: 'marca' },
    firma: { clave: 'MCD_SIGNATURE', nombre: "McDonald's cierre", comercial: true, f: (g, i) => sector(PAT_FIRMA, g, i),
      zonas: { cupula: L_(0.55, C.oro), cornisas: L_(0.4, C.calido) }, reloj: L_(1, C.oro), pantallas: 'firma' },
    blanco: { clave: 'ARCH_WHITE', nombre: 'Blanco arquitectónico', comercial: true, f: () => L_(0.42, C.blancoArq),
      zonas: { cupula: L_(0.45, C.blancoArq), cornisas: L_(0.32, C.blancoArq) }, reloj: L_(0.85, C.neutro), pantallas: 'reposo' },
    diagnostico: { clave: 'RGB_DIAGNOSTIC', nombre: 'Prueba de colores', diagnostico: true, f: (g, i, n, id) => L_(0.45, DIAG[id] || C.blancoArq),
      zonas: { cupula: L_(0.3, C.neutro), cornisas: L_(0.25, C.neutro) }, reloj: L_(0.85, C.neutro), pantallas: 'diagnostico' },
    // RGBW libre (técnico): base W neutra; cada luminaria, zona o nivel toma el color que elija el operador.
    libre: { clave: 'RGBW_FREE', nombre: 'RGBW libre (técnico)', diagnostico: true, f: () => L_(0.45, C.blancoArq),
      zonas: { cupula: L_(0.3, C.neutro), cornisas: L_(0.25, C.neutro) }, reloj: L_(0.85, C.neutro), pantallas: 'reposo' },
    apagado: { clave: 'ALL_OFF', nombre: 'Iluminación apagada', comercial: true, f: () => L_(0, C.calido),
      zonas: { cupula: L_(0, C.calido), cornisas: L_(0, C.calido) }, reloj: L_(0.85, C.neutro), pantallas: 'reposo' },
    cierre: { clave: 'CLOSE', nombre: 'Cierre', comercial: true, f: () => L_(0.3, C.calido),
      zonas: { cupula: L_(0.35, C.calido), cornisas: L_(0.25, C.calido) }, reloj: L_(0.7, C.neutro), pantallas: 'reposo' },
  };

  // Show "McDonald's Takeover 15 s" — PLANTILLA PREPROGRAMADA (no es generación por IA).
  // NORMAL → BRAND REVEAL → FULL TAKEOVER → SIGNATURE → EXIT, con fundidos de 1 s entre momentos (sin saltos).
  const BLOQUES = [
    { desde: 0, hasta: 2, id: 'normal', nombre: 'Normal' },
    { desde: 2, hasta: 5, id: 'revelacion', nombre: 'Entrada de marca' },
    { desde: 5, hasta: 10, id: 'takeover', nombre: 'Takeover' },
    { desde: 10, hasta: 13, id: 'firma', nombre: 'Cierre de marca' },
    { desde: 13, hasta: 15, id: 'salida', nombre: 'Salida' },
  ];
  // Jerarquía: con las pantallas a máxima presencia la arquitectura baja un poco (soporte, no competencia).
  const presencia = (t) => suave((t - 4.5) / 1) * (1 - suave((t - 10) / 1));
  const JERARQUIA = 0.08;
  const desfaseDe = (g) => (g === 'medio' ? 1 : g === 'inferior' ? 2 : 0);
  // Cada momento es una función continua en t; el show los encadena con fundidos (ventana de 1 s centrada en el corte).
  const MOMENTOS = [
    { desde: 0, luz: (g, i, n, id) => L_(enOchava.has(id) ? 0.42 : 0.38, C.calido) },
    { desde: 2, luz: (g, i, n, id, t) => {      // la cálida baja a 25 %; el rojo sube y avanza Corrientes → Pellegrini
      const x = n > 1 ? i / (n - 1) : 0, frente = (t - 2) / 2.4, k = suave((frente - x + 0.05) / 0.25);
      const base = L_(enOchava.has(id) ? 0.34 : 0.25, C.calido);   // la ochava conserva volumen en blanco cálido
      return (i + desfaseDe(g)) % 2 === 0 ? mezclar(base, L_(0.55, OPC.estilo === 'custom' && PALETA_TAKEOVER.custom ? PALETA_TAKEOVER.custom[0].rgbw : C.rojo), k) : base;
    } },
    { desde: 5, luz: (g, i, n, id, t) => {      // persecución lenta de sectores de 3: rojo · oro · cálido (brief: 65–75 · 35–45 · 15–25 %)
      if (OPC.efecto && OPC.efecto !== 'persecucion' && EFECTOS[OPC.efecto]) return EFECTOS[OPC.efecto].f(g, i, n, id, (t - 5) * OPC.velocidad);
      const p = (t - 5) * OPC.velocidad / 1.25, paso = Math.floor(p), k = suave((p - paso) / 0.4), b = Math.floor(i / 3) + desfaseDe(g);
      const est = (s) => PALETA_TAKEOVER[OPC.estilo][((b + s) % 3 + 3) % 3];   // con jerarquía −8 %: 66 · 39 · 20 %
      return mezclar(est(paso - 1), est(paso), k);
    } },
    { desde: 10, luz: (g, i) => PALETA_FIRMA[OPC.estilo][Math.floor(i / 3) % 3] },
    { desde: 13, luz: (g, i, n, id) => ESCENAS.arquitectonica.f(g, i, n, id) },
  ];
  const ZONAS_MOMENTO = [
    { cupula: L_(0.5, C.calido), cornisas: L_(0.35, C.calido) },
    { cupula: L_(0.45, C.calido), cornisas: L_(0.3, C.calido) },
    { cupula: L_(0.45, C.oro), cornisas: L_(0.22, C.calido) },
    { cupula: L_(0.6, C.oro), cornisas: L_(0.4, C.oro) },
    { cupula: L_(0.5, C.calido), cornisas: L_(0.35, C.calido) },
  ];
  function encadenar(t, valor) {   // valor(k) → {nivel, rgbw} del momento k; fundido suave en cada corte
    let v = valor(0);
    for (let k = 1; k < MOMENTOS.length; k++) {
      const a = suave((t - MOMENTOS[k].desde + 0.5) / 1);
      if (a <= 0) break;
      v = a >= 1 ? valor(k) : mezclar(v, valor(k), a);
    }
    return v;
  }
  // Estilo del show (lo elige el prompt o el operador): rojo (default) · dorado · cálido (sobrio). Intensidad 0,85–1,15.
  const PALETA_TAKEOVER = {
    rojo: [L_(0.72, C.rojo), L_(0.42, C.oro), L_(0.22, C.calido)],
    dorado: [L_(0.62, C.oro), L_(0.66, C.rojo), L_(0.24, C.calido)],
    calido: [L_(0.50, C.calido), L_(0.42, C.oro), L_(0.55, C.rojo)],
  };
  const PALETA_FIRMA = {
    rojo: [L_(0.50, C.oro), L_(0.45, C.calido), L_(0.30, C.rojo)],
    dorado: [L_(0.58, C.oro), L_(0.45, C.calido), L_(0.40, C.oro)],
    calido: [L_(0.48, C.calido), L_(0.42, C.oro), L_(0.48, C.calido)],
  };
  // Paleta pedida en el prompt → RGBW de previsualización con la regla comercial (2 canales + W, nunca R, G y B juntos).
  function hexARGBW(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b) || 1;
    const q = { r: (r - mn) / mx, g: (g - mn) / mx, b: (b - mn) / mx };
    const menor = ['r', 'g', 'b'].sort((x, y) => q[x] - q[y])[0]; q[menor] = 0;
    const blanco = mn / mx;   // pastel / blanco → W
    return rgbwOk({ r: q.r, g: q.g, b: q.b, w: Math.min(0.95, 0.08 + blanco * 0.9) });
  }
  function paletaPersonal(hexes) {
    const cols = (hexes && hexes.length ? hexes : ['#DA291C', '#FFC72C']).map(hexARGBW);
    const a = cols[0], b = cols[1] || C.calido, c2 = cols[2] || C.calido;
    PALETA_TAKEOVER.custom = [L_(0.70, a), L_(0.45, b), L_(0.25, c2)];
    PALETA_FIRMA.custom = [L_(0.52, b), L_(0.45, C.calido), L_(0.35, a)];
  }
  // OPC: lo que pide la FICHA del show (ver app.js · validarFicha). efecto del takeover, velocidad, zonas que participan,
  // y si participan las luces y/o las pantallas. Sin ficha = la plantilla de siempre.
  const OPC = { estilo: 'rojo', intensidad: 1, efecto: null, velocidad: 1, zonas: null, luces: true, pantallas: true };
  // Biblioteca de efectos para las 46 luminarias (momento takeover, 5–10 s). f(grupo, i, n, id, τ) con τ = segundos × velocidad.
  // x = posición a lo largo de la fachada (0 Corrientes → 1 Pellegrini); fila 0 inferior · 1 medio · 2 superior.
  // Colores: los 3 de la paleta activa (la pedida o la de marca). Respetan la regla 2 canales + W porque vienen de la paleta.
  const fila = (g) => (g === 'inferior' ? 0 : g === 'medio' ? 1 : 2);
  const posX = (i, n) => (n > 1 ? i / (n - 1) : 0.5);
  const pal = () => (PALETA_TAKEOVER[OPC.estilo] || PALETA_TAKEOVER.rojo).map((x) => x.rgbw);
  const fr = (v) => v - Math.floor(v);
  const azar = (id, k) => { let h = 2166136261; for (const ch of id + ':' + k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
  const EFECTOS = {
    persecucion: { nombre: 'persecución', txt: 'sectores de 3 que avanzan con los 3 colores', f: null },
    barrido: { nombre: 'barrido', txt: 'una franja de luz recorre la fachada de Corrientes a Pellegrini', f: (g, i, n, id, u) => {
      const [a, b] = pal(), frente = fr(u / 2.2) * 1.4 - 0.2, d = posX(i, n) - frente, k = Math.exp(-(d * d) / 0.012);
      return L_(0.22 + 0.68 * k, mezclaRGBW(b, a, k));
    } },
    ola: { nombre: 'ola', txt: 'ondas de color que suben de la planta baja al coronamiento', f: (g, i, n, id, u) => {
      const [a, b] = pal(), s = 0.5 + 0.5 * Math.sin(u * 2.6 - fila(g) * 1.1 - posX(i, n) * 2.2);
      return L_(0.25 + 0.6 * s, mezclaRGBW(b, a, s));
    } },
    latido: { nombre: 'latido', txt: 'toda la fachada late en doble pulso, como un corazón', f: (g, i, n, id, u) => {
      const [a, b] = pal(), p = fr(u / 0.9), env = Math.exp(-p * 9) + (p > 0.2 ? 0.65 * Math.exp(-(p - 0.2) * 9) : 0);
      return L_(0.2 + 0.72 * Math.min(1, env), enOchava.has(id) ? b : a);
    } },
    destello: { nombre: 'destellos', txt: 'luminarias sueltas destellan sobre una base suave', f: (g, i, n, id, u) => {
      const [a, b] = pal(), paso = Math.floor(u * 5), k = azar(id, paso) > 0.72 ? Math.exp(-fr(u * 5) * 3.2) : 0;
      return L_(0.24 + 0.7 * k, mezclaRGBW(b, a, k));
    } },
    degrade: { nombre: 'degradé', txt: 'los colores se funden a lo largo de la fachada y se desplazan lento', f: (g, i, n, id, u) => {
      const [a, b, c2] = pal(), x = fr(posX(i, n) * 0.9 + fila(g) * 0.08 + u * 0.12) * 2;
      return L_(0.6, x < 1 ? mezclaRGBW(a, b, suave(x)) : mezclaRGBW(b, OPC.estilo === 'custom' ? c2 : a, suave(x - 1)));
    } },
    tramos: { nombre: 'tramos de color', txt: 'la fachada pasa por cada color de la paleta, un tramo por protagonista', f: (g, i, n, id, u) => {
      u = Math.max(0, u);   // el fundido de entrada evalúa el efecto desde t = 4,5 s (u negativo)
      const p = pal(), dur = 5 * OPC.velocidad / p.length, k = Math.max(0, Math.min(p.length - 1, Math.floor(u / dur))), f = u - k * dur;   // u = (t−5)·vel
      const ola = suave((f * 2.2) - (1 - posX(i, n)) * 0.5), prev = p[Math.max(0, k - 1)];
      return L_(0.66, k === 0 ? p[0] : mezclaRGBW(prev, p[k], ola));
    } },
    respiracion: { nombre: 'respiración', txt: 'la fachada sube y baja lento, en un solo color', f: (g, i, n, id, u) => {
      const [a] = pal(), s = 0.5 - 0.5 * Math.cos(u * 1.5);
      return L_(0.28 + 0.4 * s, a);
    } },
  };
  // ¿la luminaria participa? (zonas pedidas: superior · medio · inferior · ochava)
  function participa(g, id) {
    if (!OPC.luces) return false;
    const z = OPC.zonas; if (!z || !z.length) return true;
    return z.includes(g) || (z.includes('ochava') && enOchava.has(id));
  }
  function showLuz(g, i, n, id, t) {
    let v = encadenar(t, (k) => MOMENTOS[k].luz(g, i, n, id, t));
    if (!participa(g, id)) {   // fuera de las zonas pedidas: queda en la cálida de base (se funde al entrar y al salir)
      const fuera = suave((t - 1.5) / 1) * (1 - suave((t - 13) / 1));
      v = mezclar(v, L_(enOchava.has(id) ? 0.36 : 0.32, C.calido), fuera);
    }
    return L_(Math.min(1, v.nivel * (1 - JERARQUIA * presencia(t)) * (t >= 2 && t < 13 ? OPC.intensidad : 1)), v.rgbw);
  }
  function showZona(z, t) {
    let v = encadenar(t, (k) => ZONAS_MOMENTO[k][z]);
    const cupulaPedida = z === 'cupula' && OPC.zonas && OPC.zonas.includes('cupula');
    if (z === 'cupula' && (cupulaPedida || OPC.estilo === 'custom') && OPC.luces) {   // la cúpula toma el color pedido en el takeover
      const k = suave((t - 4.5) / 1) * (1 - suave((t - 12.5) / 1)), puls = cupulaPedida ? 0.12 * Math.sin((t - 5) * OPC.velocidad * 3) : 0;
      v = mezclar(v, L_(0.62 + puls, pal()[0]), k);
    } else if (!OPC.luces) v = L_(0.5, C.calido);
    return L_(v.nivel * (1 - JERARQUIA * presencia(t)), v.rgbw);
  }
  function showReloj(t) {   // CLOCK ACCENT (próxima fase): realce dorado durante takeover y firma
    if (t < 5) return L_(0.85, C.neutro);
    if (t < 13) return L_(1, mezclaRGBW(C.neutro, C.oro, suave((t - 5) / 1)));
    return L_(0.85, mezclaRGBW(C.oro, C.neutro, suave((t - 13) / 1.5)));
  }
  function showPantalla() { return 1; }   // el contenido maneja sus propios fundidos

  function nuevoEstado() {
    const fixtures = [];
    for (const g of GRUPOS) for (let i = 0; i < g.n; i++) {
      fixtures.push({ id: `${g.pref}-${String(i + 1).padStart(2, '0')}`, grupo: g.id, i, n: g.n, on: true, nivel: 100, color: null, apertura: APERTURA[g.id] });
    }
    return {
      vista: 'noche',
      pantallas: { master: 100, corrientes: 100, pellegrini: 100, media: 100 },
      luces: { master: 100, grupos: { superior: 100, medio: 100, inferior: 100 }, zonas: { ochava: 100, cupula: 100, cornisas: 100 },
        zonaColor: { superior: null, medio: null, inferior: null, ochava: null, cupula: null, cornisas: null }, fixtures },
      reloj: { nivel: 100 },
      blackout: false,
      escena: 'arquitectonica',
      transicion: 2,           // s (default comercial)
      fundido: null,           // transición en curso entre presets: { t, dur, desde }
      creatividad: 'C',        // A marca · B producto · C recorrido · D papas · E desayuno · F lanzamiento
      showEstilo: 'rojo', showIntensidad: 1,
      show: { cargado: false, t: 0, reproduciendo: false },
    };
  }

  let S = nuevoEstado();
  const oyentes = new Set();
  const avisar = () => { oyentes.forEach((f) => f(S)); return S; };
  const fx = (id) => { const f = S.luces.fixtures.find((x) => x.id === id); if (!f) throw new Error('luminaria inexistente: ' + id); return f; };
  const pct = (v) => clamp(Math.round(Number(v)), 0, 100);

  function bloque(t) { return BLOQUES.find((b) => t < b.hasta) || BLOQUES[BLOQUES.length - 1]; }

  // ---------- base (preset / show / fundido) ----------
  function objetivoLuz(f) { return S.show.cargado ? showLuz(f.grupo, f.i, f.n, f.id, S.show.t) : ESCENAS[S.escena].f(f.grupo, f.i, f.n, f.id); }
  function objetivoZona(z) { return S.show.cargado ? showZona(z, S.show.t) : ESCENAS[S.escena].zonas[z]; }
  function objetivoReloj() { return S.show.cargado ? showReloj(S.show.t) : ESCENAS[S.escena].reloj; }
  const kFundido = () => suave(S.fundido.t / S.fundido.dur);
  function baseLuz(f, idx) { const o = objetivoLuz(f); return S.fundido ? mezclar(S.fundido.desde.luces[idx], o, kFundido()) : o; }
  function baseZona(z) { const o = objetivoZona(z); return S.fundido ? mezclar(S.fundido.desde.zonas[z], o, kFundido()) : o; }
  function baseReloj() { const o = objetivoReloj(); return S.fundido ? mezclar(S.fundido.desde.reloj, o, kFundido()) : o; }
  const fotoBase = () => ({ luces: S.luces.fixtures.map(baseLuz), zonas: { cupula: baseZona('cupula'), cornisas: baseZona('cornisas') }, reloj: baseReloj() });

  // ---------- salidas (lo que se ve) ----------
  function salidaLuz(f, idx) {
    const b = baseLuz(f, idx), och = enOchava.has(f.id);
    const zona = (och ? S.luces.zonas.ochava / 100 : 1) * (S.luces.grupos[f.grupo] / 100);
    const k = S.blackout || !f.on ? 0 : b.nivel * (f.nivel / 100) * zona * (S.luces.master / 100);
    const zc = (och && S.luces.zonaColor.ochava) || S.luces.zonaColor[f.grupo];
    return { id: f.id, grupo: f.grupo, nivel: k, rgbw: f.color || zc || b.rgbw, apertura: f.apertura, ochava: och };
  }
  function salidaZona(z) {
    const b = baseZona(z);
    return { nivel: S.blackout ? 0 : b.nivel * (S.luces.zonas[z] / 100) * (S.luces.master / 100), rgbw: S.luces.zonaColor[z] || b.rgbw };
  }
  function salidaPantalla(id) {
    const base = S.show.cargado ? showPantalla(id, S.show.t) : 1;
    return S.blackout ? 0 : base * (S.pantallas[id] / 100) * (S.pantallas.master / 100);
  }
  function salidaReloj() { const b = baseReloj(); return { nivel: S.blackout ? 0 : b.nivel * (S.reloj.nivel / 100), rgbw: b.rgbw }; }
  function contenido() {
    if (S.show.cargado && !OPC.pantallas) return { modo: 'institucional', t: 0, bloque: bloque(S.show.t).id, creatividad: S.creatividad };   // «solo luces»
    if (S.show.cargado) return { modo: 'show', t: S.show.t, bloque: bloque(S.show.t).id, creatividad: S.creatividad };
    return { modo: ESCENAS[S.escena].pantallas, t: 0, bloque: null, creatividad: S.creatividad };
  }
  function salidas() {
    return {
      luces: S.luces.fixtures.map(salidaLuz),
      zonas: { cupula: salidaZona('cupula'), cornisas: salidaZona('cornisas') },
      pantallas: Object.fromEntries(PANTALLAS.map((p) => [p, salidaPantalla(p)])),
      reloj: salidaReloj(),
      contenido: contenido(),
      diagnostico: !S.show.cargado && !!ESCENAS[S.escena].diagnostico,
    };
  }
  function iniciarFundido() { S.fundido = S.transicion > 0 ? { t: 0, dur: S.transicion, desde: fotoBase() } : null; }

  // ---------- acciones ----------
  const api = {
    hexARGBW,   // para mostrar cómo se arma cada color con los canales del equipo
    EFECTOS: Object.fromEntries(Object.entries(EFECTOS).map(([k, v]) => [k, { nombre: v.nombre, txt: v.txt }])),
    DUR, GRUPOS, PANTALLAS, ESCENAS, BLOQUES, APERTURA, ZONAS, OCHAVA, TRANSICIONES, CREATIVIDADES, COLORES: C,
    estado: () => JSON.parse(JSON.stringify(S)),
    salidas,
    bloque,
    suscribir(f) { oyentes.add(f); return () => oyentes.delete(f); },
    setVista(v) { if (v !== 'dia' && v !== 'noche') throw new Error('vista'); S.vista = v; return avisar(); },
    setPantalla(id, v) { if (!(id in S.pantallas)) throw new Error('pantalla ' + id); S.pantallas[id] = pct(v); return avisar(); },
    setLucesMaster(v) { S.luces.master = pct(v); return avisar(); },
    setGrupo(g, v) { if (!(g in S.luces.grupos)) throw new Error('grupo ' + g); S.luces.grupos[g] = pct(v); return avisar(); },
    setZona(z, v) { if (z in S.luces.grupos) return api.setGrupo(z, v); if (!(z in S.luces.zonas)) throw new Error('zona ' + z); S.luces.zonas[z] = pct(v); return avisar(); },
    setZonaColor(z, rgbw) { if (!(z in S.luces.zonaColor)) throw new Error('zona ' + z); S.luces.zonaColor[z] = rgbw ? rgbwOk(rgbw) : null; return avisar(); },
    setFixture(id, v) { fx(id).nivel = pct(v); return avisar(); },
    setFixtureOn(id, on) { fx(id).on = !!on; return avisar(); },
    setFixtureColor(id, rgbw) { fx(id).color = rgbw ? rgbwOk(rgbw) : null; return avisar(); },
    setColorGrupo(g, rgbw) {   // aplica (o quita, con null) un color propio a todo un nivel; no toca niveles ni ON/OFF
      if (g !== 'todas' && !(g in S.luces.grupos)) throw new Error('grupo ' + g);
      for (const f of S.luces.fixtures) if (g === 'todas' || f.grupo === g) f.color = rgbw ? rgbwOk(rgbw) : null;
      return avisar();
    },
    setFixtureApertura(id, grados) { fx(id).apertura = clamp(Math.round(+grados), 10, 90); return avisar(); },
    setReloj(v) { S.reloj.nivel = pct(v); return avisar(); },
    setBlackout(b) { S.blackout = !!b; return avisar(); },
    setTransicion(s) { s = +s; if (s !== 0 && !TRANSICIONES.includes(s)) throw new Error('transición ' + s); S.transicion = s; if (!s) S.fundido = null; return avisar(); },
    setCreatividad(v) { if (!CREATIVIDADES.includes(v)) throw new Error('creatividad ' + v); S.creatividad = v; return avisar(); },
    // Ficha del show (efecto, velocidad, zonas, qué participa). La valida app.js; acá se vuelve a acotar por seguridad.
    setFicha(f) {
      f = f || {};
      OPC.efecto = f.efecto && f.efecto in EFECTOS ? f.efecto : null;
      OPC.velocidad = clamp(+f.velocidad || 1, 0.5, 2);
      OPC.zonas = Array.isArray(f.zonas) ? f.zonas.filter((z) => ['superior', 'medio', 'inferior', 'ochava', 'cupula'].includes(z)) : null;
      OPC.luces = f.luces !== false; OPC.pantallas = f.pantallas !== false || !OPC.luces;   // nunca las dos apagadas
      S.ficha = { efecto: OPC.efecto, velocidad: OPC.velocidad, zonas: OPC.zonas, luces: OPC.luces, pantallas: OPC.pantallas };
      return avisar();
    },
    setPaletaShow(hexes) { paletaPersonal(hexes); S.showPaleta = (hexes || []).slice(0, 3); return avisar(); },
    setEstiloShow(estilo, intensidad) {
      if (estilo === 'custom' && !PALETA_TAKEOVER.custom) paletaPersonal(null);
      if (!(estilo in PALETA_TAKEOVER)) throw new Error('estilo ' + estilo);
      S.showEstilo = OPC.estilo = estilo; S.showIntensidad = OPC.intensidad = clamp(+intensidad || 1, 0.85, 1.15);
      return avisar();
    },
    setEscena(e) {
      if (!(e in ESCENAS)) throw new Error('escena ' + e);
      iniciarFundido();   // la transición parte de lo que se ve ahora (preset, show o fundido en curso)
      S.escena = e; S.show = { cargado: false, t: 0, reproduciendo: false };
      return avisar();
    },
    cargarShow() { S.fundido = null; S.show = { cargado: true, t: 0, reproduciendo: false }; return avisar(); },
    play() { if (!S.show.cargado) api.cargarShow(); if (S.show.t >= DUR) S.show.t = 0; S.show.reproduciendo = true; return avisar(); },
    pausa() { S.show.reproduciendo = false; return avisar(); },
    resetShow() { if (S.show.cargado) { S.show.t = 0; S.show.reproduciendo = false; } return avisar(); },
    seek(t) { if (!S.show.cargado) api.cargarShow(); S.show.t = clamp(+t, 0, DUR); return avisar(); },
    animando: () => !!S.fundido || (S.show.cargado && S.show.reproduciendo),
    avanzar(dt) {
      let cambio = false;
      if (S.fundido) { S.fundido.t += dt; if (S.fundido.t >= S.fundido.dur) S.fundido = null; cambio = true; }
      if (S.show.cargado && S.show.reproduciendo) {
        S.show.t = Math.min(DUR, S.show.t + dt);
        if (S.show.t >= DUR) S.show.reproduciendo = false;
        cambio = true;
      }
      return cambio ? avisar() : S;
    },
    terminarTransicion() { S.fundido = null; return avisar(); },
    // Quita los overrides del operador (colores y trims de zona/equipo) y vuelve a la escena tal como está programada.
    volverAEscena() {
      S.luces.grupos = { superior: 100, medio: 100, inferior: 100 }; S.luces.zonas = { ochava: 100, cupula: 100, cornisas: 100 };
      for (const z of Object.keys(S.luces.zonaColor)) S.luces.zonaColor[z] = null;
      S.luces.fixtures.forEach((f) => { f.on = true; f.nivel = 100; f.color = null; });
      return avisar();
    },
    restaurarNiveles() {
      S.pantallas = { master: 100, corrientes: 100, pellegrini: 100, media: 100 };
      S.luces.master = 100; S.reloj.nivel = 100; S.blackout = false;
      return api.volverAEscena();
    },
    reiniciarTodo() { S = nuevoEstado(); Object.assign(OPC, { estilo: 'rojo', intensidad: 1, efecto: null, velocidad: 1, zonas: null, luces: true, pantallas: true }); return avisar(); },
    // Escenas guardadas como archivo local (sin servicio ni red).
    exportarEscena() {
      return JSON.stringify({ formato: 'trust-escena-v1', simulacion: true, escena: S.escena, transicion: S.transicion, creatividad: S.creatividad,
        pantallas: S.pantallas, luces: S.luces, reloj: S.reloj }, null, 1);
    },
    importarEscena(txt) {
      const d = JSON.parse(txt);
      if (d.formato !== 'trust-escena-v1') throw new Error('formato desconocido');
      const nuevo = nuevoEstado();
      for (const k of Object.keys(nuevo.pantallas)) if (k in d.pantallas) nuevo.pantallas[k] = pct(d.pantallas[k]);
      nuevo.luces.master = pct(d.luces.master);
      for (const g of Object.keys(nuevo.luces.grupos)) nuevo.luces.grupos[g] = pct(d.luces.grupos[g]);
      for (const z of Object.keys(nuevo.luces.zonas)) if (d.luces.zonas && z in d.luces.zonas) nuevo.luces.zonas[z] = pct(d.luces.zonas[z]);
      for (const z of Object.keys(nuevo.luces.zonaColor)) if (d.luces.zonaColor && d.luces.zonaColor[z]) nuevo.luces.zonaColor[z] = rgbwOk(d.luces.zonaColor[z]);
      for (const f of nuevo.luces.fixtures) {
        const o = (d.luces.fixtures || []).find((x) => x.id === f.id);
        if (o) { f.on = !!o.on; f.nivel = pct(o.nivel); f.color = o.color ? rgbwOk(o.color) : null; if (o.apertura) f.apertura = clamp(Math.round(+o.apertura), 10, 90); }
      }
      nuevo.reloj.nivel = pct(d.reloj.nivel);
      S.pantallas = nuevo.pantallas; S.luces = nuevo.luces; S.reloj = nuevo.reloj;
      if (d.escena in ESCENAS) { iniciarFundido(); S.escena = d.escena; S.show = { cargado: false, t: 0, reproduciendo: false }; }
      if (TRANSICIONES.includes(d.transicion)) S.transicion = d.transicion;
      if (CREATIVIDADES.includes(d.creatividad)) S.creatividad = d.creatividad;
      return avisar();
    },
  };
  window.MOTOR = api;
})();
