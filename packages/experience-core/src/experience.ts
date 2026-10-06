import { z } from 'zod';

/**
 * CLIENT EXPERIENCE — núcleo.
 *
 * Esto NO es otro panel. Es la capa de presentación para mostrarle el edificio
 * a una dirección de marketing, y por eso su criterio de diseño es distinto
 * del de CONTROL: donde el panel operativo muestra todo lo que puede fallar,
 * la presentación muestra lo que el edificio puede hacer.
 *
 * Lo que NO cambia es quién manda: `ShowEngine` sigue siendo la única verdad.
 * La experiencia no resuelve shows, no interpola, no inventa estados. Recibe
 * `ShowRuntimeState` y lo pinta bonito. Si alguna vez calcula por su cuenta
 * qué debería verse, deja de ser una presentación del producto y pasa a ser
 * una animación que se le parece — que es exactamente lo que no se le quiere
 * mostrar a un cliente.
 */

/* ────────────────────────────────────────────────────────────────
 * Vistas
 * ──────────────────────────────────────────────────────────────── */

export const ExperienceViewSchema = z.enum([
  'HERO_CORNER',
  'CORRIENTES',
  'PELLEGRINI',
  'OBELISCO_WIDE',
]);
export type ExperienceView = z.infer<typeof ExperienceViewSchema>;

export interface ViewSpec {
  id: ExperienceView;
  label: string;
  /** Qué se ve desde ahí, en una línea, para el cliente. */
  caption: string;
  /** Fachada lateral: hoy son recortes del plano de la esquina. */
  lateral?: boolean;
  /**
   * Extensión 16:9 del master (opcional). Su franja central es el master a la
   * misma escala: se dibuja debajo sin alterar la geometría de las pantallas.
   */
  ext169?: string;
  /** Fondo. Ruta LOCAL: la presentación tiene que correr sin internet. */
  background: string;
  /** Superficies visibles desde este punto de vista. */
  surfaces: Array<'screen_a' | 'screen_b' | 'horizontal'>;
  /** Visible en la barra principal. OBELISCO_WIDE es secundaria. */
  primary: boolean;
}

/**
 * Los fondos son FOTOGRAFÍAS REALES del edificio (M2C.2.1 / punto 1).
 *
 * `hero-corner` y las dos vistas de fachada salen de la misma toma nocturna de
 * la ochava; `obelisco-wide` del plano general desde la 9 de Julio. En la foto
 * se ve la pantalla horizontal existente con contenido real: la composición
 * la cubre por completo con los dos segmentos de su superficie.
 *
 * Las pantallas superiores todavía no están instaladas, así que su posición en
 * `VIEW_GEOMETRY` es una PROPUESTA de emplazamiento y no un relevamiento.
 */
export const EXPERIENCE_VIEWS: Record<ExperienceView, ViewSpec> = {
  HERO_CORNER: {
    id: 'HERO_CORNER',
    ext169: '/experience/hero-corner-169.jpg',
    label: 'Hero Corner',
    caption: 'La ochava desde la 9 de Julio. Las tres superficies a la vez.',
    background: '/experience/hero-corner.jpg',
    surfaces: ['screen_a', 'screen_b', 'horizontal'],
    primary: true,
  },
  CORRIENTES: {
    id: 'CORRIENTES',
    lateral: true,
    label: 'Corrientes',
    caption: 'Frente sobre Corrientes. Pantalla superior A y horizontal.',
    background: '/experience/corrientes.jpg',
    surfaces: ['screen_a', 'horizontal'],
    primary: true,
  },
  PELLEGRINI: {
    id: 'PELLEGRINI',
    lateral: true,
    label: 'Pellegrini',
    caption: 'Frente sobre Carlos Pellegrini. Pantalla superior B.',
    background: '/experience/pellegrini.jpg',
    surfaces: ['screen_b', 'horizontal'],
    primary: true,
  },
  OBELISCO_WIDE: {
    id: 'OBELISCO_WIDE',
    label: 'Obelisco',
    caption: 'Plano general con el Obelisco en cuadro.',
    background: '/experience/obelisco-wide.jpg',
    surfaces: ['screen_a', 'screen_b', 'horizontal'],
    primary: false,
  },
};

