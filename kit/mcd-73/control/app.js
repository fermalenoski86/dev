// TRUST Control — interfaz y render sobre la FOTO REAL (inmutable).
// SIMULACIÓN CONCEPTUAL — NO CONECTADA A EQUIPOS REALES. Sin red: no hay fetch, XHR, WebSocket ni WebRTC en este archivo.
//
// Orden de composición por cuadro (de abajo hacia arriba):
//   1. Foto (Noche o Día). Se dibuja entera, con su proporción original: nunca se recorta ni se estira.
//   2. Capa de luces: halo por luminaria, con las PANTALLAS y el RELOJ recortados (destination-out). Se suma en modo
//      "screen": solo aclara la fachada. En Día casi no se ve (como en la realidad), pero los niveles no cambian.
//   3. Reloj: su propia pista (realce o atenuación sobre la esfera de la foto).
//   4. Pantallas: contenido proyectado sobre los cuadriláteros calibrados (homografía por triángulos). Se pintan opacas,
//      DESPUÉS de las luces: ningún halo puede quedar encima del contenido LED.
(function () {
  'use strict';
  const G = window.GEOMETRIA, L = window.LUMINARIAS, M = window.MOTOR;
  const $ = (id) => document.getElementById(id);
  const FW = G.foto.noche.ancho, FH = G.foto.noche.alto;

  // ---------- fotos ----------
  const fotoNoche = new Image();
  fotoNoche.src = G.foto.noche.archivo;
  let fotoDia = null;
  if (G.foto.dia && G.foto.dia.sha256) { fotoDia = new Image(); fotoDia.src = G.foto.dia.archivo; }

  // Posiciones: solo valen si fueron calibradas sobre ESTA foto.
  const posValidas = L && L.foto_sha256 === G.foto.noche.sha256;
  const puntos = Object.assign({}, posValidas ? L.puntos : {});
  let puntosDePrueba = false;

  // ---------- lienzos ----------
  const lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
  const capaLuz = document.createElement('canvas'), lctx = capaLuz.getContext('2d');
  const capaTinte = document.createElement('canvas'), tctx = capaTinte.getContext('2d');
  const CONT = {
    corrientes: mk(576, 288),
    pellegrini: mk(720, 288),
    media: mk(960, 206),
  };
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function ajustarTamano() {
    const esc = $('escenario');   // área interior (sin borde): así el CSS nunca comprime el lienzo
    const k = Math.min(esc.clientWidth / FW, esc.clientHeight / FH);
    const cssW = Math.floor(FW * k), cssH = Math.round(cssW * FH / FW);   // alto derivado del ancho: proporción exacta al píxel
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    lienzo.style.width = cssW + 'px'; lienzo.style.height = cssH + 'px';
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (lienzo.width !== pw || lienzo.height !== ph) {
      lienzo.width = pw; lienzo.height = ph; capaLuz.width = pw; capaLuz.height = ph; capaTinte.width = pw; capaTinte.height = ph;
    }
    ubicarEtiquetas();
    pedirCuadro();
  }

  // ---------- homografía cuadrado unidad → quad ----------
  function homografia(qd) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = qd;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let a, b, c, d, e, f, g, h;
    if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
      a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
    } else {
      const den = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
      a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
      d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
    }
    return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
  }
  // Dibuja la región (sx..sx+sw) de src sobre el quad (en px del lienzo), subdividido en nx×ny celdas de 2 triángulos afines.
  function pintarQuad(c, src, sx, sy, sw, sh, qpx, nx, ny) {
    const H = homografia(qpx);
    const P = [];
    for (let j = 0; j <= ny; j++) { P.push([]); for (let i = 0; i <= nx; i++) P[j].push(H(i / nx, j / ny)); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const s00 = [sx + sw * i / nx, sy + sh * j / ny], s10 = [sx + sw * (i + 1) / nx, sy + sh * j / ny];
      const s01 = [sx + sw * i / nx, sy + sh * (j + 1) / ny], s11 = [sx + sw * (i + 1) / nx, sy + sh * (j + 1) / ny];
      tri(c, src, s00, s10, s11, P[j][i], P[j][i + 1], P[j + 1][i + 1]);
      tri(c, src, s00, s11, s01, P[j][i], P[j + 1][i + 1], P[j + 1][i]);
    }
  }
  function tri(c, src, s0, s1, s2, d0, d1, d2) {
    // Clip con el triángulo destino levemente expandido (evita costuras entre triángulos vecinos).
    const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
    const ex = (p) => { const vx = p[0] - cx, vy = p[1] - cy, l = Math.hypot(vx, vy) || 1; return [p[0] + vx / l * 0.7, p[1] + vy / l * 0.7]; };
    const e0 = ex(d0), e1 = ex(d1), e2 = ex(d2);
    c.save();
    c.beginPath(); c.moveTo(e0[0], e0[1]); c.lineTo(e1[0], e1[1]); c.lineTo(e2[0], e2[1]); c.closePath(); c.clip();
    const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
    const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
    const det = sx1 * sy2 - sx2 * sy1;
    if (Math.abs(det) < 1e-9) { c.restore(); return; }
    const ia = sy2 / det, ib = -sx2 / det, ic = -sy1 / det, id = sx1 / det;
    const m11 = dx1 * ia + dx2 * ic, m12 = dx1 * ib + dx2 * id, m21 = dy1 * ia + dy2 * ic, m22 = dy1 * ib + dy2 * id;
    const tx = d0[0] - m11 * s0[0] - m12 * s0[1], ty = d0[1] - m21 * s0[0] - m22 * s0[1];
    c.setTransform(m11, m21, m12, m22, tx, ty);
    c.drawImage(src, 0, 0);
    c.restore();
  }
  const aPx = (qd, W, H) => qd.map(([x, y]) => [x * W, y * H]);
  function trazarQuad(c, qpx) { c.moveTo(qpx[0][0], qpx[0][1]); for (let i = 1; i < 4; i++) c.lineTo(qpx[i][0], qpx[i][1]); c.closePath(); }

  // ---------- contenido de pantallas (generado en vivo, determinista por t) ----------
  const suave = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
  function fondo(c, w, h, a, b, k) {
    const gr = c.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, a); gr.addColorStop(0.5, b); gr.addColorStop(1, a);
    c.globalAlpha = 1; c.fillStyle = gr; c.fillRect(0, 0, w, h);
    if (k < 1) { c.fillStyle = `rgba(0,0,0,${1 - k})`; c.fillRect(0, 0, w, h); }
  }
  function ondas(c, w, h, t, sem, inten) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 3; j++) {
      const amp = h * (0.13 + 0.05 * j), fr = 1.1 + 0.35 * j, vel = 0.9 + 0.35 * j, ph = sem + j * 1.9;
      const camino = () => { c.beginPath(); for (let x = 0; x <= w; x += 6) { const y = h * 0.5 + amp * Math.sin((x / w) * Math.PI * 2 * fr + t * vel + ph) + h * 0.06 * Math.sin(x / w * 7 + t * 0.6 + j); x ? c.lineTo(x, y) : c.moveTo(x, y); } };
      camino(); c.strokeStyle = `rgba(255,120,30,${0.22 * inten})`; c.lineWidth = h * 0.07; c.stroke();
      camino(); c.strokeStyle = `rgba(255,214,120,${0.85 * inten})`; c.lineWidth = Math.max(1.5, h * 0.012); c.stroke();
    }
    c.restore();
  }
  function texto(c, w, h, txt, alfa, tam, color, esp, y) {
    if (alfa <= 0) return;
    c.save(); c.globalAlpha = Math.min(1, alfa); c.fillStyle = color || '#f6d38a';
    c.font = `700 ${Math.round(h * tam)}px Inter, "Segoe UI", system-ui, sans-serif`;
    if ('letterSpacing' in c) c.letterSpacing = esp || '0px';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = 'rgba(255,190,90,.55)'; c.shadowBlur = h * 0.05;
    c.fillText(txt, w / 2, h * (y == null ? 0.5 : y));
    c.restore();
  }
  function barra(c, w, h, x, ancho) {
    const gr = c.createLinearGradient(x - ancho, 0, x + ancho, 0);
    gr.addColorStop(0, 'rgba(232,182,91,0)'); gr.addColorStop(0.5, 'rgba(255,224,150,1)'); gr.addColorStop(1, 'rgba(232,182,91,0)');
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = gr; c.fillRect(x - ancho, 0, ancho * 2, h); c.restore();
  }
  // Tramo horizontal de cada superficie dentro del "lienzo continuo" Corrientes → media → Pellegrini (para barridos).
  const TRAMO = { corrientes: [0, 1 / 3], media: [1 / 3, 2 / 3], pellegrini: [2 / 3, 1] };
  function dibujarContenido(id, cont) {
    const cv = CONT[id], c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (cont.modo === 'reposo') {
      fondo(c, w, h, '#0a1630', '#14284d', 1);
      c.fillStyle = 'rgba(232,182,91,.55)'; c.fillRect(0, h * 0.86, w, Math.max(1, h * 0.012));
      texto(c, w, h, id === 'media' ? 'EL TRUST · BUENOS AIRES' : 'EL TRUST', 0.9, id === 'media' ? 0.2 : 0.16, '#e8c27a', '0.18em');
      return;
    }
    if (cont.modo === 'marca') {
      fondo(c, w, h, '#7c0808', '#c4140f', 1); ondas(c, w, h, 2, id.length, 0.8);
      texto(c, w, h, "McDonald's", 1, id === 'media' ? 0.36 : 0.22, '#ffd27a', '0.02em');
      return;
    }
    const t = cont.t, [a0, a1] = TRAMO[id];
    if (t < 3) {                                   // Apertura: negro, barrido dorado que revela rojo
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      const g = (t / 3) * 1.2 - 0.1, xl = ((g - a0) / (a1 - a0)) * w;
      if (xl > 0) { c.fillStyle = '#9e0c0b'; c.fillRect(0, 0, Math.min(w, xl), h); }
      barra(c, w, h, xl, w * 0.06);
      if (id === 'media') texto(c, w, h, "McDonald's × EL TRUST", suave((t - 1.8) / 1), 0.3, '#ffd27a', '0.04em');
    } else if (t < 7) {                            // Contenido + ola
      fondo(c, w, h, '#8a0b0a', '#c8150f', 1); ondas(c, w, h, t, a0 * 9, 0.9);
      if (id === 'pellegrini') texto(c, w, h, 'UN MOMENTO SINCRONIZADO', suave((t - 3.8) / 0.9), 0.15, '#ffe1a3', '0.12em');
      if (id === 'media') texto(c, w, h, 'TAKEOVER 15 s', suave((t - 3.4) / 0.8), 0.34, '#ffe1a3', '0.1em');
      if (id === 'corrientes') texto(c, w, h, "McDonald's", suave((t - 3.2) / 0.8), 0.24, '#ffd27a', '0.02em');
    } else if (t < 11) {                           // Takeover conjunto: barrido oro continuo Corrientes → media → Pellegrini
      const pulso = 0.85 + 0.15 * Math.sin((t - 7) * 5);
      fondo(c, w, h, '#a00d0c', '#e01a12', pulso); ondas(c, w, h, t * 1.6, a0 * 9, 1);
      const g = (t - 7) / 4, xl = ((g - a0) / (a1 - a0)) * w;
      barra(c, w, h, xl, w * 0.09);
    } else {                                       // Cierre premium, fade a reposo de marca
      const k = suave((t - 11) / 1.2), f = 1 - 0.55 * suave((t - 13.8) / 1.2);
      fondo(c, w, h, '#4a0605', '#7d0b09', f);
      c.fillStyle = `rgba(232,182,91,${0.8 * f})`; c.fillRect(w * 0.1, h * 0.8, w * 0.8, Math.max(1, h * 0.012));
      if (id === 'corrientes') texto(c, w, h, "McDonald's", k * f, 0.26, '#ffd27a', '0.02em');
      if (id === 'media') texto(c, w, h, "McDonald's  ·  EL TRUST", k * f, 0.32, '#ffd27a', '0.06em');
      if (id === 'pellegrini') texto(c, w, h, 'FRENTE AL OBELISCO', k * f, 0.15, '#ffe1a3', '0.16em');
    }
  }

  // ---------- luces ----------
  const rgbDe = (q) => [Math.min(1, q.r + q.w), Math.min(1, q.g + q.w * 0.8), Math.min(1, q.b + q.w * 0.52)];   // W de previsualización: blanco cálido
  function separacion(W) {   // distancia típica entre vecinos del mismo nivel, para dimensionar el halo
    const out = {};
    for (const g of M.GRUPOS) {
      const ps = Object.entries(puntos).filter(([k]) => k.startsWith(g.pref)).map(([, p]) => [p[0] * W, p[1] * W]);
      const ds = [];
      for (let i = 0; i < ps.length; i++) { let m = Infinity; for (let j = 0; j < ps.length; j++) if (i !== j) m = Math.min(m, Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1])); if (isFinite(m)) ds.push(m); }
      ds.sort((a, b) => a - b);
      out[g.id] = ds.length ? ds[Math.floor(ds.length / 2)] : W * 0.03;
    }
    return out;
  }
  // Silueta de la fachada sobre ESTA foto (bordes medidos con grilla de 0,02): la luz no puede salir del edificio.
  // El borde derecho es la UNIÓN con la torre blanca (bajada pluvial ≈ 0,727): esa torre es otro edificio (corrección de Fer, 14/10).
  // Silueta COMPLETA del TRUST (cúpula y pisos altos incluidos), siguiendo el perfil de la azotea. Afuera quedan el vecino
  // de la izquierda y la torre blanca (otro edificio): no se tocan.
  const SILUETA = [[0.117, 1.0], [0.117, 0.66], [0.124, 0.60], [0.124, 0.303], [0.168, 0.303], [0.168, 0.202], [0.349, 0.175],
    [0.349, 0.069], [0.47, 0.069], [0.49, 0.03], [0.505, 0.069], [0.663, 0.09], [0.663, 0.23], [0.730, 0.23], [0.730, 1.0]];   // perfil de azotea medido
  // De noche el edificio no tiene luz propia: solo un ambiente urbano tenue y neutro (sin tinte de color).
  const AMBIENTE = [66, 68, 78];
  const GANANCIA = 2.8;   // intensidad visual del baño: nivel 45 % ≈ fachada bien leída junto al equipo

  // ---- Motor de iluminación arquitectónica (simulación) ----
  // Cada luminaria es un BAÑADOR hacia arriba ("wall washer/grazer") con:
  //   · apertura de haz configurable (°): el ancho crece con la altura, 2·h·tan(apertura/2);
  //   · caída suave (soft falloff): sube rápido junto al equipo y se atenúa con la altura (≈ 1/(1+(h/h0)^1.8));
  //   · perfil lateral gaussiano (bordes suaves, sin triángulos rígidos) y dilución al abrirse;
  //   · leve asimetría por equipo (ancho, alcance, inclinación) para que el solape no forme franjas idénticas.
  // El mapa de luz resultante MULTIPLICA la foto: se conservan molduras, sombras, columnas y vidrios oscuros.
  const ALCANCE = { superior: 4.6, medio: 3.6, inferior: 3.6 };   // altura útil del baño, en separaciones entre equipos
  const VARIANTES = [[1, 1, 0], [0.9, 1.08, 0.035], [1.1, 0.93, -0.03], [0.96, 1.04, 0.015]];   // [ancho, alcance, inclinación]
  const cacheSprites = new Map();
  const suaveP = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function sprite(sep, alcance, apertura, v) {
    const clave = `${Math.round(sep)}|${alcance}|${apertura}|${v}`;
    if (cacheSprites.has(clave)) return cacheSprites.get(clave);
    const [wj, hj, incl] = VARIANTES[v], H = sep * alcance * hj, abajo = sep * 0.4, tg = Math.tan((apertura / 2) * Math.PI / 180) * wj;
    const w0 = sep * 0.14, mitad = w0 + H * tg, ancho = Math.ceil((mitad * 1.6 + Math.abs(incl) * H) * 2) + 4, alto = Math.ceil(H + abajo);
    const cx = ancho / 2, oy = Math.ceil(H);
    const c = document.createElement('canvas'); c.width = ancho; c.height = alto;
    const g = c.getContext('2d'), img = g.createImageData(ancho, alto), d = img.data;
    for (let py = 0; py < alto; py++) {
      const h = oy - py;
      for (let px = 0; px < ancho; px++) {
        const xs = px - cx - incl * Math.max(0, h);
        let I;
        if (h >= 0) {
          const w = w0 + h * tg;
          const lateral = Math.exp(-1.6 * (xs / w) ** 2);
          const nace = 0.45 + 0.55 * suaveP(0, sep * 0.18, h);
          const cae = 1 / (1 + (h / (H * 0.5)) ** 1.8);
          const fin = 1 - suaveP(H * 0.72, H, h);
          I = lateral * nace * cae * fin * Math.pow(w0 / w, 0.22);
        } else {
          const e = -h;
          I = 0.5 * Math.exp(-2.2 * (xs / (sep * 0.32)) ** 2) * Math.exp(-e / (sep * 0.1));
        }
        d[(py * ancho + px) * 4 + 0] = 255; d[(py * ancho + px) * 4 + 1] = 255; d[(py * ancho + px) * 4 + 2] = 255;
        d[(py * ancho + px) * 4 + 3] = Math.round(Math.min(1, I) * 255);
      }
    }
    g.putImageData(img, 0, 0);
    const s = { c, cx, oy };
    cacheSprites.set(clave, s);
    return s;
  }
  const varianteDe = (id) => { let hsh = 0; for (const ch of id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0; return hsh % VARIANTES.length; };
  const tinte = document.createElement('canvas'), tictx = tinte.getContext('2d');
  function sumarBano(dst, sp, x, y, col, alfa) {
    const w = sp.c.width, h = sp.c.height;
    if (tinte.width < w || tinte.height < h) { tinte.width = Math.max(tinte.width, w); tinte.height = Math.max(tinte.height, h); }
    tictx.globalCompositeOperation = 'source-over'; tictx.clearRect(0, 0, w, h); tictx.drawImage(sp.c, 0, 0);
    tictx.globalCompositeOperation = 'source-in'; tictx.fillStyle = `rgb(${col.join(',')})`; tictx.fillRect(0, 0, w, h);
    // intensidades por encima de 1: varias pasadas aditivas (el canvas limita alfa a 1)
    const n = Math.max(1, Math.ceil(alfa)), a = alfa / n;
    dst.globalAlpha = Math.min(1, a);
    for (let i = 0; i < n; i++) dst.drawImage(tinte, 0, 0, w, h, x - sp.cx, y - sp.oy, w, h);
    dst.globalAlpha = 1;
  }
  function enmascarar(c, W, H) {
    // La luz queda DENTRO de la silueta del edificio (no se derrama al cielo, al vecino ni a la torre blanca)…
    c.globalCompositeOperation = 'destination-in'; c.fillStyle = '#000';
    c.beginPath(); c.moveTo(SILUETA[0][0] * W, SILUETA[0][1] * H);
    for (const [x, y] of SILUETA.slice(1)) c.lineTo(x * W, y * H);
    c.closePath(); c.fill();
    // …y NUNCA cae sobre los píxeles LED ni sobre la esfera del reloj (máscara de oclusión).
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    for (const sup of Object.values(G.superficies)) for (const qd of sup.quads) trazarQuad(c, aPx(qd, W, H));
    trazarQuad(c, aPx(G.reloj.quad, W, H));
    c.fill();
  }
  function dibujarLuces(sal, W, H) {
    for (const c of [lctx, tctx]) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.filter = 'none'; c.clearRect(0, 0, W, H); }
    const sep = separacion(W);
    // Mapa de luz (tctx): ambiente neutro dentro de la silueta + baño de cada luminaria con su color.
    tctx.fillStyle = `rgb(${AMBIENTE.join(',')})`;
    tctx.beginPath(); tctx.moveTo(SILUETA[0][0] * W, SILUETA[0][1] * H);
    for (const [x, y] of SILUETA.slice(1)) tctx.lineTo(x * W, y * H);
    tctx.closePath(); tctx.fill();
    tctx.globalCompositeOperation = 'lighter'; lctx.globalCompositeOperation = 'lighter';
    let dibujadas = 0;
    for (const s of sal.luces) {
      const p = puntos[s.id];
      if (!p || s.nivel <= 0.002) continue;
      const col = rgbDe(s.rgbw).map((v) => Math.round(v * 255));
      const x = p[0] * W, y = p[1] * H, sp = sep[s.grupo], k = s.nivel;
      sumarBano(tctx, sprite(sp, ALCANCE[s.grupo], s.apertura || 40, varianteDe(s.id)), x, y, col, k * GANANCIA);
      // la fuente misma: un punto chico y contenido (sin halo exagerado)
      const r = sp * 0.07, hs = lctx.createRadialGradient(x, y, 0, x, y, r);
      hs.addColorStop(0, `rgba(255,255,255,${0.7 * k})`); hs.addColorStop(0.4, `rgba(${col.join(',')},${0.5 * k})`); hs.addColorStop(1, `rgba(${col.join(',')},0)`);
      lctx.fillStyle = hs; lctx.beginPath(); lctx.arc(x, y, r, 0, Math.PI * 2); lctx.fill();
      dibujadas++;
    }
    enmascarar(lctx, W, H);
    enmascarar(tctx, W, H);
    // fuera de la silueta, pantallas y reloj: el mapa vale blanco (la foto queda igual)
    tctx.globalCompositeOperation = 'destination-over'; tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, W, H);
    return dibujadas;
  }

  // ---------- cuadro ----------
  let pedido = false, ultimo = null, ultimaInfo = {};
  function pedirCuadro() { if (!pedido) { pedido = true; requestAnimationFrame(cuadro); } }
  function cuadro(ts) {
    pedido = false;
    const est = M.estado();
    if (est.show.reproduciendo) {
      const dt = ultimo == null ? 0 : Math.min(0.1, (ts - ultimo) / 1000);
      ultimo = ts; M.avanzar(dt);
      pedirCuadro();
    } else ultimo = null;
    dibujar();
  }
  function dibujar() {
    if (!fotoNoche.complete || !fotoNoche.naturalWidth) return;
    const W = lienzo.width, H = lienzo.height, est = M.estado(), sal = M.salidas();
    const dia = est.vista === 'dia';
    const foto = dia && fotoDia && fotoDia.complete && fotoDia.naturalWidth ? fotoDia : fotoNoche;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(foto, 0, 0, foto.naturalWidth, foto.naturalHeight, 0, 0, W, H);   // foto entera, proporción intacta

    // 2. luces
    const n = dibujarLuces(sal, W, H);
    const suaveFiltro = `blur(${Math.max(0.5, W / 1800).toFixed(2)}px)`;   // solo suaviza el mapa: el relieve lo da la foto
    if (!dia) {   // 2a. NOCHE: el edificio solo se ve donde lo ilumina una luminaria encendida
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 1; ctx.filter = suaveFiltro;
      ctx.drawImage(capaTinte, 0, 0); ctx.filter = 'none';
    }
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = dia ? 0.06 : 0.6;   // 2b. la fuente (punto contenido)
    ctx.filter = suaveFiltro;
    ctx.drawImage(capaLuz, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    // 3. reloj
    const rq = aPx(G.reloj.quad, W, H);
    const rc = [(rq[0][0] + rq[2][0]) / 2, (rq[0][1] + rq[2][1]) / 2], rr = Math.abs(rq[1][0] - rq[0][0]) * 0.5;
    const rn = sal.reloj.nivel, [cr, cg, cb] = rgbDe(sal.reloj.rgbw).map((v) => Math.round(v * 255));
    ctx.save(); ctx.beginPath(); trazarQuad(ctx, rq); ctx.clip();
    if (rn < 0.85) { ctx.fillStyle = `rgba(0,0,0,${0.7 * (0.85 - rn) / 0.85})`; ctx.fillRect(rq[0][0], rq[0][1], rq[1][0] - rq[0][0], rq[2][1] - rq[1][1]); }
    ctx.restore();
    if (!dia && rn > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const gr = ctx.createRadialGradient(rc[0], rc[1], 0, rc[0], rc[1], rr * 1.6);
      gr.addColorStop(0, `rgba(${cr},${cg},${cb},${0.55 * rn})`); gr.addColorStop(0.6, `rgba(${cr},${cg},${cb},${0.18 * rn})`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(rc[0], rc[1], rr * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // 4. pantallas (opacas, encima de todo)
    for (const id of M.PANTALLAS) {
      dibujarContenido(id, sal.contenido);
      const sup = G.superficies[id], src = CONT[id], nq = sup.quads.length, nivel = sal.pantallas[id];
      sup.quads.forEach((qd, k) => {
        const qpx = aPx(qd, W, H);
        pintarQuad(ctx, src, src.width * k / nq, 0, src.width / nq, src.height, qpx, nq > 1 ? 2 : 12, nq > 1 ? 1 : 4);
      });
      if (nivel < 1) {
        ctx.save(); ctx.fillStyle = `rgba(0,0,0,${1 - nivel})`; ctx.beginPath();
        for (const qd of sup.quads) trazarQuad(ctx, aPx(qd, W, H));
        ctx.fill(); ctx.restore();
      }
    }
    ultimaInfo = { lucesDibujadas: n, foto: foto === fotoNoche ? 'noche' : 'dia', W, H };
    actualizarUI(est, sal);
  }

  // ---------- interfaz ----------
  const NOMBRES = { superior: 'Superior', medio: 'Medio', inferior: 'Inferior' };
  const COLOR_G = { superior: '#ff5a5a', medio: '#ffd23f', inferior: '#52e08f' };
  let seleccion = 'SUP-01', editor = false;

  function enlazarRango(id, set, get) {
    const r = $(id), v = $(id + '-v');
    r.addEventListener('input', () => { set(+r.value); });
    return () => { const x = get(); if (+r.value !== x && document.activeElement !== r) r.value = x; r.style.setProperty('--p', x + '%'); if (document.activeElement === r) r.style.setProperty('--p', r.value + '%'); v.textContent = x + '%'; };
  }
  const refrescos = [
    enlazarRango('p-master', (x) => M.setPantalla('master', x), () => M.estado().pantallas.master),
    enlazarRango('p-corrientes', (x) => M.setPantalla('corrientes', x), () => M.estado().pantallas.corrientes),
    enlazarRango('p-pellegrini', (x) => M.setPantalla('pellegrini', x), () => M.estado().pantallas.pellegrini),
    enlazarRango('p-media', (x) => M.setPantalla('media', x), () => M.estado().pantallas.media),
    enlazarRango('l-master', (x) => M.setLucesMaster(x), () => M.estado().luces.master),
    enlazarRango('g-superior', (x) => M.setGrupo('superior', x), () => M.estado().luces.grupos.superior),
    enlazarRango('g-medio', (x) => M.setGrupo('medio', x), () => M.estado().luces.grupos.medio),
    enlazarRango('g-inferior', (x) => M.setGrupo('inferior', x), () => M.estado().luces.grupos.inferior),
    enlazarRango('r-nivel', (x) => M.setReloj(x), () => M.estado().reloj.nivel),
  ];

  // grilla de 46 equipos
  const chips = {};
  (function armarEquipos() {
    const cont = $('equipos');
    for (const g of M.GRUPOS) {
      const t = document.createElement('div'); t.className = 'grupo-titulo';
      t.innerHTML = `<i style="background:${COLOR_G[g.id]}"></i>${g.nombre} · ${g.n} luminarias`;
      cont.appendChild(t);
      const grid = document.createElement('div'); grid.className = 'equipos';
      for (let i = 0; i < g.n; i++) {
        const id = `${g.pref}-${String(i + 1).padStart(2, '0')}`;
        const b = document.createElement('button'); b.className = 'eq'; b.textContent = String(i + 1).padStart(2, '0');
        b.title = `${NOMBRES[g.id]} ${String(i + 1).padStart(2, '0')} (${id})`; b.dataset.id = id;
        b.addEventListener('click', () => seleccionar(id));
        grid.appendChild(b); chips[id] = b;
      }
      cont.appendChild(grid);
    }
  })();

  function seleccionar(id) { seleccion = id; armarDetalle(); pedirCuadro(); }
  function armarDetalle() {
    const f = M.estado().luces.fixtures.find((x) => x.id === seleccion);
    const [, num] = f.id.split('-');
    const col = f.color || { r: 0, g: 0, b: 0, w: 1 };
    $('detalle').innerHTML = `
      <h3><span>${NOMBRES[f.grupo]} ${num} <small>· ${f.id}</small></span><small id="d-pos"></small></h3>
      <div class="botonera" style="margin-bottom:8px">
        <button class="b" id="d-on"></button>
        <button class="b" id="d-20">20 %</button><button class="b" id="d-50">50 %</button><button class="b" id="d-100">100 %</button>
        <button class="b" id="d-escena" title="El color vuelve a seguir la escena o el show">Color de escena</button>
      </div>
      <div class="fila"><label for="d-nivel">Dimmer individual</label><input type="range" class="r-oro" id="d-nivel" min="0" max="100" value="${f.nivel}"><span class="valor" id="d-nivel-v">${f.nivel}%</span></div>
      <div class="fila"><label for="d-ap" title="Apertura visual del haz en el simulador (no es la óptica real del equipo)">Apertura del haz</label><input type="range" class="r-azul2" id="d-ap" min="10" max="90" value="${f.apertura}"><span class="valor" id="d-ap-v">${f.apertura}°</span></div>
      ${['r', 'g', 'b', 'w'].map((k) => `<div class="fila"><label for="d-${k}">${{ r: 'Rojo (R)', g: 'Verde (G)', b: 'Azul (B)', w: 'Blanco (W)' }[k]}</label><input type="range" class="${{ r: 'r-rojo', g: 'r-verde', b: 'r-azul2', w: 'r-blanco' }[k]}" id="d-${k}" min="0" max="100" value="${Math.round(col[k] * 100)}"><span class="valor" id="d-${k}-v">${Math.round(col[k] * 100)}%</span></div>`).join('')}`;
    const id = f.id;
    $('d-on').addEventListener('click', () => M.setFixtureOn(id, !M.estado().luces.fixtures.find((x) => x.id === id).on));
    $('d-20').addEventListener('click', () => M.setFixture(id, 20));
    $('d-50').addEventListener('click', () => M.setFixture(id, 50));
    $('d-100').addEventListener('click', () => M.setFixture(id, 100));
    $('d-escena').addEventListener('click', () => { M.setFixtureColor(id, null); armarDetalle(); });
    $('d-nivel').addEventListener('input', (e) => M.setFixture(id, +e.target.value));
    $('d-ap').addEventListener('input', (e) => M.setFixtureApertura(id, +e.target.value));
    for (const k of ['r', 'g', 'b', 'w']) $('d-' + k).addEventListener('input', () => {
      const c = {}; for (const q of ['r', 'g', 'b', 'w']) c[q] = +$('d-' + q).value / 100;
      M.setFixtureColor(id, c);
    });
  }

  // escenas
  (function armarEscenas() {
    for (const [k, e] of Object.entries(M.ESCENAS)) {
      const b = document.createElement('button'); b.className = 'b'; b.textContent = e.nombre; b.dataset.e = k;
      b.addEventListener('click', () => M.setEscena(k));
      $('escenas').appendChild(b);
    }
  })();

  // timeline
  const PISTAS = [
    { id: 'corrientes', nombre: 'Pantalla Corrientes', color: '#c0392b', clips: [[0, 3, 'Negro · barrido oro'], [3, 7, "Ondas rojas · McDonald's"], [7, 11, 'Takeover · barrido →'], [11, 15, 'Cierre de marca']] },
    { id: 'pellegrini', nombre: 'Pantalla Pellegrini', color: '#2f6fd6', clips: [[0, 3, 'Negro · barrido oro'], [3, 7, 'Mensaje de campaña'], [7, 11, 'Takeover · barrido →'], [11, 15, 'Frente al Obelisco']] },
    { id: 'media', nombre: 'Pantalla media', color: '#8e44ad', clips: [[0, 3, "McDonald's × EL TRUST"], [3, 7, 'TAKEOVER 15 s'], [7, 11, 'Barrido oro'], [11, 15, 'Firma']] },
    { id: 'superior', nombre: 'Luminarias superior', color: '#b8892d', clips: [[0, 3, 'Cálida baja'], [3, 7, 'Ola roja →'], [7, 11, 'Rojo / oro pulso'], [11, 15, 'Fade cálido']] },
    { id: 'medio', nombre: 'Luminarias medio', color: '#c96f22', clips: [[0, 3, 'Cálida baja'], [3, 7, 'Ola roja →'], [7, 11, 'Rojo / oro pulso'], [11, 15, 'Fade cálido']] },
    { id: 'inferior', nombre: 'Luminarias inferior', color: '#a35b1f', clips: [[0, 3, 'Cálida baja'], [3, 7, 'Ola roja →'], [7, 11, 'Rojo / oro pulso'], [11, 15, 'Fade cálido']] },
    { id: 'reloj', nombre: 'Reloj', color: '#7d7d7d', clips: [[0, 7, 'Neutro'], [7, 13.5, 'Realce dorado'], [13.5, 15, 'Neutro']] },
  ];
  (function armarTimeline() {
    const p = $('pistas'), D = M.DUR;
    p.innerHTML = '<div></div><div class="regla" id="regla"></div>';
    const regla = p.querySelector('#regla');
    for (let s = 0; s <= D; s++) { const sp = document.createElement('span'); sp.style.left = (s / D * 100) + '%'; sp.textContent = s + 's'; if (s === 0) sp.style.transform = 'none'; if (s === D) sp.style.transform = 'translateX(-100%)'; regla.appendChild(sp); }
    for (const t of PISTAS) {
      const nom = document.createElement('div'); nom.className = 'nom'; nom.innerHTML = `<i style="background:${t.color}"></i>${t.nombre}`; p.appendChild(nom);
      const pista = document.createElement('div'); pista.className = 'pista';
      for (const [a, b, txt] of t.clips) {
        const c = document.createElement('div'); c.className = 'clip'; c.textContent = txt;
        c.style.left = (a / D * 100) + '%'; c.style.width = ((b - a) / D * 100) + '%';
        c.style.background = `linear-gradient(180deg, ${t.color}, ${t.color}cc)`; pista.appendChild(c);
      }
      p.appendChild(pista);
    }
    const area = document.createElement('div'); area.className = 'area-pistas'; area.id = 'area-pistas';
    area.innerHTML = '<div class="cabezal" id="cabezal"></div><div class="vacio-tl" id="vacio-tl">Cargá el show McDonald\'s para ver la secuencia en el tiempo</div>';
    p.appendChild(area);
    const buscar = (e) => { const r = area.getBoundingClientRect(); M.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * D); };
    let arrastre = false;
    area.addEventListener('pointerdown', (e) => { arrastre = true; area.setPointerCapture(e.pointerId); buscar(e); });
    area.addEventListener('pointermove', (e) => { if (arrastre) buscar(e); });
    area.addEventListener('pointerup', () => { arrastre = false; });
  })();

  // etiquetas sobre la foto
  const ETQ = [];
  (function armarEtiquetas() {
    const capa = $('capa');
    const mkE = (txt, cls, qd) => { const d = document.createElement('div'); d.className = 'etiqueta ' + (cls || ''); d.textContent = txt; capa.appendChild(d); ETQ.push([d, qd]); };
    mkE('Corrientes', '', G.superficies.corrientes.quads[0]);
    mkE('Pellegrini', '', G.superficies.pellegrini.quads[0]);
    mkE('Pantalla media', '', G.superficies.media.quads[11]);
    mkE('Reloj', 'reloj-et', G.reloj.quad);
  })();
  function cajaLienzo() { const e = $('escenario').getBoundingClientRect(), r = lienzo.getBoundingClientRect(); return { x: r.left - e.left, y: r.top - e.top, w: r.width, h: r.height }; }
  function ubicarEtiquetas() {
    const c = cajaLienzo();
    for (const [d, qd] of ETQ) {
      const x = (qd[0][0] + qd[1][0]) / 2, y = Math.min(qd[0][1], qd[1][1]);
      d.style.left = (c.x + x * c.w) + 'px'; d.style.top = (c.y + y * c.h - 6) + 'px';
    }
  }

  // guion de la presentación
  const PASOS = [
    { t: 'Portada TRUST Control × McDonald\'s', f: () => { $('portada').classList.remove('fuera'); } },
    { t: 'Vista del TRUST de día', f: () => { $('portada').classList.add('fuera'); M.setEscena('arquitectonica'); M.setVista('dia'); } },
    { t: 'Cambio a modo noche', f: () => { M.setVista('noche'); } },
    { t: 'Dimmers independientes: pantallas al 40 % (las luces no cambian) y Superior 01 al 20 % (las otras 45 no cambian)', f: () => { M.setPantalla('master', 40); M.setFixture('SUP-01', 20); seleccionar('SUP-01'); } },
    { t: "Un prompt → «Generar minishow (simulado)»: carga la plantilla McDonald's 15 s (niveles restaurados al 100 %; el prompt no se interpreta)", f: () => { M.restaurarNiveles(); generarMinishow(); } },
    { t: 'Ejecutar la secuencia sincronizada: pantallas + luces + reloj', f: () => { M.seek(0); M.play(); } },
    { t: 'Volver a la escena arquitectónica', f: () => { M.setEscena('arquitectonica'); } },
  ];
  let paso = 0, guionVisible = false;
  function irPaso(i) { paso = Math.max(0, Math.min(PASOS.length - 1, i)); PASOS[paso].f(); $('guion-txt').innerHTML = `<b>Paso ${paso + 1}/${PASOS.length}</b> · ${PASOS[paso].t}`; }
  $('btn-guion').addEventListener('click', () => { guionVisible = !guionVisible; $('guion').classList.toggle('on', guionVisible); if (guionVisible) irPaso(Math.max(1, paso)); });
  $('g-ant').addEventListener('click', () => irPaso(paso - 1));
  $('g-sig').addEventListener('click', () => irPaso(paso + 1));
  $('g-cerrar').addEventListener('click', () => { guionVisible = false; $('guion').classList.remove('on'); });
  $('comenzar').addEventListener('click', () => { guionVisible = true; $('guion').classList.add('on'); irPaso(1); });

  // mandos
  $('v-dia').addEventListener('click', () => M.setVista('dia'));
  $('v-noche').addEventListener('click', () => M.setVista('noche'));
  $('cargar').addEventListener('click', () => M.cargarShow());
  // Director de show (SIMULADO): siempre carga la plantilla McDonald's 15 s; el prompt no se interpreta ni sale del navegador.
  const PLAN = {
    apertura: 'pantallas oscuras con marca conceptual · fachada cálida baja · reloj neutro',
    ola: 'producto y mensaje en pantallas · ola roja Corrientes → Pellegrini',
    takeover: 'takeover conjunto de las 3 pantallas · acentos RGBW · reloj dorado',
    cierre: 'cierre de marca · fundido a arquitectónica cálida · reloj neutro',
  };
  function generarMinishow() {
    M.cargarShow(); M.seek(0);
    const ol = $('plan-ol'); ol.innerHTML = '';
    $('plan-cab').textContent = "Plantilla cargada: McDonald's Takeover 15 s (preprogramada, no es generación por IA)";
    for (const b of M.BLOQUES) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${b.desde}–${b.hasta} s · ${b.nombre}</b> — ${PLAN[b.id] || ''}`;
      ol.appendChild(li);
    }
    $('plan').hidden = false;
  }
  $('generar').addEventListener('click', generarMinishow);
  $('play').addEventListener('click', () => M.play());
  $('pausa').addEventListener('click', () => M.pausa());
  $('reset').addEventListener('click', () => M.resetShow());
  $('blackout').addEventListener('click', () => M.setBlackout(!M.estado().blackout));
  $('restaurar').addEventListener('click', () => { M.restaurarNiveles(); armarDetalle(); });
  $('guardar').addEventListener('click', () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([M.exportarEscena()], { type: 'application/json' }));
    a.download = 'escena-trust.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('abrir').addEventListener('click', () => $('archivo').click());
  $('archivo').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { M.importarEscena(await f.text()); armarDetalle(); } catch (err) { avisoTemporal('No se pudo abrir la escena: ' + err.message); } e.target.value = ''; });

  // clic en la foto: seleccionar luminaria o (editor) ubicarla
  lienzo.addEventListener('click', (e) => {
    const r = lienzo.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
    if (editor) { puntos[seleccion] = [+nx.toFixed(4), +ny.toFixed(4)]; exportarEditor(); siguienteEquipo(); pedirCuadro(); return; }
    let mejor = null, md = 22;
    for (const [id, p] of Object.entries(puntos)) { const d = Math.hypot((p[0] - nx) * r.width, (p[1] - ny) * r.height); if (d < md) { md = d; mejor = id; } }
    if (mejor) seleccionar(mejor);
  });
  function siguienteEquipo() { const ids = M.estado().luces.fixtures.map((f) => f.id); seleccionar(ids[(ids.indexOf(seleccion) + 1) % ids.length]); }
  function exportarEditor() {
    const orden = M.estado().luces.fixtures.map((f) => f.id).filter((id) => puntos[id]);
    $('ed-salida').value = `puntos: {\n${orden.map((id) => `    '${id}': [${puntos[id][0]}, ${puntos[id][1]}],`).join('\n')}\n  },  // ${orden.length}/46`;
  }
  $('ed-sig').addEventListener('click', siguienteEquipo);
  $('ed-borrar').addEventListener('click', () => { delete puntos[seleccion]; exportarEditor(); pedirCuadro(); });
  $('ed-exportar').addEventListener('click', () => { exportarEditor(); $('ed-salida').select(); });

  // teclado
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); const s = M.estado().show; s.reproduciendo ? M.pausa() : M.play(); }
    else if (k === 'r') M.resetShow();
    else if (k === 'd') M.setVista('dia');
    else if (k === 'n') M.setVista('noche');
    else if (k === 'b') M.setBlackout(!M.estado().blackout);
    else if (k === 'l') $('escenario').classList.toggle('ocultar-etiquetas');
    else if (k === 'e' && e.shiftKey) { editor = !editor; $('escenario').classList.toggle('editor', editor); exportarEditor(); }
    else if (k === 'arrowright' && guionVisible) irPaso(paso + 1);
    else if (k === 'arrowleft' && guionVisible) irPaso(paso - 1);
    else return;
    pedirCuadro();
  });

  let avisoTmp = null;
  function avisoTemporal(t) { avisoTmp = t; setTimeout(() => { avisoTmp = null; pedirCuadro(); }, 4000); pedirCuadro(); }
  const fmt = (t) => { const s = Math.floor(t), cs = Math.floor((t - s) * 100); return `00:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };

  function actualizarUI(est, sal) {
    refrescos.forEach((f) => f());
    $('v-dia').classList.toggle('on', est.vista === 'dia'); $('v-dia').setAttribute('aria-pressed', est.vista === 'dia');
    $('v-noche').classList.toggle('on', est.vista === 'noche'); $('v-noche').setAttribute('aria-pressed', est.vista === 'noche');
    const nombreEscena = est.show.cargado ? "McDonald's Takeover 15 s" : M.ESCENAS[est.escena].nombre;
    $('h-escena').textContent = nombreEscena;
    document.querySelectorAll('#escenas .b').forEach((b) => b.classList.toggle('on', !est.show.cargado && b.dataset.e === est.escena));
    $('cargar').classList.toggle('cargado', est.show.cargado);
    $('cargar').querySelector('span').textContent = est.show.cargado ? "Show McDonald's cargado" : "Cargar show McDonald's";
    $('play').classList.toggle('activo', est.show.reproduciendo);
    $('blackout').classList.toggle('activo', est.blackout);
    // timeline
    $('tl-t').textContent = fmt(est.show.t);
    $('tl-bloque').textContent = est.show.cargado ? 'Bloque: ' + M.bloque(est.show.t).nombre + (est.show.reproduciendo ? ' · reproduciendo' : est.show.t >= M.DUR ? ' · fin' : ' · en pausa') : 'Sin show cargado';
    $('cabezal').style.left = (est.show.t / M.DUR * 100) + '%';
    $('vacio-tl').style.display = est.show.cargado ? 'none' : 'flex';
    // chips
    for (const s of sal.luces) {
      const ch = chips[s.id], f = est.luces.fixtures.find((x) => x.id === s.id);
      const [r, g, b] = rgbDe(s.rgbw).map((v) => Math.round(v * 255));
      ch.style.setProperty('--c', `rgb(${r},${g},${b})`); ch.style.setProperty('--a', (0.12 + 0.88 * s.nivel).toFixed(3));
      ch.classList.toggle('sel', s.id === seleccion); ch.classList.toggle('off', !f.on); ch.classList.toggle('trim', f.nivel !== 100 || !!f.color);
      ch.title = `${s.id} · individual ${f.nivel}% · salida ${Math.round(s.nivel * 100)}%${puntos[s.id] ? '' : ' · posición pendiente'}`;
    }
    const f = est.luces.fixtures.find((x) => x.id === seleccion);
    if ($('d-on')) {
      $('d-on').textContent = f.on ? 'ON' : 'OFF'; $('d-on').className = 'b ' + (f.on ? 'on' : 'apagado');
      const dn = $('d-nivel'); if (document.activeElement !== dn) dn.value = f.nivel; dn.style.setProperty('--p', dn.value + '%');
      $('d-nivel-v').textContent = f.nivel + '%';
      const ap = $('d-ap'); if (document.activeElement !== ap) ap.value = f.apertura; ap.style.setProperty('--p', ((ap.value - 10) / 80 * 100) + '%'); $('d-ap-v').textContent = f.apertura + '°';
      const so = sal.luces.find((x) => x.id === seleccion);
      $('d-pos').textContent = `salida ${Math.round(so.nivel * 100)}%` + (f.color ? ' · color propio' : ' · color de escena') + (puntos[f.id] ? '' : ' · fuera de cuadro en esta foto');
      for (const k of ['r', 'g', 'b', 'w']) { const el = $('d-' + k); el.style.setProperty('--p', el.value + '%'); $('d-' + k + '-v').textContent = el.value + '%'; }
    }
    // marcador de la luminaria seleccionada
    const ms = $('marca-sel'), p = puntos[seleccion];
    if (p) { const c = cajaLienzo(); ms.style.display = 'block'; ms.style.left = (c.x + p[0] * c.w) + 'px'; ms.style.top = (c.y + p[1] * c.h) + 'px'; } else ms.style.display = 'none';
    // chip de estado y avisos honestos
    $('chip-modo').innerHTML = est.vista === 'dia'
      ? '<b>Modo Día</b><span>Pantallas visibles · iluminación arquitectónica casi imperceptible</span>'
      : '<b>Modo Noche</b><span>Pantallas + luminarias arquitectónicas</span>';
    const avisos = [];
    if (avisoTmp) avisos.push(avisoTmp);
    if (est.vista === 'dia' && ultimaInfo.foto !== 'dia') avisos.push('Foto diurna pendiente: falta la toma de día desde el mismo punto. Se muestra la nocturna; los niveles no cambian.');
    const fuera = new Set(((L && L.calibracion && L.calibracion.fuera_de_cuadro) || []));
    const faltan = est.luces.fixtures.filter((f) => !puntos[f.id] && !fuera.has(f.grupo)).length;
    if (faltan) avisos.push(`Posiciones de luminarias: faltan ${faltan} por calibrar sobre esta foto. Se controlan igual, pero su luz no se dibuja.`);
    if (puntosDePrueba) avisos.push('Posiciones SINTÉTICAS de prueba (no son las reales).');
    if (est.blackout) avisos.push('BLACKOUT activo: salida en negro. Los niveles guardados se recuperan al soltarlo.');
    $('aviso').innerHTML = avisos.join('<br>');
  }

  M.suscribir(() => pedirCuadro());
  new ResizeObserver(ajustarTamano).observe($('escenario'));
  window.addEventListener('resize', ajustarTamano);
  fotoNoche.addEventListener('load', ajustarTamano);
  if (fotoDia) fotoDia.addEventListener('load', pedirCuadro);
  armarDetalle();

  // API para las pruebas automatizadas (no cambia el comportamiento de la demo).
  window.TRUST = {
    motor: M,
    info: () => Object.assign({ posiciones: Object.keys(puntos).length, cssW: lienzo.getBoundingClientRect().width, cssH: lienzo.getBoundingClientRect().height }, ultimaInfo),
    dibujarYa: () => dibujar(),
    pixel: (nx, ny) => { dibujar(); const d = ctx.getImageData(Math.floor(nx * lienzo.width), Math.floor(ny * lienzo.height), 1, 1).data; return [d[0], d[1], d[2], d[3]]; },
    usarPuntosDePrueba: (obj) => { for (const k of Object.keys(puntos)) delete puntos[k]; Object.assign(puntos, obj); puntosDePrueba = true; pedirCuadro(); },
    seleccionar,
  };
})();
