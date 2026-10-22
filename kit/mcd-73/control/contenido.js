// TRUST Control — contenido de las 3 pantallas como UNA SOLA COMPOSICIÓN (visual polish, 14/10).
// SIMULACIÓN CONCEPTUAL: creatividad ilustrativa generada en vivo (canvas), determinista por t. Sin red, sin assets externos.
//
// Clave: las tres superficies se dibujan en un MISMO espacio de mundo = los píxeles de la foto (2560×1733). Cada pantalla es
// solo una ventana sobre ese mundo (su caja calibrada). Así un elemento que cruza de Corrientes a Pellegrini y baja a la media
// es literalmente el mismo objeto, en la misma escala, sin deformarse (el lienzo de cada pantalla tiene píxeles no cuadrados;
// la transformación los compensa).
//
// Marca: se usa el NOMBRE en tipografía (Inter) y los colores de campaña. No se dibuja el logo oficial ni el envase de la
// marca: en producción van los archivos oficiales de la agencia. El producto es una hamburguesa genérica ilustrada.
(function () {
  'use strict';
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const sv = (k) => { k = cl(k, 0, 1); return k * k * (3 - 2 * k); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const azar = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const FUENTE = 'Inter, "Segoe UI", system-ui, sans-serif';
  let MW = 2560, MH = 1733;

  // ---------- ventanas: caja de cada pantalla en el mundo (px de la foto) ----------
  const LED_ASPECTO = { corrientes: 1152 / 576, pellegrini: 1440 / 576 };   // building.ts (medidas confirmadas)
  function ventanas(G) {
    MW = G.foto.noche.ancho; MH = G.foto.noche.alto;
    const v = {};
    for (const [id, s] of Object.entries(G.superficies)) {
      const q = s.quads;
      if (q.length === 1) {
        const p = q[0];
        const x0 = Math.min(p[0][0], p[3][0]) * MW, x1 = Math.max(p[1][0], p[2][0]) * MW, yc = ((p[0][1] + p[1][1]) / 2 + (p[2][1] + p[3][1]) / 2) / 2 * MH;
        // la ventana tiene la proporción REAL del LED (píxeles cuadrados: A 2:1, B 2,5:1): lo que se dibuja no se deforma en el archivo
        const asp = LED_ASPECTO[id] || 2, alto = (x1 - x0) / asp;
        v[id] = { x0, x1, y0: yc - alto / 2, y1: yc + alto / 2 };
      } else {   // banda curva: a lo largo de la cadena de tramos, con su espesor medio
        let yc = 0, th = 0;
        for (const p of q) { yc += (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4; th += ((p[3][1] - p[0][1]) + (p[2][1] - p[1][1])) / 2; }
        yc = yc / q.length * MH; th = th / q.length * MH;
        v[id] = { x0: q[0][0][0] * MW, x1: q[q.length - 1][1][0] * MW, y0: yc - th / 2, y1: yc + th / 2 };
      }
    }
    return v;
  }
  function aMundo(c, w, h, vn) {   // desde acá se dibuja en px de la foto
    c.setTransform(w / (vn.x1 - vn.x0), 0, 0, h / (vn.y1 - vn.y0), -vn.x0 * w / (vn.x1 - vn.x0), -vn.y0 * h / (vn.y1 - vn.y0));
  }
  const VEN = {};   // se completa en preparar()
  const YM = { cx: 1075, cy: 1520, y: 1520 };   // centro de la pantalla media (se calcula en preparar)

  // ---------- recorrido del elemento que une las 3 superficies ----------
  // Nace en Corrientes (izq.), cruza por detrás de la cúpula a Pellegrini, baja por la ochava y recorre la media hasta Corrientes.
  const CAMINO = [[470, 700], [640, 640], [840, 590], [1040, 560], [1240, 500], [1440, 540], [1640, 585], [1860, 640], [1990, 860],
    [1990, 1250], [1890, 1490], [1620, 1525], [1250, 1530], [860, 1525], [480, 1520], [180, 1515]];
  const LARGO = (() => { const L = [0]; for (let i = 1; i < CAMINO.length; i++) L.push(L[i - 1] + Math.hypot(CAMINO[i][0] - CAMINO[i - 1][0], CAMINO[i][1] - CAMINO[i - 1][1])); return L; })();
  function enCamino(s) {   // s 0..1 por longitud de arco (Catmull-Rom suave)
    const d = cl(s, 0, 1) * LARGO[LARGO.length - 1];
    let i = 1; while (i < LARGO.length - 1 && LARGO[i] < d) i++;
    const u = (d - LARGO[i - 1]) / (LARGO[i] - LARGO[i - 1] || 1);
    const p0 = CAMINO[Math.max(0, i - 2)], p1 = CAMINO[i - 1], p2 = CAMINO[i], p3 = CAMINO[Math.min(CAMINO.length - 1, i + 1)];
    const cr = (a, b, c2, d2) => 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d2) * u * u + (-a + 3 * b - 3 * c2 + d2) * u * u * u);
    return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
  }
  const ORBE_T0 = 2.15, ORBE_T1 = 5.05;
  const sOrbe = (t) => { const k = cl((t - ORBE_T0) / (ORBE_T1 - ORBE_T0), 0, 1); return k < 0.5 ? 2 * k * k * 0.9 + k * 0.1 : 1 - (2 * (1 - k) * (1 - k) * 0.9 + (1 - k) * 0.1); };

  // ---------- capas ----------
  function fondoRojo(c, vn, t, calor) {   // rojo profundo con VOLUMEN: base casi negra + dos fuentes de luz comunes + rayos + viñeta
    const caja = [vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8];
    const tono = (a, b, al) => `rgba(${Math.round(lerp(a[0], b[0], calor))},${Math.round(lerp(a[1], b[1], calor))},${Math.round(lerp(a[2], b[2], calor))},${al})`;
    c.fillStyle = tono([26, 1, 4], [30, 9, 3], 1); c.fillRect(...caja);
    c.save(); c.globalCompositeOperation = 'lighter';
    // fuente alta: detrás de la cúpula, entre las dos pantallas superiores (las une)
    const fx = 1250 + 120 * Math.sin(t * 0.35), fy = 470;
    let g = c.createRadialGradient(fx, fy, 20, fx, fy, 820);
    g.addColorStop(0, tono([255, 80, 50], [255, 190, 90], 1)); g.addColorStop(0.3, tono([200, 16, 24], [200, 90, 30], 0.95));
    g.addColorStop(0.7, tono([90, 4, 10], [90, 30, 8], 0.6)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(...caja);
    // fuente baja: centro de la media, abierta en horizontal
    c.save(); c.translate(YM.cx, YM.cy); c.scale(3.2, 1); c.translate(-YM.cx, -YM.cy);
    g = c.createRadialGradient(YM.cx + 60 * Math.sin(t * 0.4) / 3.2, YM.cy, 10, YM.cx, YM.cy, 260);
    g.addColorStop(0, tono([240, 40, 34], [250, 170, 80], 1)); g.addColorStop(0.45, tono([160, 10, 18], [160, 70, 20], 0.85)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(YM.cx - 300, YM.cy - 300, 600, 600); c.restore();
    // rayos volumétricos desde la fuente alta: cruzan las superficies como una sola luz
    for (let k = 0; k < 9; k++) {
      const a = -1.3 + k * 0.33 + 0.06 * Math.sin(t * 0.5 + k * 1.7), largo = 1500, ancho = 0.035 + 0.025 * azar(k);
      const gr = c.createLinearGradient(fx, fy, fx + Math.sin(a) * largo, fy + Math.cos(a) * largo);
      gr.addColorStop(0, 'rgba(255,190,130,0.2)'); gr.addColorStop(1, 'rgba(255,110,60,0)');
      c.fillStyle = gr; c.beginPath(); c.moveTo(fx, fy);
      c.lineTo(fx + Math.sin(a - ancho) * largo, fy + Math.cos(a - ancho) * largo); c.lineTo(fx + Math.sin(a + ancho) * largo, fy + Math.cos(a + ancho) * largo);
      c.closePath(); c.fill();
    }
    // brillo especular diagonal muy suave (superficie, no plano)
    g = c.createLinearGradient(vn.x0, vn.y0, vn.x1, vn.y1);
    const sx = (t * 0.08) % 1;
    g.addColorStop(Math.max(0, sx - 0.12), 'rgba(255,255,255,0)'); g.addColorStop(sx, 'rgba(255,220,200,0.06)'); g.addColorStop(Math.min(1, sx + 0.12), 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(...caja);
    c.restore();
    vineta(c, vn, 0.6);
  }
  function vineta(c, vn, a) {   // bordes más oscuros de cada panel: profundidad, sin marco duro
    const cx = (vn.x0 + vn.x1) / 2, cy = (vn.y0 + vn.y1) / 2, r = Math.max(vn.x1 - vn.x0, (vn.y1 - vn.y0) * 3);
    const g = c.createRadialGradient(cx, cy, r * 0.25, cx, cy, r * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
    c.fillStyle = g; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
  }
  function particulas(c, vn, t, alfa, n) {   // brasas doradas controladas: pocas, lentas, deterministas
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < (n || 110); i++) {
      const x = 180 + ((azar(i) * 1800 + t * (14 + 22 * azar(i + 7))) % 1800);
      const y = 1600 - ((azar(i + 3) * 1200 + t * (18 + 30 * azar(i + 11))) % 1200);
      if (x < vn.x0 - 10 || x > vn.x1 + 10 || y < vn.y0 - 10 || y > vn.y1 + 10) continue;
      const r = 1.2 + 2.6 * azar(i + 5), tw = 0.55 + 0.45 * Math.sin(t * (1.5 + azar(i + 9) * 2) + i);
      const g = c.createRadialGradient(x, y, 0, x, y, r * 3.2);
      g.addColorStop(0, `rgba(255,236,170,${alfa * tw})`); g.addColorStop(0.35, `rgba(255,180,70,${alfa * tw * 0.5})`); g.addColorStop(1, 'rgba(255,140,40,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3.2, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function orbe(c, x, y, r, alfa) {   // núcleo blanco-dorado + halo + destello horizontal (lente)
    if (alfa <= 0) return;
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = alfa;
    let g = c.createRadialGradient(x, y, 0, x, y, r * 5);
    g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(0.15, 'rgba(255,200,90,0.55)'); g.addColorStop(0.5, 'rgba(255,120,30,0.16)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 5, 0, Math.PI * 2); c.fill();
    g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,230,160,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    g = c.createLinearGradient(x - r * 9, y, x + r * 9, y);
    g.addColorStop(0, 'rgba(255,200,120,0)'); g.addColorStop(0.5, 'rgba(255,236,200,0.55)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    c.fillStyle = g; c.fillRect(x - r * 9, y - r * 0.12, r * 18, r * 0.24);
    c.restore();
  }
  function trazo(c, s0, s1, ancho, color, desv, fase) {   // tramo del recorrido, con ondulación opcional (hebras de la cinta)
    c.beginPath();
    const n = Math.max(2, Math.ceil((s1 - s0) * 220));
    for (let k = 0; k <= n; k++) {
      const s = lerp(s0, s1, k / n), p = enCamino(s), q = enCamino(Math.min(1, s + 0.002));
      const nx = -(q[1] - p[1]), ny = q[0] - p[0], l = Math.hypot(nx, ny) || 1, o = desv ? desv * Math.sin(s * 38 + fase) : 0;
      const X = p[0] + nx / l * o, Y = p[1] + ny / l * o;
      k ? c.lineTo(X, Y) : c.moveTo(X, Y);
    }
    c.lineWidth = ancho; c.strokeStyle = color; c.stroke();
  }
  function cinta(c, s0, s1, t, fuerza) {   // cinta dorada: el rastro del elemento, varias hebras con brillo que viaja
    if (s1 <= s0 || fuerza <= 0) return;
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let j = 0; j < 4; j++) {
      const desv = 10 + 9 * j, fase = t * (1.2 + 0.3 * j) + j * 2.1;
      trazo(c, s0, s1, 26, `rgba(255,120,30,${0.07 * fuerza})`, desv, fase);
      trazo(c, s0, s1, 7, `rgba(255,190,80,${0.22 * fuerza})`, desv, fase);
      trazo(c, s0, s1, 2.2, `rgba(255,236,180,${0.8 * fuerza})`, desv, fase);
    }
    c.restore();
  }
  function marca(c, x, y, tam, alfa, brillo) {   // nombre de marca en tipografía, dorado con volumen (placeholder del logo oficial)
    if (alfa <= 0) return;
    c.save(); c.globalAlpha = cl(alfa, 0, 1);
    c.font = `800 ${tam}px ${FUENTE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if ('letterSpacing' in c) c.letterSpacing = '-0.01em';
    const m0 = c.measureText("McDonald's").width;   // aire oscuro detrás del nombre: contraste alto sobre la luz
    c.save(); c.translate(x, y); c.scale(m0 * 0.62 / tam, 1);
    const fo = c.createRadialGradient(0, 0, 0, 0, 0, tam); fo.addColorStop(0, 'rgba(25,0,0,0.6)'); fo.addColorStop(1, 'rgba(25,0,0,0)');
    c.fillStyle = fo; c.beginPath(); c.arc(0, 0, tam, 0, Math.PI * 2); c.fill(); c.restore();
    c.fillStyle = 'rgba(40,0,0,0.55)'; c.fillText("McDonald's", x + tam * 0.03, y + tam * 0.05);
    const g = c.createLinearGradient(0, y - tam * 0.5, 0, y + tam * 0.5);
    g.addColorStop(0, '#fff1b8'); g.addColorStop(0.45, '#ffc72c'); g.addColorStop(1, '#d48a12');
    c.fillStyle = g; c.fillText("McDonald's", x, y);
    if (brillo != null) {   // reflejo que barre el nombre
      const m = c.measureText("McDonald's").width, bx = x - m / 2 + (m + tam) * brillo - tam / 2;
      c.globalCompositeOperation = 'source-atop';
      const b = c.createLinearGradient(bx - tam * 0.4, 0, bx + tam * 0.4, 0);
      b.addColorStop(0, 'rgba(255,255,255,0)'); b.addColorStop(0.5, 'rgba(255,255,255,0.75)'); b.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = b; c.fillRect(bx - tam * 0.4, y - tam, tam * 0.8, tam * 2);
    }
    c.restore();
  }
  // REGLA DE CORTE (19/10, pedido de Fer): entre Corrientes y Pellegrini está la cúpula, así que una palabra o un logo
  // que cruza las dos pantallas se lee partido («McD | ld's»). Por defecto ninguna palabra ni logo queda partido:
  //   · varias palabras → se reparten por palabra (VAMOS | ARGENTINA), cada una entera en su pantalla;
  //   · una sola palabra o el logo → entero en cada pantalla (eco), con el brillo que pasa de una a la otra.
  // Se permite partir solo si el pedido lo dice («que cruce las dos pantallas», «de punta a punta», «una sola pieza»),
  // o en movimiento: lo que viaja de una pantalla a otra (orbe, cinta, papas) sí puede pasar por detrás de la cúpula.
  let CORTE = { permitido: false };
  function setCorte(permitido) { CORTE = { permitido: !!permitido }; }
  function marcaEnVentana(c, vn, a, brillo) {   // el nombre entero, ajustado a la ventana real de la pantalla
    const w = (vn.x1 - vn.x0) * 0.88, h = vn.y1 - vn.y0;
    c.save(); c.font = `800 100px ${FUENTE}`; const m = c.measureText("McDonald's").width; c.restore();
    const tam = Math.min(h * 0.6, 100 * w / m);
    marca(c, (vn.x0 + vn.x1) / 2, (vn.y0 + vn.y1) / 2, tam, a, brillo);
  }
  // Producto con VOLUMEN: se dibuja aparte y se le aplica luz principal (arriba a la izquierda) y sombra propia,
  // así no queda como un dibujo plano pegado sobre la pantalla.
  const HB = document.createElement('canvas');
  function hamburguesa(c, x, y, a, t) {
    const s = 2, w = Math.ceil(a * 1.3 * s), h = Math.ceil(a * 1.15 * s);
    if (HB.width !== w || HB.height !== h) { HB.width = w; HB.height = h; }
    const k = HB.getContext('2d'); k.setTransform(1, 0, 0, 1, 0, 0); k.globalCompositeOperation = 'source-over'; k.clearRect(0, 0, w, h);
    k.setTransform(s, 0, 0, s, 0, 0);
    const ox = a * 0.65, oy = a * 0.9;   // base del producto dentro del lienzo auxiliar
    hamburguesaPlana(k, ox, oy, a, t);
    k.setTransform(1, 0, 0, 1, 0, 0); k.globalCompositeOperation = 'source-atop';
    let g = k.createRadialGradient(w * 0.32, h * 0.25, 0, w * 0.32, h * 0.25, w * 0.75);
    g.addColorStop(0, 'rgba(255,244,220,0.28)'); g.addColorStop(0.5, 'rgba(255,244,220,0)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    k.fillStyle = g; k.fillRect(0, 0, w, h);
    g = k.createLinearGradient(0, h * 0.3, w * 0.4, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,6,0,0.42)');
    k.fillStyle = g; k.fillRect(0, 0, w, h);
    k.globalCompositeOperation = 'source-over';
    c.drawImage(HB, x - ox, y - oy, w / s, h / s);
  }
  function hamburguesaPlana(c, x, y, a, t) {   // producto genérico ilustrado, con luz de borde y vapor (base en y)
    c.save();
    const h = a * 0.62;
    // sombra / reflejo en el piso
    let g = c.createRadialGradient(x, y + a * 0.03, 0, x, y + a * 0.03, a * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y + a * 0.03, a * 0.62, a * 0.09, 0, 0, Math.PI * 2); c.fill();
    const capa = (yy, alto, ancho, c0, c1, radio) => {
      const gg = c.createLinearGradient(0, yy - alto, 0, yy); gg.addColorStop(0, c0); gg.addColorStop(1, c1);
      c.fillStyle = gg; c.beginPath(); c.roundRect ? c.roundRect(x - ancho / 2, yy - alto, ancho, alto, radio) : c.rect(x - ancho / 2, yy - alto, ancho, alto); c.fill();
    };
    capa(y, h * 0.17, a * 0.86, '#d98a3a', '#7a3a12', [a * 0.02, a * 0.02, a * 0.14, a * 0.14]);   // pan de abajo
    capa(y - h * 0.16, h * 0.15, a * 0.95, '#5a2a14', '#2a1006', a * 0.06);                        // medallón
    c.fillStyle = '#ffb21e'; c.beginPath();                                                          // queso que cae
    const yq = y - h * 0.31;
    c.moveTo(x - a * 0.46, yq); c.lineTo(x + a * 0.46, yq); c.lineTo(x + a * 0.36, yq + h * 0.07); c.lineTo(x + a * 0.2, yq + h * 0.16);
    c.lineTo(x + a * 0.08, yq + h * 0.06); c.lineTo(x - a * 0.12, yq + h * 0.13); c.lineTo(x - a * 0.28, yq + h * 0.05); c.lineTo(x - a * 0.4, yq + h * 0.09); c.closePath(); c.fill();
    c.fillStyle = '#4fae3a'; c.beginPath();                                                          // lechuga ondulada
    for (let k = 0; k <= 24; k++) { const xx = x - a * 0.5 + a * k / 24, yy = yq - h * 0.02 + Math.sin(k * 1.9) * h * 0.035; k ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
    c.lineTo(x + a * 0.46, yq - h * 0.07); c.lineTo(x - a * 0.46, yq - h * 0.07); c.closePath(); c.fill();
    const yt = yq - h * 0.06;                                                                        // pan de arriba (cúpula)
    g = c.createRadialGradient(x - a * 0.12, yt - h * 0.42, a * 0.05, x, yt - h * 0.2, a * 0.6);
    g.addColorStop(0, '#f6c37a'); g.addColorStop(0.45, '#d4822e'); g.addColorStop(1, '#7d3a10');
    c.fillStyle = g; c.beginPath(); c.moveTo(x - a * 0.47, yt); c.bezierCurveTo(x - a * 0.47, yt - h * 0.62, x + a * 0.47, yt - h * 0.62, x + a * 0.47, yt); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,240,205,0.9)';                                                           // sésamo
    for (let k = 0; k < 22; k++) {
      const u = azar(k + 40) * 2 - 1, v = azar(k + 80);
      const sx = x + u * a * 0.36, sy = yt - h * (0.1 + 0.36 * v * (1 - u * u * 0.8));
      c.beginPath(); c.ellipse(sx, sy, a * 0.013, a * 0.007, u * 0.6, 0, Math.PI * 2); c.fill();
    }
    // luz de borde cálida (rim light) arriba y a la derecha
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = 'rgba(255,210,140,0.55)'; c.lineWidth = a * 0.012; c.beginPath();
    c.moveTo(x - a * 0.3, yt - h * 0.43); c.bezierCurveTo(x - a * 0.05, yt - h * 0.5, x + a * 0.35, yt - h * 0.42, x + a * 0.46, yt - h * 0.06); c.stroke();
    // vapor: hebras suaves que suben
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = `rgba(255,236,220,${0.12 + 0.06 * Math.sin(t * 1.3 + k)})`; c.lineWidth = a * 0.02; c.beginPath();
      for (let j = 0; j <= 12; j++) { const yy = yt - h * 0.5 - j * h * 0.05, xx = x + (k - 1) * a * 0.15 + Math.sin(j * 0.7 + t * 1.6 + k * 2) * a * 0.035; j ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
      c.stroke();
    }
    c.restore();
  }
  function anillos(c, t0, t, cx, cy) {   // ondas concéntricas desde un punto común (cruzan las dos pantallas superiores)
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const e = (t - t0) * 0.55 - k * 0.32; if (e <= 0) continue;
      const fase = e % 1.3, r = 60 + fase * 900, a = (1 - fase / 1.3) * 0.5;
      c.strokeStyle = `rgba(255,200,110,${a})`; c.lineWidth = 3 + 10 * (1 - fase / 1.3);
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }
  function columnasLuz(c, t, fuerza) {   // movimiento arquitectónico: pilastras de luz que recorren ambas pantallas superiores
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 14; k++) {
      const x = 560 + ((k * 105 + t * 120) % 1470), a = fuerza * (0.25 + 0.2 * Math.sin(t * 2 + k));
      const g = c.createLinearGradient(x - 18, 0, x + 18, 0);
      g.addColorStop(0, 'rgba(255,190,90,0)'); g.addColorStop(0.5, `rgba(255,214,140,${a})`); g.addColorStop(1, 'rgba(255,190,90,0)');
      c.fillStyle = g; c.fillRect(x - 18, 420, 36, 320);
    }
    c.restore();
  }
  function ondasFirma(c, vn, t, fuerza) {   // la onda dorada queda como FIRMA: hebras finas, continuas en las 3 superficies
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    const bandas = [[480, 700], [YM.cy - 40, YM.cy + 40]];
    for (const [ya, yb] of bandas) {
      if (yb < vn.y0 - 60 || ya > vn.y1 + 60) continue;
      const ym = (ya + yb) / 2, amp = (yb - ya) * 0.28;
      for (let j = 0; j < 3; j++) {
        c.beginPath();
        for (let x = vn.x0 - 20; x <= vn.x1 + 20; x += 8) { const y = ym + amp * Math.sin(x / 260 + t * (0.8 + 0.25 * j) + j * 2) * (0.7 + 0.3 * Math.sin(x / 90 + j)); x > vn.x0 - 20 ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.strokeStyle = `rgba(255,190,90,${0.12 * fuerza})`; c.lineWidth = 9; c.stroke();
        c.strokeStyle = `rgba(255,232,170,${0.75 * fuerza})`; c.lineWidth = 1.8; c.stroke();
      }
    }
    c.restore();
  }
  function institucional(c, id, vn, t, sinMarca) {   // NIGHT_IDLE / reposo: azul noche, horizonte dorado continuo, marca del edificio sobria
    const g = c.createLinearGradient(vn.x0, vn.y0, vn.x1, vn.y1);
    g.addColorStop(0, '#060d1f'); g.addColorStop(0.5, '#10224a'); g.addColorStop(1, '#060d1f');
    c.fillStyle = g; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    const lx = 400 + ((t * 90) % 1700), lg = c.createRadialGradient(lx, 1000, 0, lx, 1000, 900);   // luz lenta y común
    lg.addColorStop(0, 'rgba(232,182,91,0.16)'); lg.addColorStop(1, 'rgba(232,182,91,0)');
    c.fillStyle = lg; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    const hy = vn.y0 + (vn.y1 - vn.y0) * (id === 'media' ? 0.84 : 0.82);
    const hl = c.createLinearGradient(vn.x0, 0, vn.x1, 0);
    hl.addColorStop(0, 'rgba(232,182,91,0)'); hl.addColorStop(0.5, 'rgba(232,182,91,0.8)'); hl.addColorStop(1, 'rgba(232,182,91,0)');
    c.fillStyle = hl; c.fillRect(vn.x0, hy, vn.x1 - vn.x0, 1.6);
    const alto = vn.y1 - vn.y0, cx = (vn.x0 + vn.x1) / 2;
    c.save(); c.font = `500 ${Math.round(alto * (id === 'media' ? 0.36 : 0.2))}px ${FUENTE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if ('letterSpacing' in c) c.letterSpacing = '0.32em';
    if (!sinMarca) c.fillStyle = '#e8c27a', c.fillText('EL TRUST', cx + alto * 0.05, vn.y0 + alto * 0.46);
    c.restore();
    vineta(c, vn, 0.45);
  }
  // Previa y salida del show (19/10, Fer: «que no diga siempre EL TRUST»): en un show de campaña las pantallas no vuelven
  // a la marca del edificio; quedan en el clima de la campaña (rojo de marca o los colores pedidos), con el nombre en la media.
  let CR_ACTUAL = 'C';
  function previa(c, id, vn, t) {
    if (CR_ACTUAL === 'P') fondoP(c, vn, t, 0.8); else fondoRojo(c, vn, t, 0.5);
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    if (id === 'media') marca(c, YM.cx, YM.cy, 58, 0.85);
    vineta(c, vn, 0.4);
  }
  function diagnostico(c, id, vn) {   // carta técnica: nunca parece una propuesta comercial
    c.fillStyle = '#16181d'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    const barras = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff'], an = (vn.x1 - vn.x0) / barras.length, alto = vn.y1 - vn.y0;
    barras.forEach((b, k) => { c.fillStyle = b; c.fillRect(vn.x0 + k * an, vn.y0 + alto * 0.62, an + 1, alto * 0.38); });
    c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
    for (let x = Math.ceil(vn.x0 / 40) * 40; x < vn.x1; x += 40) { c.beginPath(); c.moveTo(x, vn.y0); c.lineTo(x, vn.y0 + alto * 0.6); c.stroke(); }
    c.save(); c.font = `700 ${Math.round(alto * (id === 'media' ? 0.3 : 0.16))}px ${FUENTE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if ('letterSpacing' in c) c.letterSpacing = '0.12em';
    c.fillStyle = '#e9edf5'; c.fillText('DIAGNOSTIC MODE', (vn.x0 + vn.x1) / 2, vn.y0 + alto * 0.3); c.restore();
  }

  // ---------- momentos del show (t en s) ----------
  function revelado(c, id, vn, t) {   // lo que el elemento ya recorrió se enciende; lo que falta queda en negro
    const s = sOrbe(t), p = enCamino(s);
    const tramo = { corrientes: [0, 0.2], pellegrini: [0.22, 0.45], media: [0.6, 1] }[id];
    const k = (s - tramo[0]) / (tramo[1] - tramo[0]);
    if (k >= 1.15) return;
    c.save();
    if (k <= 0) { c.fillStyle = '#000'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8); c.restore(); return; }
    const dir = id === 'media' ? -1 : 1, fx = cl(p[0], vn.x0 - 200, vn.x1 + 200), borde = 140;
    const g = c.createLinearGradient(fx, 0, fx + dir * borde, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = g;
    if (dir > 0) { c.fillRect(fx, vn.y0 - 4, borde, vn.y1 - vn.y0 + 8); c.fillStyle = '#000'; c.fillRect(fx + borde, vn.y0 - 4, Math.max(0, vn.x1 - fx), vn.y1 - vn.y0 + 8); }
    else { c.fillRect(fx - borde, vn.y0 - 4, borde, vn.y1 - vn.y0 + 8); c.fillStyle = '#000'; c.fillRect(vn.x0 - 4, vn.y0 - 4, Math.max(0, fx - borde - vn.x0 + 4), vn.y1 - vn.y0 + 8); }
    c.restore();
  }
  function revelacion(c, id, vn, t) {   // 2–5 s: el elemento nace en Corrientes, pasa a Pellegrini y cae en la media
    fondoRojo(c, vn, t, 0.05);
    particulas(c, vn, t, 0.6, 70);
    revelado(c, id, vn, t);
    const s = sOrbe(t), p = enCamino(s), nace = sv((t - ORBE_T0 + 0.1) / 0.5);
    cinta(c, Math.max(0, s - 0.16), s, t, 0.8 * nace);
    orbe(c, p[0], p[1], 15, nace);
  }
  // ---------- piezas de las creatividades D · E · F (ilustración genérica, sin envases ni logos de la marca) ----------
  function papa(c, x, y, largo, ang) {   // bastón de papa frita dorado, con puntas más tostadas y brillo
    c.save(); c.translate(x, y); c.rotate(ang);
    const g = c.createLinearGradient(-largo / 2, 0, largo / 2, 0);
    g.addColorStop(0, '#c9781a'); g.addColorStop(0.12, '#f5c24c'); g.addColorStop(0.5, '#ffd968'); g.addColorStop(0.88, '#f2b840'); g.addColorStop(1, '#c47216');
    c.fillStyle = g; c.beginPath(); c.roundRect ? c.roundRect(-largo / 2, -7, largo, 14, 4) : c.rect(-largo / 2, -7, largo, 14); c.fill();
    c.fillStyle = 'rgba(255,248,210,0.55)'; c.fillRect(-largo * 0.42, -5, largo * 0.84, 3);
    c.restore();
  }
  function lluviaPapas(c, vn, t) {   // caen en el MISMO espacio: una papa que cruza una pantalla superior aparece después en la media
    for (let i = 0; i < 220; i++) {
      const ts = 4.6 + azar(i + 1) * 5, dt = t - ts; if (dt < 0) continue;
      const v = 170 + 230 * azar(i + 2), x = 280 + azar(i) * 1840 + dt * 40 * (azar(i + 3) - 0.5), y = 400 + 140 * azar(i + 7) + dt * v + 40 * dt * dt;
      if (y > 1700) continue;
      const largo = 70 + 50 * azar(i + 4);
      if (x < vn.x0 - largo || x > vn.x1 + largo || y < vn.y0 - largo || y > vn.y1 + largo) continue;
      papa(c, x, y, largo, azar(i + 5) * Math.PI + dt * (azar(i + 6) - 0.5) * 3);
    }
  }
  // Lluvia de papas SOBRE la marquesina media (pieza «Lluvia de papas»): la foto de fondo deja de ser fija; caen papas
  // en tres planos (atrás chicas y lentas, adelante grandes y rápidas), giran, se balancean y brillan con chispas de sal.
  // Entran desde arriba al empezar el tramo y siguen en bucle hasta que termina. Se compone «pre-comprimida» (k) como la media.
  function lluviaMedia(c, w, h, seg, t, k) {
    const dt = t - seg.desde; if (dt < 0) return;
    const fi = seg.fundido == null ? 0.35 : seg.fundido, a = sv((seg.hasta - t) / fi);
    const wa = w * k, PLANOS = [[22, 0.45, 0.6, 0.45, 0.55], [14, 0.72, 0.95, 0.75, 0.85], [7, 1.1, 1.4, 1.1, 1]];   // n, largo min/max (× alto), velocidad (× alto/s), opacidad
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.scale(1 / k, 1); c.globalCompositeOperation = 'source-over'; c.globalAlpha = sv(dt / fi) * a;   // fondo propio, vivo: rojo profundo con dos focos de luz dorada que viajan
    let g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a000c'); g.addColorStop(0.55, '#b3120f'); g.addColorStop(1, '#6e000d');
    c.fillStyle = g; c.fillRect(0, 0, wa, h); c.globalCompositeOperation = 'lighter';
    for (let q = 0; q < 2; q++) {
      const fx = wa * (0.5 + 0.42 * Math.sin(t * (0.33 + q * 0.21) + q * 2.4)), r = h * 1.6;
      g = c.createRadialGradient(fx, h * 0.55, 0, fx, h * 0.55, r); g.addColorStop(0, 'rgba(255,170,40,0.38)'); g.addColorStop(1, 'rgba(255,120,20,0)');
      c.fillStyle = g; c.fillRect(0, 0, wa, h);
    }
    c.restore();
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.scale(1 / k, 1);
    let i0 = 0;
    for (const [n, l0, l1, vel, op] of PLANOS) {
      for (let j = 0; j < n; j++) {
        const i = i0 + j, L = h * (l0 + (l1 - l0) * azar(i + 11)), v = h * vel * (0.8 + 0.4 * azar(i + 12));
        const tramo = h + 2 * L, per = tramo / v, ret = azar(i + 13) * per * 1.1, u = dt - ret; if (u < 0) continue;
        const y = -L + (u % per) * v, vuelta = Math.floor(u / per);
        const x = wa * (0.02 + 0.96 * azar(i * 3.7 + vuelta * 1.3)) + Math.sin(u * (0.9 + azar(i + 14)) + i) * L * 0.25;
        const ang = (azar(i + 15) - 0.5) * 1.6 + u * (azar(i + 16) - 0.5) * 2.4, esc = L / 100;
        c.globalAlpha = a * op; c.save(); c.translate(x, y); c.scale(esc, esc); papa(c, 0, 0, 100, ang); c.restore();
      }
      i0 += n;
    }
    c.globalCompositeOperation = 'lighter';   // chispas de sal que titilan
    for (let i = 0; i < 70; i++) {
      const ph = t * (1.5 + azar(i + 40) * 2.5) + azar(i + 41) * 6.28, br = Math.max(0, Math.sin(ph)) ** 6; if (br < 0.05) continue;
      const x = wa * azar(i + 42), y = (h * azar(i + 43) + dt * h * 0.12) % h, r = h * (0.006 + 0.01 * azar(i + 44)) * (0.6 + br);
      const g = c.createRadialGradient(x, y, 0, x, y, r * 4); g.addColorStop(0, `rgba(255,252,235,${0.95 * br * a})`); g.addColorStop(1, 'rgba(255,230,160,0)');
      c.globalAlpha = 1; c.fillStyle = g; c.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    }
    c.restore();
  }
  function medialuna(c, x, y, a) {   // medialuna dorada (desayuno argentino), forma genérica
    c.save(); c.translate(x, y);
    const g = c.createLinearGradient(0, -a * 0.3, 0, a * 0.3); g.addColorStop(0, '#f3b45a'); g.addColorStop(1, '#9a5214');
    c.fillStyle = g; c.beginPath(); c.arc(0, a * 0.35, a * 0.62, Math.PI * 1.12, Math.PI * 1.88); c.arc(0, a * 0.62, a * 0.5, Math.PI * 1.8, Math.PI * 1.2, true); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(110,50,10,0.55)'; c.lineWidth = a * 0.02;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(k * a * 0.12, -a * 0.2); c.quadraticCurveTo(k * a * 0.15, 0, k * a * 0.13, a * 0.08); c.stroke(); }
    c.restore();
  }
  function taza(c, x, y, a, t) {   // taza de café con plato y vapor (genérica)
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(x, y + a * 0.05, a * 0.62, a * 0.09, 0, 0, Math.PI * 2); c.fill();
    let g = c.createLinearGradient(x - a * 0.6, 0, x + a * 0.6, 0); g.addColorStop(0, '#d9d2c6'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(1, '#bfb6a8');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y, a * 0.6, a * 0.08, 0, 0, Math.PI * 2); c.fill();                 // plato
    c.beginPath(); c.moveTo(x - a * 0.36, y - a * 0.62); c.lineTo(x + a * 0.36, y - a * 0.62); c.lineTo(x + a * 0.28, y - a * 0.06); c.quadraticCurveTo(x, y + a * 0.02, x - a * 0.28, y - a * 0.06); c.closePath(); c.fill();   // taza
    c.strokeStyle = '#e8e1d6'; c.lineWidth = a * 0.06; c.beginPath(); c.arc(x + a * 0.4, y - a * 0.36, a * 0.13, -Math.PI / 2, Math.PI / 2); c.stroke();   // asa
    g = c.createRadialGradient(x, y - a * 0.62, 0, x, y - a * 0.62, a * 0.36); g.addColorStop(0, '#c8955e'); g.addColorStop(0.7, '#5a2c10'); g.addColorStop(1, '#3a1a08');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y - a * 0.62, a * 0.34, a * 0.06, 0, 0, Math.PI * 2); c.fill();        // café con crema
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = `rgba(255,240,225,${0.16 + 0.06 * Math.sin(t * 1.2 + k)})`; c.lineWidth = a * 0.035; c.beginPath();
      for (let j = 0; j <= 14; j++) { const yy = y - a * 0.7 - j * a * 0.06, xx = x + (k - 1) * a * 0.12 + Math.sin(j * 0.6 + t * 1.4 + k * 2) * a * 0.05; j ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
      c.stroke();
    }
    c.restore();
  }
  function fondoAmanecer(c, vn, t) {   // desayuno: amanecer cálido, crema y café (sin rojo dominante)
    const g = c.createLinearGradient(0, 380, 0, 1650);
    g.addColorStop(0, '#2a1208'); g.addColorStop(0.18, '#a8521a'); g.addColorStop(0.3, '#f0a042'); g.addColorStop(0.42, '#ffe2b0'); g.addColorStop(0.62, '#7a3a14'); g.addColorStop(1, '#2a1208');
    c.fillStyle = g; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    const sy = 760 - (t - 5) * 18, sol = c.createRadialGradient(1250, sy, 0, 1250, sy, 520);
    sol.addColorStop(0, 'rgba(255,246,214,0.9)'); sol.addColorStop(0.25, 'rgba(255,214,140,0.5)'); sol.addColorStop(1, 'rgba(255,170,80,0)');
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = sol; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8); c.restore();
    vineta(c, vn, 0.4);
  }
  function digito(c, txt, x, y, tam, a, esc) {   // número de la cuenta regresiva, con aro de luz detrás
    if (a <= 0) return;
    c.save(); c.globalAlpha = cl(a, 0, 1);
    c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(255,200,110,0.55)'; c.lineWidth = tam * 0.06;
    c.beginPath(); c.arc(x, y, tam * (0.55 + 0.25 * esc), 0, Math.PI * 2); c.stroke();
    c.globalCompositeOperation = 'source-over';
    c.translate(x, y); c.scale(0.8 + 0.2 * esc, 0.8 + 0.2 * esc);
    c.font = `800 ${tam}px ${FUENTE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const g = c.createLinearGradient(0, -tam / 2, 0, tam / 2); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ffc72c');
    c.fillStyle = g; c.fillText(txt, 0, tam * 0.04);
    c.restore();
  }
  // ---------- P · LA IDEA DEL PROMPT: paleta, texto y producto pedidos (generado en vivo, sin IA) ----------
  let PERSONAL = { colores: ['#DA291C', '#FFC72C', '#27251F'], titular: '', producto: null, marca: "McDonald's", energia: 1 };
  function setPersonal(p) { PERSONAL = Object.assign({ colores: ['#DA291C', '#FFC72C'], titular: '', producto: null, marca: "McDonald's", energia: 1 }, p || {}); }
  const rgbDe = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lumDe = (q) => (q[0] * 0.3 + q[1] * 0.59 + q[2] * 0.11) / 255;
  function tonosP() {   // principal (más saturado), acento (otro), oscuro (base)
    const cols = (PERSONAL.colores.length ? PERSONAL.colores : ['#DA291C', '#FFC72C']).map(rgbDe);
    const sat = (q) => Math.max(...q) - Math.min(...q);
    const orden = cols.slice().sort((x, y) => sat(y) - sat(x) || lumDe(x) - lumDe(y));
    const princ = orden[0], acento = orden[1] || [255, 236, 200], claro = cols.slice().sort((x, y) => lumDe(y) - lumDe(x))[0];
    return { princ, acento, claro, oscuro: princ.map((v) => Math.round(v * 0.12)) };
  }
  const rgba = (q, a) => `rgba(${q[0]},${q[1]},${q[2]},${a})`;
  function fondoP(c, vn, t, calma) {   // mismo volumen que el rojo de marca, con los colores pedidos
    const T = tonosP(), caja = [vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8];
    c.fillStyle = rgba(T.oscuro, 1); c.fillRect(...caja);
    c.save(); c.globalCompositeOperation = 'lighter';
    const fx = 1250 + 160 * Math.sin(t * 0.35 * PERSONAL.energia), fy = 470;
    let g = c.createRadialGradient(fx, fy, 20, fx, fy, 860);
    g.addColorStop(0, rgba(T.claro, 0.9)); g.addColorStop(0.28, rgba(T.princ, 0.95)); g.addColorStop(0.7, rgba(T.princ.map((v) => v * 0.35 | 0), 0.6)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(...caja);
    const ax = 900 + 500 * Math.sin(t * 0.22 + 1.3), ay = 640;   // segunda fuente con el acento: une las dos pantallas
    g = c.createRadialGradient(ax, ay, 10, ax, ay, 620); g.addColorStop(0, rgba(T.acento, 0.55 * (1 - calma * 0.5))); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(...caja);
    c.save(); c.translate(YM.cx, YM.cy); c.scale(3.2, 1); c.translate(-YM.cx, -YM.cy);
    g = c.createRadialGradient(YM.cx, YM.cy, 10, YM.cx, YM.cy, 260); g.addColorStop(0, rgba(T.princ, 1)); g.addColorStop(0.5, rgba(T.princ.map((v) => v * 0.6 | 0), 0.8)); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(YM.cx - 300, YM.cy - 300, 600, 600); c.restore();
    c.restore();
    vineta(c, vn, 0.5);
  }
  function tamQueEntra(c, txt, maxAncho, tam) { let px = tam; c.font = `800 ${px}px ${FUENTE}`; while (c.measureText(txt).width > maxAncho && px > 18) { px *= 0.92; c.font = `800 ${px}px ${FUENTE}`; } return px; }
  function titular(c, txt, cx, cy, maxAncho, tam, a, desliz, fijo) {   // texto pedido: blanco con halo del color principal, se ajusta al ancho
    if (!txt || a <= 0) return;
    const T = tonosP();
    c.save(); c.globalAlpha = cl(a, 0, 1); c.textAlign = 'center'; c.textBaseline = 'middle';
    const px = fijo || tamQueEntra(c, txt, maxAncho, tam); c.font = `800 ${px}px ${FUENTE}`;
    const x = cx + (desliz || 0);
    c.shadowColor = rgba(T.princ.map((v) => Math.min(255, v + 60)), 0.9); c.shadowBlur = px * 0.35;
    c.fillStyle = '#ffffff'; c.fillText(txt, x, cy);
    c.shadowBlur = 0; c.globalCompositeOperation = 'lighter'; c.globalAlpha = cl(a, 0, 1) * 0.35;
    const g = c.createLinearGradient(x - maxAncho / 2, 0, x + maxAncho / 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, rgba(T.acento, 1)); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillText(txt, x, cy);
    c.restore();
  }
  function partirTitular(txt) {   // dos mitades por palabras (Corrientes | Pellegrini) cuando no hay producto
    const w = txt.split(/\s+/).filter(Boolean); if (w.length < 2) return [txt, ''];
    let mejor = 1, dif = 1e9;
    for (let i = 1; i < w.length; i++) { const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length); if (d < dif) { dif = d; mejor = i; } }
    return [w.slice(0, mejor).join(' '), w.slice(mejor).join(' ')];
  }
  function helado(c, x, y, a, t) {   // vaso de helado con remolino (genérico, sin envase de marca); base en y
    const T = tonosP(), h = a * 0.95, wTop = a * 0.62, wBot = a * 0.44;
    c.save();
    let g = c.createLinearGradient(x - wTop / 2, 0, x + wTop / 2, 0); g.addColorStop(0, '#d9dde6'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#c4c9d3');
    c.fillStyle = g; c.beginPath(); c.moveTo(x - wTop / 2, y - h * 0.62); c.lineTo(x + wTop / 2, y - h * 0.62); c.lineTo(x + wBot / 2, y); c.lineTo(x - wBot / 2, y); c.closePath(); c.fill();
    c.fillStyle = rgba(T.princ, 0.9); c.fillRect(x - wTop * 0.47, y - h * 0.42, wTop * 0.94 - (wTop - wBot) * 0.25, h * 0.12);
    for (let k = 0; k < 4; k++) {   // remolino
      const r = wTop * (0.5 - k * 0.1), yy = y - h * 0.62 - k * h * 0.11 - Math.sin(t * 2 + k) * 2;
      g = c.createRadialGradient(x - r * 0.3, yy - r * 0.3, 2, x, yy, r); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e8e2d8');
      c.fillStyle = g; c.beginPath(); c.ellipse(x, yy, r, r * 0.42, 0, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'rgba(40,30,30,0.85)';   // trocitos (galleta)
    for (let k = 0; k < 14; k++) { const ax = x + (azar(k) - 0.5) * wTop * 0.7, ay = y - h * 0.66 - azar(k + 9) * h * 0.3; c.fillRect(ax, ay, a * 0.03, a * 0.022); }
    c.restore();
  }
  function cucurucho(c, x, y, a) {   // cucurucho de papas (genérico): bastones dorados saliendo de un sobre del color principal
    const T = tonosP();
    for (let k = 0; k < 9; k++) papa(c, x - a * 0.22 + k * a * 0.055, y - a * 0.62 - azar(k) * a * 0.18, a * 0.5, -Math.PI / 2 + (k - 4) * 0.06);
    c.save(); c.fillStyle = rgba(T.princ, 1); c.beginPath(); c.moveTo(x - a * 0.3, y - a * 0.55); c.lineTo(x + a * 0.3, y - a * 0.55); c.lineTo(x + a * 0.22, y); c.lineTo(x - a * 0.22, y); c.closePath(); c.fill(); c.restore();
  }
  function productoEn(c, vn, t, escala) {   // el producto entra ENTERO en la pantalla (se escala por el alto real de la ventana)
    const p = PERSONAL.producto, h = vn.y1 - vn.y0, x = (vn.x0 + vn.x1) / 2, base = vn.y1 - h * 0.07, e = escala || 1;
    if (p === 'helado') return helado(c, x, base, h * 0.66 * e, t);
    if (p === 'papas') return cucurucho(c, x, base, h * 0.78 * e);
    if (p === 'cafe') { taza(c, x + h * 0.3, base - h * 0.32, h * 0.62 * e, t); medialuna(c, x - h * 0.42, base - h * 0.3, h * 0.62 * e); return; }
    return hamburguesa(c, x, base, h * 1.55 * e, t);
  }
  function titularEn(c, txt, vn, a, desliz) {   // ocupa la pantalla: una línea si es corto, dos si es largo
    if (!txt) return;
    const w = (vn.x1 - vn.x0) * 0.88, h = vn.y1 - vn.y0, cx = (vn.x0 + vn.x1) / 2, cy = (vn.y0 + vn.y1) / 2;
    const pal = txt.split(/\s+/).filter(Boolean);
    if (pal.length >= 3 && txt.length > 14 && (vn.x1 - vn.x0) / h < 3.5) {   // la banda media (muy panorámica) siempre en una línea
      const [l1, l2] = partirTitular(txt);
      const px = Math.min(tamQueEntra(c, l1, w, h * 0.36), tamQueEntra(c, l2, w, h * 0.36));   // las dos líneas con el mismo cuerpo
      titular(c, l1, cx, cy - h * 0.2, w, px, a, desliz, px); titular(c, l2, cx, cy + h * 0.2, w, px, a, -(desliz || 0), px);
    } else titular(c, txt, cx, cy, w, h * 0.55, a, desliz);
  }
  function revelacionP(c, id, vn, t) {
    fondoP(c, vn, t, 0.3); particulas(c, vn, t, 0.5, 60); revelado(c, id, vn, t);
    const s = sOrbe(t), p = enCamino(s), nace = sv((t - ORBE_T0 + 0.1) / 0.5);
    cinta(c, Math.max(0, s - 0.16), s, t, 0.7 * nace); orbe(c, p[0], p[1], 15, nace);
  }
  function takeoverP(c, id, vn, t) {
    const k = sv((t - 5) / 0.6);
    fondoP(c, vn, t, 0);
    particulas(c, vn, t, 0.65, Math.round(80 * PERSONAL.energia));
    anillos(c, 5.1, t, 1240, 520);
    const tit = (PERSONAL.titular || '').toUpperCase();
    const entra = (d) => sv((t - d) / 0.55), desl = (d) => 120 * (1 - sv((t - d) / 0.7));
    if (PERSONAL.producto) {
      if (id === 'pellegrini') productoEn(c, VEN.pellegrini, t, 0.92 + 0.08 * entra(5.2));
      if (id === 'corrientes') { if (tit) titularEn(c, tit, VEN.corrientes, entra(5.4), -desl(5.4)); else productoEn(c, VEN.corrientes, t, 1.1); }
    } else if (tit) {
      const [a1, a2] = partirTitular(tit);
      if (id === 'corrientes') titularEn(c, a2 ? a1 : tit, VEN.corrientes, entra(5.3), -desl(5.3));
      if (id === 'pellegrini') titularEn(c, a2 || tit, VEN.pellegrini, entra(5.9), desl(5.9));
    } else { columnasLuz(c, t, 0.8 * k); cinta(c, 0, 1, t, k); }
    if (id === 'media') marca(c, YM.cx, YM.cy, 66, sv((t - 5.6) / 0.8), cl((t - 6.4) / 1.8, 0, 1));
  }
  function firmaP(c, id, vn, t) {
    fondoP(c, vn, t, 0.6);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    particulas(c, vn, t, 0.4, 50); ondasFirma(c, vn, t, 0.9);
    const tit = (PERSONAL.titular || '').toUpperCase();
    if (id === 'media') marca(c, YM.cx, YM.cy, 62, 1);
    else if (tit && id === 'corrientes') titularEn(c, tit, vn, 0.95);
    else if (PERSONAL.producto && id === 'pellegrini') productoEn(c, vn, t, 0.95);
    else if (tit && id === 'pellegrini') titularEn(c, PERSONAL.marca.toUpperCase(), vn, 0.9);
  }
  function takeover(c, id, vn, t, cr) {   // 5–10 s: máxima presencia de pantallas
    if (cr === 'P') return takeoverP(c, id, vn, t);
    const k = sv((t - 5) / 0.6);
    if (cr === 'D') {   // PAPAS: lluvia de papas doradas que atraviesa las 3 pantallas como un solo espacio
      fondoRojo(c, vn, t, 0.12);
      lluviaPapas(c, vn, t);
      if (id === 'media') marca(c, YM.cx, YM.cy, 66, sv((t - 6.2) / 0.8), cl((t - 7) / 1.6, 0, 1));
      return;
    }
    if (cr === 'E') {   // DESAYUNO: amanecer cálido, café y medialuna; la marca entra suave
      fondoAmanecer(c, vn, t);
      particulas(c, vn, t, 0.35, 50);
      const pa = sv((t - 5.2) / 1);
      if (id === 'pellegrini') taza(c, 1648, 690 + 20 * (1 - pa), 190, t);
      if (id === 'corrientes') medialuna(c, 835, 610 + 15 * (1 - pa), 230 * (0.95 + 0.05 * pa));
      if (id === 'media') marca(c, YM.cx, YM.cy, 62, sv((t - 5.8) / 1));
      return;
    }
    if (cr === 'F') {   // LANZAMIENTO: cuenta regresiva que salta de pantalla en pantalla, destello y revelación del producto
      fondoRojo(c, vn, t, 0.05);
      c.fillStyle = `rgba(0,0,0,${0.55 * (1 - sv((t - 7.1) / 0.3))})`; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
      const paso = (desde, hasta) => sv((t - desde) / 0.15) * (1 - sv((t - hasta + 0.15) / 0.15));
      if (id === 'corrientes') digito(c, '3', 835, 600, 150, paso(5, 5.7), cl((t - 5) / 0.7, 0, 1));
      if (id === 'pellegrini') digito(c, '2', 1648, 588, 160, paso(5.7, 6.4), cl((t - 5.7) / 0.7, 0, 1));
      if (id === 'media') digito(c, '1', YM.cx, YM.cy, 80, paso(6.4, 7.1), cl((t - 6.4) / 0.7, 0, 1));
      if (t >= 7.1) {
        particulas(c, vn, t, 0.8, 110);
        anillos(c, 7.1, t, 1240, 560);
        const pa = sv((t - 7.2) / 0.8);
        if (id === 'pellegrini') hamburguesa(c, 1648, 668 + 25 * (1 - pa), 290 * (0.9 + 0.1 * pa), t);
        if (id === 'corrientes') columnasLuz(c, t, 0.7);
        if (id === 'media') marca(c, YM.cx, YM.cy, 66, sv((t - 7.4) / 0.6), cl((t - 8) / 1.5, 0, 1));
        const fl = 1 - sv((t - 7.1) / 0.45);   // destello
        if (fl > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,236,200,${0.85 * fl})`; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8); c.restore(); }
      }
      return;
    }
    if (cr === 'B') {   // PRODUCT HERO: fondo oscuro cálido, el producto manda
      fondoRojo(c, vn, t, 0.0);
      c.fillStyle = 'rgba(10,0,0,0.42)'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
      particulas(c, vn, t, 0.5, 60);
      const pa = sv((t - 5.1) / 0.9);
      if (id === 'pellegrini') hamburguesa(c, 1648, 665 + 30 * (1 - pa), 300 * (0.92 + 0.08 * pa), t);
      if (id === 'corrientes') { const z = 1.05 + 0.12 * (t - 5) / 5, an = 300 * z; hamburguesa(c, 835, 600 + 0.3 * an, an, t); }   // el mismo producto, más cerca (empuje lento)   // macro del mismo producto: la cúpula del pan llena el panel   // macro del mismo producto
      if (id === 'media') { ondasFirma(c, vn, t, 0.35 * k); marca(c, YM.cx, YM.cy, 66, sv((t - 5.4) / 0.8), cl((t - 6.2) / 1.6, 0, 1)); }
    } else if (cr === 'A') {   // BRAND DOMINANCE: un solo nombre gigante que abarca ambas pantallas + pilastras de luz
      fondoRojo(c, vn, t, 0.1);
      columnasLuz(c, t, 0.9 * k);
      particulas(c, vn, t, 0.5, 70);
      if (id !== 'media' && CORTE.permitido) marca(c, 1240 - 40 * (t - 5) / 5, 600, 180, sv((t - 5.2) / 0.8), cl((t - 6) / 2.4, 0, 1));   // pedido: una pieza
      else if (id !== 'media') {   // regla de corte: el nombre entero en cada pantalla; el brillo cruza de Corrientes a Pellegrini
        const izq = id === 'corrientes';
        marcaEnVentana(c, vn, sv((t - (izq ? 5.2 : 5.6)) / 0.8), cl((t - (izq ? 6 : 7.1)) / 1.2, 0, 1));
      }
      else { cinta(c, 0.6, 1, t, 0.55 * k); marca(c, YM.cx, YM.cy, 64, sv((t - 5.6) / 0.8)); }
    } else {   // C · ICONIC MOMENT: el rastro del elemento se vuelve una cinta continua y la marca aparece donde aterrizó
      fondoRojo(c, vn, t, 0.08);
      particulas(c, vn, t, 0.75, 110);
      anillos(c, 5.1, t, 1240, 500);
      cinta(c, 0, 1, t, k);
      const ps = enCamino((t - 5) / 5 % 1);
      orbe(c, ps[0], ps[1], 11, 0.8 * k);
      if (id === 'media') marca(c, YM.cx, YM.cy, 66, sv((t - 5.3) / 0.8), cl((t - 6.4) / 1.8, 0, 1));
    }
  }
  function firma(c, id, vn, t, cr) {   // 10–13 s: oro y calidez; la onda dorada como firma; marca serena
    if (cr === 'P') return firmaP(c, id, vn, t);
    fondoRojo(c, vn, t, 0.55);
    c.fillStyle = 'rgba(30,6,0,0.25)'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    particulas(c, vn, t, 0.45, 60);
    ondasFirma(c, vn, t, 1);
    if (id === 'media') marca(c, YM.cx, YM.cy, 62, 1);
    else if (cr === 'B' && id === 'pellegrini') hamburguesa(c, 1648, 668, 280, t);
    else if (cr === 'A') { if (CORTE.permitido) marca(c, 1240, 600, 160, 0.9); else marcaEnVentana(c, vn, 0.9); }   // A: una pieza solo si se pidió
    else { const g = c.createRadialGradient(1250, 470, 0, 1250, 470, 700); g.addColorStop(0, 'rgba(255,200,110,0.22)'); g.addColorStop(1, 'rgba(255,200,110,0)');
      c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.fillRect(vn.x0, vn.y0, vn.x1 - vn.x0, vn.y1 - vn.y0); c.restore(); }
  }
  function enMomento(c, id, vn, t, cr) {
    if (t < 2) return previa(c, id, vn, t);
    if (t < 5) return cr === 'P' ? revelacionP(c, id, vn, t) : revelacion(c, id, vn, t);
    if (t < 10) return takeover(c, id, vn, t, cr);
    if (t < 13) return firma(c, id, vn, t, cr);
    return previa(c, id, vn, t);
  }
  // Fundidos entre momentos (sin cortes): el momento siguiente se dibuja en una capa auxiliar y se funde encima.
  const AUX = {};
  function fundir(cv, id, vn, dibA, dibB, a) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    aMundo(c, w, h, vn); dibA(c);
    if (a <= 0) return;
    if (!AUX[id]) AUX[id] = document.createElement('canvas');
    const x = AUX[id]; if (x.width !== w || x.height !== h) { x.width = w; x.height = h; }
    const xc = x.getContext('2d'); xc.setTransform(1, 0, 0, 1, 0, 0); xc.globalAlpha = 1; xc.globalCompositeOperation = 'source-over'; xc.clearRect(0, 0, w, h);
    aMundo(xc, w, h, vn); dibB(xc);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = a; c.drawImage(x, 0, 0); c.globalAlpha = 1;
  }
  function show(cv, id, vn, t, cr) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    aMundo(c, w, h, vn);
    if (t >= 1.3 && t < 2.15) {   // la noche se apaga a negro antes de que nazca el elemento
      previa(c, id, vn, t); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = `rgba(0,0,0,${sv((t - 1.3) / 0.75)})`; c.fillRect(0, 0, w, h); return;
    }
    if (t >= 4.85 && t < 5.35) return fundir(cv, id, vn, (k) => (cr === 'P' ? revelacionP : revelacion)(k, id, vn, Math.min(t, 4.99)), (k) => takeover(k, id, vn, Math.max(t, 5), cr), sv((t - 4.85) / 0.5));
    if (t >= 9.6 && t < 10.4) return fundir(cv, id, vn, (k) => takeover(k, id, vn, t, cr), (k) => firma(k, id, vn, t, cr), sv((t - 9.6) / 0.8));
    if (t >= 12.6 && t < 13.6) return fundir(cv, id, vn, (k) => firma(k, id, vn, t, cr), (k) => previa(k, id, vn, t), sv((t - 12.6) / 1));
    enMomento(c, id, vn, t, cr);
  }

  // ---------- MATERIAL SUBIDO (AI Content Studio): capa encima del contenido generado, en píxeles REALES de la pantalla ----------
  // Los lienzos de contenido tienen la proporción de cada superficie (A 1152×576 = 2:1 · B 1440×576 = 2,5:1 · marquesina
  // 1920×412): un recorte con esa proporción se dibuja sin deformar. NUNCA se estira: cubrir (crop con foco), master A+B
  // (crop 2592×576 partido en A y B), contener (reencuadre + fondo extendido desenfocado), logo (contenido) o paleta.
  let MEDIA = null;
  function setMedia(m) { MEDIA = m; }
  const dimsDe = (el) => (el.videoWidth ? [el.videoWidth, el.videoHeight] : [el.naturalWidth || el.width, el.naturalHeight || el.height]);
  function recorteCubrir(sw, sh, asp, foco) {
    let cw = sw, ch = sw / asp; if (ch > sh) { ch = sh; cw = sh * asp; }
    const fx = foco ? foco[0] : 0.5, fy = foco ? foco[1] : 0.5;
    return [(sw - cw) * fx, (sh - ch) * fy, cw, ch];
  }
  function paletaMov(c, w, h, t, paleta, a) {   // motion background con la paleta del material (contenido generado combinado)
    const cols = (paleta && paleta.length ? paleta : ['#DA291C', '#FFC72C', '#27251F']).map((x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]);
    const lum = (q) => q[0] * 0.3 + q[1] * 0.59 + q[2] * 0.11, sat = (q) => Math.max(...q) - Math.min(...q);
    const oscuro = cols.slice().sort((x, y) => lum(x) - lum(y))[0], vivos = cols.slice().sort((x, y) => sat(y) - sat(x));
    c.save(); c.globalAlpha = a;
    c.fillStyle = `rgb(${oscuro.map((v) => Math.round(v * 0.35)).join(',')})`; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    vivos.slice(0, 3).forEach((q, k) => {
      const x = w * (0.5 + 0.42 * Math.sin(t * (0.35 + k * 0.17) + k * 2.1)), y = h * (0.5 + 0.3 * Math.sin(t * 0.5 + k)), r = Math.max(w, h) * (0.35 + 0.1 * k);
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${q.join(',')},0.55)`); g.addColorStop(1, `rgba(${q.join(',')},0)`);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    const sx = ((t * 0.18) % 1.4 - 0.2) * w, g2 = c.createLinearGradient(sx - w * 0.08, 0, sx + w * 0.08, 0);   // rastro de luz
    g2.addColorStop(0, 'rgba(255,220,150,0)'); g2.addColorStop(0.5, 'rgba(255,230,170,0.5)'); g2.addColorStop(1, 'rgba(255,220,150,0)');
    c.fillStyle = g2; c.fillRect(sx - w * 0.08, 0, w * 0.16, h);
    c.restore();
  }
  // Capa de material. Además de los modos de siempre, cada tramo puede animar el material (19/10, Fer: «animalo, que no
  // quede en materiales»): rect = recorte normalizado de la fuente [x, y, an, al]; kb = Ken Burns {z: [desde, hasta],
  // f: [[fx, fy], [fx, fy]]} (zoom y foco que viajan durante el tramo); entra = 'izq' | 'der' | 'abajo' (deslizamiento de
  // 0,5 s). Los tramos que se solapan se funden entre sí (antes se dibujaba uno solo y el cruce pasaba por el fondo).
  const lerp2 = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  // La marquesina se ve mucho más alargada en el edificio que su lienzo (1920×412): la foto la estira ~k veces a lo ancho.
  // Para que lo que se ve en la calle no quede deformado, la media se compone «pre-comprimida» por ese factor (medido de la geometría).
  function estiramiento(id) {
    const m = VEN.media; if (id !== 'media' || !m || !(m.y1 > m.y0)) return 1;
    return Math.max(1, Math.min(4, ((m.x1 - m.x0) / (m.y1 - m.y0)) / (1920 / 412)));
  }
  function tramoMedia(c, w, h, seg, t, id) {
    const k = estiramiento(id), wa = w * k;   // ancho «aparente» con el que se compone
    const dur = Math.max(0.01, seg.hasta - seg.desde), u = cl((t - seg.desde) / dur, 0, 1);
    const fi = seg.fundido == null ? 0.35 : seg.fundido, a = sv((t - seg.desde) / fi) * sv((seg.hasta - t) / fi);
    if (seg.modo === 'paleta' || seg.modo === 'logo') paletaMov(c, w, h, t, seg.paleta, a);
    const el = seg.modo === 'paleta' ? null : MEDIA.fuentes[seg.fuente]; if (!el) return;
    if (seg.src && MEDIA.sincronizar) MEDIA.sincronizar(seg, t);
    const [W0, H0] = dimsDe(el); if (!W0 || !H0) return;
    const R = seg.rect ? [seg.rect[0] * W0, seg.rect[1] * H0, seg.rect[2] * W0, seg.rect[3] * H0] : [0, 0, W0, H0];
    const kb = seg.kb || {}, z = kb.z ? kb.z[0] + (kb.z[1] - kb.z[0]) * sv(u) : 1, foco = kb.f ? lerp2(kb.f[0], kb.f[1], sv(u)) : (seg.foco || [0.5, 0.5]);
    const e = seg.entra ? 1 - sv((t - seg.desde) / 0.5) : 0;
    const dx = seg.entra === 'izq' ? -w * e : seg.entra === 'der' ? w * e : 0, dy = seg.entra === 'abajo' ? h * e : 0;
    c.save(); c.globalAlpha = a; c.translate(dx, dy);
    if (seg.modo === 'cubrir') {
      let cw = R[2], ch = R[2] / (wa / h); if (ch > R[3]) { ch = R[3]; cw = R[3] * (wa / h); }
      cw /= z; ch /= z;
      const x = R[0] + (R[2] - cw) * cl(foco[0], 0, 1), y = R[1] + (R[3] - ch) * cl(foco[1], 0, 1);
      c.drawImage(el, x, y, cw, ch, 0, 0, w, h);
    } else if (seg.modo === 'master') {
      const r = recorteCubrir(W0, H0, 2592 / 576, seg.foco), fa = 1152 / 2592;
      const sub = seg.parte === 'a' ? [r[0], r[1], r[2] * fa, r[3]] : [r[0] + r[2] * fa, r[1], r[2] * (1 - fa), r[3]];
      c.drawImage(el, sub[0], sub[1], sub[2], sub[3], 0, 0, w, h);
    } else if (seg.modo === 'contener') {   // el recorte entero + el mismo material desenfocado de fondo (o el color del tramo)
      const cx0 = seg.caja ? w * seg.caja[0] : 0, cw0 = seg.caja ? w * seg.caja[1] : w;   // «caja»: franja horizontal de destino [x, ancho] (pantallas muy anchas, como la media)
      if (seg.sinFondo) { /* capa encima de otra del mismo tramo */ }
      else if (seg.fondo) { c.fillStyle = seg.fondo; c.fillRect(cx0, 0, cw0, h); }
      else {
        let cw = R[2], ch = R[2] / (w / h); if (ch > R[3]) { ch = R[3]; cw = R[3] * (w / h); }
        c.filter = `blur(${Math.round(h * 0.06)}px) brightness(0.45)`; c.drawImage(el, R[0] + (R[2] - cw) / 2, R[1] + (R[3] - ch) / 2, cw, ch, -w * 0.04, -h * 0.08, w * 1.08, h * 1.16); c.filter = 'none';
      }
      const anch = (seg.caja ? cw0 : seg.lado ? w * 0.5 : w) * k, ka = Math.min(anch / R[2], h / R[3]) * (seg.escala || 0.94) * z, dw = R[2] * ka / k, dh = R[3] * ka, px = seg.caja ? cx0 + cw0 / 2 : seg.lado === 'izq' ? w * 0.26 : seg.lado === 'der' ? w * 0.74 : w / 2;
      c.drawImage(el, R[0], R[1], R[2], R[3], px - dw / 2, (h - dh) / 2, dw, dh);
    } else if (seg.modo === 'logo') {
      const k = Math.min(w * 0.8 / R[2], h * 0.74 / R[3]), dw = R[2] * k, dh = R[3] * k; c.drawImage(el, R[0], R[1], R[2], R[3], (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    c.restore();
  }
  function capaMedia(cv, id, t) {
    const segs = (MEDIA.pistas[id] || []).filter((x) => t >= x.desde && t < x.hasta); if (!segs.length) return null;
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
    for (const seg of segs) tramoMedia(c, w, h, seg, t, id);
    c.restore();
    return segs[segs.length - 1];
  }

  // ---------- entrada ----------
  function dibujar(cv, id, cont) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, vn = VEN[id];
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h);
    const cr = cont.creatividad || 'C'; CR_ACTUAL = cr;
    if (cont.modo === 'show') {
      show(cv, id, vn, cont.t, cr);
      const seg = MEDIA ? capaMedia(cv, id, cont.t) : null;
      if (seg && seg.lluvia === 'papas') lluviaMedia(c, w, h, seg, cont.t, estiramiento(id));
      if (seg && seg.titular) {   // texto del motor SOBRE la pieza (nítido, ajustado a la pantalla; nunca generado por la IA)
        const r0 = seg.retardo == null ? 0.6 : seg.retardo, sube = seg.retardo == null ? 0.5 : Math.max(0.05, seg.retardo || 0.1);   // «retardo» corto: contadores (p. ej. 1986 → 2026)
        const a = sv((cont.t - seg.desde - r0) / sube) * sv((seg.hasta - cont.t) / (seg.retardo == null ? 0.4 : 0.1));
        aMundo(c, w, h, vn); titularEn(c, seg.titular, vn, a);
      }
    }
    else {
      aMundo(c, w, h, vn);
      if (cont.modo === 'marca') takeover(c, id, vn, 7.6, cr);
      else if (cont.modo === 'firma') firma(c, id, vn, 11.6, cr);
      else if (cont.modo === 'diagnostico') diagnostico(c, id, vn);
      else institucional(c, id, vn, 3, cont.modo !== 'institucional');   // EL TRUST solo en «Noche sin campaña»
    }
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  function preparar(G) {
    Object.assign(VEN, ventanas(G));
    const m = VEN.media; YM.cx = (m.x0 + m.x1) / 2; YM.cy = (m.y0 + m.y1) / 2; YM.y = YM.cy;
    // el recorrido baja a la media por su centro real
    for (let i = 10; i < CAMINO.length; i++) CAMINO[i][1] = YM.cy;
    CAMINO[9][1] = YM.cy - 260;
    LARGO.length = 1; for (let i = 1; i < CAMINO.length; i++) LARGO.push(LARGO[i - 1] + Math.hypot(CAMINO[i][0] - CAMINO[i - 1][0], CAMINO[i][1] - CAMINO[i - 1][1]));
    return VEN;
  }
  window.CONTENIDO = { setCorte, corte: () => CORTE.permitido, preparar, dibujar, enCamino, ventanas: () => VEN, setMedia, hayMedia: () => !!MEDIA, recorteCubrir, setPersonal, personal: () => JSON.parse(JSON.stringify(PERSONAL)) };
})();
