// Portal EL TRUST · trust.affinitas.com.ar — Cloudflare Worker.
// SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar.
// - Una clave compartida (env.CLAVE) abre una sesión firmada (cookie HttpOnly, 12 h). 10 intentos fallidos por IP → 15 min de bloqueo.
// - Las claves de Claude y fal viven SOLO acá (secrets del Worker): el navegador nunca las ve.
// - Tope de gasto diario (env.TOPE_DIARIO_USD, USD 5 por defecto) contado en R2 antes de cada llamada paga.
// - El navegador orquesta los pasos (plan → imágenes → control → guardar); cada paso es una llamada corta y acotada.
// - Solo se habla con hosts conocidos (api.anthropic.com, queue.fal.run, CDN de fal): nada de URLs arbitrarias con las claves.

const MODELO = 'claude-sonnet-5-5';
const PRECIO = { claude: 0.02, imagen: { corrientes: 0.06, pellegrini: 0.06, media: 0.045 }, video: 0.35 };
const GEN = { corrientes: [2048, 1024], pellegrini: [2560, 1024], media: [2400, 512] };
const SESION_H = 12, MAX_INTENTOS = 10, BLOQUEO_MIN = 15;

const DIRECTOR = `Sos director de arte de un edificio con pantallas LED frente al Obelisco (Buenos Aires): EL TRUST.
Salida FIJA, nunca la cambies: 3 pantallas y 46 luminarias RGBW de fachada, show de 15 s.
- corrientes: panel superior izquierdo, 2:1. pellegrini: panel superior derecho, 2,5:1. Entre los dos está la cúpula
  (un hueco físico): nada importante puede quedar partido entre ambos; cada pantalla tiene que leerse sola.
- media: banda muy panorámica 4,66:1 sobre el primer piso; ideal para texturas, horizontes, movimiento lateral.
Reglas de las imágenes (las genera otro modelo a partir de tus prompts en inglés):
- SIN texto, letras, números, logos, marcas, envases con marca ni rostros protagonistas. Los textos y la marca los pone
  el sistema después, desde el pack oficial del cliente. Pedí envases lisos y genéricos.
- Fotografía publicitaria de producto, iluminación de estudio, alto contraste, fondos limpios y oscuros que se lean de
  noche a 80 m de distancia; el sujeto principal centrado, entero (con su envase completo) y con aire alrededor.
- Encuadre por pantalla: en corrientes y pellegrini (2:1 y 2,5:1) el producto entero en el centro, ocupando cerca de la
  mitad del alto, con lo que cae o vuela (papas, migas, chispas) contenido dentro del cuadro; en media (4,66:1) una banda
  horizontal o un horizonte que puede salir por los costados, con el producto chico al centro.
- Las 3 imágenes forman una campaña coherente (misma luz y paleta), pero cada una con un encuadre propio de su formato.
Devolvé SOLO JSON:
{"titulo": "...", "concepto": "una frase en español",
 "corrientes": {"prompt": "..."}, "pellegrini": {"prompt": "..."}, "media": {"prompt": "..."},
 "video": {"pantalla": "corrientes|pellegrini|null", "movimiento": "prompt en inglés de movimiento de cámara lento"},
 "ficha": {"efecto": "barrido|ola|latido|destello|degrade|respiracion|persecucion", "paleta": ["#RRGGBB", "..."],
           "zonas": [], "velocidad": 1, "titular": "texto corto en español para que el sistema lo ponga (o vacío)"}}`;

const CONTROL = `Sos control de calidad de piezas para pantallas LED publicitarias. Mirá la imagen y respondé SOLO JSON:
{"grave": true|false, "motivo": "menos de 15 palabras, en español", "correccion": "instrucción en inglés para regenerar, o vacío"}
grave = true SOLO si pasa algo de esto:
- hay texto, letras o números legibles, o un logo, o un producto/envase con una marca reconocible impresa;
- el producto PRINCIPAL (el protagonista) o su envase quedan cortados por un borde;
- el producto está deformado o se ve claramente falso.
NO es grave (respondé grave=false): elementos secundarios que tocan un borde (papas que caen, migas, chispas, humo),
una banda o textura que sale por los costados en formatos muy panorámicos, un envase liso de color, aire vacío a los lados.`;

