// TRUST Control — motor de la simulación (sin DOM, determinista).
// SIMULACIÓN CONCEPTUAL — NO CONECTADA A EQUIPOS REALES. Este archivo no abre red ni emite DMX/Art-Net/sACN.
//
// Subsistemas independientes (cada uno con su propio estado; ninguno lee ni escribe el de otro):
//   pantallas: master + Corrientes + Pellegrini + media          (0–100)
//   luces:     master + 3 grupos (16/16/14) + 46 equipos RGBW      (0–100, ON/OFF, color propio opcional)
//   reloj:     nivel propio                                         (0–100)
// Vista Día/Noche: SOLO representación. No toca ningún nivel.
//
// Salida de una luminaria = escena(t) × individual × grupo × master × ON × (sin blackout)
//   - "escena" la pone el preset activo o el show de 15 s; el ajuste individual es un TRIM que se multiplica
//     y nunca se pisa: cargar un preset o el show NO borra tus ajustes. "Restaurar niveles" sí los vuelve a 100.
//   - Color: si el equipo tiene color propio (RGBW) manda ese; si no, sigue la escena.
(function () {
  'use strict';
  const DUR = 15;
  const GRUPOS = [
    { id: 'superior', nombre: 'Nivel superior', n: 16, pref: 'SUP' },
    { id: 'medio', nombre: 'Nivel medio', n: 16, pref: 'MED' },
    { id: 'inferior', nombre: 'Nivel inferior', n: 14, pref: 'INF' },
  ];
  const PANTALLAS = ['corrientes', 'pellegrini', 'media'];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const suave = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  const mezclaRGBW = (a, b, k) => ({ r: lerp(a.r, b.r, k), g: lerp(a.g, b.g, k), b: lerp(a.b, b.b, k), w: lerp(a.w, b.w, k) });

  // Colores de escena (canales RGBW 0..1). Son colores de PREVISUALIZACIÓN, no un patch DMX.
  const C = {
    calido: { r: 0.60, g: 0.20, b: 0.00, w: 0.80 },   // dorado cálido (referencia de estilo de Fer)
    rojo: { r: 1.00, g: 0.02, b: 0.00, w: 0.00 },
    oro: { r: 1.00, g: 0.58, b: 0.00, w: 0.22 },
    blanco: { r: 1.00, g: 1.00, b: 1.00, w: 1.00 },
    neutro: { r: 0.00, g: 0.00, b: 0.00, w: 0.85 },
  };

  // Escenas fijas. f(grupo, i, n) → { nivel 0..1, rgbw }
  const ESCENAS = {
    arquitectonica: { nombre: 'Arquitectónica cálida', f: () => ({ nivel: 0.85, rgbw: C.calido }), reloj: { nivel: 0.85, rgbw: C.neutro }, pantallas: 'reposo' },
    mcd: { nombre: "McDonald's", f: (g, i) => ({ nivel: 1, rgbw: i % 2 ? C.oro : C.rojo }), reloj: { nivel: 1, rgbw: C.oro }, pantallas: 'marca' },
    blanco: { nombre: 'Prueba blanco total', f: () => ({ nivel: 1, rgbw: C.blanco }), reloj: { nivel: 1, rgbw: C.neutro }, pantallas: 'reposo' },
    cierre: { nombre: 'Cierre', f: () => ({ nivel: 0.45, rgbw: C.calido }), reloj: { nivel: 0.7, rgbw: C.neutro }, pantallas: 'reposo' },
  };

  // Show "McDonald's Takeover 15 s" — PLANTILLA PREPROGRAMADA (no es generación por IA).
  // Bloques del guion (#73, 14/10): 0–3 apertura · 3–7 contenido + ola roja Corrientes→Pellegrini · 7–11 takeover · 11–15 cierre.
  const BLOQUES = [
    { desde: 0, hasta: 3, id: 'apertura', nombre: 'Apertura' },
    { desde: 3, hasta: 7, id: 'ola', nombre: 'Ola roja' },
    { desde: 7, hasta: 11, id: 'takeover', nombre: 'Takeover' },
    { desde: 11, hasta: 15, id: 'cierre', nombre: 'Cierre' },
  ];
  // Orden espacial de la ola: índice 0 = extremo Corrientes (izquierda de la vista), último = extremo Pellegrini.
  function showLuz(g, i, n, t) {
    const x = n > 1 ? i / (n - 1) : 0;
    if (t < 3) return { nivel: lerp(0.15, 0.30, suave(t / 3)), rgbw: C.calido };
    if (t < 7) {
      const frente = (t - 3) / 3;               // la ola cruza en 3 s y queda roja hasta los 7 s
      const k = suave((frente - x) / 0.18);
      return { nivel: lerp(0.30, 1, k), rgbw: mezclaRGBW(C.calido, C.rojo, k) };
    }
    if (t < 11) {
      const fase = (t - 7) * 2.2 + x * 6 + (g === 'medio' ? 1.3 : g === 'inferior' ? 2.6 : 0);
      const brillo = 0.70 + 0.30 * (0.5 + 0.5 * Math.sin(fase));
      const acento = (i + Math.floor((t - 7) * 2)) % 4 === 0;
      return { nivel: brillo, rgbw: acento ? C.oro : C.rojo };
    }
    const k = suave((t - 11) / 3.2);
    return { nivel: lerp(1, 0.85, k), rgbw: mezclaRGBW(C.oro, C.calido, k) };
  }
  function showReloj(t) {
    if (t < 7) return { nivel: 0.85, rgbw: C.neutro };
    if (t < 13.5) return { nivel: 1, rgbw: mezclaRGBW(C.neutro, C.oro, suave((t - 7) / 0.8)) };
    return { nivel: 0.85, rgbw: mezclaRGBW(C.oro, C.neutro, suave((t - 13.5) / 1.5)) };
  }
  // Nivel base de cada pantalla según el show (el contenido lo dibuja render; acá solo el nivel).
  function showPantalla(id, t) {
    if (t < 3) return 0.55 + 0.45 * suave(t / 3);
    return 1;
  }

  function nuevoEstado() {
    const fixtures = [];
    for (const g of GRUPOS) for (let i = 0; i < g.n; i++) {
      fixtures.push({ id: `${g.pref}-${String(i + 1).padStart(2, '0')}`, grupo: g.id, i, n: g.n, on: true, nivel: 100, color: null });
    }
    return {
      vista: 'noche',
      pantallas: { master: 100, corrientes: 100, pellegrini: 100, media: 100 },
      luces: { master: 100, grupos: { superior: 100, medio: 100, inferior: 100 }, fixtures },
      reloj: { nivel: 100 },
      blackout: false,
      escena: 'arquitectonica',
      show: { cargado: false, t: 0, reproduciendo: false },
    };
  }

  let S = nuevoEstado();
  const oyentes = new Set();
  const avisar = () => { oyentes.forEach((f) => f(S)); return S; };
  const fx = (id) => { const f = S.luces.fixtures.find((x) => x.id === id); if (!f) throw new Error('luminaria inexistente: ' + id); return f; };
  const pct = (v) => clamp(Math.round(Number(v)), 0, 100);

  function bloque(t) { return BLOQUES.find((b) => t < b.hasta) || BLOQUES[BLOQUES.length - 1]; }

  // ---------- salidas (lo que se ve) ----------
  function baseLuz(f) {
    if (S.show.cargado) return showLuz(f.grupo, f.i, f.n, S.show.t);
    return ESCENAS[S.escena].f(f.grupo, f.i, f.n);
  }
  function salidaLuz(f) {
    const b = baseLuz(f);
    const k = S.blackout || !f.on ? 0 : b.nivel * (f.nivel / 100) * (S.luces.grupos[f.grupo] / 100) * (S.luces.master / 100);
    return { id: f.id, grupo: f.grupo, nivel: k, rgbw: f.color || b.rgbw };
  }
  function salidaPantalla(id) {
    const base = S.show.cargado ? showPantalla(id, S.show.t) : 1;
    return S.blackout ? 0 : base * (S.pantallas[id] / 100) * (S.pantallas.master / 100);
  }
  function salidaReloj() {
    const b = S.show.cargado ? showReloj(S.show.t) : ESCENAS[S.escena].reloj;
    return { nivel: S.blackout ? 0 : b.nivel * (S.reloj.nivel / 100), rgbw: b.rgbw };
  }
  function contenido() {
    if (S.show.cargado) return { modo: 'show', t: S.show.t, bloque: bloque(S.show.t).id };
    return { modo: ESCENAS[S.escena].pantallas, t: 0, bloque: null };
  }
  function salidas() {
    return {
      luces: S.luces.fixtures.map(salidaLuz),
      pantallas: Object.fromEntries(PANTALLAS.map((p) => [p, salidaPantalla(p)])),
      reloj: salidaReloj(),
      contenido: contenido(),
    };
  }

  // ---------- acciones ----------
  const api = {
    DUR, GRUPOS, PANTALLAS, ESCENAS, BLOQUES,
    estado: () => JSON.parse(JSON.stringify(S)),
    salidas,
    bloque,
    suscribir(f) { oyentes.add(f); return () => oyentes.delete(f); },
    setVista(v) { if (v !== 'dia' && v !== 'noche') throw new Error('vista'); S.vista = v; return avisar(); },
    setPantalla(id, v) { if (!(id in S.pantallas)) throw new Error('pantalla ' + id); S.pantallas[id] = pct(v); return avisar(); },
    setLucesMaster(v) { S.luces.master = pct(v); return avisar(); },
    setGrupo(g, v) { if (!(g in S.luces.grupos)) throw new Error('grupo ' + g); S.luces.grupos[g] = pct(v); return avisar(); },
    setFixture(id, v) { fx(id).nivel = pct(v); return avisar(); },
    setFixtureOn(id, on) { fx(id).on = !!on; return avisar(); },
    setFixtureColor(id, rgbw) {
      fx(id).color = rgbw ? { r: clamp(+rgbw.r, 0, 1), g: clamp(+rgbw.g, 0, 1), b: clamp(+rgbw.b, 0, 1), w: clamp(+rgbw.w, 0, 1) } : null;
      return avisar();
    },
    setReloj(v) { S.reloj.nivel = pct(v); return avisar(); },
    setBlackout(b) { S.blackout = !!b; return avisar(); },
    setEscena(e) { if (!(e in ESCENAS)) throw new Error('escena ' + e); S.escena = e; S.show = { cargado: false, t: 0, reproduciendo: false }; return avisar(); },
    cargarShow() { S.show = { cargado: true, t: 0, reproduciendo: false }; return avisar(); },
    play() { if (!S.show.cargado) api.cargarShow(); if (S.show.t >= DUR) S.show.t = 0; S.show.reproduciendo = true; return avisar(); },
    pausa() { S.show.reproduciendo = false; return avisar(); },
    resetShow() { if (S.show.cargado) { S.show.t = 0; S.show.reproduciendo = false; } return avisar(); },
    seek(t) { if (!S.show.cargado) api.cargarShow(); S.show.t = clamp(+t, 0, DUR); return avisar(); },
    avanzar(dt) {
      if (!S.show.cargado || !S.show.reproduciendo) return S;
      S.show.t = Math.min(DUR, S.show.t + dt);
      if (S.show.t >= DUR) S.show.reproduciendo = false;
      return avisar();
    },
    restaurarNiveles() {
      S.pantallas = { master: 100, corrientes: 100, pellegrini: 100, media: 100 };
      S.luces.master = 100; S.luces.grupos = { superior: 100, medio: 100, inferior: 100 };
      S.luces.fixtures.forEach((f) => { f.on = true; f.nivel = 100; f.color = null; });
      S.reloj.nivel = 100; S.blackout = false;
      return avisar();
    },
    reiniciarTodo() { S = nuevoEstado(); return avisar(); },
    // Escenas guardadas como archivo local (sin servicio ni red).
    exportarEscena() { return JSON.stringify({ formato: 'trust-escena-v1', simulacion: true, pantallas: S.pantallas, luces: S.luces, reloj: S.reloj }, null, 1); },
    importarEscena(txt) {
      const d = JSON.parse(txt);
      if (d.formato !== 'trust-escena-v1') throw new Error('formato desconocido');
      const nuevo = nuevoEstado();
      for (const k of Object.keys(nuevo.pantallas)) if (k in d.pantallas) nuevo.pantallas[k] = pct(d.pantallas[k]);
      nuevo.luces.master = pct(d.luces.master);
      for (const g of Object.keys(nuevo.luces.grupos)) nuevo.luces.grupos[g] = pct(d.luces.grupos[g]);
      for (const f of nuevo.luces.fixtures) {
        const o = (d.luces.fixtures || []).find((x) => x.id === f.id);
        if (o) { f.on = !!o.on; f.nivel = pct(o.nivel); f.color = o.color || null; }
      }
      nuevo.reloj.nivel = pct(d.reloj.nivel);
      S.pantallas = nuevo.pantallas; S.luces = nuevo.luces; S.reloj = nuevo.reloj;
      return avisar();
    },
  };
  window.MOTOR = api;
})();
