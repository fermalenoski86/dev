import type { LightingZoneId, ScreenId, ShowPackage, ShowRuntimeState } from '@trust/shared-types';
import { resolveStateAt, type ResolveContext } from './resolve';

/**
 * REVIEW-001 / P1.
 *
 * Zod valida FORMA. Esto valida CONTEXTO.
 *
 * Un show con `lighting.scene: "escena_que_no_existe"` es un JSON perfectamente
 * valido y un show roto: en PREVIS no pasa nada visible, y en el edificio real
 * esa zona se queda en el estado anterior en mitad de un takeover pago.
 *
 * Preflight corre antes de cargar en PREVIS y, en fase CONTROL, antes de
 * publicar a EDGE. Un paquete que no pasa preflight no sale al aire.
 */

export type PreflightSeverity = 'error' | 'warning';

export interface PreflightIssue {
  severity: PreflightSeverity;
  code: string;
  message: string;
  /** Indice del evento en el timeline original, si aplica. */
  eventIndex?: number;
  atMs?: number;
}

export interface PreflightResult {
  ok: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
}

export function preflightShow(show: ShowPackage, ctx: ResolveContext): PreflightResult {
  const issues: PreflightIssue[] = [];

  const screenIds = new Set(ctx.building.screens.map((s) => s.id));
  const zoneIds = new Set(ctx.building.lightingZones.map((z) => z.id));
  const cameraIds = new Set(ctx.building.cameras.map((c) => c.id));

  const err = (code: string, message: string, extra: Partial<PreflightIssue> = {}) =>
    issues.push({ severity: 'error', code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<PreflightIssue> = {}) =>
    issues.push({ severity: 'warning', code, message, ...extra });

  /* ── Estado inicial ─────────────────────────────────────────── */

  if (!ctx.scenes.has(show.initialState.lightingScene)) {
    err(
      'INITIAL_SCENE_NOT_FOUND',
      `La escena inicial "${show.initialState.lightingScene}" no existe en el catalogo.`,
    );
  }
  if (show.initialState.camera && !cameraIds.has(show.initialState.camera)) {
    err('INITIAL_CAMERA_NOT_FOUND', `La camara inicial "${show.initialState.camera}" no existe.`);
  }

  /* ── Media declarada ────────────────────────────────────────── */

  for (const screenId of Object.keys(show.media)) {
    if (!screenIds.has(screenId as never)) {
      err('MEDIA_SCREEN_NOT_FOUND', `El media apunta a la pantalla "${screenId}", que no existe.`);
    }
  }

  /* ── Media groups: membresia del show vs capacidad del edificio ──
   * ADR-013. El show decide quien comparte decoder; el edificio decide quien
   * PUEDE. Un grupo que el edificio no soporta se ve bien en PREVIS y se
   * desincroniza en la esquina, que es el peor lugar para descubrirlo.
   */
  const groupOf = new Map<string, string>();
  for (const [groupId, group] of Object.entries(show.mediaGroups)) {
    const members = Object.keys(group.layout);

    if (members.length < 2) {
      warn('GROUP_SINGLE_MEMBER', `El grupo "${groupId}" tiene una sola pantalla: no aporta frame-lock.`);
    }

    for (const screenId of members) {
      const surface = ctx.building.screens.find((sc) => sc.id === screenId);
      if (!surface) {
        err('GROUP_SCREEN_NOT_FOUND', `El grupo "${groupId}" apunta a "${screenId}", que no existe.`);
        continue;
      }

      const previo = groupOf.get(screenId);
      if (previo) {
        err(
          'SCREEN_IN_MULTIPLE_GROUPS',
          `"${screenId}" esta en los grupos "${previo}" y "${groupId}". Una pantalla tiene un solo decoder.`,
        );
      } else {
        groupOf.set(screenId, groupId);
      }

      for (const other of members) {
        if (other === screenId) continue;
        if (!surface.syncCapableWith.includes(other as never)) {
          err(
            'GROUP_NOT_SYNC_CAPABLE',
            `El grupo "${groupId}" junta "${screenId}" con "${other}", pero el edificio no declara que puedan compartir decoder.`,
          );
        }
      }

      // Aspecto: el recorte tiene que tener la forma fisica de la pantalla.
      const rect = group.layout[screenId as keyof typeof group.layout];
      if (group.canvas && rect) {
        const recortePx = (rect.w * group.canvas.width) / (rect.h * group.canvas.height);
        const fisico = surface.physicalWidthM / surface.physicalHeightM;
        const desvio = Math.abs(recortePx - fisico) / fisico;
        if (desvio > 0.02) {
          err(
            'GROUP_ASPECT_MISMATCH',
            `En "${groupId}", el recorte de "${screenId}" tiene aspecto ${recortePx.toFixed(3)} y la pantalla ${fisico.toFixed(3)}. El contenido se veria estirado ${(desvio * 100).toFixed(1)}%.`,
          );
        }
      }
    }
  }

  /* ── Fuentes de media: guard interino hasta ADR-014 ──
   * Un show no puede apuntar a otro host ni a otro esquema. Solo rutas locales
   * absolutas del propio servidor. No reemplaza a los assetId: impide lo peor
   * mientras tanto (requests a la red interna o a terceros desde el edificio).
   */
  const fuentes: Array<[string, string]> = [
    ...Object.entries(show.media).map(([k, v]) => [`media.${k}`, v] as [string, string]),
    ...Object.entries(show.mediaGroups).map(
      ([k, g]) => [`mediaGroups.${k}`, g.source] as [string, string],
    ),
  ];
  for (const [donde, src] of fuentes) {
    if (!isLocalMediaPath(src)) {
      err(
        'MEDIA_SOURCE_NOT_LOCAL',
        `${donde} apunta a "${src}". Solo se aceptan rutas locales que empiecen con "/" (sin esquema, sin host, sin "..").`,
      );
    }
  }

  /* ── Eventos ────────────────────────────────────────────────── */

  const playedWithoutSource = new Set<string>();

  show.timeline.forEach((event, i) => {
    const where = { eventIndex: i, atMs: event.atMs };

    if (event.atMs > show.durationMs) {
      err(
        'EVENT_AFTER_DURATION',
        `Evento "${event.type}" en ${event.atMs}ms, despues del fin del show (${show.durationMs}ms). Nunca se ejecutaria.`,
        where,
      );
    }

    switch (event.type) {
      case 'lighting.scene': {
        if (!ctx.scenes.has(event.value)) {
          err('SCENE_NOT_FOUND', `La escena "${event.value}" no existe en el catalogo.`, where);
        }
        break;
      }
      case 'lighting.zone.set': {
        if (!zoneIds.has(event.target)) {
          err('ZONE_NOT_FOUND', `La zona "${event.target}" no existe en el edificio.`, where);
        }
        if (
          event.intensity === undefined &&
          event.color === undefined &&
          event.enabled === undefined
        ) {
          warn('ZONE_SET_EMPTY', `lighting.zone.set sobre "${event.target}" no cambia nada.`, where);
        }
        if (event.fadeMs !== undefined && event.atMs + event.fadeMs > show.durationMs) {
          warn(
            'FADE_TRUNCATED',
            `El fade de "${event.target}" (${event.fadeMs}ms) no termina antes del fin del show: queda cortado a mitad.`,
            where,
          );
        }
        break;
      }
      case 'media.play':
      case 'media.pause':
      case 'media.seek':
      case 'media.stop': {
        if (!screenIds.has(event.target)) {
          err('SCREEN_NOT_FOUND', `La pantalla "${event.target}" no existe.`, where);
          break;
        }
        const surface = ctx.building.screens.find((s) => s.id === event.target);
        if (surface && !surface.enabled) {
          warn('SCREEN_DISABLED', `La pantalla "${event.target}" esta deshabilitada.`, where);
        }
        // La fuente puede venir de `media` o de un mediaGroup: se consulta el
        // estado resuelto, no el diccionario crudo.
        if (event.type === 'media.play') {
          const resolved = resolveStateAt(show, ctx, event.atMs, { transport: 'playing' });
          if (!resolved.screens[event.target]?.source) playedWithoutSource.add(event.target);
        }
        break;
      }
      case 'camera.switch': {
        if (!cameraIds.has(event.value)) {
          err('CAMERA_NOT_FOUND', `La camara "${event.value}" no existe.`, where);
        }
        break;
      }
      case 'clock.state':
        break;
    }
  });

  for (const screenId of playedWithoutSource) {
    err(
      'PLAY_WITHOUT_MEDIA',
      `Se reproduce "${screenId}" pero el show no declara media para esa pantalla.`,
    );
  }

  /* ── Invariantes de negocio, sobre el ESTADO RESUELTO ───────── */
  /*
   * REVIEW-002 / P1-7. Antes esto miraba nombres de eventos: el primer
   * media.play de A y B, el ultimo lighting.scene. Eso no ve `fromMs`
   * distintos, ni seeks posteriores, ni un zone.set que vuelve a pintar una
   * zona de marca despues de la escena de cierre.
   *
   * Ahora se evalua el estado que el motor realmente produce, muestreado en
   * todos los puntos de discontinuidad: cada evento, el ms anterior, el ms
   * posterior, y el cierre.
   */
  for (const issue of checkResolvedInvariants(show, ctx)) issues.push(issue);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}

/** Formato de una linea para log o UI. */
export function formatIssue(issue: PreflightIssue): string {
  const at = issue.atMs !== undefined ? ` @${issue.atMs}ms` : '';
  return `[${issue.code}]${at} ${issue.message}`;
}


/* ────────────────────────────────────────────────────────────────
 * Invariantes evaluadas sobre el estado resuelto
 * ──────────────────────────────────────────────────────────────── */

/** Instantes donde el estado puede cambiar: bordes de evento, de fade y cierre. */
export function discontinuityPoints(show: ShowPackage): number[] {
  const points = new Set<number>([0, show.durationMs]);
  for (const e of show.timeline) {
    for (const d of [-1, 0, 1]) {
      const t = e.atMs + d;
      if (t >= 0 && t <= show.durationMs) points.add(t);
    }
    // Fin de fade: es donde una transicion termina de moverse.
    if ('fadeMs' in e && typeof e.fadeMs === 'number') {
      const end = e.atMs + e.fadeMs;
      if (end <= show.durationMs) points.add(end);
    }
  }
  return [...points].sort((a, b) => a - b);
}

/** Zonas que definen la identidad del edificio: no deberian quedar tenidas al cierre. */
const SIGNATURE_ZONES: LightingZoneId[] = ['dome', 'clock'];

function checkResolvedInvariants(show: ShowPackage, ctx: ResolveContext): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const points = discontinuityPoints(show);

  /* Frame-lock A+B: mismo mediaTimeMs en TODO punto donde ambas reproducen. */
  const pair: [ScreenId, ScreenId] = ['screen_a', 'screen_b'];
  let worstDrift = 0;
  let worstAt = 0;
  let bothEverPlaying = false;
  let separateDecodersReported = false;

  for (const t of points) {
    const state = resolveStateAt(show, ctx, t, { transport: 'playing' });
    const a = state.screens[pair[0]];
    const b = state.screens[pair[1]];
    if (!a || !b) continue;
    if (a.cue === 'playing' && b.cue === 'playing') {
      bothEverPlaying = true;
      const drift = Math.abs(a.mediaTimeMs - b.mediaTimeMs);
      if (drift > worstDrift) {
        worstDrift = drift;
        worstAt = t;
      }
      // Fuentes distintas = dos decoders = no hay frame-lock posible.
      // Se reporta una sola vez, pero el barrido sigue: la deriva se mide igual.
      if (!separateDecodersReported && a.source && b.source && a.source !== b.source) {
        separateDecodersReported = true;
        out.push({
          severity: 'warning',
          code: 'SCREENS_SEPARATE_DECODERS',
          atMs: t,
          message: `screen_a y screen_b usan archivos distintos. Dos decoders derivan entre si: para contenido anamorfico usa un mediaGroup con una fuente unica.`,
        });
      }
    }
  }

  // Un frame a 30 fps son 33 ms. Ese es el objetivo, no 120.
  const ONE_FRAME_MS = 33;
  if (bothEverPlaying && worstDrift > ONE_FRAME_MS) {
    out.push({
      severity: 'error',
      code: 'SCREENS_OUT_OF_SYNC',
      atMs: worstAt,
      message: `screen_a y screen_b se separan ${worstDrift}ms (max ${ONE_FRAME_MS}ms = 1 frame). Si el contenido es anamorfico, la ilusion se abre en la ochava.`,
    });
  } else if (bothEverPlaying && worstDrift > 0) {
    out.push({
      severity: 'warning',
      code: 'SCREENS_MINOR_DRIFT',
      atMs: worstAt,
      message: `screen_a y screen_b se separan ${worstDrift}ms. Dentro de un frame, pero revisalo si el contenido es anamorfico.`,
    });
  }

  /* Cierre: el edificio tiene que volver a su identidad, no quedar con la marca. */
  const closing = resolveStateAt(show, ctx, show.durationMs, { transport: 'ended' });
  const canonical = canonicalClosingState(show, ctx);

  for (const zoneId of SIGNATURE_ZONES) {
    const actual = closing.zones[zoneId];
    const expected = canonical.zones[zoneId];
    if (!actual || !expected) continue;
    const delta =
      Math.abs(actual.color.r - expected.color.r) +
      Math.abs(actual.color.g - expected.color.g) +
      Math.abs(actual.color.b - expected.color.b);
    if (delta > 0.15) {
      out.push({
        severity: 'warning',
        code: 'ENDS_IN_TAKEOVER',
        atMs: show.durationMs,
        message: `Al terminar el show, la zona "${zoneId}" no volvio a su estado de identidad. El edificio queda con la iluminacion de la marca despues de que termino la pauta.`,
      });
    }
    if (!actual.enabled) {
      out.push({
        severity: 'warning',
        code: 'ENDS_WITH_ZONE_OFF',
        atMs: show.durationMs,
        message: `La zona "${zoneId}" queda apagada al terminar el show.`,
      });
    }
  }

  /* Ninguna pantalla deberia quedar con contenido congelado al cierre. */
  for (const screen of Object.values(closing.screens)) {
    if (screen.output === 'hold') {
      out.push({
        severity: 'warning',
        code: 'ENDS_ON_FROZEN_FRAME',
        atMs: show.durationMs,
        message: `"${screen.id}" termina con un frame congelado en pantalla en vez de negro.`,
      });
    }
  }

  return out;
}

/** Estado canonico de cierre: el edificio en su escena de identidad. */
function canonicalClosingState(show: ShowPackage, ctx: ResolveContext): ShowRuntimeState {
  return resolveStateAt(
    { ...show, timeline: [], initialState: { ...show.initialState, lightingScene: 'trust_normal' } },
    ctx,
    0,
  );
}


/**
 * Ruta local aceptable para media en SHOW PACKAGE v1. Interino hasta ADR-014.
 *
 * Rechaza: esquemas (http:, https:, file:, data:, blob:, javascript:),
 * protocol-relative ("//host"), barras invertidas, "..", y cualquier cosa que
 * no empiece con "/".
 */
export function isLocalMediaPath(src: string): boolean {
  if (!src.startsWith('/')) return false;
  if (src.startsWith('//')) return false;
  if (src.includes('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  if (src.split('/').some((seg) => seg === '..')) return false;
  // Caracteres de control (0x00-0x1F, 0x7F): nunca legitimos en una ruta.
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}
