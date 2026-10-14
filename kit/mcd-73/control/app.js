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
  // Detalle fino de la MISMA foto (generar_relieve.py): capa aparte para que la luz lea molduras y pilastras.
  const relieve = new Image();
  relieve.src = 'fotos/trust-relieve.jpg';
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
  const capaSuma = document.createElement('canvas'), sctx = capaSuma.getContext('2d');   // foto × luz agregada
  const capaAmb = document.createElement('canvas'), actx = capaAmb.getContext('2d');      // ambiente urbano (cacheado por tamaño)
  function mapaAmbiente(W, H) {
    if (capaAmb.width === W && capaAmb.height === H && capaAmb.dataset.listo) return capaAmb;
    capaAmb.width = W; capaAmb.height = H;
    actx.fillStyle = '#fff'; actx.fillRect(0, 0, W, H);
    actx.fillStyle = `rgb(${AMBIENTE.join(',')})`; actx.beginPath(); actx.moveTo(SILUETA[0][0] * W, SILUETA[0][1] * H);
    for (const [x, y] of SILUETA.slice(1)) actx.lineTo(x * W, y * H);
    actx.closePath(); actx.fill();
    actx.fillStyle = '#fff'; actx.beginPath();   // pantallas y reloj: su propia pista, sin ambiente
    for (const sup of Object.values(G.superficies)) for (const qd of sup.quads) trazarQuad(actx, aPx(qd, W, H));
    trazarQuad(actx, aPx(G.reloj.quad, W, H)); actx.fill();
    capaAmb.dataset.listo = '1';
    return capaAmb;
  }
  const capaSombra = document.createElement('canvas');
  function sombrasContacto(W, H) {   // sombra de contacto bajo el gabinete de las pantallas superiores (estática por tamaño)
    if (capaSombra.width === W && capaSombra.height === H && capaSombra.dataset.listo) return capaSombra;
    capaSombra.width = W; capaSombra.height = H; const c = capaSombra.getContext('2d');
    c.filter = `blur(${Math.max(2, W / 380).toFixed(1)}px)`; c.fillStyle = 'rgba(0,0,0,0.5)';
    for (const id of ['corrientes', 'pellegrini']) {
      const qd = aPx(G.superficies[id].quads[0], W, H), alto = Math.hypot(qd[3][0] - qd[0][0], qd[3][1] - qd[0][1]);
      c.beginPath(); c.moveTo(qd[3][0], qd[3][1]); c.lineTo(qd[2][0], qd[2][1]);
      c.lineTo(qd[2][0], qd[2][1] + alto * 0.16); c.lineTo(qd[3][0], qd[3][1] + alto * 0.16); c.closePath(); c.fill();
    }
    capaSombra.dataset.listo = '1';
    return capaSombra;
  }
  const promedio = document.createElement('canvas').getContext('2d', { willReadFrequently: true });   // color medio de cada contenido LED
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
      lienzo.width = pw; lienzo.height = ph;
      // los mapas de luz son suaves: se calculan a MEDIA resolución y se escalan (interpolación bilineal = más suavidad)
      capaLuz.width = Math.ceil(pw / 2); capaLuz.height = Math.ceil(ph / 2); capaTinte.width = capaLuz.width; capaTinte.height = capaLuz.height;
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

  // ---------- contenido de pantallas: UNA composición sobre las 3 superficies (contenido.js), determinista por t ----------
  const suave = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
  window.CONTENIDO.preparar(G);
  function dibujarContenido(id, cont) { window.CONTENIDO.dibujar(CONT[id], id, cont); }

  // ---------- luces ----------
  // Canal W = el LED blanco FIJO del equipo (Fer, 14/10: no asumir blanco cálido regulable). Previsualización ≈ 4000 K;
  // el blanco real depende del LED W de la luminaria elegida. Los cálidos salen de MEZCLAR W con R/G, como en un RGBW real.
  const rgbDe = (q) => [Math.min(1, q.r + q.w), Math.min(1, q.g + q.w * 0.9), Math.min(1, q.b + q.w * 0.78)];
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
  // Luz AMBIENTAL URBANA (Fer, 14/10): la que ya existe (farolas, reflejos, cielo). Con nuestras 46 apagadas el TRUST sigue
  // visible: la foto queda a este nivel, levemente neutra/fría. NUESTRA luz se SUMA encima (no reemplaza a la de la ciudad).
  const AMBIENTE = [150, 149, 148];
  const GANANCIA = 2.4;   // intensidad visual del baño que se suma (+23 % perceptual, brief 14/10: más presencia sin saturar)

  // ---- Motor de iluminación arquitectónica (simulación) ----
  // Cada luminaria es un BAÑADOR hacia arriba ("wall washer/grazer") con:
  //   · apertura de haz configurable (°): el ancho crece con la altura, 2·h·tan(apertura/2);
  //   · caída suave (soft falloff): sube rápido junto al equipo y se atenúa con la altura (≈ 1/(1+(h/h0)^1.8));
  //   · perfil lateral gaussiano (bordes suaves, sin triángulos rígidos) y dilución al abrirse;
  //   · leve asimetría por equipo (ancho, alcance, inclinación) para que el solape no forme franjas idénticas.
  // El mapa de luz resultante MULTIPLICA la foto: se conservan molduras, sombras, columnas y vidrios oscuros.
  const ALCANCE = { superior: 4.6, medio: 3.6, inferior: 3.6 };   // altura útil del baño, en separaciones entre equipos
  const VARIANTES = [[1, 1, 0], [0.88, 1.09, 0.035], [1.12, 0.92, -0.03], [0.95, 1.04, 0.015],
    [1.06, 0.97, -0.012], [0.92, 1.12, 0.022], [1.15, 0.88, 0.008], [0.98, 1.0, -0.025]];   // [ancho, alcance, inclinación]
  const JITTER = [1, 0.9, 1.08, 0.94, 1.04, 0.88, 1.1, 0.97];   // pequeñas diferencias de flujo entre equipos reales
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
          const nace = 0.6 + 0.4 * suaveP(0, sep * 0.16, h);   // más intensidad junto al origen
          const fin = 1 - suaveP(H * 0.72, H, h);
          // núcleo del haz (bordes gaussianos) + halo ancho de luz dispersa: los vecinos se funden sin franjas
          const nucleo = Math.exp(-1.7 * (xs / w) ** 2) / (1 + (h / (H * 0.52)) ** 1.7) * Math.pow(w0 / w, 0.2);   // proyección vertical más legible
          const halo = Math.exp(-1.1 * (xs / (w * 2.2 + sep * 0.3)) ** 2) / (1 + (h / (H * 0.62)) ** 1.6) * 0.45;
          I = (0.82 * nucleo + 0.18 * halo) * nace * fin;
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
  const hashDe = (id) => { let hsh = 2166136261; for (const ch of id) hsh = Math.imul(hsh ^ ch.charCodeAt(0), 16777619) >>> 0; return hsh; };
  const varianteDe = (id) => hashDe(id) % VARIANTES.length;
  // Variación DETERMINISTA por equipo (misma en cada cuadro: sin parpadeo): ±6° de apertura, flujo 0,86–1,14, ±~150 K.
  const VARIACION = new Map();
  function variacionDe(id) {
    if (!VARIACION.has(id)) {
      const hsh = hashDe(id + '#v'), a = (hsh & 255) / 255, b = ((hsh >>> 8) & 255) / 255, c = ((hsh >>> 16) & 255) / 255;
      VARIACION.set(id, { dAp: Math.round((a - 0.5) * 12), flujo: 0.86 + 0.28 * b, temp: (c - 0.5) * 0.08 });
    }
    return VARIACION.get(id);
  }
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
  // OCLUSIÓN POR CORNISAS (medidas sobre esta foto): el baño de cada fila se corta, con borde suave, al llegar a la cornisa
  // saliente de arriba; deja pasar solo una fracción (la luz que rebota y la que escapa por el borde).
  //   medio  → la cornisa/balcón corrido sobre las ventanas de arco (la misma donde apoya la fila superior);
  //   superior → la cornisa principal del remate (balaustrada).
  const CORNISA_MEDIA = [[0.11, 0.672], [0.16, 0.665], [0.20, 0.655], [0.24, 0.647], [0.28, 0.638], [0.31, 0.630], [0.34, 0.618],
    [0.38, 0.607], [0.44, 0.603], [0.48, 0.606], [0.52, 0.608], [0.56, 0.612], [0.60, 0.615], [0.64, 0.622], [0.68, 0.629], [0.74, 0.640]];
  const CORNISA_REMATE = [[0.11, 0.315], [0.20, 0.318], [0.30, 0.330], [0.36, 0.352], [0.44, 0.362], [0.50, 0.365], [0.58, 0.362],
    [0.66, 0.356], [0.74, 0.350]];
  const OCLUSOR = { medio: { linea: CORNISA_MEDIA, pasa: 0.22 }, superior: { linea: CORNISA_REMATE, pasa: 0.4 } };
  const capaGrupo = document.createElement('canvas'), gctx = capaGrupo.getContext('2d');
  const cacheOclusor = new Map();
  function ocluir(c, oc, W, H) {
    const clave = `${W}x${H}|${oc.pasa}|${oc.linea[0]}`;
    if (!cacheOclusor.has(clave)) {   // máscara fija por tamaño: se calcula una vez
      const m = document.createElement('canvas'); m.width = W; m.height = H; const mc = m.getContext('2d');
      mc.filter = `blur(${Math.max(1, W / 450).toFixed(1)}px)`;   // borde de sombra suave
      mc.fillStyle = `rgba(0,0,0,${1 - oc.pasa})`; mc.beginPath(); mc.moveTo(oc.linea[0][0] * W, 0);
      for (const [x, y] of oc.linea) mc.lineTo(x * W, y * H);
      mc.lineTo(oc.linea[oc.linea.length - 1][0] * W, 0); mc.closePath(); mc.fill();
      cacheOclusor.set(clave, m);
    }
    c.save(); c.globalCompositeOperation = 'destination-out'; c.drawImage(cacheOclusor.get(clave), 0, 0); c.restore();
  }
  // Color de luz para el MAPA: algo menos saturado que el canal puro (la piedra y el ambiente mezclan) → sin look de filtro.
  const colorMapa = (rgb) => { const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], mx = Math.max(...rgb) || 1; const s = 1 - Math.min(...rgb) / mx; const m = 0.12 + 0.12 * s; return rgb.map((v) => Math.round(255 * Math.min(1, v * (1 - m) + Math.max(l, 0.25 * mx) * m))); };   // los colores puros se suavizan algo más
  function dibujarLuces(sal, W, H, extra) {
    for (const c of [lctx, tctx]) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.filter = 'none'; c.clearRect(0, 0, W, H); }
    if (capaGrupo.width !== W || capaGrupo.height !== H) { capaGrupo.width = W; capaGrupo.height = H; }
    const sep = separacion(W);
    // Mapa de la luz QUE AGREGAMOS (tctx): baños por fila (con oclusión) + derrame de pantallas + reloj/cúpula. Fondo negro.
    lctx.globalCompositeOperation = 'lighter';
    let dibujadas = 0;
    for (const g of M.GRUPOS) {
      gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalCompositeOperation = 'source-over'; gctx.globalAlpha = 1; gctx.filter = 'none'; gctx.clearRect(0, 0, W, H);
      gctx.globalCompositeOperation = 'lighter';
      let hay = false;
      for (const s of sal.luces) {
        if (s.grupo !== g.id) continue;
        const p = puntos[s.id];
        if (!p || s.nivel <= 0.002) continue;
        const vr = variacionDe(s.id), rgb0 = rgbDe(s.rgbw), v = varianteDe(s.id);
        const rgb = [rgb0[0], rgb0[1] * (1 + vr.temp * 0.4), rgb0[2] * (1 + vr.temp)];   // pequeña diferencia de temperatura
        const col = rgb.map((c) => Math.round(Math.min(1, c) * 255));
        const x = p[0] * W, y = p[1] * H, sp = sep[s.grupo], k = s.nivel;
        const ap = Math.max(10, Math.min(90, Math.round(((s.apertura || 40) + vr.dAp) / 2) * 2));   // paso de 2° para reusar sprites
        sumarBano(gctx, sprite(sp, ALCANCE[s.grupo], ap, v), x, y, colorMapa(rgb.map((c) => Math.min(1, c))), k * GANANCIA * JITTER[v] * vr.flujo);
        // la fuente: punto chico y contenido, sin halo
        // hotspot suave sobre la piedra, justo arriba del proyector (donde el haz pega más fuerte)
        const cm = colorMapa(rgb.map((c) => Math.min(1, c))), hy = y - sp * 0.42, hrx = sp * 0.26, hry = sp * 0.55;
        const hw = gctx.createRadialGradient(x, hy, 0, x, hy, hry);
        hw.addColorStop(0, `rgba(${cm.join(',')},${Math.min(1, 0.55 * k * vr.flujo)})`); hw.addColorStop(1, `rgba(${cm.join(',')},0)`);
        gctx.save(); gctx.translate(x, hy); gctx.scale(hrx / hry, 1); gctx.translate(-x, -hy);
        gctx.fillStyle = hw; gctx.beginPath(); gctx.arc(x, hy, hry, 0, Math.PI * 2); gctx.fill(); gctx.restore();
        // el equipo mismo: punto chico y contenido
        const r = sp * 0.08, hs = lctx.createRadialGradient(x, y, 0, x, y, r);
        hs.addColorStop(0, `rgba(255,255,255,${0.7 * k})`); hs.addColorStop(0.4, `rgba(${col.join(',')},${0.5 * k})`); hs.addColorStop(1, `rgba(${col.join(',')},0)`);
        lctx.fillStyle = hs; lctx.beginPath(); lctx.arc(x, y, r, 0, Math.PI * 2); lctx.fill();
        dibujadas++; hay = true;
      }
      if (!hay) continue;
      if (OCLUSOR[g.id]) ocluir(gctx, OCLUSOR[g.id], W, H);
      tctx.globalCompositeOperation = 'lighter'; tctx.drawImage(capaGrupo, 0, 0);
    }
    // Derrame de las pantallas sobre la piedra vecina (integra el LED con la fachada; nunca sobre el LED: se enmascara abajo).
    tctx.globalCompositeOperation = 'lighter';
    for (const e of extra.pantallas) {
      if (e.nivel <= 0.01) continue;
      tctx.save(); tctx.filter = `blur(${Math.max(6, W / 70).toFixed(0)}px)`; tctx.globalAlpha = 0.32 * e.nivel;
      tctx.fillStyle = `rgb(${e.color.join(',')})`; tctx.beginPath();
      for (const qd of e.quads) trazarQuad(tctx, aPx(qd, W, H));
      tctx.fill(); tctx.restore();
    }
    // El reloj iluminado baña levemente la cúpula que lo rodea (integración, sin sobreexponer).
    if (extra.reloj.nivel > 0.01) {
      const rq = aPx(G.reloj.quad, W, H), cx = (rq[0][0] + rq[2][0]) / 2, cy = (rq[0][1] + rq[2][1]) / 2, rr = Math.abs(rq[1][0] - rq[0][0]) * 3.2;
      const gr = tctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      const c = extra.reloj.color;
      gr.addColorStop(0, `rgba(${c.join(',')},${0.38 * extra.reloj.nivel})`); gr.addColorStop(1, `rgba(${c.join(',')},0)`);
      tctx.fillStyle = gr; tctx.beginPath(); tctx.arc(cx, cy, rr, 0, Math.PI * 2); tctx.fill();
    }
    // ZONA CÚPULA: baño suave sobre sus ornamentos (zona 'dome' de composition.ts), con su propio dimmer y RGBW.
    const zc = extra.zonas.cupula;
    if (zc.nivel > 0.005) {
      const cm = colorMapa(rgbDe(zc.rgbw).map((v) => Math.min(1, v)));
      const dc = [0.49 * W, 0.25 * H], drx = 0.085 * W, dry = 0.12 * H, gd = tctx.createRadialGradient(dc[0], dc[1] + dry * 0.5, 0, dc[0], dc[1] + dry * 0.5, dry * 1.2);
      gd.addColorStop(0, `rgba(${cm.join(',')},${Math.min(1, 0.9 * zc.nivel * GANANCIA / 2.4)})`); gd.addColorStop(1, `rgba(${cm.join(',')},0)`);
      tctx.save(); tctx.translate(dc[0], 0); tctx.scale(drx / dry, 1); tctx.translate(-dc[0], 0);
      tctx.fillStyle = gd; tctx.beginPath(); tctx.arc(dc[0], dc[1] + dry * 0.5, dry * 1.2, 0, Math.PI * 2); tctx.fill(); tctx.restore();
    }
    // ZONA CORNISAS (PROPUESTA: equipos lineales adicionales, fuera de las 46): rasante corto que dibuja el perfil de cada cornisa.
    const zk = extra.zonas.cornisas;
    if (zk.nivel > 0.005) {
      const cm = colorMapa(rgbDe(zk.rgbw).map((v) => Math.min(1, v)));
      for (const [linea, alto] of [[CORNISA_MEDIA, 0.022], [CORNISA_REMATE, 0.03]]) {
        for (let i = 1; i < linea.length; i++) {
          const [xa, ya] = linea[i - 1], [xb, yb] = linea[i], ym = (ya + yb) / 2 * H;
          const gr = tctx.createLinearGradient(0, ym - alto * H, 0, ym + 0.006 * H);
          gr.addColorStop(0, `rgba(${cm.join(',')},0)`); gr.addColorStop(0.78, `rgba(${cm.join(',')},${Math.min(1, 1.15 * zk.nivel)})`); gr.addColorStop(1, `rgba(${cm.join(',')},0)`);
          tctx.fillStyle = gr; tctx.beginPath();
          tctx.moveTo(xa * W, ya * H - alto * H); tctx.lineTo(xb * W, yb * H - alto * H); tctx.lineTo(xb * W, yb * H + 0.006 * H); tctx.lineTo(xa * W, ya * H + 0.006 * H);
          tctx.closePath(); tctx.fill();
        }
      }
    }
    enmascarar(lctx, W, H);
    enmascarar(tctx, W, H);
    // fuera de la silueta, pantallas y reloj: no agregamos luz (negro)
    tctx.globalCompositeOperation = 'destination-over'; tctx.fillStyle = '#000'; tctx.fillRect(0, 0, W, H);
    return dibujadas;
  }

  // ---------- cuadro ----------
  let pedido = false, ultimo = null, ultimaInfo = {};
  function pedirCuadro() { if (!pedido) { pedido = true; requestAnimationFrame(cuadro); } }
  function cuadro(ts) {
    pedido = false;
    const est = M.estado();
    if (M.animando()) {   // show en reproducción o transición entre presets
      const dt = ultimo == null ? 0 : Math.min(0.5, (ts - ultimo) / 1000);   // el show sigue el reloj REAL aunque baje el fps
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

    // contenido de pantallas primero: su color medio alimenta el derrame de luz sobre la fachada
    const extra = { pantallas: [], zonas: sal.zonas, reloj: { nivel: sal.reloj.nivel, color: rgbDe(sal.reloj.rgbw).map((v) => Math.round(v * 255)) } };
    for (const id of M.PANTALLAS) {
      dibujarContenido(id, sal.contenido);
      promedio.clearRect(0, 0, 1, 1); promedio.drawImage(CONT[id], 0, 0, 1, 1);
      const d = promedio.getImageData(0, 0, 1, 1).data;
      extra.pantallas.push({ nivel: sal.pantallas[id], color: [d[0], d[1], d[2]], quads: G.superficies[id].quads });
    }
    // 2. luces
    const n = dibujarLuces(sal, capaTinte.width, capaTinte.height, extra);
    const suaveFiltro = `blur(${Math.max(0.5, W / 1800).toFixed(2)}px)`;   // solo suaviza el mapa: el relieve lo da la foto
    if (!dia) {
      // 2a. NOCHE: la ciudad queda (ambiente urbano sobre el TRUST) y NUESTRA luz se suma: foto × mapa de luz, aditivo.
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 1;
      ctx.drawImage(mapaAmbiente(W, H), 0, 0);
      if (capaSuma.width !== W || capaSuma.height !== H) { capaSuma.width = W; capaSuma.height = H; }
      sctx.globalCompositeOperation = 'source-over'; sctx.globalAlpha = 1; sctx.filter = 'none';
      sctx.drawImage(foto, 0, 0, foto.naturalWidth, foto.naturalHeight, 0, 0, W, H);
      sctx.globalCompositeOperation = 'multiply'; sctx.drawImage(capaTinte, 0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(capaSuma, 0, 0);
      // equilibrio de temperatura: la franja baja (farolas de sodio en la foto) se neutraliza levemente
      ctx.save(); ctx.beginPath(); ctx.moveTo(SILUETA[0][0] * W, SILUETA[0][1] * H);
      for (const [x, y] of SILUETA.slice(1)) ctx.lineTo(x * W, y * H);
      ctx.closePath(); ctx.clip();
      const wb = ctx.createLinearGradient(0, 0.6 * H, 0, H); wb.addColorStop(0, 'rgb(255,255,255)'); wb.addColorStop(1, 'rgb(236,244,255)');
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = wb; ctx.fillRect(0, 0.6 * H, W, 0.4 * H); ctx.restore();
      // 2a'. lectura del relieve: el detalle fino de la foto en 'soft-light', solo sobre la fachada del TRUST.
      if (relieve.complete && relieve.naturalWidth) {
        ctx.save(); ctx.beginPath(); ctx.moveTo(SILUETA[0][0] * W, SILUETA[0][1] * H);
        for (const [x, y] of SILUETA.slice(1)) ctx.lineTo(x * W, y * H);
        ctx.closePath(); ctx.clip();
        ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.55;
        ctx.drawImage(relieve, 0, 0, W, H); ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = dia ? 0.06 : 0.6;   // 2b. la fuente (punto contenido)
    ctx.drawImage(capaLuz, 0, 0, W, H);
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
      gr.addColorStop(0, `rgba(${cr},${cg},${cb},${0.28 * rn})`); gr.addColorStop(0.6, `rgba(${cr},${cg},${cb},${0.12 * rn})`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(rc[0], rc[1], rr * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // 3b. integración de las pantallas superiores: sombra de contacto bajo el gabinete y emisión suave alrededor.
    //     Se dibuja ANTES del contenido (que es opaco): ningún efecto cae sobre los píxeles LED. La pantalla media, limpia.
    for (const id of ['corrientes', 'pellegrini']) {
      const qd = aPx(G.superficies[id].quads[0], W, H), e = extra.pantallas.find((x) => x.quads === G.superficies[id].quads);
      if (id === 'corrientes') ctx.drawImage(sombrasContacto(W, H), 0, 0);   // las dos sombras, en una capa cacheada
      if (!dia && e && e.nivel > 0.01) {
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.22 * e.nivel;
        ctx.filter = `blur(${Math.max(6, W / 110).toFixed(0)}px)`; ctx.fillStyle = `rgb(${e.color.join(',')})`;
        ctx.beginPath(); trazarQuad(ctx, qd); ctx.fill(); ctx.restore();
      }
    }
    // 4. pantallas (opacas, encima de todo)
    for (const id of M.PANTALLAS) {
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
      // borde físico del gabinete LED: una línea oscura fina (la pantalla se lee como superficie instalada, no como pegote)
      const qs = sup.quads.map((qd) => aPx(qd, W, H));
      ctx.save(); ctx.strokeStyle = 'rgba(10,10,12,0.6)'; ctx.lineWidth = Math.max(1, W / 1000); ctx.lineJoin = 'round'; ctx.beginPath();
      ctx.moveTo(qs[0][0][0], qs[0][0][1]); for (const q of qs) ctx.lineTo(q[1][0], q[1][1]);   // borde superior
      ctx.lineTo(qs[qs.length - 1][2][0], qs[qs.length - 1][2][1]);                             // esquina inferior derecha
      for (let k = qs.length - 1; k >= 0; k--) ctx.lineTo(qs[k][3][0], qs[k][3][1]);          // borde inferior
      ctx.closePath(); ctx.stroke(); ctx.restore();
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
    enlazarRango('z-cupula', (x) => M.setZona('cupula', x), () => M.estado().luces.zonas.cupula),
    enlazarRango('z-cornisas', (x) => M.setZona('cornisas', x), () => M.estado().luces.zonas.cornisas),
    enlazarRango('z-ochava', (x) => M.setZona('ochava', x), () => M.estado().luces.zonas.ochava),
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

  // Colores rápidos RGBW (cualquier otro sale de los 4 sliders). Valores de canal, no colores de pantalla.
  const MUESTRAS = [
    { n: 'Rojo', c: { r: 1, g: 0, b: 0, w: 0 }, css: '#ff3b30' }, { n: 'Ámbar', c: { r: 1, g: 0.4, b: 0, w: 0.1 }, css: '#ff9a1f' },
    { n: 'Oro', c: { r: 1, g: 0.58, b: 0, w: 0.2 }, css: '#ffc24d' }, { n: 'Verde', c: { r: 0, g: 1, b: 0, w: 0 }, css: '#34c759' },
    { n: 'Cian', c: { r: 0, g: 1, b: 1, w: 0 }, css: '#32d4e6' }, { n: 'Azul', c: { r: 0, g: 0, b: 1, w: 0 }, css: '#3a6dff' },
    { n: 'Violeta', c: { r: 0.55, g: 0, b: 1, w: 0 }, css: '#8e5cff' }, { n: 'Magenta', c: { r: 1, g: 0, b: 0.8, w: 0 }, css: '#ff3fd0' },
    { n: 'Blanco cálido (W + R/G)', c: { r: 0.3, g: 0.07, b: 0, w: 0.78 }, css: '#ffd2a0' }, { n: 'Blanco W', c: { r: 0, g: 0, b: 0, w: 1 }, css: '#fff1df' },
  ];
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
      <div class="muestras" role="group" aria-label="Color RGBW rápido">${MUESTRAS.map((m, i) => `<button class="muestra" data-i="${i}" title="${m.n}" style="--m:${m.css}"></button>`).join('')}</div>
      ${['r', 'g', 'b', 'w'].map((k) => `<div class="fila"><label for="d-${k}">${{ r: 'Rojo (R)', g: 'Verde (G)', b: 'Azul (B)', w: 'Blanco (W)' }[k]}</label><input type="range" class="${{ r: 'r-rojo', g: 'r-verde', b: 'r-azul2', w: 'r-blanco' }[k]}" id="d-${k}" min="0" max="100" value="${Math.round(col[k] * 100)}"><span class="valor" id="d-${k}-v">${Math.round(col[k] * 100)}%</span></div>`).join('')}
      <div class="botonera" style="margin-top:6px"><button class="b" id="d-nivelcolor">Aplicar color a todo el nivel</button><button class="b" id="d-todascolor">Aplicar a las 46</button></div>`;
    const id = f.id;
    $('d-on').addEventListener('click', () => M.setFixtureOn(id, !M.estado().luces.fixtures.find((x) => x.id === id).on));
    $('d-20').addEventListener('click', () => M.setFixture(id, 20));
    $('d-50').addEventListener('click', () => M.setFixture(id, 50));
    $('d-100').addEventListener('click', () => M.setFixture(id, 100));
    $('d-escena').addEventListener('click', () => { M.setFixtureColor(id, null); armarDetalle(); });
    $('d-nivel').addEventListener('input', (e) => M.setFixture(id, +e.target.value));
    $('d-ap').addEventListener('input', (e) => M.setFixtureApertura(id, +e.target.value));
    const leer = () => { const c = {}; for (const q of ['r', 'g', 'b', 'w']) c[q] = +$('d-' + q).value / 100; return c; };
    for (const k of ['r', 'g', 'b', 'w']) $('d-' + k).addEventListener('input', () => M.setFixtureColor(id, leer()));
    document.querySelectorAll('#detalle .muestra').forEach((b) => b.addEventListener('click', () => { M.setFixtureColor(id, MUESTRAS[+b.dataset.i].c); armarDetalle(); }));
    $('d-nivelcolor').addEventListener('click', () => M.setColorGrupo(f.grupo, leer()));
    $('d-todascolor').addEventListener('click', () => M.setColorGrupo('todas', leer()));
  }

  // ---------- zonas: color RGBW por zona (override temporal; «Color de escena» lo quita) ----------
  // Paleta comercial (2 canales + W, nunca R+G+B juntos) y, aparte, colores técnicos de diagnóstico.
  const PALETA_ZONA = [
    { n: 'Blanco cálido', c: M.COLORES.calido, css: '#ffd2a0' }, { n: 'Blanco W', c: { r: 0, g: 0, b: 0, w: 1 }, css: '#fff1df' },
    { n: 'Ámbar', c: M.COLORES.ambar, css: '#ff9a1f' }, { n: 'Oro', c: M.COLORES.oro, css: '#ffc24d' }, { n: 'Rojo McDonald\'s', c: M.COLORES.rojo, css: '#e1251b' },
  ];
  const NOMBRE_ZONA = Object.fromEntries(M.ZONAS.map((z) => [z.id, z.nombre]));
  let zonaSel = null;
  function armarZona() {
    const caja = $('zona-rgbw');
    document.querySelectorAll('.zsel').forEach((b) => b.classList.toggle('on', b.dataset.z === zonaSel));
    if (!zonaSel) { caja.innerHTML = ''; return; }
    const col = M.estado().luces.zonaColor[zonaSel];
    const v = col || { r: 0, g: 0, b: 0, w: 0 };
    caja.innerHTML = `<div class="zcab"><b>Color · ${NOMBRE_ZONA[zonaSel]}</b><small>${col ? 'override de zona' : 'sigue la escena'}</small><button class="b" id="zc-escena">Color de escena</button><button class="b" id="zc-cerrar" title="Cerrar">✕</button></div>
      <div class="muestras m5" role="group" aria-label="Paleta comercial">${PALETA_ZONA.map((m, i) => `<button class="muestra" data-i="${i}" title="${m.n}" style="--m:${m.css}"></button>`).join('')}</div>
      ${['r', 'g', 'b', 'w'].map((k) => `<div class="fila"><label for="zc-${k}">${{ r: 'R', g: 'G', b: 'B', w: 'W' }[k]}</label><input type="range" class="${{ r: 'r-rojo', g: 'r-verde', b: 'r-azul2', w: 'r-blanco' }[k]}" id="zc-${k}" min="0" max="100" value="${Math.round(v[k] * 100)}" style="--p:${Math.round(v[k] * 100)}%"><span class="valor" id="zc-${k}-v">${Math.round(v[k] * 100)}%</span></div>`).join('')}`;
    const leer = () => { const c = {}; for (const q of ['r', 'g', 'b', 'w']) c[q] = +$('zc-' + q).value / 100; return c; };
    for (const k of ['r', 'g', 'b', 'w']) $('zc-' + k).addEventListener('input', () => { M.setZonaColor(zonaSel, leer()); $('zc-' + k + '-v').textContent = $('zc-' + k).value + '%'; $('zc-' + k).style.setProperty('--p', $('zc-' + k).value + '%'); });
    caja.querySelectorAll('.muestra').forEach((b) => b.addEventListener('click', () => { M.setZonaColor(zonaSel, PALETA_ZONA[+b.dataset.i].c); armarZona(); }));
    $('zc-escena').addEventListener('click', () => { M.setZonaColor(zonaSel, null); armarZona(); });
    $('zc-cerrar').addEventListener('click', () => { zonaSel = null; armarZona(); });
  }
  document.querySelectorAll('.zsel').forEach((b) => b.addEventListener('click', () => { zonaSel = zonaSel === b.dataset.z ? null : b.dataset.z; armarZona(); }));
  document.querySelectorAll('#transicion button').forEach((b) => b.addEventListener('click', () => M.setTransicion(+b.dataset.s)));
  document.querySelectorAll('#creatividad button').forEach((b) => b.addEventListener('click', () => M.setCreatividad(b.dataset.v)));

  // escenas (presets). Los técnicos/diagnóstico quedan separados de los comerciales.
  (function armarEscenas() {
    for (const [k, e] of Object.entries(M.ESCENAS)) {
      const b = document.createElement('button'); b.className = 'b' + (e.diagnostico ? ' tec' : ''); b.dataset.e = k;
      b.innerHTML = `<small>${e.clave}</small>${e.nombre}`; b.title = e.diagnostico ? 'Escena técnica (no comercial)' : 'Preset comercial';
      b.addEventListener('click', () => M.setEscena(k));
      $(['blanco', 'libre', 'cierre'].includes(k) ? 'escenas-tec' : 'escenas').appendChild(b);
    }
  })();

  // ---------- modo Cliente / Operador ----------
  function setModo(cliente) {
    document.body.classList.toggle('cliente', cliente);
    $('m-cliente').classList.toggle('on', cliente); $('m-cliente').setAttribute('aria-pressed', cliente);
    $('m-operador').classList.toggle('on', !cliente); $('m-operador').setAttribute('aria-pressed', !cliente);
    if (cliente) { guionVisible = false; $('guion').classList.remove('on'); }
    setTimeout(ajustarTamano, 0);
  }
  $('m-cliente').addEventListener('click', () => setModo(true));
  $('m-operador').addEventListener('click', () => setModo(false));
  let antes = null;   // ANTES / DESPUÉS: el TRUST hoy (sin iluminación arquitectónica) vs. con la escena cálida
  document.querySelectorAll('#cliente-bar button').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.c;
    if (c !== 'antes') antes = null;
    if (c === 'normal') M.setEscena('nocheIdle');
    else if (c === 'takeover') { M.restaurarNiveles(); M.cargarShow(); M.play(); }
    else if (c === 'firma') M.setEscena('firma');
    else { antes = antes === 'antes' ? 'despues' : 'antes'; M.setEscena(antes === 'antes' ? 'apagado' : 'arquitectonica'); }
    pedirCuadro();
  }));

  // timeline
  const PISTAS = [
    { id: 'corrientes', nombre: 'Pantalla Corrientes', color: '#c0392b', clips: [[0, 2, 'Noche institucional'], [2, 5, 'Nace la luz →'], [5, 10, 'Takeover · una pieza'], [10, 13, 'Firma dorada'], [13, 15, 'Salida']] },
    { id: 'pellegrini', nombre: 'Pantalla Pellegrini', color: '#2f6fd6', clips: [[0, 2, 'Noche institucional'], [2, 5, 'La luz cruza →'], [5, 10, 'Takeover · una pieza'], [10, 13, 'Firma dorada'], [13, 15, 'Salida']] },
    { id: 'media', nombre: 'Pantalla media', color: '#8e44ad', clips: [[0, 2, 'EL TRUST'], [2, 5, 'Aterriza · ← revela'], [5, 10, 'Marca'], [10, 13, 'Firma'], [13, 15, 'Salida']] },
    { id: 'superior', nombre: 'Fachada superior', color: '#b8892d', clips: [[0, 2, 'Cálida 38 %'], [2, 5, 'Rojo 55 % →'], [5, 10, 'Rojo 70 · oro 40 · cálido 20'], [10, 13, 'Oro + cálido'], [13, 15, 'A cálida']] },
    { id: 'medio', nombre: 'Fachada media', color: '#c96f22', clips: [[0, 2, 'Cálida 38 %'], [2, 5, 'Rojo 55 % →'], [5, 10, 'Rojo 70 · oro 40 · cálido 20'], [10, 13, 'Oro + cálido'], [13, 15, 'A cálida']] },
    { id: 'inferior', nombre: 'Fachada inferior', color: '#a35b1f', clips: [[0, 2, 'Cálida 38 %'], [2, 5, 'Rojo 55 % →'], [5, 10, 'Rojo 70 · oro 40 · cálido 20'], [10, 13, 'Oro + cálido'], [13, 15, 'A cálida']] },
    { id: 'zonas', nombre: 'Cúpula · cornisas', color: '#8a6d3b', clips: [[0, 5, 'Cálido · volumen'], [5, 13, 'Cúpula oro'], [13, 15, 'Cálido']] },
    { id: 'reloj', nombre: 'Clock accent', color: '#7d7d7d', clips: [[0, 5, 'Neutro'], [5, 13, 'Acento dorado'], [13, 15, 'Neutro']] },
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
    { t: "Un prompt → «Generar minishow (simulado)»: carga la plantilla McDonald's 15 s (Normal → Brand reveal → Full takeover → Signature → Exit; el prompt no se interpreta)", f: () => { M.restaurarNiveles(); generarMinishow(); } },
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
    normal: 'fachada cálida 38 % · pantallas en noche institucional',
    revelacion: 'una luz nace en Corrientes, cruza a Pellegrini y aterriza en la media · la cálida baja a 25 % y el rojo sube a 55 % en el mismo sentido',
    takeover: 'las 3 pantallas como una pieza, máxima presencia · rojo 70 % · oro 40 % · cálido 20 % · arquitectura −8 % (soporte)',
    firma: 'onda dorada como firma · sube oro y cálido, baja el rojo · la fachada recupera elegancia',
    salida: 'fundido suave a ARCHITECTURAL_WARM',
  };
  function plegarDirector(plegado) {
    $('t-director').classList.toggle('plegado', plegado);
    $('director-plegar').setAttribute('aria-expanded', String(!plegado));
  }
  $('director-plegar').addEventListener('click', () => plegarDirector(!$('t-director').classList.contains('plegado')));
  function generarMinishow() {
    plegarDirector(false);   // en la demo se muestra el plan cargado
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
  $('restaurar').addEventListener('click', () => { M.restaurarNiveles(); armarDetalle(); armarZona(); });
  $('volver').addEventListener('click', () => { M.volverAEscena(); armarDetalle(); armarZona(); });
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
    const nombreEscena = est.show.cargado ? "MCD_TAKEOVER · show 15 s" : M.ESCENAS[est.escena].clave + ' · ' + M.ESCENAS[est.escena].nombre;
    $('diag').hidden = !sal.diagnostico;
    document.querySelectorAll('#transicion button').forEach((b) => b.classList.toggle('on', +b.dataset.s === est.transicion));
    document.querySelectorAll('#creatividad button').forEach((b) => b.classList.toggle('on', b.dataset.v === est.creatividad));
    for (const z of ['superior', 'medio', 'inferior', 'cupula', 'cornisas', 'ochava']) {
      const zb = document.querySelector(`.zsel[data-z="${z}"]`), q = est.luces.zonaColor[z];
      if (zb) { zb.style.color = q ? `rgb(${rgbDe(q).map((v) => Math.round(v * 255)).join(',')})` : ''; zb.classList.toggle('override', !!q); }
    }
    const ad = $('antes-despues');
    ad.hidden = !antes || est.show.cargado;
    ad.innerHTML = antes === 'antes' ? '<b>ANTES</b><span>El TRUST hoy · sin iluminación arquitectónica</span>' : '<b>DESPUÉS</b><span>Iluminación arquitectónica cálida + pantallas</span>';
    $('h-escena').textContent = nombreEscena;
    document.querySelectorAll('#escenas .b, #escenas-tec .b').forEach((b) => b.classList.toggle('on', !est.show.cargado && b.dataset.e === est.escena));
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
  relieve.addEventListener('load', pedirCuadro);
  armarDetalle();

  // API para las pruebas automatizadas (no cambia el comportamiento de la demo).
  window.TRUST = {
    motor: M,
    info: () => Object.assign({ posiciones: Object.keys(puntos).length, cssW: lienzo.getBoundingClientRect().width, cssH: lienzo.getBoundingClientRect().height }, ultimaInfo),
    dibujarYa: () => dibujar(),
    pixel: (nx, ny) => { dibujar(); const d = ctx.getImageData(Math.floor(nx * lienzo.width), Math.floor(ny * lienzo.height), 1, 1).data; return [d[0], d[1], d[2], d[3]]; },
    usarPuntosDePrueba: (obj) => { for (const k of Object.keys(puntos)) delete puntos[k]; Object.assign(puntos, obj); puntosDePrueba = true; pedirCuadro(); },
    seleccionar,
    variacion: (id) => Object.assign({}, variacionDe(id)),
    rgbDe: (q) => rgbDe(q),
  };
})();