// ---------- utilidades ----------
const enc = new TextEncoder();
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(env, txt) {
  const k = await crypto.subtle.importKey('raw', enc.encode('trust-sesion|' + env.CLAVE + '|' + env.FAL_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(txt)));
}
function igual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const cookie = (req, n) => (req.headers.get('cookie') || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === n)?.[1];
async function sesionValida(req, env) {
  const v = cookie(req, 'trust_s');
  if (v) { const [exp, firma] = v.split('.'); if (exp && firma && Date.now() <= +exp && igual(firma, await hmac(env, exp))) return true; }
  return sesionSinCookies(req, env);
}
// Navegadores que no guardan cookies (p. ej. el de una tele): después de entrar con la clave, esa conexión
// (la IP pública) queda habilitada por SIN_COOKIES_H horas. Solo se activa si el navegador demostró que no guarda la cookie.
const SIN_COOKIES_H = 3, MEMO_IP = new Map();
async function sesionSinCookies(req, env) {
  const k = await ipHash(req), m = MEMO_IP.get(k);
  if (m && m > Date.now()) return true;
  const o = await leerR2(env, `sincookies/${k}.json`, null);
  if (o && o.hasta > Date.now()) { MEMO_IP.set(k, Math.min(o.hasta, Date.now() + 60e3)); return true; }
  return false;
}
async function activarSinCookies(req, env) {   // solo si esta IP entró con la clave hace menos de 2 minutos
  const k = await ipHash(req), pend = await leerR2(env, `pendiente/${k}.json`, null);
  if (!pend || Date.now() - pend.t > 120e3) return false;
  await env.PIEZAS.put(`sincookies/${k}.json`, JSON.stringify({ hasta: Date.now() + SIN_COOKIES_H * 3600e3 }));
  await env.PIEZAS.delete(`pendiente/${k}.json`); MEMO_IP.delete(k);
  return true;
}
const ipHash = async (req) => hex(await crypto.subtle.digest('SHA-256', enc.encode('ip|' + (req.headers.get('cf-connecting-ip') || '?')))).slice(0, 24);
async function leerR2(env, k, def) { const o = await env.PIEZAS.get(k); return o ? o.json() : def; }
const hoy = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // día de Buenos Aires
async function cobrar(env, concepto, usd) {
  const tope = +(env.TOPE_DIARIO_USD || 5), k = `gasto/${hoy()}.json`, g = await leerR2(env, k, { usd: 0, items: [] });
  if (g.usd + usd > tope) throw new Tope(`Por hoy se llegó al tope de USD ${tope}. Mañana se puede seguir creando.`);
  g.usd = +(g.usd + usd).toFixed(4); g.items.push([new Date().toISOString(), concepto, usd]);
  await env.PIEZAS.put(k, JSON.stringify(g)); return g.usd;
}
class Tope extends Error {}