export const DEFAULT_VIEW: ExperienceView = 'HERO_CORNER';

/**
 * Vistas laterales ocultas — M2C.2.2 / PRESENTATION MODE. Corrientes y
 * Pellegrini son recortes de la foto de la esquina: hasta tener masters
 * propios, el selector ejecutivo muestra solo HERO CORNER.
 */
export const SHOW_LATERAL_VIEWS = false;

export function viewList(onlyPrimary = false, includeLateral = SHOW_LATERAL_VIEWS): ViewSpec[] {
  const todas = Object.values(EXPERIENCE_VIEWS);
  const base = onlyPrimary ? todas.filter((v) => v.primary) : todas;
  return includeLateral ? base : base.filter((v) => v.id === DEFAULT_VIEW || !v.lateral);
}

/* ────────────────────────────────────────────────────────────────
 * Assets: todo local, sin excepción
 * ──────────────────────────────────────────────────────────────── */

/** Clips que la presentación necesita además de los fondos. */
/**
 * Creatividad de CAMPAÑA para Client Mode — sustitución de presentación.
 *
 * El ShowPackage no cambia: sigue referenciando los clips de prueba, que son
 * los que usan el Builder y los tests internos. La experiencia ejecutiva los
 * reemplaza al DIBUJAR por la pieza de campaña, así delante del cliente nunca
 * aparece un timecode ni un patrón de prueba.
 *
 * Los archivos de campaña son huecos con nombre propio: cuando la agencia
 * entregue el spot real, se reemplazan esos dos `.mp4` y no se toca nada más.
 * Formatos: torres 2592×576 (A+B en un solo lienzo), marquesina 1920×412.
 */
export const CAMPAIGN_MEDIA: Readonly<Record<string, string>> = {
  '/demo/test_towers_master.mp4': '/experience/campaign/mcd_towers_master.mp4',
  '/demo/test_horizontal.mp4': '/experience/campaign/mcd_horizontal.mp4',
};

/** Fuente que se muestra en Client Mode para una fuente del ShowPackage. */
export function presentationSource(source: string | null): string | null {
  if (!source) return source;
  return CAMPAIGN_MEDIA[source] ?? source;
}

/** Clips que la presentación precarga y calienta: los de campaña. */
export const EXPERIENCE_MEDIA: string[] = Object.values(CAMPAIGN_MEDIA);

/** Todo lo que tiene que estar en memoria antes de habilitar PLAY. */
export function requiredAssets(): string[] {
  return [...Object.values(EXPERIENCE_VIEWS).map((v) => v.background), ...EXPERIENCE_MEDIA];
}

/**
 * Una presentación en una sala de reuniones no puede depender del wifi del
 * cliente. Esta regla no es una preferencia: un asset remoto que no carga
 * delante de una dirección de marketing arruina la reunión entera, y no hay
 * segunda oportunidad para esa demo.
 */
