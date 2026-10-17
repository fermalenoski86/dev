// TRUST Control — AI CONTENT STUDIO (simulado): UPLOAD MEDIA, análisis local, plan creativo por superficie.
// SIMULACIÓN CONCEPTUAL. Todo corre en ESTE navegador: los archivos no salen de la máquina (sin red, sin servicios).
//
// Flujos (brief §59): IDEA FIRST (prompt → plantilla) · MEDIA FIRST (subo → propuesta) · MEDIA + PROMPT (el más potente).
// Modelo MediaAttachment (§43): id, type, filename, mimeType, durationMs?, width, height, fps?, thumbnail?, assetId?, status
//   status: UPLOADING → ANALYZING → READY | REJECTED. Solo READY entra al concepto.
// Análisis (§42): metadata técnica REAL (cajas del MP4: códec, fps, timescale) + keyframes 0/25/50/75/100 % + análisis
//   visual básico (colores dominantes, cortes de escena, energía, dirección del movimiento, composición, áreas seguras).
//   Las "AI NOTES" son HEURÍSTICAS LOCALES rotuladas como análisis generado: no hay modelo de IA.
// Concepto (§47): generateConcept({ prompt, attachments, brandContext, campaignContext }) con un proveedor intercambiable.
//   Hoy: 'planificador-local' (reglas deterministas). Un proveedor multimodal futuro recibe texto + imágenes + keyframes.
// Original intacto (§54): el archivo subido nunca se modifica; cada uso por pantalla es una DERIVADA con derivedFromAssetId.
// Referencia vs asset final (§46): nada es publicable por defecto. Un asset final requiere render al formato de la
//   superficie + pipeline M3A real (SHA-256 → ffprobe → frame decode → Media Manager → Asset Validation): NO disponible acá.
(function () {
  'use strict';
  const M = window.MOTOR, CONT = window.CONTENIDO;
  const $ = (id) => document.getElementById(id);
  // Formatos reales de las superficies (packages/show-engine/src/building.ts; marquesina en experience.ts).
  const FORMATOS = {
    screen_a: { pantalla: 'corrientes', nombre: 'Corrientes (screen_a)', w: 1152, h: 576 },
    screen_b: { pantalla: 'pellegrini', nombre: 'Pellegrini (screen_b)', w: 1440, h: 576 },
    horizontal: { pantalla: 'media', nombre: 'Horizontal (marquesina)', w: 1920, h: 412 },
    master: { nombre: 'Master A+B', w: 2592, h: 576 },
  };
  const SUP_DE = { corrientes: 'screen_a', pellegrini: 'screen_b', media: 'horizontal' };
  const ACEPTA = { 'video/mp4': 'video', 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image' };
  const MAX_BYTES = 500 * 1024 * 1024;
  const ESTRATEGIAS = ['USE_AS_IS', 'TRIM', 'CROP', 'REFRAME', 'LOOP', 'SPLIT', 'EXTRACT_SEGMENT', 'USE_AS_REFERENCE', 'GENERATE_VARIATION', 'COMBINE_WITH_GENERATED_CONTENT'];
  const adjuntos = [];
  let seq = 0, concepto = null, aplicado = false, visorId = null;
  const VERSIONES = {};   // versión por superficie: cada concepto genera derivadas nuevas (nunca pisa las anteriores)

  // ---------- utilidades ----------
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtT = (s) => { if (s == null || !isFinite(s)) return '—'; const m = Math.floor(s / 60), r = s - m * 60; return `${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`; };
  const fmtB = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mcd = (a, b) => (b ? mcd(b, a % b) : a);
  const aspecto = (w, h) => { if (!w || !h) return '—'; const g = mcd(w, h), r = w / h; const k = `${w / g}:${h / g}`; return (w / g > 50 ? r.toFixed(2) + ':1' : k) + ` (${r.toFixed(2)})`; };
  const publico = (a) => { const o = {}; for (const [k, v] of Object.entries(a)) if (!k.startsWith('_')) o[k] = v; return JSON.parse(JSON.stringify(o)); };
  function nombreColor([r, g, b]) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, s = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255) || 1);
    if (l < 0.13) return 'negro'; if (l > 0.88 && s < 0.25) return 'blanco'; if (s < 0.18) return l < 0.45 ? 'gris oscuro' : 'gris';
    let h = 0; const d = mx - mn;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h < 15 || h >= 345) return l < 0.3 ? 'bordó' : 'rojo'; if (h < 40) return l < 0.35 ? 'marrón' : 'naranja'; if (h < 65) return 'amarillo';
    if (h < 160) return 'verde'; if (h < 200) return 'cian'; if (h < 255) return 'azul'; if (h < 290) return 'violeta'; return 'magenta';
  }
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  // ---------- MP4: cajas ISO-BMFF (metadata técnica real, sin ffprobe) ----------
  function leerMP4(buf) {
    const dv = new DataView(buf), out = { pistas: [] }, tx = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    function cajas(ini, fin, cb) {
      let o = ini;
      while (o + 8 <= fin) {
        let tam = dv.getUint32(o); const tipo = tx(o + 4); let cab = 8;
        if (tam === 1) { tam = Number(dv.getBigUint64(o + 8)); cab = 16; } else if (tam === 0) tam = fin - o;
        if (tam < cab || o + tam > fin) break;
        cb(tipo, o + cab, o + tam);
        o += tam;
      }
    }
    let pista = null;
    const rec = (tipo, a, b) => {
      if (tipo === 'ftyp') out.marca = tx(a);
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(tipo)) { if (tipo === 'trak') { pista = {}; out.pistas.push(pista); } cajas(a, b, rec); return; }
      if (!pista) return;
      if (tipo === 'tkhd') { const v = dv.getUint8(a), o = a + (v === 1 ? 84 : 72); pista.ancho = dv.getUint32(o) / 65536; pista.alto = dv.getUint32(o + 4) / 65536; }
      if (tipo === 'mdhd') { const v = dv.getUint8(a); pista.escala = dv.getUint32(a + (v === 1 ? 20 : 12)); pista.duracion = v === 1 ? Number(dv.getBigUint64(a + 24)) : dv.getUint32(a + 16); }
      if (tipo === 'hdlr') pista.tipo = tx(a + 8);
      if (tipo === 'stsd') pista.codec = tx(a + 8 + 4);
      if (tipo === 'stts') { const n = dv.getUint32(a + 4); let muestras = 0, total = 0; for (let i = 0; i < n; i++) { const c = dv.getUint32(a + 8 + i * 8), d = dv.getUint32(a + 12 + i * 8); muestras += c; total += c * d; } pista.muestras = muestras; pista.ticks = total; }
    };
    cajas(0, buf.byteLength, rec);
    const v = out.pistas.find((p) => p.tipo === 'vide');
    if (v) {
      out.codec = v.codec; out.ancho = Math.round(v.ancho); out.alto = Math.round(v.alto);
      if (v.escala && v.ticks) out.fps = Math.round((v.muestras * v.escala / v.ticks) * 1000) / 1000;
      if (v.escala && v.duracion) out.duracionS = v.duracion / v.escala;
    }
    out.audio = out.pistas.some((p) => p.tipo === 'soun');
    return out;
  }
  const CODECS = { avc1: 'H.264 / AVC (avc1)', avc3: 'H.264 / AVC (avc3)', hvc1: 'H.265 / HEVC (hvc1)', hev1: 'H.265 / HEVC (hev1)', av01: 'AV1 (av01)', vp09: 'VP9 (vp09)', mp4v: 'MPEG-4 Part 2 (mp4v)' };

  // ---------- análisis visual básico ----------
  const lienzoA = document.createElement('canvas'), ca = lienzoA.getContext('2d', { willReadFrequently: true });
  function estadisticas(src, sw, sh) {   // muestra 64×36: color medio, saturación, brillo, histograma, saliencia
    const W = 64, H = Math.max(8, Math.round(64 * sh / sw)); lienzoA.width = W; lienzoA.height = H;
    ca.clearRect(0, 0, W, H); ca.drawImage(src, 0, 0, W, H);
    const d = ca.getImageData(0, 0, W, H).data, hist = new Float32Array(64), cuant = new Map();
    let sat = 0, bri = 0, n = 0, transp = 0, sx = 0, sy = 0, sp = 0, mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 30) continue; mr += d[i]; mg += d[i + 1]; mb += d[i + 2]; n++; }
    mr /= n || 1; mg /= n || 1; mb /= n || 1;
    const borde = []; let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = d[i + 3];
      if (a < 30) { transp++; continue; }
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat += mx ? (mx - mn) / mx : 0; bri += (r + g + b) / 765;
      hist[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)]++;
      const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5); const e = cuant.get(k) || [0, 0, 0, 0]; e[0] += r; e[1] += g; e[2] += b; e[3]++; cuant.set(k, e);
      const dist = Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb);   // saliencia simple: distancia al color medio
      sx += x * dist; sy += y * dist; sp += dist;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) borde.push([r, g, b]);
    }
    const bm = borde.reduce((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]).map((v) => v / (borde.length || 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {   // área con contenido: lo que se aparta del fondo del borde
      const i = (y * W + x) * 4;
      if (d[i + 3] < 30) continue;
      if (Math.abs(d[i] - bm[0]) + Math.abs(d[i + 1] - bm[1]) + Math.abs(d[i + 2] - bm[2]) > 60) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    }
    const tot = n || 1;
    for (let i = 0; i < 64; i++) hist[i] /= tot;
    return { media: [mr, mg, mb], sat: sat / tot, bri: bri / tot, hist, cuant, transp: transp / (W * H),
      centro: sp ? [sx / sp / (W - 1), sy / sp / (H - 1)] : [0.5, 0.5], caja: bx1 >= 0 ? [bx0 / W, by0 / H, (bx1 + 1) / W, (by1 + 1) / H] : null };
  }
  function dominantes(listas, k) {
    const acc = new Map();
    for (const cu of listas) for (const [key, e] of cu) { const a = acc.get(key) || [0, 0, 0, 0]; a[0] += e[0]; a[1] += e[1]; a[2] += e[2]; a[3] += e[3]; acc.set(key, a); }
    const tot = [...acc.values()].reduce((s, e) => s + e[3], 0) || 1;
    const orden = [...acc.values()].sort((a, b) => b[3] - a[3]), res = [];
    for (const e of orden) {
      const c = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
      const igual = res.find((r) => Math.abs(r.rgb[0] - c[0]) + Math.abs(r.rgb[1] - c[1]) + Math.abs(r.rgb[2] - c[2]) < 70);
      if (igual) { igual.peso += e[3] / tot; continue; }
      res.push({ rgb: c, peso: e[3] / tot });
      if (res.length >= k * 2) break;
    }
    return res.sort((a, b) => b.peso - a.peso).slice(0, k).map((r) => ({ hex: hex(r.rgb), nombre: nombreColor(r.rgb), peso: Math.round(r.peso * 100) / 100, rgb: r.rgb.map(Math.round) }));
  }
  const miniatura = (src, sw, sh, ancho) => { const c = document.createElement('canvas'); c.width = ancho; c.height = Math.round(ancho * sh / sw); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.78); };
  const buscar = (v, t) => new Promise((ok, mal) => {
    const fin = () => { v.removeEventListener('seeked', fin); v.removeEventListener('error', err); ok(); };
    const err = () => { v.removeEventListener('seeked', fin); mal(new Error('no se pudo decodificar el cuadro')); };
    v.addEventListener('seeked', fin); v.addEventListener('error', err); v.currentTime = t;
  });

  async function analizarVideo(a, buf) {
    const meta = leerMP4(buf);
    if (!meta.pistas.some((p) => p.tipo === 'vide')) throw new Error('el MP4 no tiene pista de video');
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = a._url;
    const pista = /^(avc|hvc|hev)/.test(meta.codec || '') ? ' — en Chrome o Edge sí se decodifica; este navegador no trae ese códec' : '';
    await new Promise((ok, mal) => { v.onloadeddata = ok; v.onerror = () => mal(new Error('el navegador no puede decodificar este video (' + (CODECS[meta.codec] || meta.codec || 'códec desconocido') + ')' + pista)); });
    const dur = isFinite(v.duration) ? v.duration : meta.duracionS;
    a._el = v; a.durationMs = Math.round(dur * 1000); a.width = v.videoWidth || meta.ancho; a.height = v.videoHeight || meta.alto;
    a.fps = meta.fps || null; a.codec = meta.codec || null;
    // muestras uniformes (≈2 por segundo, 8–40) para escenas, energía y movimiento; keyframes en 0/25/50/75/100 %
    const N = cl(Math.round(dur * 2), 8, 40), muestras = [];
    for (let i = 0; i < N; i++) {
      const t = Math.min(dur - 0.04, (i + 0.5) * dur / N); await buscar(v, t);
      muestras.push(Object.assign({ t }, estadisticas(v, v.videoWidth, v.videoHeight)));
    }
    a.keyframes = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const t = Math.min(dur - 0.04, Math.max(0.02, f * dur)); await buscar(v, t);
      a.keyframes.push({ t: Math.round(t * 1000) / 1000, img: miniatura(v, v.videoWidth, v.videoHeight, 240) });
    }
    a.thumbnail = a.keyframes[0].img;
    await buscar(v, 0);
    // escenas: corte cuando cambia mucho el histograma entre muestras vecinas
    const cortes = [];
    for (let i = 1; i < N; i++) { let dsum = 0; for (let k = 0; k < 64; k++) dsum += Math.abs(muestras[i].hist[k] - muestras[i - 1].hist[k]); muestras[i].salto = dsum; if (dsum > 0.6) cortes.push(Math.round((muestras[i].t + muestras[i - 1].t) / 2 * 100) / 100); }
    const escenas = []; let ini = 0;
    for (const c of [...cortes, dur]) { escenas.push({ desde: Math.round(ini * 100) / 100, hasta: Math.round(c * 100) / 100 }); ini = c; }
    // energía visual (saturación × contraste local aproximado) y dirección del movimiento (deriva del centro de saliencia)
    muestras.forEach((m) => { m.energia = m.sat * 0.7 + Math.abs(m.bri - 0.5) * 0.1 + (m.salto || 0) * 0.2; });
    let deriva = 0, dv = 0;
    for (let i = 1; i < N; i++) if (!cortes.some((c) => c > muestras[i - 1].t && c < muestras[i].t)) { deriva += muestras[i].centro[0] - muestras[i - 1].centro[0]; dv += muestras[i].centro[1] - muestras[i - 1].centro[1]; }
    const dir = Math.abs(deriva) < 0.06 && Math.abs(dv) < 0.06 ? 'estable / sin desplazamiento claro' : Math.abs(deriva) >= Math.abs(dv) ? (deriva > 0 ? 'hacia la derecha' : 'hacia la izquierda') : (dv > 0 ? 'hacia abajo' : 'hacia arriba');
    const colores = dominantes(muestras.map((m) => m.cuant), 5);
    const ritmo = cortes.length / Math.max(1, dur) * 10;
    // rango sugerido: ventana de 15 s (o todo el clip) con más energía, alineada a cortes
    const L = Math.min(15, dur); let mejor = 0, mejorV = -1;
    for (let s = 0; s <= dur - L + 1e-6; s += Math.max(0.25, dur / 120)) {
      const en = muestras.filter((m) => m.t >= s && m.t <= s + L); const val = en.reduce((x, m) => x + m.energia, 0) / (en.length || 1);
      if (val > mejorV + 1e-9) { mejorV = val; mejor = s; }
    }
    const snap = cortes.find((c) => Math.abs(c - mejor) < 0.8); if (snap != null && snap + L <= dur) mejor = snap;
    a.rangoSugerido = [Math.round(mejor * 1000) / 1000, Math.round((mejor + L) * 1000) / 1000];
    a.rango = a.rangoSugerido.slice();
    const pico = muestras.reduce((p, m) => (m.energia > p.energia ? m : p), muestras[0]);
    const finales = muestras.filter((m) => m.t > dur * 0.8), finBri = finales.reduce((s, m) => s + m.bri, 0) / (finales.length || 1);
    a.analisis = {
      tecnico: { duracion: fmtT(dur), resolucion: `${a.width} × ${a.height}`, aspecto: aspecto(a.width, a.height), fps: a.fps ? String(a.fps) : 'no informado',
        codec: CODECS[a.codec] || a.codec || 'desconocido', contenedor: 'MP4' + (meta.marca ? ` (${meta.marca})` : ''), audio: meta.audio ? 'sí' : 'no', tamano: fmtB(a.sizeBytes) },
      visual: { escenas, cortes, colores, direccion: dir, ritmo: ritmo > 4 ? 'rápido' : ritmo > 1.5 ? 'medio' : 'lento', cortesPor10s: Math.round(ritmo * 10) / 10,
        energiaMax: { t: Math.round(pico.t * 10) / 10 }, texto: 'no detectable sin proveedor multimodal', logoProducto: 'no detectable sin proveedor multimodal' },
      notasIA: [
        `Predominan ${colores.slice(0, 3).map((c) => c.nombre).filter((x, i, l) => l.indexOf(x) === i).join(', ')}.`,
        `${escenas.length} escena${escenas.length > 1 ? 's' : ''} detectada${escenas.length > 1 ? 's' : ''}${cortes.length ? ' (cortes en ' + cortes.map((c) => c.toFixed(1) + ' s').join(', ') + ')' : ''} · ritmo ${ritmo > 4 ? 'rápido' : ritmo > 1.5 ? 'medio' : 'lento'}.`,
        `Mayor energía visual cerca de ${pico.t.toFixed(1)} s: candidato a momento de producto (heurístico).`,
        `Movimiento predominante ${dir}.`,
        finBri < 0.3 ? 'El final es oscuro y estable: posible cierre de marca (heurístico).' : 'El final no es un cierre oscuro: revisar si incluye logo.',
        `Rango sugerido para 15 s: ${fmtT(a.rangoSugerido[0])} → ${fmtT(a.rangoSugerido[1])}${dur < 15 ? ' (clip más corto que el takeover: LOOP o combinación con contenido generado)' : ''}.`,
      ],
    };
  }
  async function analizarImagen(a) {
    const im = new Image(); im.src = a._url;
    await new Promise((ok, mal) => { im.onload = ok; im.onerror = () => mal(new Error('el navegador no puede decodificar esta imagen')); });
    a._el = im; a.width = im.naturalWidth; a.height = im.naturalHeight;
    const e = estadisticas(im, a.width, a.height);
    a.thumbnail = miniatura(im, a.width, a.height, 240); a.keyframes = [{ t: 0, img: a.thumbnail }];
    const colores = dominantes([e.cuant], 5);
    const [cx, cy] = e.centro, h = cx < 0.4 ? 'cargada a la izquierda' : cx > 0.6 ? 'cargada a la derecha' : 'centrada', v = cy < 0.4 ? 'arriba' : cy > 0.6 ? 'abajo' : 'al medio';
    const caja = e.caja, ocupa = caja ? (caja[2] - caja[0]) * (caja[3] - caja[1]) : 1;
    const transparente = e.transp > 0.05, candLogo = transparente && ocupa < 0.85, candProd = !candLogo && ocupa < 0.75;
    a.analisis = {
      tecnico: { resolucion: `${a.width} × ${a.height}`, aspecto: aspecto(a.width, a.height), formato: a.mimeType.replace('image/', '').toUpperCase(), transparencia: transparente ? `sí (${Math.round(e.transp * 100)} %)` : 'no', tamano: fmtB(a.sizeBytes) },
      visual: { colores, composicion: `${h}, ${v}`, areaSegura: caja ? caja.map((x) => Math.round(x * 100) / 100) : null, ocupacion: Math.round(ocupa * 100) / 100,
        texto: 'no detectable sin proveedor multimodal', logoProducto: 'no detectable sin proveedor multimodal' },
      notasIA: [
        `Predominan ${colores.slice(0, 3).map((c) => c.nombre).filter((x, i, l) => l.indexOf(x) === i).join(', ')}.`,
        `Composición ${h}, ${v}; el contenido ocupa ~${Math.round(ocupa * 100)} % del cuadro.`,
        transparente ? 'Fondo transparente: apto para superponer (logo o packshot recortado) (heurístico).' : 'Fondo opaco: para pantallas anchas conviene REFRAME con extensión de fondo, no estirar.',
        candLogo ? 'Podría ser un logo (transparente y compacto): confirmalo con «USE THIS LOGO».' : candProd ? 'Objeto centrado sobre fondo uniforme: posible packshot; confirmalo con «USE THIS PRODUCT».' : 'Imagen de cuadro completo: útil como fondo o referencia de estilo.',
      ],
    };
  }
  async function huella(buf) {   // SHA-256 local (huella del original; NO es un Asset de M3A)
    try { const h = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return null; }
  }

  // ---------- alta de archivos ----------
  async function agregar(file) {
    const a = { id: 'att-' + (++seq), type: ACEPTA[file.type] || 'desconocido', filename: file.name, mimeType: file.type || 'desconocido', sizeBytes: file.size,
      durationMs: null, width: null, height: null, fps: null, codec: null, thumbnail: null, keyframes: [], assetId: null, sha256: null, status: 'UPLOADING', motivo: null,
      uso: { referencia: true, final: true }, roles: [], derechos: { rightsConfirmed: false, sourceOwner: '', usageNotes: '' },
      rango: null, rangoSugerido: null, analisis: null, _file: file, _url: null, _el: null };
    adjuntos.push(a); pintar();
    try {
      if (!ACEPTA[file.type]) throw new Error(`tipo no admitido (${file.type || 'sin tipo'}): por ahora MP4, JPG, PNG o WEBP`);
      if (file.size > MAX_BYTES) throw new Error(`archivo de ${fmtB(file.size)}: el límite de la simulación es ${fmtB(MAX_BYTES)}`);
      const buf = await file.arrayBuffer();
      a.sha256 = await huella(buf); a.assetId = a.sha256 ? 'local-' + a.sha256.slice(0, 16) : null;
      a._url = URL.createObjectURL(file);
      a.status = 'ANALYZING'; pintar();
      if (a.type === 'video') await analizarVideo(a, buf); else await analizarImagen(a);
      if (a.width < 320 || a.height < 120) throw new Error(`resolución ${a.width}×${a.height}: demasiado chica incluso como fuente`);
      a.status = 'READY';
    } catch (e) {
      a.status = 'REJECTED'; a.motivo = e.message;
    }
    pintar(); if (visorId === a.id) abrirVisor(a.id);
    // Subir = verlo: cuando termina de analizarse todo lo cargado, el material entra a las pantallas y el show arranca.
    if (a.status === 'READY' && !adjuntos.some((x) => x.status === 'UPLOADING' || x.status === 'ANALYZING') && window.TRUST_GENERAR) window.TRUST_GENERAR();
    return a;
  }
  function quitar(id) {
    const i = adjuntos.findIndex((a) => a.id === id); if (i < 0) return;
    const a = adjuntos[i]; if (a._el && a._el.pause) a._el.pause(); if (a._url) URL.revokeObjectURL(a._url);
    adjuntos.splice(i, 1);
    if (concepto && aplicado && JSON.stringify(concepto).includes(id)) quitarDelPreview();
    if (visorId === id) cerrarVisor();
    pintar();
  }

  // ---------- concepto: proveedor intercambiable ----------
  const brandContext = () => ({ brand: "McDonald's", colores: ['#DA291C', '#FFC72C', '#27251F'], restricciones: ['logo oficial solo desde archivos de la agencia', 'no estirar ni deformar el material', 'contenido LED sin luz arquitectónica encima'] });
  const campaignContext = () => ({ campaign: 'Takeover EL TRUST · frente al Obelisco', duracionS: M.DUR, superficies: ['screen_a', 'screen_b', 'horizontal'],
    formatos: Object.fromEntries(Object.entries(FORMATOS).map(([k, f]) => [k, `${f.w}×${f.h}`])), momentos: M.BLOQUES.map((b) => `${b.nombre} ${b.desde}–${b.hasta} s`) });
  // Solicitud multimodal (lo que recibiría un proveedor futuro): texto + metadata + keyframes. Hoy no se envía a ningún lado.
  function solicitudMultimodal(req) {
    return { prompt: req.prompt, brandContext: req.brandContext, campaignContext: req.campaignContext,
      adjuntos: req.attachments.map((a) => ({ id: a.id, type: a.type, filename: a.filename, uso: a.uso, roles: a.roles, tecnico: a.analisis.tecnico,
        descripcion: a.analisis.notasIA.join(' '), keyframes: a.keyframes.map((k) => ({ t: k.t, imagen: '(data URL JPEG 240 px)' })) })) };
  }
  const PROVEEDORES = {
    'planificador-local': { id: 'planificador-local', nombre: 'Planificador local (reglas, sin IA)', multimodal: false, generateConcept: (req) => planLocal(req) },
    // 'proveedor-multimodal': { … generateConcept(req) → CreativePlan }   ← preparado; no se conecta sin autorización de Fer (costo y tope).
  };
  let proveedor = 'planificador-local';
  async function generateConcept(req) { return PROVEEDORES[proveedor].generateConcept(req); }

  function planLocal({ prompt, attachments, brandContext: bc, campaignContext: cc }) {
    const p = (prompt || '').toLowerCase();
    const quiere = { producto: /hamburgues|burger|producto|product|packshot/.test(p), logo: /logo|arco|marca|cierre|firma|brand|arches/.test(p), onda: /onda|ola|wave/.test(p) };
    const listos = attachments.filter((a) => a.status === 'READY');
    const videos = listos.filter((a) => a.type === 'video'), imagenes = listos.filter((a) => a.type === 'image');
    const vid = videos.find((a) => a.roles.includes('clip')) || videos.find((a) => a.uso.final) || videos[0] || null;
    const logo = imagenes.find((a) => a.roles.includes('logo')) || null;
    const prod = imagenes.find((a) => a.roles.includes('producto')) || null;
    const paletaDe = listos.find((a) => a.roles.includes('paleta')) || vid || imagenes[0] || null;
    const paleta = paletaDe ? paletaDe.analisis.visual.colores.map((c) => c.hex) : bc.colores;
    const pistas = { corrientes: [], pellegrini: [], media: [] }, derivadas = [], notas = [], faltantes = [], fx = [];
    const usaVid = vid && vid.uso.final, aspectoVid = vid ? vid.width / vid.height : 0;
    const R = vid ? (vid.rango || vid.rangoSugerido) : null, L = R ? R[1] - R[0] : 0;
    const segV = (desde, hasta, off) => {   // tramo de la fuente que corresponde a [desde, hasta) del show
      const len = hasta - desde, ini = R[0] + off;
      return { desde: Math.round(ini * 1000) / 1000, hasta: Math.round(Math.min(R[1], ini + len) * 1000) / 1000, loop: ini + len > R[1] + 1e-6 };
    };
    const cortaVertical = aspectoVid && aspectoVid < 1;   // 9:16 → no recortar a 2:1 (perdería casi todo): REFRAME con fondo extendido
    if (vid && usaVid && L > 0) {
      // BRAND REVEAL 2–5 s: la entrada del producto en Corrientes (el elemento nace ahí)
      const s1 = segV(2, 5, 0);
      pistas.corrientes.push({ desde: 2.2, hasta: 5, fuente: vid.id, modo: cortaVertical ? 'contener' : 'cubrir', foco: [0.42, 0.5], src: s1, estrategias: ['EXTRACT_SEGMENT', cortaVertical ? 'REFRAME' : 'CROP'] ,
        descripcion: `video ${fmtT(s1.desde)}–${fmtT(s1.hasta)} · ${cortaVertical ? 'reencuadre (vertical) con fondo extendido' : 'crop izquierdo · entrada del producto'}` });
      // FULL TAKEOVER 5–10 s: A+B como un solo lienzo (master 2592×576) o producto en B
      const s2 = segV(5, 10, Math.min(3, Math.max(0, L - 5)));
      if (prod && prod.uso.final && quiere.producto !== false) {
        pistas.corrientes.push({ desde: 5, hasta: 10, fuente: vid.id, modo: cortaVertical ? 'contener' : 'cubrir', foco: [0.5, 0.5], src: s2, estrategias: ['EXTRACT_SEGMENT', 'CROP'], descripcion: `video ${fmtT(s2.desde)}–${fmtT(s2.hasta)} · crop centrado` });
        pistas.pellegrini.push({ desde: 5, hasta: 10, fuente: prod.id, modo: 'contener', foco: [0.5, 0.5], estrategias: ['REFRAME', 'COMBINE_WITH_GENERATED_CONTENT'], descripcion: `Product Hero: ${prod.filename} reencuadrado, sin estirar` });
      } else if (cortaVertical) {
        pistas.corrientes.push({ desde: 5, hasta: 10, fuente: vid.id, modo: 'contener', src: s2, estrategias: ['EXTRACT_SEGMENT', 'REFRAME'], descripcion: `video ${fmtT(s2.desde)}–${fmtT(s2.hasta)} · reencuadre` });
        pistas.pellegrini.push({ desde: 5, hasta: 10, fuente: vid.id, modo: 'contener', src: s2, estrategias: ['EXTRACT_SEGMENT', 'REFRAME'], descripcion: 'mismo tramo · reencuadre' });
      } else {
        pistas.corrientes.push({ desde: 5, hasta: 10, fuente: vid.id, modo: 'master', parte: 'a', foco: [0.5, 0.5], src: s2, estrategias: ['EXTRACT_SEGMENT', 'CROP', 'SPLIT'], descripcion: `video ${fmtT(s2.desde)}–${fmtT(s2.hasta)} · master A+B, crop izquierdo` });
        pistas.pellegrini.push({ desde: 5, hasta: 10, fuente: vid.id, modo: 'master', parte: 'b', foco: [0.5, 0.5], src: s2, estrategias: ['EXTRACT_SEGMENT', 'CROP', 'SPLIT'], descripcion: 'mismo lienzo master · crop derecho (continuación)' });
      }
      // horizontal: fondo en movimiento con la paleta del video + rastro dorado (contenido generado combinado)
      pistas.media.push({ desde: 4.6, hasta: 10, fuente: vid.id, modo: 'paleta', paleta, estrategias: ['GENERATE_VARIATION', 'COMBINE_WITH_GENERATED_CONTENT'], descripcion: 'motion background con los colores del video + rastro de luz' });
      if (L < 10) { notas.push(`El rango elegido dura ${L.toFixed(1)} s: los tramos que lo exceden hacen LOOP.`); }
      fx.push({ fx: 'LIGHT WAVE', desde: 2, hasta: 5, sobre: 'luces', nota: 'acompaña la entrada en Corrientes, de Corrientes a Pellegrini' });
      fx.push({ fx: 'PRODUCT GLOW', desde: 5, hasta: 10, sobre: 'luces + pantallas', nota: prod && prod.uso.final ? 'realce dorado mientras el producto domina Pellegrini' : 'realce dorado en el pico de energía del video' });
      // SIGNATURE 10–13 s: cierre con el final del clip arriba
      const s3 = { desde: Math.max(R[0], R[1] - 3), hasta: R[1], loop: false };
      // el cierre suele tener el logo centrado: NO se parte entre A y B (quedaría cortado por la cúpula); cada torre lo encuadra entero
      const mc = cortaVertical ? 'contener' : 'cubrir', tc = cortaVertical ? 'REFRAME' : 'CROP';
      pistas.corrientes.push({ desde: 10, hasta: 12.9, fuente: vid.id, modo: mc, foco: [0.5, 0.5], src: s3, estrategias: ['EXTRACT_SEGMENT', tc], descripcion: `cierre del clip ${fmtT(s3.desde)}–${fmtT(s3.hasta)} · encuadre centrado` });
      pistas.pellegrini.push({ desde: 10, hasta: 12.9, fuente: vid.id, modo: mc, foco: [0.5, 0.5], src: s3, estrategias: ['EXTRACT_SEGMENT', tc], descripcion: 'cierre del clip · encuadre centrado (el logo no se parte entre torres)' });
    } else if (vid) {
      pistas.corrientes.push({ desde: 5, hasta: 10, fuente: vid.id, modo: 'paleta', paleta, estrategias: ['USE_AS_REFERENCE', 'GENERATE_VARIATION'], descripcion: 'contenido generado con la paleta y el ritmo del video (referencia)' });
      pistas.pellegrini.push({ desde: 5, hasta: 10, fuente: vid.id, modo: 'paleta', paleta, estrategias: ['USE_AS_REFERENCE', 'GENERATE_VARIATION'], descripcion: 'continuación de la variación generada' });
      pistas.media.push({ desde: 4.6, hasta: 10, fuente: vid.id, modo: 'paleta', paleta, estrategias: ['USE_AS_REFERENCE', 'GENERATE_VARIATION'], descripcion: 'motion background con la paleta del video' });
      notas.push(`«${vid.filename}» está marcado solo como REFERENCIA: se usan su paleta y su ritmo, no sus cuadros. Marcá «Usar en el show final» para usar el clip.`);
      fx.push({ fx: 'LIGHT WAVE', desde: 2, hasta: 5, sobre: 'luces' });
    }
    if (prod && prod.uso.final && !(vid && usaVid)) {
      pistas.pellegrini.push({ desde: 5, hasta: 10, fuente: prod.id, modo: 'contener', estrategias: ['REFRAME', 'COMBINE_WITH_GENERATED_CONTENT'], descripcion: `Product Hero: ${prod.filename}` });
      fx.push({ fx: 'PRODUCT GLOW', desde: 5, hasta: 10, sobre: 'luces + pantallas' });
    } else if (prod && !prod.uso.final) notas.push(`«${prod.filename}» (producto) está como referencia: no se publica.`);
    if (logo && logo.uso.final) {
      pistas.media.push({ desde: 10, hasta: 12.9, fuente: logo.id, modo: 'logo', paleta, estrategias: ['USE_AS_IS', 'COMBINE_WITH_GENERATED_CONTENT'], descripcion: `logo «${logo.filename}» solo en Signature` });
    } else if (logo) notas.push(`«${logo.filename}» (logo) está como referencia: el cierre usa el nombre en letras hasta que lo marques para el show final.`);
    fx.push({ fx: 'SIGNATURE GLOW', desde: 10, hasta: 13, sobre: 'luces + reloj', nota: 'oro y cálido suben; el rojo baja' });
    if (!listos.length) notas.push('Sin material listo: se usa la base del show.');
    if (!vid) faltantes.push({ para: 'screen_a + screen_b (5–10 s)', pedido: 'Video de campaña o de producto 16:9, ≥ 1920×1080, 8–15 s, sin textos legales incrustados.', promptGenerativo: `Premium hero shot of the product on deep red (#DA291C) background, volumetric warm light, slow push-in, 2592×576 safe framing, no text.` });
    if (!logo || !logo.uso.final) faltantes.push({ para: 'horizontal · Signature (10–13 s)', pedido: 'Logo oficial en PNG con transparencia (archivo de la agencia).', promptGenerativo: null });
    if (!prod && quiere.producto) faltantes.push({ para: 'screen_b · Product Hero', pedido: 'Packshot del producto con fondo limpio o transparente.', promptGenerativo: 'Clean packshot of the product, centered, transparent background, soft rim light.' });
    if (quiere.onda && !fx.some((f) => f.fx === 'LIGHT WAVE')) fx.unshift({ fx: 'LIGHT WAVE', desde: 2, hasta: 5, sobre: 'luces' });
    // RENDERED CAMPAIGN ASSETS (§53): lo que el contrato v1 puede representar. upperMode es de CAMPAÑA (draft-schema.ts):
    // con un tramo master, A+B salen en UN solo lienzo 2592×576 de 15 s; si no, un archivo por torre. Nunca se mezclan.
    const upperMode = pistas.corrientes.some((x) => x.modo === 'master') ? 'master' : 'independent';
    const fuenteDe = (id) => listos.find((a) => a.id === id);
    const desc = (seg) => `${seg.desde}–${seg.hasta} s: ${seg.estrategias.join(' + ')} · ${seg.descripcion}`;
    const armar = (sup, todos) => {
      const segs = todos.filter((x) => x.fuente && fuenteDe(x.fuente) && fuenteDe(x.fuente).uso.final);   // una REFERENCIA nunca genera un asset publicable
      if (!segs.length) return;
      const peso = new Map(); for (const x of segs) if (x.fuente) peso.set(x.fuente, (peso.get(x.fuente) || 0) + (x.hasta - x.desde));
      const prim = fuenteDe([...peso.entries()].sort((a, b) => b[1] - a[1])[0][0]), f = FORMATOS[sup];
      VERSIONES[sup] = (VERSIONES[sup] || 0) + 1;
      derivadas.push({ id: `der-${sup}-v${VERSIONES[sup]}`, nombre: `${prim.filename.replace(/\.[^.]+$/, '')}_${sup}_v${VERSIONES[sup]}.mp4`, superficie: sup,
        derivedFromAssetId: prim.assetId || prim.id, derivadoDe: [...peso.keys()].map((id) => { const a = fuenteDe(id); return { assetId: a.assetId || a.id, filename: a.filename }; }),
        fuente: prim.filename, transformacion: segs.map(desc).join(' | ') + ' | resto: contenido generado de la plantilla',
        formatoDestino: `${f.w}×${f.h} · H.264 · 25 fps · ${M.DUR} s`, estado: 'PREVIEW — requiere render + Asset Validation M3A (no disponible offline)' });
    };
    if (upperMode === 'master') armar('master', [...pistas.corrientes, ...pistas.pellegrini.filter((x) => x.modo !== 'master')]);
    else { armar('screen_a', pistas.corrientes); armar('screen_b', pistas.pellegrini); }
    armar('horizontal', pistas.media.filter((x) => x.modo !== 'paleta' || x.estrategias.includes('COMBINE_WITH_GENERATED_CONTENT')));
    const momentos = M.BLOQUES.map((b) => ({ id: b.id, nombre: b.nombre, desde: b.desde, hasta: b.hasta,
      pantallas: Object.fromEntries(Object.entries(pistas).map(([pid, segs]) => { const s = segs.find((x) => x.desde < b.hasta && x.hasta > b.desde); return [SUP_DE[pid], s ? `${s.estrategias.join(' + ')} · ${s.descripcion}` : 'contenido generado de la plantilla']; })),
      fx: fx.filter((f) => f.desde < b.hasta && f.hasta > b.desde).map((f) => f.fx) }));
    return { version: 'creative-plan-v0', simulacion: true, proveedor: PROVEEDORES[proveedor].nombre, generadoEn: 'navegador local', prompt, brandContext: bc, campaignContext: cc,
      flujo: !listos.length ? 'IDEA FIRST' : (prompt || '').trim() ? 'MEDIA + PROMPT' : 'MEDIA FIRST', duracionS: M.DUR,
      upperMode,
      fuentes: listos.map((a) => ({ id: a.id, filename: a.filename, assetId: a.assetId, uso: a.uso.final ? 'CAMPAIGN ASSET (pendiente de validación)' : 'REFERENCE MEDIA', roles: a.roles, rango: a.rango, derechos: a.derechos })),
      momentos, pistas, fx, derivadas, faltantes, notas: ['Nada se estira: cada pantalla recorta o reencuadra el material a su medida.', ...notas] };
  }

  // ---------- preview sobre las 3 pantallas del simulador ----------
  function sincronizar(seg, t) {   // el video sigue al reloj del show; en pausa queda en el cuadro exacto
    const a = adjuntos.find((x) => x.id === seg.fuente); if (!a || !a._el || a.type !== 'video') return;
    const v = a._el, s = seg.src, len = Math.max(0.05, s.hasta - s.desde);
    let quiero = s.desde + (t - seg.desde); if (quiero > s.hasta) quiero = s.desde + ((quiero - s.desde) % len);
    if (M.animando() && M.estado().show.reproduciendo) {
      if (v.paused) { v.currentTime = quiero; v.play().catch(() => {}); } else if (Math.abs(v.currentTime - quiero) > 0.3) v.currentTime = quiero;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - quiero) > 0.03 && !v.seeking) v.currentTime = quiero;
    }
  }
  function aplicarAlPreview() {
    if (!concepto) return;
    const fuentes = {};
    for (const a of adjuntos) if (a.status === 'READY' && a._el) { fuentes[a.id] = a._el; if (a.type === 'video' && !a._oyente) { a._oyente = true; a._el.addEventListener('seeked', () => window.TRUST && TRUST.dibujarYa()); } }
    CONT.setMedia({ pistas: concepto.pistas, fuentes, sincronizar });
    aplicado = true;
    M.restaurarNiveles(); M.cargarShow(); M.seek(0);
    pintar();
  }
  function quitarDelPreview() {
    CONT.setMedia(null); aplicado = false;
    for (const a of adjuntos) if (a._el && a._el.pause) a._el.pause();
    pintar(); if (window.TRUST) TRUST.dibujarYa();
  }

  // ---------- interfaz ----------
  const ICONO = { video: '▶', image: '▣', desconocido: '?' };
  const ESTADO_TXT = { UPLOADING: 'Subiendo', ANALYZING: 'Analizando', READY: 'Listo', REJECTED: 'Rechazado' };
  function pintar() {
    const ul = $('adj-lista'); if (!ul) return;
    ul.innerHTML = adjuntos.map((a) => `<li class="adj ${a.status.toLowerCase()}" data-id="${a.id}">
      <button class="adj-ver" data-id="${a.id}" title="Ver análisis y opciones">${a.thumbnail ? `<img src="${a.thumbnail}" alt="">` : `<span class="ic">${ICONO[a.type] || '?'}</span>`}
        <span class="adj-txt"><b>${esc(a.filename)}</b><small>${a.status === 'READY' ? (a.type === 'video' ? `${fmtT(a.durationMs / 1000)} · ${a.width}×${a.height}` : `${a.width}×${a.height}`) + ' · ' + (a.uso.final ? 'va al show' : 'referencia') + (a.roles.length ? ' · ' + a.roles.join(', ') : '') : a.status === 'REJECTED' ? esc(a.motivo) : a.status === 'ANALYZING' ? 'analizando…' : 'cargando…'}</small></span>
        <em class="estado-adj">${ESTADO_TXT[a.status]}</em></button>
      <button class="adj-quitar" data-id="${a.id}" title="Quitar">remove</button></li>`).join('');
    ul.querySelectorAll('.adj-ver').forEach((b) => b.addEventListener('click', () => abrirVisor(b.dataset.id)));
    ul.querySelectorAll('.adj-quitar').forEach((b) => b.addEventListener('click', () => quitar(b.dataset.id)));
    $('adj-vacio').hidden = adjuntos.length > 0;
    const c = $('concepto');
    if (!concepto) { c.hidden = true; return; }
    c.hidden = false;
    c.innerHTML = `<p class="cab">Plan del show · armado con reglas a partir de tu material${(concepto.prompt || '').trim() ? ' y tu pedido' : ''} (sin IA)</p>
      <p class="sub">Qué se ve en cada momento</p>
      <div class="story">${concepto.momentos.map((m) => `<div class="mom"><b>${m.desde}–${m.hasta} s · ${esc(m.nombre)}</b>${m.fx.length ? `<span class="fx">${m.fx.join(' · ')}</span>` : ''}
        ${[['screen_a', 'Corrientes'], ['screen_b', 'Pellegrini'], ['horizontal', 'Abajo']].map(([s, k]) => `<div class="ln" title="${esc(m.pantallas[s])}"><i>${k}</i>${esc(m.pantallas[s].split(' · ').slice(1).join(' · ') || m.pantallas[s])}</div>`).join('')}</div>`).join('')}</div>
      ${concepto.derivadas.length ? `<p class="sub">Archivos finales a producir (el original no se toca)</p><ul class="lista-chica">${concepto.derivadas.map((d) => `<li title="${esc(d.transformacion)}"><b>${esc(d.nombre)}</b> · ${esc(d.formatoDestino)} · sale de ${esc(d.fuente)} · <i>pendiente de render y validación</i></li>`).join('')}</ul>` : ''}
      ${concepto.faltantes.length ? `<p class="sub">Falta</p><ul class="lista-chica">${concepto.faltantes.map((f) => `<li><b>${esc(f.para)}:</b> ${esc(f.pedido)}${f.promptGenerativo ? `<br><code>${esc(f.promptGenerativo)}</code>` : ''}</li>`).join('')}</ul>` : ''}
      <ul class="lista-chica notas">${concepto.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <div class="botonera"><button class="b oro" id="c-aplicar">${aplicado ? 'Viéndolo en el edificio ✓' : 'Ver en el edificio'}</button><button class="b" id="c-quitar" ${aplicado ? '' : 'disabled'}>Quitar el material</button><button class="b" id="c-exportar">Descargar plan</button></div>`;
    $('c-aplicar').addEventListener('click', aplicarAlPreview);
    $('c-quitar').addEventListener('click', quitarDelPreview);
    $('c-exportar').addEventListener('click', exportarPlan);
  }
  function exportarPlan() {
    const req = { prompt: concepto.prompt, attachments: adjuntos.filter((a) => a.status === 'READY'), brandContext: concepto.brandContext, campaignContext: concepto.campaignContext };
    const datos = { formato: 'trust-creative-plan-v0', simulacion: true, plan: concepto, mediaAttachments: adjuntos.map(publico).map((a) => Object.assign(a, { thumbnail: a.thumbnail ? '(data URL)' : null, keyframes: a.keyframes.map((k) => ({ t: k.t })) })), solicitudMultimodal: solicitudMultimodal(req) };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }));
    a.download = 'plan-creativo-trust.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function generar() {
    const req = { prompt: $('prompt').value, attachments: adjuntos.filter((a) => a.status === 'READY'), brandContext: brandContext(), campaignContext: campaignContext() };
    concepto = await generateConcept(req);
    aplicado = false; CONT.setMedia(null);
    pintar();
    return concepto;
  }

  // visor (preview del adjunto)
  const ATAJOS = [
    ['producto', 'Es el producto', 'image'], ['logo', 'Es el logo', 'image'], ['estilo', 'Tomar su estilo', 'video'],
    ['paleta', 'Tomar sus colores', null], ['clip', 'Usar este clip', 'video'],
  ];
  function abrirVisor(id) {
    const a = adjuntos.find((x) => x.id === id); if (!a) return;
    visorId = id;
    const v = $('visor'); v.hidden = false;
    const tec = a.analisis ? a.analisis.tecnico : {}, vis = a.analisis ? a.analisis.visual : {};
    const medio = a.status !== 'READY' ? `<div class="vis-vacio">${a.status === 'REJECTED' ? 'REJECTED · ' + esc(a.motivo) : a.status + '…'}</div>`
      : a.type === 'video' ? `<video id="vis-player" src="${a._url}" controls muted playsinline></video>` : `<img id="vis-img" src="${a._url}" alt="${esc(a.filename)}">`;
    v.querySelector('.vis-caja').innerHTML = `
      <header><h3>${esc(a.filename)} <small>${a.type === 'video' ? 'VIDEO' : 'IMAGEN'} · ${a.status}</small></h3><button class="b" id="vis-cerrar">✕</button></header>
      <div class="vis-cuerpo">
        <div class="vis-izq">${medio}
          ${a.keyframes.length > 1 ? `<div class="kf">${a.keyframes.map((k) => `<figure><img src="${k.img}" alt=""><figcaption>${k.t.toFixed(2)} s</figcaption></figure>`).join('')}</div>` : ''}
          ${a.type === 'video' && a.status === 'READY' ? `<div class="rango"><p class="sub">Qué parte del video usar</p>
            <div class="rango-barra"><span id="rg-sel"></span>${(vis.cortes || []).map((c) => `<i style="left:${c / (a.durationMs / 1000) * 100}%"></i>`).join('')}</div>
            <div class="fila"><label for="rg-a">Desde</label><input type="range" id="rg-a" min="0" max="${a.durationMs}" step="40" value="${Math.round(a.rango[0] * 1000)}"><span class="valor" id="rg-a-v"></span></div>
            <div class="fila"><label for="rg-b">Hasta</label><input type="range" id="rg-b" min="0" max="${a.durationMs}" step="40" value="${Math.round(a.rango[1] * 1000)}"><span class="valor" id="rg-b-v"></span></div>
            <p class="uso-rango" id="rg-txt"></p><button class="b" id="rg-sug">Usar la parte sugerida (${fmtT(a.rangoSugerido[0])} → ${fmtT(a.rangoSugerido[1])})</button></div>` : ''}
        </div>
        <div class="vis-der">
          <p class="sub">Datos del archivo</p>
          <table class="meta">${Object.entries(tec).map(([k, x]) => `<tr><th>${esc(k)}</th><td>${esc(x)}</td></tr>`).join('')}${a.sha256 ? `<tr><th>SHA-256 (local)</th><td class="mono">${a.sha256.slice(0, 24)}…</td></tr>` : ''}</table>
          ${a.analisis ? `<p class="sub">Lo que vimos en el material <span class="gen">análisis automático por reglas · no es IA · puede fallar</span></p>
          <ul class="notas-ia">${a.analisis.notasIA.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
          <div class="paleta">${vis.colores.map((c) => `<span style="background:${c.hex}" title="${c.nombre} · ${Math.round(c.peso * 100)} %"></span>`).join('')}</div>` : ''}
          <p class="sub">Para qué se usa</p>
          <label class="chk"><input type="checkbox" id="u-ref" ${a.uso.referencia ? 'checked' : ''}> Solo como referencia (no sale al aire)</label>
          <label class="chk"><input type="checkbox" id="u-fin" ${a.uso.final ? 'checked' : ''} ${a.status !== 'READY' ? 'disabled' : ''}> Usar en el show final <small>(antes de salir al aire se renderiza y se valida)</small></label>
          <p class="sub">Derechos (opcional)</p>
          <label class="chk"><input type="checkbox" id="d-rc" ${a.derechos.rightsConfirmed ? 'checked' : ''}> Derechos de uso confirmados</label>
          <input class="txt" id="d-own" placeholder="Dueño del material (agencia / marca)" value="${esc(a.derechos.sourceOwner)}">
          <input class="txt" id="d-not" placeholder="Notas de uso" value="${esc(a.derechos.usageNotes)}">
          ${a.status === 'READY' ? `<p class="sub">Atajos para tu pedido</p><div class="atajos">${ATAJOS.filter(([, , t]) => !t || t === a.type).map(([r, txt]) => `<button class="b ${a.roles.includes(r) ? 'on' : ''}" data-r="${r}">${txt}</button>`).join('')}
            ${a.type === 'video' ? '<button class="b oro" id="build15">Armar el show de 15 s con este video</button>' : ''}</div>` : ''}
        </div>
      </div>`;
    $('vis-cerrar').addEventListener('click', cerrarVisor);
    $('u-ref').addEventListener('change', (e) => { a.uso.referencia = e.target.checked; pintar(); });
    $('u-fin').addEventListener('change', (e) => { a.uso.final = e.target.checked; pintar(); });
    $('d-rc').addEventListener('change', (e) => { a.derechos.rightsConfirmed = e.target.checked; });
    $('d-own').addEventListener('input', (e) => { a.derechos.sourceOwner = e.target.value; });
    $('d-not').addEventListener('input', (e) => { a.derechos.usageNotes = e.target.value; });
    v.querySelectorAll('.atajos [data-r]').forEach((b) => b.addEventListener('click', () => {
      const r = b.dataset.r; if (a.roles.includes(r)) a.roles = a.roles.filter((x) => x !== r); else a.roles.push(r);
      if (a.roles.includes(r)) agregarAlPrompt({ producto: `Usá «${a.filename}» como producto protagonista.`, logo: `Usá «${a.filename}» como logo, solo en el cierre.`, estilo: `Tomá el estilo visual de «${a.filename}».`, paleta: `Usá la paleta de colores de «${a.filename}».`, clip: `Usá el clip «${a.filename}» ${a.rango ? `(${fmtT(a.rango[0])} → ${fmtT(a.rango[1])})` : ''}.` }[r]);
      abrirVisor(a.id); pintar();
    }));
    if ($('build15')) $('build15').addEventListener('click', () => {
      if (!a.roles.includes('clip')) a.roles.push('clip');
      $('prompt').value = `Show de 15 s con el video «${a.filename}» como material principal (${fmtT(a.rango[0])} → ${fmtT(a.rango[1])}). El producto protagonista, que la imagen arranque en Corrientes, pase a Pellegrini y baje a la pantalla de abajo; el logo solo en el cierre.`;
      plegar(false); abrirVisor(a.id); pintar();
    });
    if (a.type === 'video' && a.status === 'READY') {
      const ra = $('rg-a'), rb = $('rg-b'), dur = a.durationMs / 1000;
      const act = () => {
        let x = +ra.value / 1000, y = +rb.value / 1000; if (y - x < 0.5) { if (document.activeElement === ra) x = y - 0.5; else y = x + 0.5; }
        x = cl(x, 0, dur - 0.5); y = cl(y, x + 0.5, dur); a.rango = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
        ra.value = Math.round(x * 1000); rb.value = Math.round(y * 1000);
        $('rg-a-v').textContent = x.toFixed(1) + 's'; $('rg-b-v').textContent = y.toFixed(1) + 's';
        ra.style.setProperty('--p', (x / dur * 100) + '%'); rb.style.setProperty('--p', (y / dur * 100) + '%');
        $('rg-sel').style.left = (x / dur * 100) + '%'; $('rg-sel').style.width = ((y - x) / dur * 100) + '%';
        $('rg-txt').innerHTML = `Se usa: <b>${fmtT(a.rango[0])} → ${fmtT(a.rango[1])}</b> · ${(y - x).toFixed(2)} s${y - x < 15 ? ' (menos de 15 s: LOOP / combinación)' : ''}`;
        pintar();
      };
      ra.addEventListener('input', act); rb.addEventListener('input', act);
      $('rg-sug').addEventListener('click', () => { ra.value = Math.round(a.rangoSugerido[0] * 1000); rb.value = Math.round(a.rangoSugerido[1] * 1000); act(); });
      act();
    }
  }
  function cerrarVisor() { visorId = null; const v = $('visor'); v.hidden = true; const p = $('vis-player'); if (p) p.pause(); v.querySelector('.vis-caja').innerHTML = ''; }
  function agregarAlPrompt(txt) { const p = $('prompt'); if (!p.value.includes(txt)) p.value = (p.value.trim() + ' ' + txt).trim(); }
  function plegar(pl) { $('t-director').classList.toggle('plegado', pl); $('director-plegar').setAttribute('aria-expanded', String(!pl)); }

  async function subir(files) { const prom = []; for (const f of files) prom.push(agregar(f)); return Promise.all(prom); }
  function montar() {
    $('upload').addEventListener('click', () => $('adj-archivo').click());
    $('adj-archivo').addEventListener('change', (e) => { subir([...e.target.files]); e.target.value = ''; });
    const zona = $('t-director');
    ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); zona.classList.add('soltar'); } }));
    ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => { if (ev === 'dragleave' && zona.contains(e.relatedTarget)) return; zona.classList.remove('soltar'); }));
    zona.addEventListener('drop', (e) => { e.preventDefault(); subir([...e.dataTransfer.files]); });
    $('visor').addEventListener('click', (e) => { if (e.target.id === 'visor') cerrarVisor(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && visorId) cerrarVisor(); });
    pintar();
  }
  montar();

  window.ESTUDIO = {
    hayMedia: () => adjuntos.some((a) => a.status === 'READY'),
    generar, generateConcept, aplicarAlPreview, quitarDelPreview, subir, quitar,
    adjuntos: () => adjuntos.map(publico),
    concepto: () => (concepto ? JSON.parse(JSON.stringify(concepto)) : null),
    aplicado: () => aplicado,
    marcar(id, cambios) {   // para pruebas y para el operador (equivalente a los checkboxes y atajos del visor)
      const a = adjuntos.find((x) => x.id === id); if (!a) throw new Error('adjunto ' + id);
      if (cambios.final != null) a.uso.final = !!cambios.final; if (cambios.referencia != null) a.uso.referencia = !!cambios.referencia;
      if (cambios.roles) a.roles = cambios.roles.slice(); if (cambios.rango) a.rango = cambios.rango.slice();
      pintar(); return publico(a);
    },
    abrirVisor, cerrarVisor, FORMATOS, ESTRATEGIAS, PROVEEDORES: Object.keys(PROVEEDORES),
    leerMP4: (buf) => leerMP4(buf),
  };
})();
