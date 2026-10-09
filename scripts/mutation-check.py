# Mutation check: rompe a proposito cada regla critica y verifica que algun
# test la atrape. Uso: python3 scripts/mutation-check.py (desde la raiz).
# No corre en `pnpm verify`: tarda ~1 min. Correrlo antes de cerrar un gate.
import pathlib, subprocess, sys
M = [
 ("STOP -> black",            "packages/show-engine/src/resolve.ts",   "  if (transport === 'stopped') return 'black';\n", ""),
 ("SAFE MODE -> black",       "packages/show-engine/src/resolve.ts",   "  if (safeMode) return 'black';\n", ""),
 ("PAUSE -> hold",            "packages/show-engine/src/resolve.ts",   "  return transport === 'playing' ? 'live' : 'hold';", "  return 'live';"),
 ("uv x+w <= 1",              "packages/shared-types/src/index.ts",    "(r) => r.x + r.w <= 1 + 1e-9", "(r) => true"),
 ("uv w,h > 0",               "packages/shared-types/src/index.ts",    "(r) => r.w > 0 && r.h > 0", "(r) => true"),
 ("capacidad del edificio",   "packages/show-engine/src/preflight.ts", "if (!surface.syncCapableWith.includes(other as never)) {", "if (false) {"),
 ("doble membresia",          "packages/show-engine/src/preflight.ts", "      if (previo) {", "      if (false) {"),
 ("aspecto del recorte",      "packages/show-engine/src/preflight.ts", "if (desvio > 0.02) {", "if (false) {"),
 ("guard de URLs",            "packages/show-engine/src/preflight.ts", "  if (!src.startsWith('/')) return false;", "  return true;"),
 ("ended en transporte",      "packages/timeline/src/index.ts",        "      this.status = 'ended';", ""),
 ("retry: libera fallada activa", "packages/trust-3d/src/MediaTextureManager.ts", "if (activeSources.has(source) && !entry.failed) continue;", "if (activeSources.has(source)) continue;"),
 ("retry: recrea el video",   "packages/trust-3d/src/MediaTextureManager.ts", "    this.release(source);\n    this.acquire(source);\n    return true;", "    return true;"),
 ("actuador obedece output",  "packages/trust-3d/src/MediaTextureManager.ts", "if (runtime.output !== 'live') {", "if (runtime.cue !== 'playing') {"),
 ("simulador determinista",  "packages/telemetry/src/simulator.ts", "  const s = f * f * (3 - 2 * f); // smoothstep\n  return a + (b - a) * s;", "  return Math.random();"),
 ("flag simulated",          "packages/telemetry/src/simulator.ts", "    simulated: true,", "    simulated: false,"),
 ("phase loss antes que UV", "packages/telemetry/src/alarms.ts", "    if (p.voltageV < thresholds.voltage.phaseLossV) {", "    if (false) {"),
 ("umbrales configurables",  "packages/telemetry/src/alarms.ts", "if (t.powerFactor < thresholds.powerFactor.warnBelow) {", "if (t.powerFactor < 0.1) {"),
 ("serie == lectura viva",   "packages/telemetry/src/simulator.ts", "  return Array.from({ length: points }, (_, i) => sampleTelemetry(fromMs + i * step, config));", "  return Array.from({ length: points }, (_, i) => sampleTelemetry(fromMs + i * step + 500, config));"),
 ("clip caido se reporta",   "packages/control-core/src/system.ts", "      detail: failed\n        ? 'El clip asignado no carga'", "      detail: false\n        ? 'El clip asignado no carga'"),
 ("logico != salud",         "packages/control-core/src/system.ts", "      health: healthOf(id),\n      provenance: prov[id],", "      health: (logicalState === 'BLACK' ? 'OFFLINE' : healthOf(id)),\n      provenance: prov[id],"),
 ("offline != safe mode",    "packages/control-core/src/system.ts", "    health: input.controlReachable ? healthOf('connectivity') : 'OFFLINE',", "    health: healthOf('connectivity'),"),
 ("contexto IA sin handles", "packages/control-core/src/ai.ts", "  return {\n    advisoryOnly: true,", "  return {\n    // @ts-expect-error mutante\n    leak: () => input.log,\n    advisoryOnly: true,"),
 ("provenance simulada",     "packages/control-core/src/system.ts", "  screen_corrientes: 'SIMULATED',", "  screen_corrientes: 'REAL',"),
 ("simulated no verificado",  "packages/control-core/src/system.ts", "  SIMULATED: false,", "  SIMULATED: true,"),
 ("verificado mira provenance","packages/control-core/src/system.ts", "return subsystems.some((s) => PROVENANCE_IS_VERIFIED[s.provenance]);", "return subsystems.some((s) => s.health !== 'ONLINE');"),
 ("stale degrada salud",      "packages/control-core/src/system.ts", "  if (sample.quality === 'STALE') return 'STALE';", "  if (false) return 'STALE';"),
 ("alarmas -> salud electrica","packages/control-core/src/system.ts", "  if (alarms.some((a) => a.severity === 'critical')) return 'CRITICAL';", "  if (false) return 'CRITICAL';"),
 ("preview no pisa al motor", "packages/control-core/src/modes.ts", "  if (showDrivesLighting) {\n    return { state: engineState, source: 'ENGINE', overrideBlockedReason: 'SHOW_TIMELINE' };\n  }", "  if (false) {\n    return { state: engineState, source: 'ENGINE', overrideBlockedReason: 'SHOW_TIMELINE' };\n  }"),
 ("override off por defecto", "packages/control-core/src/modes.ts", "  if (!overrideEnabled) return { state: engineState, source: 'ENGINE', overrideBlockedReason: 'DISABLED' };", "  // sin chequeo"),
 ("serie congelada en stale", "packages/telemetry/src/freshness.ts", "  const toMs = Math.min(sample.measuredAt, nowMs);", "  const toMs = nowMs;"),
 ("engine recarga si cambio", "packages/show-authoring/src/preview-session.ts", "    if (this.engineRevision !== revision) {", "    if (false) {"),
 ("revision por contenido",   "packages/show-authoring/src/preview-session.ts", "  const json = JSON.stringify(pkg);", "  const json = pkg.id;"),
 ("canPreview corta BLOCKED", "packages/show-authoring/src/preview-session.ts", "  if (validation.status === 'BLOCKED') return false;", ""),
 ("canPreview mira exportable","packages/show-authoring/src/preview-session.ts", "  if (!validation.exportable) return false;", ""),
 ("blocked suelta el motor",  "packages/show-authoring/src/preview-session.ts", "    if (!canPreview(validation)) {\n      this.release();\n      return null;\n    }", "    if (!canPreview(validation)) {\n      return null;\n    }"),
 ("scrub deja en pausa",      "packages/show-authoring/src/preview-session.ts", "    if (engine.getStatus() !== 'playing') engine.play();", ""),
 ("preset queda dirty",       "packages/show-authoring/src/persistence.ts", "  return { draft, dirty: !desdeDisco, autosave: !desdeDisco };", "  return { draft, dirty: false, autosave: false };"),
 ("storage valida con Zod",   "packages/show-authoring/src/persistence.ts", "    return parsed.success ? parsed.data : null;", "    return JSON.parse(raw) as TakeoverDraft;"),
 ("hold no emite evento",    "packages/show-authoring/src/compiler.ts", "      case 'hold':\n        // Nada.", "      case 'hold':\n        timeline.push({ atMs, type: 'media.stop', target: screenId });\n        // Nada."),
 ("black emite media.stop",  "packages/show-authoring/src/compiler.ts", "          timeline.push({ atMs, type: 'media.stop', target: screenId });\n          s.playing = false;", "          s.playing = false;"),
 ("namespace de assets",     "packages/show-authoring/src/asset-registry.ts", "  } else if (!ALLOWED_ASSET_PREFIXES.some((p) => asset.source.startsWith(p))) {", "  } else if (false) {"),
 ("ruta local en assets",    "packages/show-authoring/src/asset-registry.ts", "  } else if (!isLocalMediaPath(asset.source)) {", "  } else if (false) {"),
 ("BLOCKED bloquea export",  "packages/show-authoring/src/validation.ts", "errors.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARNING' : 'READY'", "warnings.length > 0 ? 'WARNING' : 'READY'"),
 ("experiencia: vista pura", "packages/experience-core/src/experience.ts", "export function setView(state: ExperienceState, view: ExperienceView): ExperienceState {\n  return { ...state, view };", "export function setView(state: ExperienceState, view: ExperienceView): ExperienceState {\n  return { ...INITIAL_EXPERIENCE, view, loaded: state.loaded };"),
 ("experiencia: assets locales","packages/experience-core/src/experience.ts", "  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;\n  if (src.split('/').some((seg) => seg === '..')) return false;\n  return true;\n}\n\nexport function nonLocalAssets", "  return true;\n}\n\nexport function nonLocalAssets"),
 ("experiencia: PLAY requiere ready","packages/experience-core/src/experience.ts", "  return isReadyToPresent(state) && state.phase !== 'LOADING';", "  return state.phase !== 'LOADING';"),
 ("experiencia: reset conoce estado","packages/experience-core/src/experience.ts", "    ...INITIAL_EXPERIENCE,\n    loaded: state.loaded,", "    ...state,"),
 ("pantalla A en su lugar", "packages/experience-core/src/composition.ts", "      screen_a: q([0.237, 0.335], [0.415, 0.266], [0.415, 0.360], [0.237, 0.429]),", "      screen_a: q([0.130, 0.335], [0.415, 0.266], [0.415, 0.360], [0.130, 0.429]),"),
 ("pantalla B en su lugar", "packages/experience-core/src/composition.ts", "      screen_b: q([0.555, 0.258], [0.733, 0.309], [0.733, 0.418], [0.555, 0.367]),", "      screen_b: q([0.555, 0.258], [0.900, 0.309], [0.900, 0.418], [0.555, 0.367]),"),
 ("client mode usa campaña",  "packages/experience-core/src/experience.ts", "  return CAMPAIGN_MEDIA[source] ?? source;", "  return source;"),
 ("precarga solo campaña",    "packages/experience-core/src/experience.ts", "export const EXPERIENCE_MEDIA: string[] = Object.values(CAMPAIGN_MEDIA);", "export const EXPERIENCE_MEDIA: string[] = Object.keys(CAMPAIGN_MEDIA);"),
 ("titular ejecutivo",        "packages/experience-core/src/experience.ts", "export const HOME_HEADLINE = '3 superficies digitales · 1 momento sincronizado';", "export const HOME_HEADLINE = '15 s · 3 pantallas · iluminación · reloj';"),
 ("WHY sin claims de luz",    "packages/experience-core/src/experience.ts", "    body: 'Tres superficies digitales coordinadas sobre un único edificio.',", "    body: 'Tres superficies, iluminación y reloj sobre un único edificio.',"),
 ("segmentos reparten el uv","packages/experience-core/src/composition.ts", "      const ancho = base.w / segmentos.length;", "      const ancho = base.w;"),
 ("segmento usa su indice",  "packages/experience-core/src/composition.ts", "{ x: base.x + ancho * segment, y: base.y, w: ancho, h: base.h }", "{ x: base.x, y: base.y, w: ancho, h: base.h }"),
 ("black no muestra media",  "packages/experience-core/src/composition.ts", "        source: rt && rt.output !== 'black' ? rt.source : null,", "        source: rt ? rt.source : null,"),
 ("contain entra entero",    "packages/experience-core/src/composition.ts", "  const escala = Math.min(containerW / master.width, containerH / master.height);", "  const escala = Math.max(containerW / master.width, containerH / master.height);"),
 ("fallo no cuenta cargado", "packages/experience-core/src/experience.ts", "    loaded: state.loaded.filter((a) => a !== asset),\n    failed:", "    loaded: [...state.loaded, asset],\n    failed:"),
 ("READY exige todo",        "packages/experience-core/src/experience.ts", "  return requiredAssets().every((a) => isAssetSatisfied(state, a));", "  return requiredAssets().some((a) => isAssetSatisfied(state, a));"),
 ("fallback debe estar cargado","packages/experience-core/src/experience.ts", "  return Boolean(fb) && state.loaded.includes(fb!);", "  return Boolean(fb);"),
 ("STOP nunca se bloquea",   "packages/experience-core/src/experience.ts", "  void state;\n  return true;", "  void state;\n  return state.phase !== 'LOADING';"),
 ("signature con seek",      "packages/experience-core/src/experience.ts", "    seekToMs: spec.seekToMs,\n    pauseAfterSeek: spec.seekToMs !== null,", "    seekToMs: null,\n    pauseAfterSeek: spec.seekToMs !== null,"),
 ("check requerido bloquea", "packages/experience-core/src/experience.ts", "    status: failures.length === 0 ? 'PRESENTATION READY' : 'NOT READY',", "    status: 'PRESENTATION READY',"),
 ("check sin ejecutar falla","packages/experience-core/src/experience.ts", "(c) => porId.get(c.id) ?? { id: c.id, ok: false, detail: 'sin ejecutar' },", "(c) => porId.get(c.id) ?? { id: c.id, ok: true, detail: 'sin ejecutar' },"),
 ("logger guarda la key",    "packages/control-core/src/acknowledge.ts", "        key: tr.key,", "        key: undefined,"),
 ("serie corta en measuredAt","packages/telemetry/src/freshness.ts", "  const toMs = Math.min(sample.measuredAt, nowMs);", "  const toMs = sample.quality === 'LIVE' ? nowMs : Math.min(sample.measuredAt, nowMs);"),
 ("ack emite evento",        "packages/control-core/src/acknowledge.ts", "    emitted: actualizada ? [emit(log, actualizada, now, actor)] : [],", "    emitted: [],"),
 ("ack no borra",            "packages/control-core/src/acknowledge.ts", "  registry.acknowledge(key, now);\n  const actualizada = registry.get(key);", "  const actualizada = registry.get(key);"),
 ("ack all sincroniza log",  "packages/control-core/src/acknowledge.ts", "  const eventos = log.acknowledgeAll();", "  const eventos = 0;"),
 ("sin tarifa en la alarma", "packages/telemetry/src/alarms.ts", "(umbral ${thresholds.powerFactor.criticalBelow})", "— riesgo de penalizacion en factura"),
 ("alarma: ESCALATED",        "packages/telemetry/src/lifecycle.ts", "    if (RANK[alarm.severity] > RANK[antes.severity]) {", "    if (false) {"),
 ("alarma: DEESCALATED",      "packages/telemetry/src/lifecycle.ts", "    } else if (RANK[alarm.severity] < RANK[antes.severity]) {", "    } else if (false) {"),
 ("alarma: RESOLVED",         "packages/telemetry/src/lifecycle.ts", "    if (actuales.has(key)) continue;", "    continue;"),
 ("ack no borra la alarma",   "packages/telemetry/src/lifecycle.ts", "    this.tracked.set(key, { ...e, acknowledged: true, acknowledgedAt: now });", "    this.tracked.delete(key);"),
 ("escalar invalida el ack",  "packages/telemetry/src/lifecycle.ts", "        acknowledged: t.type === 'ESCALATED' ? false : (antes?.acknowledged ?? false),", "        acknowledged: antes?.acknowledged ?? false,"),
 ("metric en la identidad",   "packages/telemetry/src/alarms.ts", "  return `${a.code}|${a.phase ?? '-'}|${a.metric}`;", "  return `${a.code}|${a.phase ?? '-'}`;"),
 ("freshness: STALE",         "packages/telemetry/src/freshness.ts", "    quality: ageMs > staleAfterMs ? 'STALE' : 'LIVE',", "    quality: 'LIVE',"),
 ("freshness: COMM_ERROR",    "packages/telemetry/src/freshness.ts", "  if (input.commError) {", "  if (false) {"),
 ("modo efectivo del estado", "packages/control-core/src/modes.ts", "  const effective = SCENE_TO_MODE.get(activeSceneId) ?? null;", "  const effective = requested;"),
 ("modo: safe mode manda",    "packages/control-core/src/modes.ts", "  if (safeMode) {\n    return {", "  if (false) {\n    return {"),
 ("mes calendario real",      "packages/telemetry/src/simulator.ts", "  const diasCompletosDelMes = local.getUTCDate() - 1;", "  const diasCompletosDelMes = Math.floor(localMs / MS_DAY) % 30;"),
 ("IA usa umbral configurado","packages/control-core/src/ai.ts", "        threshold: tr.alarm.threshold,", "        threshold: 0.92,"),
 ("compiler: atMs acumulado", "packages/show-authoring/src/compiler.ts", "  for (const { moment, index, startMs, endMs } of spans) {", "  for (const { moment, index, endMs } of spans) {\n    const startMs = 0;"),
 ("compiler: A y B mismo cue","packages/show-authoring/src/compiler.ts", "      aplicarPantalla('screen_b', moment.screens.upper, startMs, ref);", "      aplicarPantalla('screen_b', moment.screens.pellegrini, startMs, ref);"),
 ("compiler: cierre a identidad","packages/show-authoring/src/compiler.ts", "      timeline.push({ atMs: durationMs, type: 'lighting.scene', value: draft.closingSceneId, fadeMs: 0 });", "      void draft.closingSceneId;"),
 ("compiler: escena existe",  "packages/show-authoring/src/compiler.ts", "      if (!ctx.sceneIds.has(sceneId)) {", "      if (false) {"),
 ("compiler: uv por pixeles", "packages/show-authoring/src/compiler.ts", "        x: a.pixelWidth,\n        y: 0,", "        x: canvas.width / 2,\n        y: 0,"),
 ("assets: namespace",        "packages/show-authoring/src/asset-registry.ts", "  } else if (!ALLOWED_ASSET_PREFIXES.some((p) => asset.source.startsWith(p))) {", "  } else if (false) {"),
 ("assets: unmanaged bloquea","packages/show-authoring/src/asset-registry.ts", "  if (asset.unmanaged) {\n    block(", "  if (false) {\n    block("),
 ("assets: aspecto",          "packages/show-authoring/src/asset-registry.ts", "    if (desvio > ASPECT_TOLERANCE) {", "    if (false) {"),
 ("validation: no exporta",   "packages/show-authoring/src/validation.ts", "  return { status, errors, warnings, compile, exportable: errors.length === 0 };", "  return { status, errors, warnings, compile, exportable: true };"),
 ("draft: duracion minima",   "packages/show-authoring/src/draft-schema.ts", "  durationMs: z.number().int().min(MIN_MOMENT_MS),", "  durationMs: z.number().int(),"),
 ("draft: duplicar id nuevo", "packages/show-authoring/src/draft-schema.ts", "    id: nextMomentId(draft, `${original.id}_copy`),", "    id: original.id,"),
 ("membresia por show",       "packages/show-engine/src/resolve.ts",   "      if (group && rect) {", "      if (false) {"),
 ('storage: dedup solo por tamaño', 'packages/platform-storage/src/local-disk.ts', '      if (existente.sha256 !== shaDeClave(key) || existente.sizeBytes !== sizeBytes) {', '      if (existente.sizeBytes !== sizeBytes) {'),
 ('storage: shard≠hash aceptado', 'packages/platform-storage/src/keys.ts', "  if (!m || m[2]?.slice(0, 2) !== m[1]) throw new StorageKeyError('clave de contenido inválida');", "  if (!m) throw new StorageKeyError('clave de contenido inválida');"),
 ('storage: temporal huérfano pisado', 'packages/platform-storage/src/local-disk.ts', '      await fs.mkdir(dir, { mode: DIR_MODE });', '      await fs.mkdir(dir, { mode: DIR_MODE, recursive: true });'),
 ('storage: permisos no endurecidos', 'packages/platform-storage/src/local-disk.ts', '    if ((st.mode & 0o777) !== DIR_MODE) {', '    if ((st.mode & 0o777) === -1) {'),
 ('media: HEVC aceptado', 'packages/platform-media/src/validator.ts', '  if (media.codec !== ACCEPTED_CODEC) {', "  if (media.codec !== ACCEPTED_CODEC && media.codec !== 'HEVC') {"),
 ('media: 29.97 aceptado (float)', 'packages/platform-media/src/validator.ts', '  if (!fps || !ACCEPTED_FPS.some((a) => a.numerator === fps.numerator && a.denominator === fps.denominator)) {', '  if (!fps || !ACCEPTED_FPS.some((a) => Math.round(a.numerator / a.denominator) === Math.round(fps.numerator / fps.denominator))) {'),
 ('media: resolución errada aceptada', 'packages/platform-media/src/validator.ts', '  if (media.width !== fmt.width || media.height !== fmt.height) {', '  if (media.width !== fmt.width && media.height !== fmt.height) {'),
 ('media: múltiples pistas aceptadas', 'packages/platform-media/src/validator.ts', '  if (media.videoStreamCount > 1) {', '  if (media.videoStreamCount > 2) {'),
 ('media: formato hardcodeado', 'packages/platform-media/src/validator.ts', '  const fmt = formats[parseSurfaceType(surfaceType, formats)];', '  const fmt = { width: 1920, height: 412 };'),
 ('media: MOV pasa como MP4', 'packages/platform-media/src/ffprobe.ts', "  const esMp4 = formatName.split(',').includes('mp4') && brand !== null && MP4_BRANDS.includes(brand);", "  const esMp4 = formatName.split(',').includes('mp4');"),
 ('media: carátula cuenta como pista', 'packages/platform-media/src/ffprobe.ts', "  const videos = streams.filter((s) => s.codec_type === 'video' && !esCaratula(s));", "  const videos = streams.filter((s) => s.codec_type === 'video');"),
 ('media: decode de frame omitido', 'packages/platform-media/src/pipeline.ts', '    const frame = await decoder.decode(m.path, { streamIndex: probe.media.videoStreamIndex ?? 0, durationMs: probe.media.durationMs ?? 0, signal: opts.signal });', '    const frame = { ok: true as const, frameBytes: 1 };', 'npx vitest run -c vitest.media.config.ts'),
 ('media: timeout omitido', 'packages/platform-media/src/process.ts', "    const timer = setTimeout(() => terminar({ kind: 'timeout' }), opts.timeoutMs);", '    const timer = setTimeout(() => {}, opts.timeoutMs);', 'npx vitest run -c vitest.media.config.ts'),
 ('media: reintento de decode omitido', 'packages/platform-media/src/ffmpeg.ts', "      if (!sinFrame || seekMs === 0) return primero;", "      return primero;", 'npx vitest run -c vitest.media.config.ts'),
 ('media: reintento rescata corruptos', 'packages/platform-media/src/ffmpeg.ts', "primero.outcome.kind === 'exit' && primero.outcome.code === 0 && primero.stdoutBytes === 0", "primero.outcome.kind === 'exit' && primero.stdoutBytes === 0", 'npx vitest run -c vitest.media.config.ts'),
 # B3 — pipeline de Asset con PostgreSQL + storage + ffmpeg reales
 ('assets: hash del upload ignorado', 'packages/platform-assets/src/service.ts', "          ? { sha256: recibido.temp.sha256, sizeBytes: recibido.temp.sizeBytes }", "          ? { sizeBytes: recibido.temp.sizeBytes }", 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: huella de TOO_LARGE ignorada', 'packages/platform-assets/src/service.ts', "          : { tooLarge: true, limitBytes: recibido.limitBytes, prefixSha256: recibido.prefixSha256 },", "          : { tooLarge: true, limitBytes: recibido.limitBytes },", 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: dedup desactivado', 'packages/platform-assets/src/service.ts', "        .onConflict((oc) => oc.column('sha256').doNothing())\n", "", 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: temporal no limpiado', 'packages/platform-assets/src/service.ts', "      await storage.deleteTemporary(tempId).catch(() => {});", "      void tempId;", 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: REJECTED entra READY', 'packages/platform-assets/src/service.ts', "    if (!r.ok) return this.rechazar(asset.id, input.actorId, r.error);", "    if (!r.ok) r = { ok: true, media: { mimeType: 'video/mp4', container: 'MP4', width: 1, height: 1, fpsValue: 25, codec: 'h264', durationMs: 1000 } as never, frameBytes: 1 };", 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: BAD_RESOLUTION aceptado', 'packages/platform-media/src/validator.ts', '  if (media.width !== fmt.width || media.height !== fmt.height) {', '  if (false) {', 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: corrupto aceptado', 'packages/platform-media/src/pipeline.ts', '    if (!frame.ok) return frame;', '', 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: READY sin StoredObject', 'packages/platform-db/src/migrations/0002_asset_pipeline.ts', "  IF NOT FOUND THEN\n    RAISE EXCEPTION 'ASSET_OBJECT_MISSING", "  IF false THEN\n    RAISE EXCEPTION 'ASSET_OBJECT_MISSING", 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: READY con sha ajeno', 'packages/platform-db/src/migrations/0002_asset_pipeline.ts', '  IF o.sha256 IS DISTINCT FROM NEW.sha256 THEN', '  IF false THEN', 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: READY con tamaño ajeno', 'packages/platform-db/src/migrations/0002_asset_pipeline.ts', '  IF o.size_bytes IS DISTINCT FROM NEW.size_bytes THEN', '  IF false THEN', 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: terminal sin detail', 'packages/platform-db/src/migrations/0002_asset_pipeline.ts', '        NEW.sha256, NEW.container, NEW.rejection_detail)', '        NEW.sha256, NEW.container, OLD.rejection_detail)', 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 ('assets: tempId desde filename', 'packages/platform-assets/src/service.ts', '    const tempId = randomUUID(); // nunca deriva del nombre del archivo', '    const tempId = originalFilename;', 'npx vitest run -c vitest.platform.config.ts packages/platform-assets packages/platform-db/src/asset-consistency.db.test.ts'),
 # B4 — API Fastify con PostgreSQL + storage + ffmpeg reales
 ('api: actor no exigido', 'apps/platform-api/src/actor.ts', "  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Se requiere un actor autenticado.');", "  if (false) throw new ApiError(401, 'UNAUTHENTICATED', 'Se requiere un actor autenticado.');", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('api: Idempotency-Key opcional', 'apps/platform-api/src/app.ts', "    if (!hdr.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED',", "    if (false) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED',", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('api: 500 filtra el error interno', 'apps/platform-api/src/errors.ts', "  return body(500, 'INTERNAL_ERROR', 'Error interno.');", "  return body(500, 'INTERNAL_ERROR', String((err as Error)?.message ?? err));", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('api: TOO_LARGE no es 413', 'apps/platform-api/src/app.ts', "  if (a.rejection.code === 'ASSET_TOO_LARGE') return 413;\n", "", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('api: ve assets ajenos', 'apps/platform-api/src/app.ts', "where('id', '=', id).where('created_by', '=', actorId).executeTakeFirst();", "where('id', '=', id).executeTakeFirst();", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('api: ready ignora la base', 'apps/platform-api/src/app.ts', "      database: await check(() => sql`SELECT 1`.execute(deps.db)),", "      database: 'ok' as const,", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('api: x-request-id sin sanear', 'apps/platform-api/src/app.ts', "const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;", "const REQUEST_ID_RE = /^[\\s\\S]+$/;", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('api: partes después del archivo aceptadas', 'apps/platform-api/src/app.ts', "        afterBody: nadaDespuesDelArchivo,\n", "", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('assets: afterBody ignorado', 'packages/platform-assets/src/service.ts', "      if (input.afterBody) await input.afterBody();\n", "", 'npx vitest run -c vitest.platform.config.ts apps/platform-api'),
 ('remediación: resolución hardcodeada', 'packages/platform-media/src/remediation.ts', "  const args = normalizationArgs(fmt.width, fmt.height, fps);", "  const args = normalizationArgs(1920, 412, fps);", 'npx vitest run packages/platform-media/src/remediation.test.ts'),
 ('auth: Argon2id omitido (Argon2d)', 'packages/platform-auth/src/password.ts', 'const ARGON2ID = 2 as unknown as Algorithm;', 'const ARGON2ID = 0 as unknown as Algorithm;', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: parámetros Argon2 bajados', 'packages/platform-auth/src/password.ts', '  memoryCost: 19_456, // KiB = 19 MiB', '  memoryCost: 4_096,', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: sesión sin expiración', 'packages/platform-auth/src/sessions.ts', "    .where('s.expires_at', '>', sql<Date>`now()`)\n", '', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: sesión revocada sigue valiendo', 'packages/platform-auth/src/sessions.ts', "    .where('s.revoked_at', 'is', null)\n    .where('s.expires_at'", "    .where('s.expires_at'", 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: usuario deshabilitado conserva sesión', 'packages/platform-auth/src/sessions.ts', "    .where('u.enabled', '=', true)\n", '', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: CSRF omitido', 'apps/platform-api/src/actor.ts', "  if (actor.source === 'session' && !SAFE_METHODS.has(req.method.toUpperCase())) {", '  if (false) {', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: CSRF de cualquier sesión', 'packages/platform-auth/src/sessions.ts', "  return typeof presented === 'string' && presented.length > 0 && safeEqual(presented, session.csrfToken);", "  return typeof presented === 'string' && presented.length > 0;", 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: rol ignorado', 'apps/platform-api/src/actor.ts', '  if (roles && !hasAnyRole(actor, roles)) throw', '  if (false && roles && !hasAnyRole(actor, roles)) throw', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: external habilitado sin flag', 'packages/platform-auth/src/sessions.ts', '      if (opts.externalApprovalEnabled && r.external_approval_enabled === true && r.contract_id) external.push(r.contract_id);', '      if (r.contract_id) external.push(r.contract_id);', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: cross-contract permitido', 'packages/platform-auth/src/access.ts', '    if (p.externalContractIds.includes(contractId)) return true;', '    return true;', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: cambio de rol no revoca sesiones', 'packages/platform-auth/src/users.ts', '    const revokedSessions = await revokeAllSessions(trx, userId);', '    const revokedSessions = 0;', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: login no rota la sesión previa', 'apps/platform-api/src/auth-routes.ts', '    if (previa?.session) await revokeSession(deps.db, previa.session.id);\n', '', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: rate limit después del audit', 'packages/platform-auth/src/login.ts', "  if (retry !== null) return { ok: false, kind: 'RATE_LIMITED', retryAfterMs: retry };", "  if (retry !== null) { await deps.db.transaction().execute((trx) => appendAuditEvent(trx, { actorUserId: null, action: 'AUTH_LOGIN_FAILED', entityType: 'user', entityId: null, metadata: { reason: 'RATE_LIMITED' } })); return { ok: false, kind: 'RATE_LIMITED', retryAfterMs: retry }; }", 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: rate limit apagado', 'packages/platform-auth/src/rate-limit.ts', '    if (retry > 0) return retry;', '    if (retry < 0) return retry;', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: IPv6 por dirección completa', 'packages/platform-auth/src/rate-limit.ts', 'full.slice(0, 4)', 'full.slice(0, 8)', 'npx vitest run packages/platform-auth'),
 ('auth: audit de login con email', 'packages/platform-auth/src/login.ts', 'metadata: { reason } }),', 'metadata: { reason, email } }),', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: cookie sin HttpOnly', 'apps/platform-api/src/auth-routes.ts', "  const cookieOpts = { path: '/', httpOnly: true,", "  const cookieOpts = { path: '/', httpOnly: false,", 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: login acepta no-JSON', 'apps/platform-api/src/auth-routes.ts', "    if (ct !== 'application/json') throw", '    if (false) throw', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: logout no revoca', 'apps/platform-api/src/auth-routes.ts', '    if (actor.session) await revokeSession(deps.db, actor.session.id);\n    reply.clearCookie', '    reply.clearCookie', 'npx vitest run -c vitest.platform.config.ts packages/platform-auth apps/platform-api'),
 ('auth: rate limit sin barrido de vencidas', 'packages/platform-auth/src/rate-limit.ts', '    this.sweep(t);\n', '', 'npx vitest run packages/platform-auth'),
 ('auth: rate limit sin tope de claves', 'packages/platform-auth/src/rate-limit.ts', '      while (this.hits.size >= this.cfg.maxKeys) {', '      while (false) {', 'npx vitest run packages/platform-auth'),
 ('auth: rate limit con claves de IP arbitrarias', 'packages/platform-auth/src/rate-limit.ts', "  return '?:invalid';", '  return `?:${ip}`;', 'npx vitest run packages/platform-auth'),
 ('c2: cuatro ojos sin trigger', 'packages/platform-db/src/migrations/0001_initial.ts', "  IF NEW.decision = 'APPROVED' AND required AND NEW.actor_user_id = submitter THEN", '  IF false THEN', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: cuatro ojos ignora el contrato', 'packages/platform-approval/src/service.ts', 'if (v.four_eyes_required && v.submitted_by === input.actor.userId) {', 'if (v.submitted_by === input.actor.userId) {', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: approve sin evidencia (API)', 'apps/platform-api/src/contracts.ts', 'export const ApproveBodySchema = z.object({ evidenceId: Uuid,', 'export const ApproveBodySchema = z.object({ evidenceId: Uuid.optional(),', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: approve sin evidencia (base)', 'packages/platform-db/src/migrations/0001_initial.ts', "  CHECK (decision <> 'APPROVED' OR evidence_id IS NOT NULL),\n", '', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: reject sin motivo (API)', 'apps/platform-api/src/contracts.ts', 'reason: z.string().trim().min(1).max(2000)', 'reason: z.string().max(2000)', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: reject sin motivo (base)', 'packages/platform-db/src/migrations/0001_initial.ts', "  CHECK (decision <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0))", '  CHECK (true)', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: transición inválida', 'packages/platform-approval/src/service.ts', "        if (v.decision) throw estadoInvalido(v.decision);\n        if (decision === 'APPROVED') {", "        if (decision === 'APPROVED') {", 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: evidencia después de decidir', 'packages/platform-approval/src/service.ts', '          if (v.decision) throw estadoInvalido(v.decision);\n          let commit;', '          let commit;', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: retry duplicado (sin idempotencia)', 'packages/platform-approval/src/service.ts', '      withIdempotency(db, { key: input.idempotencyKey, actorId: input.actor.userId, operation, fingerprint }, async (trx) => {', '      (async (run: (trx: Kysely<Database>) => Promise<{ status: number; body: ShowVersionView }>) => ({ ...(await db.transaction().execute(run)), replayed: false }))(async (trx) => {', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: decisión sin hash exacto', 'packages/platform-approval/src/service.ts', '        if (v.version_hash !== input.versionHash) {', '        if (false) {', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: hash exacto sin trigger', 'packages/platform-db/src/migrations/0003_approval.ts', '  IF h IS DISTINCT FROM NEW.version_hash THEN', '  IF false THEN', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: scope de lectura ignorado', 'packages/platform-approval/src/service.ts', '    if (!v || !canAccessContract(actor, v.contract_id, READ_ROLES)) {', '    if (!v) {', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: ver alcanza para decidir', 'packages/platform-approval/src/service.ts', '    if (!canAccessContract(actor, v.contract_id, DECIDE_ROLES)) {', '    if (false) {', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: tipo declarado no se compara', 'packages/platform-approval/src/service.ts', '      if (detectedType !== input.type) {', '      if (false) {', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: allowlist sin trigger', 'packages/platform-db/src/migrations/0003_approval.ts', '  IF (NEW.type, m) NOT IN (${pares}) THEN', '  IF false THEN', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: HTML pasa como texto', 'packages/platform-approval/src/detect.ts', '  if (looksLikeMarkup(texto)) return null;\n', '', 'npx vitest run packages/platform-approval'),
 ('c2: texto sin validar controles', 'packages/platform-approval/src/detect.ts', 'const esTextoSeguro = (s: string) => !CONTROL_PROHIBIDO.test(s);', 'const esTextoSeguro = (s: string) => s.length >= 0;', 'npx vitest run packages/platform-approval'),
 ('c2: descarga con el nombre original', 'apps/platform-api/src/approval-routes.ts', '      .header(\'content-disposition\', `attachment; filename="${downloadFilename(evidence)}"`)', '      .header(\'content-disposition\', `attachment; filename="${evidence.originalFilename}"`)', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: firma de imagen alcanza', 'packages/platform-approval/src/detect.ts', '  if (!s.isText) return null;', "  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'PDF';\n  if (!s.isText) return null;", 'npx vitest run packages/platform-approval'),
 ('c2: parser corta antes que limitBody', 'apps/platform-api/src/approval-routes.ts', 'fileSize: deps.maxEvidenceBytes + 1,', 'fileSize: deps.maxEvidenceBytes,', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: aprobación sin audit', 'packages/platform-approval/src/service.ts', "          action: decision === 'APPROVED' ? 'VERSION_APPROVED' : 'VERSION_REJECTED',", "          action: 'VERSION_REJECTED',", 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: desactivar cuatro ojos sin evento explícito', 'packages/platform-approval/src/service.ts', "        action: input.required ? 'CONTRACT_UPDATED' : 'FOUR_EYES_DISABLED',", "        action: 'CONTRACT_UPDATED',", 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: última aprobada retrocede', 'packages/platform-approval/src/service.ts', "                eb('latest_approved_version_id', 'is', null),\n", '                eb.val(true),\n', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('c2: evidencia de otra versión (base)', 'packages/platform-db/src/migrations/0003_approval.ts', 'ALTER TABLE approvals ADD CONSTRAINT approvals_evidence_same_version\n  FOREIGN KEY (evidence_id, show_version_id) REFERENCES approval_evidence(id, show_version_id);', '', 'npx vitest run -c vitest.platform.config.ts packages/platform-db apps/platform-api/src/approval.db.test.ts'),
 ('storage: limpieza compara con fracción de ms', 'packages/platform-storage/src/local-disk.ts', '      if (Math.floor(ultima) > limite) continue;', '      if (ultima > limite) continue;', 'npx vitest run packages/platform-storage'),
 ('c3: submit sin preflight', 'packages/platform-approval/src/submit.ts', '    if (!v.exportable || !v.compile.showPackage) {', '    if (!v.compile.showPackage) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: submit sin revisión esperada', 'packages/platform-approval/src/submit.ts', '    if (d.revision !== input.draftRevision) {', '    if (false) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: misma revisión se envía dos veces', 'packages/platform-approval/src/submit.ts', '    if (previa) {', '    if (false && previa) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: asset no READY entra', 'packages/platform-approval/src/submit.ts', "      if (!a || a.status !== 'READY' || !a.sha256 || !a.width || !a.height) {", '      if (!a || !a.sha256 || !a.width || !a.height) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: ranura sin chequeo de superficie', 'packages/platform-approval/src/submit.ts', '      if (a.surface_type !== SLOT_SURFACE[slot]) {', '      if (false) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: retry duplicado (sin idempotencia)', 'packages/platform-approval/src/submit.ts', '  const r = await withIdempotency(deps.db, { key: input.idempotencyKey, actorId: input.actor.userId, operation: SUBMIT_OPERATION, fingerprint }, async (trx) => {', '  const r = await (async (run: (trx: Kysely<Database>) => Promise<{ status: number; body: ShowVersionView }>) => ({ ...(await deps.db.transaction().execute(run)), replayed: false }))(async (trx) => {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: source por UUID (hash depende de la base)', 'packages/platform-approval/src/submit.ts', 'source: assetSourceFor(a.sha256),', 'source: `/assets/${a.id}.mp4`,', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: submit sin audit', 'packages/platform-approval/src/submit.ts', "actorUserId: input.actor.userId, action: 'VERSION_SUBMITTED',", "actorUserId: input.actor.userId, action: 'VERSION_APPROVED',", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('c3: submit sin lock de campaña', 'packages/platform-approval/src/submit.ts', "      .where('id', '=', input.campaignId)\n      .forUpdate()\n", "      .where('id', '=', input.campaignId)\n", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: last-write-wins (sin expectedRevision)', 'packages/platform-campaigns/src/service.ts', "        .where('revision', '=', input.expectedRevision)\n", '', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: la revisión no avanza', 'packages/platform-campaigns/src/service.ts', 'revision: sql<number>`revision + 1`', 'revision: sql<number>`revision`', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: draft sin validar', 'packages/platform-campaigns/src/service.ts', '    const draft = parseDraft(input.takeoverDraft);\n    return this.db.transaction().execute(async (trx) => {\n      const cp = await trx', '    const draft = input.takeoverDraft as TakeoverDraft;\n    return this.db.transaction().execute(async (trx) => {\n      const cp = await trx', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: draft sin audit', 'packages/platform-campaigns/src/service.ts', "action: 'DRAFT_UPDATED'", "action: 'CAMPAIGN_CREATED'", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: conflicto con clientRevision falso', 'packages/platform-campaigns/src/service.ts', 'serverRevision: actual.revision, clientRevision: input.expectedRevision,', 'serverRevision: actual.revision, clientRevision: actual.revision,', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: draft de campaña archivada', 'packages/platform-campaigns/src/service.ts', "      if (cp.lifecycle_status !== 'ACTIVE') {", '      if (false) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: §6 sin chequeo en PUT', 'packages/platform-campaigns/src/service.ts', "      const ct = await trx.selectFrom('contracts').select('allowed_surfaces').where('id', '=', cp.contract_id).forShare().executeTakeFirstOrThrow();\n      exigirSuperficies(draft, ct.allowed_surfaces);\n", "      const ct = await trx.selectFrom('contracts').select('allowed_surfaces').where('id', '=', cp.contract_id).forShare().executeTakeFirstOrThrow();\n", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: PUT sin FOR SHARE del contrato (AUDIT D1 P1)', 'packages/platform-campaigns/src/service.ts', ".where('id', '=', cp.contract_id).forShare().executeTakeFirstOrThrow();", ".where('id', '=', cp.contract_id).executeTakeFirstOrThrow();", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: submit sin FOR SHARE del contrato (AUDIT D1 P1)', 'packages/platform-approval/src/submit.ts', ".where('id', '=', cp.contract_id).forShare().executeTakeFirstOrThrow();", ".where('id', '=', cp.contract_id).executeTakeFirstOrThrow();", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: §6 sin chequeo al crear', 'packages/platform-campaigns/src/service.ts', '      exigirSuperficies(draft, ct.allowed_surfaces);\n', '', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: §6 sin chequeo en submit', 'packages/platform-approval/src/submit.ts', '    exigirSuperficies(draft, ct.allowed_surfaces);\n', '', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d1: contrato con pantallas inexistentes', 'packages/platform-campaigns/src/service.ts', '  if (unicas.length === 0 || malas.length > 0) {', '  if (unicas.length === 0) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/campaigns.db.test.ts apps/platform-api/src/submit.db.test.ts'),
 ('d2: last-write-wins ante 409', 'packages/builder-repository/src/api.ts', "        return { kind: 'conflict', conflict };", '        return this.put(campaignId, draft, conflict.serverRevision);', 'npx vitest run packages/builder-repository'),
 ('d2: save sin guardar local primero', 'packages/builder-repository/src/syncing.ts', '    this.escribir({ campaignId, baseRevision: expectedRevision, pending: true, draft });\n', '', 'npx vitest run packages/builder-repository'),
 ('d2: PUT sin token CSRF', 'packages/builder-repository/src/api.ts', "      if (csrf) headers['x-csrf-token'] = csrf;\n", '', 'npx vitest run packages/builder-repository'),
 ('d2: mantener local sin rebasar', 'packages/builder-repository/src/syncing.ts', '    const base = this.conflict.serverRevision;', '    const base = this.revision;', 'npx vitest run packages/builder-repository'),
 ('d2: PUT perdido tomado como conflicto', 'packages/builder-repository/src/syncing.ts', '&& mismoDraft(s.draft, draft)) {', '&& false) {', 'npx vitest run packages/builder-repository'),
 ('d2: conflicto real tomado como propio', 'packages/builder-repository/src/syncing.ts', '&& mismoDraft(s.draft, draft)) {', '&& true) {', 'npx vitest run packages/builder-repository'),
 ('d2: local sin chequeo de revision', 'packages/builder-repository/src/local.ts', '    if (expectedRevision !== this.revision) {', '    if (false) {', 'npx vitest run packages/builder-repository'),
 ('d2: metadata de otra campania', 'packages/builder-repository/src/syncing.ts', ' || r.data.campaignId !== campaignId) return null;', ') return null;', 'npx vitest run packages/builder-repository'),
 ('d2: draft local fallido se sube igual (AUDIT D2 P1)', 'packages/builder-repository/src/syncing.ts', '    if (!saveDraft(st, r.draft)) {', '    if (!saveDraft(st, r.draft) && false) {', 'npx vitest run packages/builder-repository'),
 ('d2: estado pendiente antes de guardar local (AUDIT D2 P1)', 'packages/builder-repository/src/syncing.ts', '    this.escribir({ campaignId, baseRevision: expectedRevision, pending: true, draft });\n    this.draft = draft;\n    this.revision = expectedRevision;\n    this.pending = true;\n', '    this.draft = draft;\n    this.revision = expectedRevision;\n    this.pending = true;\n    this.escribir({ campaignId, baseRevision: expectedRevision, pending: true, draft });\n', 'npx vitest run packages/builder-repository'),
 ('d2: offline sin pendiente', 'packages/builder-repository/src/syncing.ts', "      return { kind: 'pending', revision: base };", '      throw e;', 'npx vitest run packages/builder-repository'),
 ('d2: espejo M2C antes del registro (AUDIT D2 R2)', 'packages/builder-repository/src/syncing.ts', '    // (1) registro primero\n    try {', '    saveDraft(st, r.draft);\n    // (1) registro primero\n    try {', 'npx vitest run packages/builder-repository'),
 ('d2: sin restaurar el registro (AUDIT D2 R2)', 'packages/builder-repository/src/syncing.ts', '        if (anterior === null) st.removeItem(clave);\n        else st.setItem(clave, anterior);\n', '', 'npx vitest run packages/builder-repository'),
 ('d2: adoptar servidor pisa M2C ajeno (AUDIT D2 R2)', 'packages/builder-repository/src/syncing.ts', "pending: false, draft }, 'si-es-nuestro');", 'pending: false, draft });', 'npx vitest run packages/builder-repository'),
 ('d2: espejo ajeno tomado como propio (AUDIT D2 R2)', 'packages/builder-repository/src/syncing.ts', '    return previo !== null && mismoDraft(actual, previo.draft);', '    return true;', 'npx vitest run packages/builder-repository'),
 ('d1: black no usa la pantalla', 'packages/platform-campaigns/src/surfaces.ts', "  const activa = (d: { mode: string }) => d.mode !== 'hold';", "  const activa = (d: { mode: string }) => d.mode === 'play';", 'npx vitest run packages/platform-campaigns'),
 ('d1: master no arrastra la horizontal', 'packages/platform-campaigns/src/surfaces.ts', "        if (draft.surfaces.includeHorizontalInMaster) usadas.add('horizontal');\n", '', 'npx vitest run packages/platform-campaigns'),
 ('e1: cupo de upload nunca devuelto (BL-10)', 'apps/platform-api/src/app.ts', '      cupo.release();', '      void cupo;', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/upload-limits.db.test.ts'),
 ('e1: límite de upload ignorado (BL-10)', 'apps/platform-api/src/app.ts', '    if (!cupo.ok) {', '    if (cupo.ok === (false as boolean) && Math.random() > 2) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/upload-limits.db.test.ts'),
 ('e1: 429 sin Retry-After (BL-10)', 'apps/platform-api/src/app.ts', "      reply.header('retry-after', String(segundos));\n", '', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/upload-limits.db.test.ts'),
 ('e1: ventana de tasa nunca se reinicia (BL-10)', 'apps/platform-api/src/upload-limiter.ts', '    if (e && e.resetAt <= t) {', '    if (e && e.resetAt < 0) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/upload-limits.db.test.ts'),
 ('e1: release doble descuenta dos veces (BL-10)', 'apps/platform-api/src/upload-limiter.ts', '        if (liberado) return;\n', '', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/upload-limits.db.test.ts'),
 ('e1: descarta actores con uploads en curso (BL-10)', 'apps/platform-api/src/upload-limiter.ts', '      if (v.active === 0) {', '      if (v.active >= 0) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/upload-limits.db.test.ts'),
 ('e1: tabla OpenAPI con un rol de más (BL-11)', 'apps/platform-api/src/openapi.ts', 'const DECISORES = [...DECIDE_ROLES];', "const DECISORES = [...DECIDE_ROLES, 'ADMIN'];", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/contract.db.test.ts'),
 ('e1: Idempotency-Key no declarada (BL-11)', 'apps/platform-api/src/openapi.ts', "csrf: true, idempotency: true, body: { json: 'RejectBody' }", "csrf: true, idempotency: false, body: { json: 'RejectBody' }", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/contract.db.test.ts'),
 ('e1: conversor pierde strict (BL-11)', 'apps/platform-api/src/openapi.ts', "      if (def.unknownKeys === 'strict') out.additionalProperties = false;\n", '', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/contract.db.test.ts'),
 ('e1: ruta registrada sin documentar (BL-11)', 'apps/platform-api/src/openapi.ts', "  { method: 'GET', path: '/health',", "  { method: 'GET', path: '/healthz',", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/contract.db.test.ts'),
 ('e1: login loguea el cuerpo (§34)', 'apps/platform-api/src/auth-routes.ts', "req.log.info({ event: 'auth.login', requestId: req.id, userId: r.userId }, 'login');", "req.log.info({ event: 'auth.login', requestId: req.id, userId: r.userId, body: req.body }, 'login');", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/logs-sin-secretos.db.test.ts'),
 ('media: caché de fixtures borra el directorio publicado por otro worker', 'packages/platform-media/src/fixtures.ts', '    try {\n      renameSync(tmp, dir);', '    rmSync(dir, { recursive: true, force: true });\n    try {\n      renameSync(tmp, dir);', 'npx vitest run packages/platform-media/src/fixtures.test.ts'),
 ('d3: expectedRevision inventado por el llamador (§31)', 'packages/builder-repository/src/session.ts', '        const rev = this.repo.status().revision;', '        const rev = 1 as number | null;', 'npx vitest run packages/builder-repository/src/session.test.ts'),
 ('d3: el autosave del medio también se sube', 'packages/builder-repository/src/session.ts', '      this.next = null;\n      return this.correr(', '      return this.correr(', 'npx vitest run packages/builder-repository/src/session.test.ts'),
 ('d3: dos guardados en paralelo', 'packages/builder-repository/src/session.ts', '    while (this.inFlight) await this.inFlight;\n    let liberar', '    let liberar', 'npx vitest run packages/builder-repository/src/session.test.ts'),
 ('d3: CSRF de la sesión no se manda', 'packages/builder-repository/src/session.ts', 'csrfToken: () => csrf });', 'csrfToken: () => null });', 'npx vitest run packages/builder-repository/src/session.test.ts'),
 ('d3: ?campaign= acepta cualquier cosa', 'packages/builder-repository/src/session.ts', '  return id && UUID.test(id) ? id.toLowerCase() : null;', '  return id ? id.toLowerCase() : null;', 'npx vitest run packages/builder-repository/src/session.test.ts'),
 ('d3: conflicto marcado como guardado en la vista (§9)', 'packages/builder-repository/src/session.ts', "        this.patch({ phase: 'conflict', connectivity: st.connectivity, conflict: r.conflict });", "        this.patch({ phase: 'saved', connectivity: st.connectivity, conflict: r.conflict });", 'npx vitest run packages/builder-repository/src/session.test.ts'),
 ('d3: limpio aunque se editó durante el guardado', 'apps/control/src/state/useBuilderStore.ts', "(r.kind === 'saved' || r.kind === 'pending') && get().draft === enviado", "(r.kind === 'saved' || r.kind === 'pending')", 'npx vitest run apps/control/src/state/useBuilderStore.test.ts'),
 ('d3: conflicto deja el draft limpio (reemplazo sin confirmación)', 'apps/control/src/state/useBuilderStore.ts', "(r.kind === 'saved' || r.kind === 'pending') && get().draft === enviado", "(r.kind === 'saved' || r.kind === 'pending' || r.kind === 'conflict') && get().draft === enviado", 'npx vitest run apps/control/src/state/useBuilderStore.test.ts'),
 ('d3: campaña que no abrió sigue recibiendo autosaves', 'apps/control/src/state/useBuilderStore.ts', '      set({ campaignSession: null, campaign: session.view() });\n      return false;', '      set({ campaignSession: session, campaign: session.view() });\n      return false;', 'npx vitest run apps/control/src/state/useBuilderStore.test.ts'),
 ('d3: sin campaña el Builder deja de guardar local (M2C)', 'apps/control/src/state/useBuilderStore.ts', '    if (!sesion) {\n      // M2C, sin cambios', '    if (sesion === undefined) {\n      // M2C, sin cambios', 'npx vitest run apps/control/src/state/useBuilderStore.test.ts'),
 ('d3: indicador sin APPROVED VERSION (§32)', 'apps/control/src/components/builder/CampaignStatus.tsx', '          APPROVED VERSION v{campaign.approvedVersion.versionNumber}', '          VERSION v{campaign.approvedVersion.versionNumber}', 'npx vitest run apps/control/src/components/builder/CampaignStatus.test.ts'),
 ('d3: indicador visible sin campaña (M2C cambia)', 'apps/control/src/components/builder/CampaignStatus.tsx', '  if (!campaign) return null;\n', '  if (!campaign) return <div data-testid="campaign-status" />;\n', 'npx vitest run apps/control/src/components/builder/CampaignStatus.test.ts'),
 ('e2: la aprobación no publica la versión en la campaña (§41)', 'packages/platform-approval/src/service.ts', '            .set({ latest_approved_version_id: input.versionId })', '            .set({ latest_approved_version_id: null })', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/e2e-flow.db.test.ts'),
 ('e2: logout no revoca la sesión (§41 logout)', 'apps/platform-api/src/auth-routes.ts', '    if (actor.session) await revokeSession(deps.db, actor.session.id);\n    reply.clearCookie', '    reply.clearCookie', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/e2e-flow.db.test.ts'),
 ('e2: submit audita con otro actor (§48.17)', 'packages/platform-approval/src/submit.ts', "          actorUserId: input.actor.userId, action: 'VERSION_SUBMITTED'", "          actorUserId: null, action: 'VERSION_SUBMITTED'", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/e2e-flow.db.test.ts'),
 ('e2: validación de asset sin audit (§48.17)', 'packages/platform-assets/src/service.ts', "        actorUserId: input.actorId, action: 'ASSET_VALIDATED'", "        actorUserId: input.actorId, action: 'ASSET_UPLOADED'", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/e2e-flow.db.test.ts'),
 ('e2: un punto de §48 pierde su test y la matriz no se entera (BL-23)', 'apps/platform-api/src/e2e-flow.db.test.ts', "verifyChain OK y cada evento esperado con el actor del rol que corresponde [§48.17]'", "verifyChain OK y cada evento esperado con el actor del rol que corresponde'", 'npx vitest run scripts/acceptance/matrix.test.ts'),
 ('e2: un test etiquetado salteado cuenta como cubierto (BL-23)', 'scripts/acceptance/matrix.mjs', "if (a.status !== 'passed')", "if (a.status === 'failed')", 'npx vitest run scripts/acceptance/matrix.test.ts'),
 ('e2: punto cubierto sin test pasa la validación (BL-23)', 'scripts/acceptance/matrix.mjs', '      } else if (conTag.length === 0) {', '      } else if (conTag.length < 0) {', 'npx vitest run scripts/acceptance/matrix.test.ts'),
 ('e3a: CORS responde `*` en vez del origen exacto (ADR-063)', 'apps/platform-api/src/cors.ts', "    reply.header('access-control-allow-origin', origin);", "    reply.header('access-control-allow-origin', '*');", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/cors.db.test.ts'),
 ('e3a: CORS sin Vary: Origin (caché cruzada)', 'apps/platform-api/src/cors.ts', "    reply.header('vary', 'Origin');\n", '', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/cors.db.test.ts'),
 ('e3a: mutación con Origin no listado no se corta (defensa en profundidad)', 'apps/platform-api/src/cors.ts', '      if (esPreflight || !SEGUROS.has(req.method)) {', '      if (esPreflight) {', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/cors.db.test.ts'),
 ('e3a: preflight no habilita X-CSRF-Token', 'apps/platform-api/src/cors.ts', "export const CORS_ALLOWED_HEADERS = 'Content-Type, X-CSRF-Token, Idempotency-Key, X-Request-Id';", "export const CORS_ALLOWED_HEADERS = 'Content-Type, Idempotency-Key, X-Request-Id';", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/cors.db.test.ts'),
 ('e3a: TRUST_CORS_ORIGINS acepta orígenes no exactos', 'apps/platform-api/src/cors.ts', '    if (u.origin !== v) throw', '    if (false) throw', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/cors.db.test.ts'),
 ('e3a: TRUST_CORS_ORIGINS acepta http en producción', 'apps/platform-api/src/cors.ts', "    if (opts.production && u.protocol !== 'https:') throw", '    if (false) throw', 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/cors.db.test.ts'),
 ('e3a: el cliente web no manda credenciales (la cookie del host de la API no viaja)', 'apps/platform-web/src/lib/api.ts', "method, headers, credentials: 'include', cache: 'no-store',", "method, headers, credentials: 'same-origin', cache: 'no-store',", 'npx vitest run -c vitest.platform.config.ts apps/platform-api/src/platform-web-client.db.test.ts'),
 ('e3a: el cliente web no manda X-CSRF-Token en mutaciones', 'apps/platform-web/src/lib/api.ts', "      headers['x-csrf-token'] = this.csrf;\n", '', 'npx vitest run apps/platform-web/src/lib/api.test.ts'),
 ('e3a: el cliente web conserva el CSRF después de un 401', 'apps/platform-web/src/lib/api.ts', '      if (res.status === 401) this.csrf = null;\n', '', 'npx vitest run apps/platform-web/src/lib/api.test.ts'),
 ('e3a: open redirect en `next` del login', 'apps/platform-web/src/lib/session.ts', "  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\\\')) return HOME_PATH;", "  if (!raw.startsWith('/')) return HOME_PATH;", 'npx vitest run apps/platform-web/src/lib/session.test.ts'),
 ('e3a: sin sesión no se redirige a /login', 'apps/platform-web/src/lib/session.ts', '  if (!me) return enLogin ? null : `${LOGIN_PATH}?next=${encodeURIComponent(pathname + search)}`;', '  if (!me) return null;', 'npx vitest run apps/platform-web/src/lib/session.test.ts'),
 ('e3b: asignar un asset pisa todas las superficies del draft', 'apps/platform-web/src/lib/draft-assets.ts', 'surfaces: { ...(surfaces as Record<string, unknown>), [slot]: assetId }', 'surfaces: { [slot]: assetId }', 'npx vitest run apps/platform-web/src/lib/draft-assets.test.ts'),
 ('e3b: un asset no READY se puede asignar al draft', 'apps/platform-web/src/lib/draft-assets.ts', "  if (a.status !== 'READY') return null;\n", '', 'npx vitest run apps/platform-web/src/lib/draft-assets.test.ts'),
 ('e3b: upload de asset sin Idempotency-Key', 'apps/platform-web/src/lib/api.ts', "AssetSchema, { form }, { 'idempotency-key': this.newKey() });", 'AssetSchema, { form }, {});', 'npx vitest run apps/platform-web/src/lib/api-e3b.test.ts'),
 ('e3b: asset REJECTED por ffprobe tratado como error de la UI', 'apps/platform-web/src/lib/api.ts', "      if (rechazado?.success && rechazado.data.status === 'REJECTED') return rechazado.data;\n", '', 'npx vitest run apps/platform-web/src/lib/api-e3b.test.ts'),
 ('e3b: submit cita otra revisión del draft', 'apps/platform-web/src/lib/api.ts', 'ShowVersionSchema, { json: { draftRevision } },', 'ShowVersionSchema, { json: { draftRevision: draftRevision + 1 } },', 'npx vitest run apps/platform-web/src/lib/api-e3b.test.ts'),
 ('e3b: aprobar sin confirmar el hash mostrado', 'apps/platform-web/src/components/VersionReview.tsx', 'disabled={p.decision.busy || !p.decision.evidenceId || !p.decision.confirmHash}', 'disabled={p.decision.busy || !p.decision.evidenceId}', 'npx vitest run apps/platform-web/src/components/views-e3b.test.ts'),
 ('e3b: §32 la versión aprobada muestra la revisión del draft', 'apps/platform-web/src/components/CampaignDetail.tsx', '<strong>APPROVED VERSION v{c.latestApprovedVersion.versionNumber}</strong>', '<strong>APPROVED VERSION v{p.draft.revision}</strong>', 'npx vitest run apps/platform-web/src/components/views-e3b.test.ts'),
 ('e3b: §41 el hash de la versión enviada no se muestra', 'apps/platform-web/src/components/CampaignDetail.tsx', '({versionCreada.status}) · hash <code className="hash">{versionCreada.versionHash}</code>', '({versionCreada.status})', 'npx vitest run apps/platform-web/src/components/views-e3b.test.ts'),
 ('e3b: Idempotency-Key depende de crypto.randomUUID (falla en http de desarrollo)', 'apps/platform-web/src/lib/api.ts', "  if (typeof c.randomUUID === 'function') return c.randomUUID();", '  return (c as Crypto).randomUUID();', 'npx vitest run apps/platform-web/src/lib/api-e3b.test.ts'),
]
# Restauracion garantizada: si esto se interrumpe a mitad (Ctrl-C, timeout,
# SIGTERM), el repo NO puede quedar con una mutacion aplicada. Pasa, y el
# sintoma es un test que "falla solo" sin que nadie haya tocado nada.
import atexit, json, os, signal, sys

# Diario en disco. `atexit` y los handlers de señal no corren ante SIGKILL
# (timeout -9, contenedor detenido), y cuando eso pasa el repo queda MUTADO:
# aparecen tests "fallando solos" y lint con errores que nadie escribio. Ya
# ocurrio dos veces. El diario permite recuperar sin adivinar.
#
#   python3 scripts/mutation-check.py --restore
_DIARIO = pathlib.Path(__file__).with_name('.mutation-journal.json')

_pendiente = {}

def _guardar_diario():
    if _pendiente:
        _DIARIO.write_text(json.dumps(_pendiente))
    elif _DIARIO.exists():
        _DIARIO.unlink()

def _restaurar_desde_diario():
    if not _DIARIO.exists():
        print('sin mutaciones pendientes')
        return 0
    datos = json.loads(_DIARIO.read_text())
    for f, orig in datos.items():
        pathlib.Path(f).write_text(orig)
        print('restaurado:', f)
    _DIARIO.unlink()
    return len(datos)

if '--restore' in sys.argv:
    sys.exit(0 if _restaurar_desde_diario() >= 0 else 1)

# Lock exclusivo. Dos corridas simultaneas se pisan el diario —el segundo lo
# sobrescribe— y la mutacion del primero queda VIVA en el repo sin registro.
# Paso de verdad: tres mutantes aplicados a la vez, uno de ellos salteando la
# validacion Zod de `loadDraft`.
_LOCK = pathlib.Path(__file__).with_name('.mutation-lock')
try:
    _fd = os.open(str(_LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(_fd, str(os.getpid()).encode())
    os.close(_fd)
except FileExistsError:
    viejo = _LOCK.read_text().strip()
    activo = pathlib.Path(f'/proc/{viejo}').exists() if viejo.isdigit() else False
    if activo:
        print(f'ERROR: ya hay un mutation-check corriendo (pid {viejo}).')
        print('Esperalo, o matalo y corre: python3 scripts/mutation-check.py --restore')
        sys.exit(2)
    print(f'lock huerfano del pid {viejo}: la corrida anterior murio. Restaurando.')
    _restaurar_desde_diario()
    _LOCK.write_text(str(os.getpid()))

atexit.register(lambda: _LOCK.exists() and _LOCK.unlink())

# Si quedo un diario de una corrida anterior, se restaura antes de empezar:
# mutar sobre codigo ya mutado daria resultados sin sentido.
if _DIARIO.exists():
    print('ATENCION: corrida anterior interrumpida, restaurando')
    _restaurar_desde_diario()

def _restaurar(*_):
    for f, orig in list(_pendiente.items()):
        pathlib.Path(f).write_text(orig)
        _pendiente.pop(f, None)
    _guardar_diario()

atexit.register(_restaurar)
for _sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    try:
        signal.signal(_sig, lambda *_: (_restaurar(), sys.exit(130)))
    except (ValueError, OSError):
        pass

# --tanda inicio:fin  → corre solo esas reglas (índices de Python, fin
# excluido). Sirve para entornos donde un proceso largo no sobrevive: se
# corre en tandas y se suman los resultados. Sin la opción, corren todas.
_reglas = M
for _i, _arg in enumerate(sys.argv):
    if _arg == '--tanda' and _i + 1 < len(sys.argv):
        _ini, _fin = (int(v) if v else None for v in sys.argv[_i + 1].split(':'))
        _reglas = M[_ini:_fin]
        print(f'tanda {_ini}:{_fin} — {len(_reglas)} de {len(M)} reglas', flush=True)

# Una regla puede traer un 5.º campo: el comando de test que la atrapa. Por
# defecto, la suite unitaria. Las mutaciones de procesos reales (ffprobe/ffmpeg)
# usan la suite de media (vitest.media.config.ts).
CMD_DEFAULT = "npx vitest run"
CMD_MEDIA = "npx vitest run -c vitest.media.config.ts"

# MUTATION_TEST_CMD reemplaza el comando de test de TODAS las reglas. Sirve para
# demostrar el gate sin correr la suite (ver docs/reviews/M3A1_FASE_B2_AUDIT1.md):
#   MUTATION_TEST_CMD="printf 'Tests 1 passed\n'" → SOBREVIVE → exit 1
#   MUTATION_TEST_CMD="true"                       → SIN SALIDA → exit 1
import os, re
_override = os.environ.get('MUTATION_TEST_CMD')


_ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')


def clasificar(line):
    """ATRAPADA solo si vitest reporta tests fallados. Una suite que no produce
    la línea 'Tests …' (no arrancó, crasheó, comando inexistente) NO es una
    mutación atrapada: es un fallo de infraestructura y también tumba el gate."""
    # En CI vitest colorea la salida: "\x1b[31m2 failed" no tiene límite de
    # palabra antes del número. Se limpian los códigos ANSI antes de clasificar.
    line = _ANSI.sub('', line)
    if re.search(r'Tests\s.*\b\d+ failed', line):
        return 'ATRAPADA'
    if re.search(r'Tests\s.*\b\d+ passed', line):
        return 'SOBREVIVE'
    return 'SIN SALIDA'


if '--autoprueba' in sys.argv:
    assert clasificar('      Tests  2 failed | 594 passed | 1 skipped (597)') == 'ATRAPADA'
    assert clasificar('      Tests  596 passed | 1 skipped (597)') == 'SOBREVIVE'
    assert clasificar('') == 'SIN SALIDA'
    assert clasificar('Error: Cannot find module vitest') == 'SIN SALIDA'
    # salida coloreada como la de GitHub Actions
    assert clasificar('      Tests  \x1b[1m\x1b[31m2 failed\x1b[39m\x1b[22m | \x1b[32m594 passed\x1b[39m') == 'ATRAPADA'
    assert clasificar('      Tests  \x1b[1m\x1b[32m596 passed\x1b[39m\x1b[22m') == 'SOBREVIVE'
    print('autoprueba OK')
    sys.exit(0)

estados = {'ATRAPADA': 0, 'SOBREVIVE': 0, 'SIN SALIDA': 0}
for regla in _reglas:
    name, f, a, b = regla[:4]
    cmd = _override or (regla[4] if len(regla) > 4 else CMD_DEFAULT)
    p = pathlib.Path(f); orig = p.read_text()
    assert a in orig, f"no encontre el patron de: {name}"
    _pendiente[f] = orig
    _guardar_diario()
    try:
        p.write_text(orig.replace(a, b, 1))
        r = subprocess.run(f"{cmd} 2>&1 | grep -E 'Tests '", shell=True, capture_output=True, text=True)
        line = r.stdout.strip()
    finally:
        p.write_text(orig)
        _pendiente.pop(f, None)
        _guardar_diario()
    estado = clasificar(line)
    estados[estado] += 1
    print(f"{estado:10s} {name:28s} {line}", flush=True)
print(f"atrapadas {estados['ATRAPADA']} · sobreviven {estados['SOBREVIVE']} · sin salida {estados['SIN SALIDA']}")
if estados['SOBREVIVE'] or estados['SIN SALIDA'] or not _reglas:
    print("GATE FALLIDO: HAY MUTANTES VIVOS O SUITES SIN SALIDA")
    sys.exit(1)
print("TODAS ATRAPADAS")
