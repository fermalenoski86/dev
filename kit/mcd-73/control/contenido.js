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
  function ventanas(G) {
    MW = G.foto.noche.ancho; MH = G.foto.noche.alto;
    const v = {};
    for (const [id, s] of Object.entries(G.superficies)) {
      const q = s.quads;
      if (q.length === 1) {
        const p = q[0];
        v[id] = { x0: Math.min(p[0][0], p[3][0]) * MW, x1: Math.max(p[1][0], p[2][0]) * MW, y0: (p[0][1] + p[1][1]) / 2 * MH, y1: (p[2][1] + p[3][1]) / 2 * MH };
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
  function hamburguesa(c, x, y, a, t) {   // producto genérico ilustrado, con luz de borde y vapor (base en y)
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
  function institucional(c, id, vn, t) {   // NIGHT_IDLE / reposo: azul noche, horizonte dorado continuo, marca del edificio sobria
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
    c.fillStyle = '#e8c27a'; c.fillText('EL TRUST', cx + alto * 0.05, vn.y0 + alto * 0.46); c.restore();
    vineta(c, vn, 0.45);
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
  function takeover(c, id, vn, t, cr) {   // 5–10 s: máxima presencia de pantallas
    const k = sv((t - 5) / 0.6);
    if (cr === 'B') {   // PRODUCT HERO: fondo oscuro cálido, el producto manda
      fondoRojo(c, vn, t, 0.0);
      c.fillStyle = 'rgba(10,0,0,0.42)'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
      particulas(c, vn, t, 0.5, 60);
      const pa = sv((t - 5.1) / 0.9);
      if (id === 'pellegrini') hamburguesa(c, 1648, 665 + 30 * (1 - pa), 300 * (0.92 + 0.08 * pa), t);
      if (id === 'corrientes') { const z = 2.4 + 0.3 * (t - 5) / 5, an = 300 * z; hamburguesa(c, 800 + 50 * (t - 5) / 5, 640 + 0.4 * an, an, t); }   // macro del mismo producto: la cúpula del pan llena el panel   // macro del mismo producto
      if (id === 'media') { ondasFirma(c, vn, t, 0.35 * k); marca(c, YM.cx, YM.cy, 66, sv((t - 5.4) / 0.8), cl((t - 6.2) / 1.6, 0, 1)); }
    } else if (cr === 'A') {   // BRAND DOMINANCE: un solo nombre gigante que abarca ambas pantallas + pilastras de luz
      fondoRojo(c, vn, t, 0.1);
      columnasLuz(c, t, 0.9 * k);
      particulas(c, vn, t, 0.5, 70);
      if (id !== 'media') marca(c, 1240 - 40 * (t - 5) / 5, 600, 236, sv((t - 5.2) / 0.8), cl((t - 6) / 2.4, 0, 1));
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
    fondoRojo(c, vn, t, 0.55);
    c.fillStyle = 'rgba(30,6,0,0.25)'; c.fillRect(vn.x0 - 4, vn.y0 - 4, vn.x1 - vn.x0 + 8, vn.y1 - vn.y0 + 8);
    particulas(c, vn, t, 0.45, 60);
    ondasFirma(c, vn, t, 1);
    if (id === 'media') marca(c, YM.cx, YM.cy, 62, 1);
    else if (cr === 'B' && id === 'pellegrini') hamburguesa(c, 1648, 668, 280, t);
    else if (cr === 'A') marca(c, 1240, 600, 200, 0.9);   // A: el mismo nombre gigante que une ambas pantallas
    else { const g = c.createRadialGradient(1250, 470, 0, 1250, 470, 700); g.addColorStop(0, 'rgba(255,200,110,0.22)'); g.addColorStop(1, 'rgba(255,200,110,0)');
      c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.fillRect(vn.x0, vn.y0, vn.x1 - vn.x0, vn.y1 - vn.y0); c.restore(); }
  }
  function enMomento(c, id, vn, t, cr) {
    if (t < 2) return institucional(c, id, vn, t);
    if (t < 5) return revelacion(c, id, vn, t);
    if (t < 10) return takeover(c, id, vn, t, cr);
    if (t < 13) return firma(c, id, vn, t, cr);
    return institucional(c, id, vn, t);
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
      institucional(c, id, vn, t); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = `rgba(0,0,0,${sv((t - 1.3) / 0.75)})`; c.fillRect(0, 0, w, h); return;
    }
    if (t >= 4.85 && t < 5.35) return fundir(cv, id, vn, (k) => revelacion(k, id, vn, Math.min(t, 4.99)), (k) => takeover(k, id, vn, Math.max(t, 5), cr), sv((t - 4.85) / 0.5));
    if (t >= 9.6 && t < 10.4) return fundir(cv, id, vn, (k) => takeover(k, id, vn, t, cr), (k) => firma(k, id, vn, t, cr), sv((t - 9.6) / 0.8));
    if (t >= 12.6 && t < 13.6) return fundir(cv, id, vn, (k) => firma(k, id, vn, t, cr), (k) => institucional(k, id, vn, t), sv((t - 12.6) / 1));
    enMomento(c, id, vn, t, cr);
  }

  // ---------- entrada ----------
  function dibujar(cv, id, cont) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, vn = VEN[id];
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h);
    const cr = cont.creatividad || 'C';
    if (cont.modo === 'show') show(cv, id, vn, cont.t, cr);
    else {
      aMundo(c, w, h, vn);
      if (cont.modo === 'marca') takeover(c, id, vn, 7.6, cr);
      else if (cont.modo === 'firma') firma(c, id, vn, 11.6, cr);
      else if (cont.modo === 'diagnostico') diagnostico(c, id, vn);
      else institucional(c, id, vn, 3);
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
  window.CONTENIDO = { preparar, dibujar, enCamino, ventanas: () => VEN };
})();