export function isLocalExperienceAsset(src: string): boolean {
  if (!src.startsWith('/')) return false;
  if (src.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  if (src.split('/').some((seg) => seg === '..')) return false;
  return true;
}

export function nonLocalAssets(sources: readonly string[] = requiredAssets()): string[] {
  return sources.filter((s) => !isLocalExperienceAsset(s));
}

/* ────────────────────────────────────────────────────────────────
 * Brand moments (accesos de UX, no estados nuevos del motor)
 * ──────────────────────────────────────────────────────────────── */

export const BrandMomentSchema = z.enum(['NORMAL', 'LAUNCH', 'EVENT', 'TAKEOVER', 'SIGNATURE']);
export type BrandMoment = z.infer<typeof BrandMomentSchema>;

export interface BrandMomentSpec {
  id: BrandMoment;
  label: string;
  /** Qué vende, en una línea. */
  pitch: string;
  /**
   * Id del preset de draft existente. NO son estados nuevos del ShowEngine:
   * son atajos a shows que ya se pueden autorar en el Builder.
   */
  presetId: string;
  /** Instante del show de 15 s al que saltar cuando aplica. null = desde 0. */
  seekToMs: number | null;
}

export const BRAND_MOMENTS: Record<BrandMoment, BrandMomentSpec> = {
  NORMAL: {
    id: 'NORMAL',
    label: 'Normal',
    pitch: 'El edificio en su identidad. Lo que construye el valor de la esquina.',
    presetId: 'ICONIC_15S',
    seekToMs: null,
  },
  LAUNCH: {
    id: 'LAUNCH',
    label: 'Launch',
    pitch: 'Aparición de marca: las superficies se suman de a una.',
    presetId: 'BRAND_REVEAL_15S',
    seekToMs: null,
  },
  EVENT: {
    id: 'EVENT',
    label: 'Event',
    pitch: 'Fechas especiales y cuentas regresivas.',
    presetId: 'EVENT_30S',
    seekToMs: null,
  },
  TAKEOVER: {
    id: 'TAKEOVER',
    label: 'Takeover',
    pitch: 'Campaña completa: tres superficies digitales en un solo momento sincronizado.',
    presetId: 'MCDONALDS_15S',
    seekToMs: null,
  },
  SIGNATURE: {
    id: 'SIGNATURE',
    label: 'Signature',
    pitch: 'El cierre: la marca y el edificio en la misma imagen.',
    presetId: 'MCDONALDS_15S',
    seekToMs: 12_000,
  },
};

/** El preset con el que arranca la demo. */
export const DEMO_PRESET_ID = 'MCDONALDS_15S';

/* ────────────────────────────────────────────────────────────────
 * Contenido de la presentación
 * ──────────────────────────────────────────────────────────────── */

export interface PitchBlock {
  title: string;
  body: string;
  /** Capacidad que todavía no existe. Se marca; no se insinúa que está. */
  planned?: boolean;
}

/**
 * FINAL POLISH: tres argumentos, solo lo que se puede sostener HOY.
 * Iluminación arquitectónica y reloj NO se venden como instalados: viven en
 * HOW IT WORKS como «next phase / ready for integration».
 */
export const WHY_BLOCKS: PitchBlock[] = [
  {
    title: 'LOCATION',
    body: 'Una de las esquinas más emblemáticas de Buenos Aires.',
  },
  {
    title: 'IMPACT',
    body: 'Tres superficies digitales coordinadas sobre un único edificio.',
  },
  {
    title: 'PLATFORM',
    body: 'Crear, previsualizar, aprobar, operar y medir desde un mismo sistema.',
  },
];

/** Mensaje principal de la home ejecutiva. */
export const HOME_HEADLINE = '3 superficies digitales · 1 momento sincronizado';

/**
 * Acciones de la end card. Viven acá y no sueltas en el JSX para que el texto
 * que ve el cliente esté cubierto por tests: es la última pantalla de la
 * presentación y la que queda proyectada mientras se conversa.
 */
export const END_CARD_ACTIONS = { replay: 'VER DE NUEVO', back: 'VOLVER' } as const;

export const END_CARD_BLOCKS: PitchBlock[] = [
  {
    title: 'BRAND DOMINANCE',
    body: 'El edificio como una sola pieza de marca.',
  },
  {
    title: 'REAL-TIME MOMENTS',
    body: 'Lanzamientos, eventos y activaciones relevantes.',
  },
  {
    title: 'MEASUREMENT',
    body: 'Proof of Play y disponibilidad. Audience Analytics — future capability.',
    planned: true,
  },
];

/**
 * Lo que la experiencia dice sobre sí misma.
 *
 * No se insinúa que haya hardware conectado. El cliente va a preguntar, y la
 * respuesta tiene que estar escrita antes de que pregunte: una demo que se
 * presenta como sistema en vivo y después resulta ser una simulación quema la
 * confianza en todo lo demás que se dijo en esa reunión.
 */
export const TRANSPARENCY_BADGE = 'CAMPAIGN PREVIEW';
export const TRANSPARENCY_CAPTION = 'Visualización conceptual';
export const TRANSPARENCY_TECHNICAL =
  'Control físico e integración EDGE en etapa de implementación.';

/**
 * Lo único que se muestra en la home. El detalle de implementación va en
 * HOW IT WORKS: en la pantalla principal distrae de lo que se está mostrando.
 */
export const HOME_DISCLAIMER = 'CAMPAIGN PREVIEW · VISUALIZACIÓN CONCEPTUAL';

/* ────────────────────────────────────────────────────────────────
 * Estado de la sesión de presentación
 * ──────────────────────────────────────────────────────────────── */

export type ExperiencePhase = 'LOADING' | 'READY' | 'PLAYING' | 'PAUSED' | 'ENDED';

/** BEFORE muestra el edificio sin campaña. Es un recurso VISUAL, no del motor. */
export type ComparisonMode = 'BEFORE' | 'TAKEOVER';

export interface ExperienceState {
  phase: ExperiencePhase;
  view: ExperienceView;
  brandMoment: BrandMoment;
  comparison: ComparisonMode;
  cinema: boolean;
  audioEnabled: boolean;
  /** Assets efectivamente cargados. */
  loaded: string[];
  /**
   * Assets que fallaron al cargar.
   *
   * M2C.2.1 / punto 6: antes un `onerror` contaba igual que un `onload` —el
   * handler marcaba "listo" en ambos casos—, así que READY TO PRESENT podía
   * encenderse con el Hero Corner roto. El fallo delante del cliente llegaba
   * recién al apretar PLAY.
   */
  failed: string[];
  /** Assets que se sirven desde un reemplazo local verificado. */
  fallbacks: Record<string, string>;
}

export const INITIAL_EXPERIENCE: ExperienceState = {
  phase: 'LOADING',
  view: DEFAULT_VIEW,
  brandMoment: 'TAKEOVER',
  comparison: 'TAKEOVER',
  cinema: false,
  audioEnabled: false,
  loaded: [],
  failed: [],
  fallbacks: {},
};

export type PreloadState = Pick<ExperienceState, 'loaded' | 'failed' | 'fallbacks'>;

/** Un asset requerido está resuelto si cargó, o si su fallback local cargó. */
export function isAssetSatisfied(state: PreloadState, asset: string): boolean {
  if (state.loaded.includes(asset)) return true;
  const fb = state.fallbacks[asset];
  return Boolean(fb) && state.loaded.includes(fb!);
}

/**
 * Todos los assets requeridos están realmente disponibles.
 *
 * Un asset que falló NO cuenta, salvo que exista un reemplazo local que sí
 * cargó. Si falta el Hero Corner, no hay READY: es la vista por defecto, y
 * abrir la presentación sobre un rectángulo vacío es peor que demorar.
 */
export function isReadyToPresent(state: PreloadState): boolean {
  return requiredAssets().every((a) => isAssetSatisfied(state, a));
}

/** Assets requeridos que fallaron y no tienen reemplazo. Para el modo operador. */
export function blockingAssets(state: PreloadState): string[] {
  return requiredAssets().filter((a) => !isAssetSatisfied(state, a));
}

/** Requeridos que andan por fallback. Se muestra solo en debug, nunca al cliente. */
export function fallbackAssets(state: PreloadState): string[] {
  return requiredAssets().filter((a) => !state.loaded.includes(a) && isAssetSatisfied(state, a));
}

/** Registra el resultado de cargar un asset. */
export function markLoaded(state: PreloadState, asset: string): PreloadState {
  return {
    ...state,
    loaded: state.loaded.includes(asset) ? state.loaded : [...state.loaded, asset],
    failed: state.failed.filter((a) => a !== asset),
  };
}

export function markFailed(state: PreloadState, asset: string): PreloadState {
  return {
    ...state,
    loaded: state.loaded.filter((a) => a !== asset),
    failed: state.failed.includes(asset) ? state.failed : [...state.failed, asset],
  };
}

/**
 * Si PLAY se puede presionar.
 *
 * Un primer playback con el video buscando datos es un parpadeo negro delante
 * del cliente. Se prefiere que el botón tarde en habilitarse a que el show
 * arranque mal.
 */
export function canPlay(state: ExperienceState): boolean {
  return isReadyToPresent(state) && state.phase !== 'LOADING';
}

/**
 * STOP está SIEMPRE disponible.
 *
 * No depende de la precarga, ni del modo cinema, ni de que el draft sea
 * válido: es la única salida segura. Un preview que no se puede parar delante
 * de un cliente es peor que no tener preview, y por eso la regla vive acá y no
 * como un `disabled` suelto en el JSX, donde cualquiera puede agregarle una
 * condición sin darse cuenta.
 */
export function canStop(state: ExperienceState): boolean {
  // El parámetro se recibe a propósito aunque no se use: la firma es la misma
  // que la de `canPlay`, así que la UI las llama igual y nadie se tienta con
  // agregarle una condición a STOP.
  void state;
  return true;
}

/** Progreso de precarga, 0..1. Para la barra de READY TO PRESENT. */
export function loadProgress(state: PreloadState): number {
  const req = requiredAssets();
  if (req.length === 0) return 1;
  return req.filter((a) => isAssetSatisfied(state, a)).length / req.length;
}

/**
 * Cambiar de vista NO toca el show.
 *
 * Es la propiedad que hace que la comparación entre frentes sirva: el cliente
 * ve el MISMO instante desde otro ángulo. Si cambiar de vista reiniciara el
 * show, estaría viendo dos momentos distintos y comparando nada.
 */
export function setView(state: ExperienceState, view: ExperienceView): ExperienceState {
  return { ...state, view };
}

export function setComparison(state: ExperienceState, comparison: ComparisonMode): ExperienceState {
  return { ...state, comparison };
}

export function enterCinema(state: ExperienceState): ExperienceState {
  return { ...state, cinema: true };
}

export function exitCinema(state: ExperienceState): ExperienceState {
  return { ...state, cinema: false };
}

/**
 * Estado al que vuelve DEMO RESET: listo para presentar de nuevo, en un click.
 *
 * Conserva `loaded` a propósito — los assets ya están en memoria y volver a
 * LOADING obligaría a esperar otra vez delante del cliente.
 */
export function demoReset(state: ExperienceState): ExperienceState {
  return {
    ...INITIAL_EXPERIENCE,
    loaded: state.loaded,
    failed: state.failed,
    fallbacks: state.fallbacks,
    phase: isReadyToPresent(state) ? 'READY' : 'LOADING',
  };
}

/** Atajos de teclado. Documentados acá para que UI y tests no diverjan. */
export const SHORTCUTS: Record<string, 'reset' | 'playPause' | 'exitCinema'> = {
  r: 'reset',
  R: 'reset',
  ' ': 'playPause',
  Escape: 'exitCinema',
};

export function shortcutFor(key: string): 'reset' | 'playPause' | 'exitCinema' | null {
  return SHORTCUTS[key] ?? null;
}

/* ────────────────────────────────────────────────────────────────
 * Aplicar un Brand Moment — M2C.2.1 / punto 7
 * ──────────────────────────────────────────────────────────────── */

export interface BrandMomentAction {
  /** Preset a cargar en el motor. */
  presetId: string;
  /** Instante al que posicionarse, o null para dejarlo en 0. */
  seekToMs: number | null;
  /**
   * Tras aplicarlo el show queda PAUSADO, no reproduciendo: un Brand Moment es
   * una imagen para mostrar y comentar, no un playback.
   */
  pauseAfterSeek: boolean;
}

/**
 * Qué hay que hacerle al motor al elegir un Brand Moment.
 *
 * `BRAND_MOMENTS.SIGNATURE` declaraba `seekToMs: 12000` y la UI lo ignoraba:
 * al elegir SIGNATURE el show arrancaba desde NORMAL y el cliente veía
 * cualquier cosa menos el Signature. La decisión se resuelve acá, pura, y la
 * UI la ejecuta.
 */
export function brandMomentAction(moment: BrandMoment): BrandMomentAction {
  const spec = BRAND_MOMENTS[moment];
  return {
    presetId: spec.presetId,
    seekToMs: spec.seekToMs,
    pauseAfterSeek: spec.seekToMs !== null,
  };
}

/* ────────────────────────────────────────────────────────────────
 * DEMO CHECK — M2C.2.1 / punto 11
 * ──────────────────────────────────────────────────────────────── */

export type DemoCheckId =
  | 'hero_master'
  | 'views'
  | 'media'
  | 'fonts'
  | 'show_package'
  | 'preflight'
  | 'playback'
  | 'backup_video'
  | 'renderer';

export interface DemoCheckItem {
  id: DemoCheckId;
  label: string;
  /** false = bloquea la presentación. */
  required: boolean;
}

export const DEMO_CHECKS: DemoCheckItem[] = [
  { id: 'hero_master', label: 'Master Hero Corner', required: true },
  { id: 'views', label: 'Vistas Corrientes y Pellegrini', required: true },
  { id: 'media', label: 'Videos de las pantallas', required: true },
  { id: 'fonts', label: 'Tipografías locales', required: false },
  { id: 'show_package', label: 'ShowPackage compilado', required: true },
  { id: 'preflight', label: 'Preflight sin errores', required: true },
  { id: 'playback', label: 'Reproducción de prueba', required: true },
  /*
   * M2C.2.3 / 12: el renderer tiene que entregar frame con el MISMO decoder
   * que usa PLAY, y el respaldo tiene que ser reproducible. Los dos pasan a
   * requeridos: PRESENTATION READY no se da sin plan B.
   */
  { id: 'renderer', label: 'Renderer entrega frame', required: true },
  { id: 'backup_video', label: 'Video de respaldo', required: true },
];

export interface DemoCheckResult {
  id: DemoCheckId;
  ok: boolean;
  detail: string;
}

export interface DemoCheckReport {
  /** Solo si TODO lo requerido pasó. */
  status: 'PRESENTATION READY' | 'NOT READY';
  results: DemoCheckResult[];
  failures: DemoCheckResult[];
  /** Fallas de cosas no requeridas: se presenta igual, con menos red. */
  warnings: DemoCheckResult[];
}

/**
 * Consolida los resultados de las pruebas locales.
 *
 * Se ejecuta ANTES de la reunión, no durante. La alternativa —descubrir que un
 * master no carga con la gente sentada— no es recuperable.
 */
export function demoCheckReport(results: readonly DemoCheckResult[]): DemoCheckReport {
  const porId = new Map(results.map((r) => [r.id, r]));
  const completos: DemoCheckResult[] = DEMO_CHECKS.map(
    (c) => porId.get(c.id) ?? { id: c.id, ok: false, detail: 'sin ejecutar' },
  );
  const requerido = (id: DemoCheckId) => DEMO_CHECKS.find((c) => c.id === id)?.required ?? false;

  const failures = completos.filter((r) => !r.ok && requerido(r.id));
  const warnings = completos.filter((r) => !r.ok && !requerido(r.id));

  return {
    status: failures.length === 0 ? 'PRESENTATION READY' : 'NOT READY',
    results: completos,
    failures,
    warnings,
  };
}

/* ────────────────────────────────────────────────────────────────
 * BACKUP VIDEO — M2C.2.1 / punto 12
 * ──────────────────────────────────────────────────────────────── */

/**
 * Plan B local: si el renderer interactivo falla en la reunión, esto reproduce
 * un MP4 del show a pantalla completa. No es una capacidad del producto, es un
 * seguro — por eso el acceso es de operador y no está en la UI del cliente.
 */
export const BACKUP_VIDEO = '/experience/backup-15s.mp4';