// ---------- proveedores ----------
async function claude(env, sistema, contenido, max = 2000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELO, max_tokens: max, system: sistema, messages: [{ role: 'user', content: contenido }] }) });
  if (!r.ok) throw new Error(`Claude respondió ${r.status}`);
  const d = await r.json(), t = (d.content || []).map((b) => b.text || '').join(''), i = t.indexOf('{'), j = t.lastIndexOf('}');
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}
const FAL_COLA = 'https://queue.fal.run/';
const esFalCola = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'queue.fal.run'; } catch { return false; } };
const esFalCdn = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'fal.media' || x.hostname.endsWith('.fal.media')); } catch { return false; } };
async function falEnviar(env, modelo, entrada) {
  const r = await fetch(FAL_COLA + modelo, { method: 'POST', headers: { authorization: `Key ${env.FAL_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(entrada) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`fal respondió ${r.status}: ${(d.detail && JSON.stringify(d.detail).slice(0, 160)) || ''}`);
  return { estado: d.status_url, resultado: d.response_url };
}

// ---------- API ----------
async function api(req, env, ruta) {
  const cuerpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (ruta === '/api/gasto') { const g = await leerR2(env, `gasto/${hoy()}.json`, { usd: 0 }); return json({ usd: g.usd, tope: +(env.TOPE_DIARIO_USD || 5) }); }

  if (ruta === '/api/plan') {
    const brief = String(cuerpo.brief || '').trim().slice(0, 1200); if (brief.length < 8) return json({ error: 'Contá la idea en al menos una frase.' }, 400);
    await cobrar(env, 'plan', PRECIO.claude);
    const plan = await claude(env, DIRECTOR, `Brief: ${brief}\nVideo pedido: ${cuerpo.video ? 'sí' : 'no'}.`);
    if (!plan || !plan.corrientes) return json({ error: 'No salió una idea clara para las pantallas. Probá de nuevo o contala distinto.' }, 502);
    return json(plan);
  }
  if (ruta === '/api/imagen') {
    const p = cuerpo.pantalla; if (!GEN[p]) return json({ error: 'pantalla inválida' }, 400);
    const prompt = String(cuerpo.prompt || '').slice(0, 2500) + ' Absolutely no text, no letters, no numbers, no logos, no brand marks.';
    await cobrar(env, `imagen ${p}`, PRECIO.imagen[p]);
    return json(await falEnviar(env, 'fal-ai/flux-2-pro', { prompt, image_size: { width: GEN[p][0], height: GEN[p][1] }, seed: (cuerpo.seed | 0) || undefined, output_format: 'jpeg', safety_tolerance: '2' }));
  }
  if (ruta === '/api/video') {
    if (!esFalCdn(cuerpo.imagen)) return json({ error: 'imagen inválida' }, 400);
    await cobrar(env, 'video 5 s', PRECIO.video);
    return json(await falEnviar(env, 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', { prompt: String(cuerpo.movimiento || 'slow push-in').slice(0, 600) + '. Slow, smooth, premium commercial. No text, no logos.',
      image_url: cuerpo.imagen, duration: '5', negative_prompt: 'text, letters, logo, watermark, blur, distortion, faces' }));
  }
  if (ruta === '/api/estado') {   // consulta un trabajo de fal (solo URLs de su cola)
    if (!esFalCola(cuerpo.estado) || !esFalCola(cuerpo.resultado)) return json({ error: 'trabajo inválido' }, 400);
    const h = { authorization: `Key ${env.FAL_KEY}` };
    const s = await (await fetch(cuerpo.estado, { headers: h })).json();
    if (s.status !== 'COMPLETED') return json({ listo: false, estado: s.status, error: /FAIL|ERROR/.test(s.status || '') ? 'fal no pudo generar esta imagen' : undefined });
    const r = await (await fetch(cuerpo.resultado, { headers: h })).json();
    return json({ listo: true, url: r.images ? r.images[0].url : r.video && r.video.url });
  }
  if (ruta === '/api/control') {
    if (!esFalCdn(cuerpo.url) || !GEN[cuerpo.pantalla]) return json({ error: 'imagen inválida' }, 400);
    await cobrar(env, `control ${cuerpo.pantalla}`, PRECIO.claude);
    const qc = await claude(env, CONTROL, [{ type: 'image', source: { type: 'url', url: cuerpo.url } },
      { type: 'text', text: `Pantalla ${cuerpo.pantalla} (${GEN[cuerpo.pantalla][0] / GEN[cuerpo.pantalla][1]}:1). Respondé solo el JSON.` }], 1500);
    if (!qc) return json({ ok: false, motivo: 'el control no respondió claro', correccion: 'Keep the main product fully inside the frame.' });   // falla cerrada
    return json({ ok: qc.grave !== true, motivo: qc.motivo || '', correccion: qc.correccion || '' });
  }
  if (ruta === '/api/guardar') {   // copia los originales de fal a R2 (la CDN de fal no garantiza guardarlos)
    const id = `${hoy()}-${crypto.randomUUID().slice(0, 8)}`, pantallas = {};
    for (const [k, u] of Object.entries(cuerpo.pantallas || {})) {
      if (!/^(corrientes|pellegrini|media)(_video)?$/.test(k) || !esFalCdn(u)) continue;
      const r = await fetch(u); if (!r.ok) continue;
      const ext = k.endsWith('_video') ? 'mp4' : 'jpg';
      await env.PIEZAS.put(`piezas/${id}/${k}.${ext}`, await r.arrayBuffer(), { httpMetadata: { contentType: ext === 'mp4' ? 'video/mp4' : 'image/jpeg' } });
      pantallas[k] = `/piezas/${id}/${k}.${ext}`;
    }
    if (!pantallas.corrientes || !pantallas.pellegrini) return json({ error: 'No se pudieron guardar las imágenes.' }, 502);
    const f = cuerpo.ficha || {}, meta = { id, titulo: String(cuerpo.titulo || 'Pieza IA').slice(0, 60), concepto: String(cuerpo.concepto || '').slice(0, 400),
      brief: String(cuerpo.brief || '').slice(0, 1200), ficha: { efecto: f.efecto, paleta: (f.paleta || []).slice(0, 4), zonas: f.zonas || [], velocidad: f.velocidad, titular: String(f.titular || '').slice(0, 40) },
      pantallas, creada: new Date().toISOString() };
    await env.PIEZAS.put(`piezas/${id}/meta.json`, JSON.stringify(meta));
    return json(meta);
  }
  if (ruta === '/api/programa') {   // grilla semanal de programación (prototipo: no se envía al edificio)
    if (req.method !== 'POST') return json(await leerR2(env, 'programa/semana.json', null));
    const P = validarPrograma(cuerpo); if (!P) return json({ error: 'La programación no tiene un formato válido.' }, 400);
    P.actualizado = new Date().toISOString();
    await env.PIEZAS.put('programa/semana.json', JSON.stringify(P));
    return json(P);
  }
  if (ruta === '/api/piezas') {   // las creadas con IA + los shows de material de marca ya cargado (McÁlvarez, McAllister, McFernández…)
    const faltan = [], mat = (await piezasMaterial(env, req.url, faltan)).map((p) => {
      const mi = p.miniatura && p.fuentes[p.miniatura.fuente] ? { url: p.fuentes[p.miniatura.fuente], rect: p.miniatura.rect } : null;
      const pr = (p.pistas.corrientes || [])[0], foto = pr && p.fuentes[pr.fuente];
      return { id: p.id, titulo: p.titulo, concepto: p.concepto, creada: p.creada || '2026-10-19T12:00:00-03:00', material: true, miniatura: mi, pantallas: { pellegrini: foto, corrientes: foto } };
    });
    return json([...mat, ...faltan, ...(await listarPiezas(env))]);
  }
  if (ruta === '/api/material/asignar') {   // usa un archivo ya subido (con otro nombre) para un lugar de material.json: lo copia con el nombre que espera el show
    const de = String(cuerpo.de || '').replace(/[^a-z0-9.-]/g, ''), a = String(cuerpo.a || '');
    let cfg; try { cfg = await (await env.ASSETS.fetch(new Request(new URL('/control/material.json', req.url)))).json(); } catch { cfg = { archivos: {} }; }
    if (!Object.values(cfg.archivos).some((x) => x.archivo === a)) return json({ error: 'Lugar inválido.' }, 400);
    const o = await env.PIEZAS.get('material/' + de); if (!o) return json({ error: 'Ese archivo no está subido.' }, 404);
    await env.PIEZAS.put('material/' + a, await o.arrayBuffer(), { httpMetadata: { contentType: o.httpMetadata?.contentType || 'image/jpeg' } });
    return json({ ok: true, nombre: a });
  }
  if (ruta === '/api/material' && req.method === 'GET') {   // lo subido + los lugares que pide material.json
    const l = await env.PIEZAS.list({ prefix: 'material/', limit: 500 });
    return json(l.objects.map((o) => ({ nombre: o.key.slice(9), bytes: o.size, url: '/' + o.key })));
  }
  return json({ error: 'no existe' }, 404);
}
// Material de marca (fotos, logos, piezas de campaña): se sube desde el portal y queda en R2, privado (el repo es público).
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4' };
async function subirMaterial(req, env) {
  const f = await req.formData(), a = f.get('archivo'); if (!a || typeof a === 'string') return json({ error: 'Elegí un archivo.' }, 400);
  if (!TIPOS[a.type]) return json({ error: 'Formato no admitido: subí JPG, PNG, WEBP, SVG o MP4.' }, 400);
  if (a.size > 25e6) return json({ error: 'El archivo pesa más de 25 MB.' }, 400);
  const base = String(f.get('nombre') || a.name || 'material').toLowerCase().replace(/\.[a-z0-9]+$/, '').normalize('NFD').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'material';
  const nombre = `${base}.${TIPOS[a.type]}`;
  await env.PIEZAS.put('material/' + nombre, await a.arrayBuffer(), { httpMetadata: { contentType: a.type } });
  return json({ nombre, url: '/material/' + nombre });
}
async function borrarMaterial(env, nombre) { await env.PIEZAS.delete('material/' + nombre.replace(/[^a-z0-9.-]/g, '')); return json({ ok: true }); }
// Piezas de material animado (material.json del kit) con las fuentes que ya estén subidas
async function piezasMaterial(env, origen, incompletas) {
  let cfg; try { cfg = await (await env.ASSETS.fetch(new Request(new URL('/control/material.json', origen)))).json(); } catch { return []; }
  const subidos = new Set((await env.PIEZAS.list({ prefix: 'material/', limit: 500 })).objects.map((o) => o.key.slice(9)));
  const out = [];
  const hayArch = (k) => cfg.archivos[k] && subidos.has(cfg.archivos[k].archivo);
  for (const p0 of cfg.piezas || []) {
    const pistas = {};   // una pista con «alt» usa otra fuente si la suya no está subida (p. ej. McÁlvarez sin el afiche usa el tríptico)
    for (const [pant, l] of Object.entries(p0.pistas)) pistas[pant] = l.map((x) => (x.alt && !hayArch(x.fuente) && hayArch(x.alt.fuente) ? { ...x, ...x.alt, alt: undefined } : x));
    const p = { ...p0, pistas };
    const usadas = new Set(Object.values(p.pistas).flat().map((x) => x.fuente).filter(Boolean)), fuentes = {};   // las de «paleta» no usan archivo
    for (const k of usadas) { const arch = cfg.archivos[k] && cfg.archivos[k].archivo; if (arch && subidos.has(arch)) fuentes[k] = '/material/' + arch; }
    if (Object.keys(fuentes).length === usadas.size) out.push({ ...p, fuentes, material: true });
    else if (incompletas) incompletas.push({ id: p.id, titulo: p.titulo, material: true, creada: p.creada, faltan: [...usadas].filter((k) => !fuentes[k]).map((k) => (cfg.archivos[k] || {}).nombre || (cfg.archivos[k] || {}).que || k) });
  }
  return out;
}

const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'], HORA = /^([01]\d|2[0-3]):[0-5]\d$/, ID = /^[a-z0-9-]{1,60}$/;
function validarPrograma(c) {
  if (!c || typeof c !== 'object') return null;
  const franja = (f) => (f && HORA.test(f.desde) && HORA.test(f.hasta) ? { desde: f.desde, hasta: f.hasta } : null);
  const operacion = franja(c.operacion), noche = franja(c.noche); if (!operacion || !noche) return null;
  const semana = {};
  for (const d of DIAS) {
    semana[d] = {};
    for (const [h, slots] of Object.entries((c.semana || {})[d] || {})) {
      if (!/^([01]\d|2[0-3])$/.test(h) || !Array.isArray(slots)) return null;
      const l = slots.slice(0, 12).map(String); if (!l.every((x) => ID.test(x))) return null;
      semana[d][h] = l;
    }
  }
  const out = { operacion, noche, semana };
  return JSON.stringify(out).length < 200000 ? out : null;
}

async function listarPiezas(env) {
  const l = await env.PIEZAS.list({ prefix: 'piezas/', limit: 1000 }), metas = l.objects.filter((o) => o.key.endsWith('/meta.json')).map((o) => o.key);
  const out = []; for (const k of metas.slice(-60)) { const m = await leerR2(env, k, null); if (m) out.push(m); }
  return out.sort((a, b) => (a.creada < b.creada ? 1 : -1));
}

// ---------- login ----------
function paginaLogin(msg) {
  const e = msg ? `<p class="error" role="alert">${msg}</p>` : '';
  return new Response(LOGIN_HTML.replace('<!--ERROR-->', e), { status: msg ? 401 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
async function login(req, env) {
  const k = `intentos/${await ipHash(req)}.json`, a = await leerR2(env, k, { n: 0, desde: Date.now() });
  if (Date.now() - a.desde > BLOQUEO_MIN * 60e3) { a.n = 0; a.desde = Date.now(); }
  if (a.n >= MAX_INTENTOS) return paginaLogin(`Demasiados intentos. Probá de nuevo en ${BLOQUEO_MIN} minutos.`);
  const f = await req.formData(), clave = String(f.get('clave') || '');
  if (!env.CLAVE || !igual(clave, env.CLAVE)) {
    a.n++; await env.PIEZAS.put(k, JSON.stringify(a));
    const quedan = MAX_INTENTOS - a.n;
    return paginaLogin(quedan > 0 ? `Clave incorrecta. Te quedan ${quedan} intentos.` : `Demasiados intentos. Probá de nuevo en ${BLOQUEO_MIN} minutos.`);
  }
  await env.PIEZAS.delete(k);
  const exp = String(Date.now() + SESION_H * 3600e3);
  await env.PIEZAS.put(`pendiente/${await ipHash(req)}.json`, JSON.stringify({ t: Date.now() }));
  return new Response(null, { status: 303, headers: { location: '/?entrada=1', 'set-cookie': `trust_s=${exp}.${await hmac(env, exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESION_H * 3600}` } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), ruta = url.pathname;
    if (ruta === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    if (ruta === '/login') return req.method === 'POST' ? login(req, env) : paginaLogin('');
    if (ruta === '/salir') { const k = await ipHash(req); MEMO_IP.delete(k); await env.PIEZAS.delete(`sincookies/${k}.json`); }   // también cierra el modo sin cookies de esta conexión
    if (ruta === '/salir') return new Response(null, { status: 303, headers: { location: '/login', 'set-cookie': 'trust_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
    if (ruta === '/fondo.jpg') {   // la imagen del login es pública: el edificio con las pantallas y la fachada dorada (sale de la carpeta oculta); si no está, la foto
      const o = await env.PIEZAS.get('material/login-fondo.jpg');
      if (o) return new Response(o.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
      return env.ASSETS.fetch(new Request(new URL('/control/fotos/trust-noche-completa.jpg', url)));
    }
    if (ruta === '/' && url.searchParams.get('entrada') && (await sesionValida(req, env))) await env.PIEZAS.delete(`pendiente/${await ipHash(req)}.json`);   // ya hay sesión: no queda nada pendiente
    if (ruta === '/' && url.searchParams.get('entrada') && !(await sesionValida(req, env))) {   // la clave estaba bien pero no volvió la cookie
      if (await activarSinCookies(req, env)) return Response.redirect(new URL('/', url), 302);
      return paginaLogin('No se pudo abrir la sesión en este navegador. Volvé a escribir la clave.');
    }
    if (!(await sesionValida(req, env))) return ruta.startsWith('/api/') ? json({ error: 'La sesión venció. Volvé a entrar con la clave.' }, 401) : Response.redirect(new URL('/login', url), 302);
    try {
      if (ruta.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers.get('origin') && new URL(req.headers.get('origin')).host !== url.host) return json({ error: 'origen inválido' }, 403);
        if (ruta === '/api/material' && req.method === 'POST') return await subirMaterial(req, env);
        if (ruta.startsWith('/api/material/') && req.method === 'DELETE') return await borrarMaterial(env, decodeURIComponent(ruta.slice(14)));
        return await api(req, env, ruta);
      }
      if (ruta.startsWith('/material/')) {
        const o = await env.PIEZAS.get(ruta.slice(1)); if (!o) return new Response('no existe', { status: 404 });
        return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
      }
      if (ruta === '/control/material_mcd.js') {
        return new Response(`window.PIEZAS_IA = (window.PIEZAS_IA || []).concat(${JSON.stringify(await piezasMaterial(env, url))});\n`, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (ruta.startsWith('/piezas/')) {
        const o = await env.PIEZAS.get(ruta.slice(1)); if (!o) return new Response('no existe', { status: 404 });
        return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'private, max-age=86400' } });
      }
      if (ruta === '/control/piezas_ia.js') {   // las del kit + las guardadas en R2
        const base = await (await env.ASSETS.fetch(req)).text(), extra = await listarPiezas(env);
        return new Response(base + `\nwindow.PIEZAS_IA = (window.PIEZAS_IA || []).concat(${JSON.stringify(extra)});\n`, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
      }
      const r = await env.ASSETS.fetch(req), h = new Headers(r.headers); h.set('x-robots-tag', 'noindex');
      return new Response(r.body, { status: r.status, headers: h });
    } catch (e) {
      return json({ error: e instanceof Tope ? e.message : `Error: ${e.message}` }, e instanceof Tope ? 429 : 500);
    }
  },
};

const LOGIN_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Entrar a EL TRUST</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&display=swap" rel="stylesheet">
<style>
:root{--noche:#0A1830;--piedra:#E9DFCC;--sodio:#F2A63B;--celeste:#6CACE4;--niebla:#93A0B5}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--noche);color:var(--piedra);font-family:Archivo,system-ui,sans-serif;font-stretch:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);min-height:100vh}
.texto{padding:64px;padding:clamp(28px,6vw,88px);display:flex;flex-direction:column;justify-content:center;position:relative;z-index:1}
.texto>*+*{margin-top:28px}
h1{margin:0;font-weight:850;font-stretch:62%;font-size:150px;font-size:clamp(64px,min(14vw,24vh),210px);line-height:.82;letter-spacing:-.01em}
.lugar{margin:20px 0 0;color:var(--niebla);font-size:17px;line-height:1.5;max-width:30ch}
form{display:flex;flex-direction:column;max-width:340px}
form>*+*{margin-top:10px}
label{font-size:14px;color:var(--niebla)}
.fila{display:flex}.fila>*+*{margin-left:8px}
input{flex:1;min-width:0;font:inherit;font-size:18px;padding:12px 14px;border-radius:6px;border:1px solid #2B3D5C;background:#0E2040;color:var(--piedra)}
input:focus{outline:2px solid var(--sodio);outline-offset:2px;border-color:transparent}
button{font:inherit;font-weight:700;font-size:16px;padding:12px 20px;border:0;border-radius:6px;background:var(--sodio);color:#1D1205;cursor:pointer}
button:focus-visible{outline:2px solid var(--piedra);outline-offset:3px}
.error{margin:14px 0 0;max-width:340px;padding:10px 12px;border-radius:6px;background:rgba(255,180,162,.1);border:1px solid rgba(255,180,162,.35);color:#FFB4A2;font-size:14px;line-height:1.45}
.texto>.by{margin-top:10px}.by{margin:10px 0 0;font-size:15px;letter-spacing:.3em;text-transform:uppercase;color:var(--sodio)}
.foto{background:#050b18 url(/fondo.jpg?v=3) center 42%/cover no-repeat;position:relative}
.foto::after{content:"";position:absolute;top:0;right:0;bottom:0;left:0;background:linear-gradient(90deg,var(--noche) 0%,rgba(10,24,48,.35) 28%,rgba(10,24,48,0) 60%)}
.pie{position:absolute;left:64px;left:clamp(28px,6vw,88px);bottom:22px;font-size:12px;color:#5E6E88}
@media (max-width:760px){body{grid-template-columns:1fr;grid-template-rows:42vh auto}.foto{grid-row:1}.foto::after{background:linear-gradient(0deg,var(--noche),rgba(10,24,48,0) 55%)}.texto{grid-row:2;padding-top:0}.pie{position:static;margin-top:8px}}
</style></head><body>
<main class="texto"><h1>EL<br>TRUST</h1><p class="by">by Affinitas</p>
<p class="lugar">Corrientes y Carlos Pellegrini, frente al Obelisco.</p>
<form method="post" action="/login"><label for="clave">Clave</label>
<div class="fila"><input id="clave" name="clave" type="password" autocomplete="current-password" required autofocus><button type="submit">Entrar</button></div><!--ERROR--></form>
<p class="pie">Affinitas. Material de trabajo, no publicar.</p></main>
<div class="foto" role="img" aria-label="Simulación: EL TRUST de noche, con las pantallas encendidas y la fachada en dorado"></div>
</body></html>`;
