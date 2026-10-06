import { z } from 'zod';
import { ElectricalTelemetrySchema, type ElectricalTelemetry } from './contract';

/**
 * Frescura y calidad del dato — M2A.1 / punto 5.
 *
 * El problema que esto resuelve no existe todavía, y por eso hay que
 * resolverlo ahora: cuando EDGE lea Modbus de verdad y el analizador deje de
 * responder, la tentación natural del código es conservar el último valor. El
 * panel entonces muestra 47,3 kW con un punto verde, y nadie se entera de que
 * ese número es de hace veinte minutos.
 *
 * Por eso la metadata de frescura es un sobre SEPARADO de la medida, no un
 * campo más adentro: el estado de la comunicación no es una propiedad de la
 * medición, y mezclarlos es lo que permite que un valor viejo se presente como
 * actual.
 *
 * El último valor SÍ puede mostrarse, etiquetado como "última lectura". Lo que
 * no puede es seguir pareciendo ONLINE.
 */

export const TelemetryQualitySchema = z.enum(['LIVE', 'STALE', 'NO_DATA', 'COMM_ERROR']);
export type TelemetryQuality = z.infer<typeof TelemetryQualitySchema>;

export const TelemetrySampleSchema = z.object({
  /** Instante en que el instrumento tomó la medida. */
  measuredAt: z.number().int().nullable(),
  /** Instante en que el sistema la recibió. Distinto de measuredAt si hay cola. */
  receivedAt: z.number().int().nullable(),
  /** Antigüedad respecto de "ahora", en ms. */
  ageMs: z.number().nonnegative(),
  quality: TelemetryQualitySchema,
  /** Umbral efectivo usado para decidir STALE. */
  staleAfterMs: z.number().int().positive(),
  /**
   * La medida. Puede ser la ÚLTIMA conocida aunque `quality` sea STALE: se
   * muestra como "última lectura", nunca como valor actual.
   */
  telemetry: ElectricalTelemetrySchema.nullable(),
  /** Detalle del error de comunicación, si lo hubo. */
  errorMessage: z.string().nullable().default(null),
});
export type TelemetrySample = z.infer<typeof TelemetrySampleSchema>;

/**
 * Cuánto puede pasar sin una muestra antes de considerar el dato viejo.
 *
 * 5 s con un analizador que publica a 1 Hz: tolera cuatro lecturas perdidas
 * sin alarmar por un hipo de la red, y no tanto como para que un corte real
 * pase inadvertido. Es configurable porque el valor correcto depende de la
 * cadencia real del equipo, que todavía no está elegido.
 */
export const DEFAULT_STALE_AFTER_MS = 5000;

export interface FreshnessInput {
  now: number;
  measuredAt: number | null;
  receivedAt: number | null;
  telemetry: ElectricalTelemetry | null;
  staleAfterMs?: number;
  /** Si la última comunicación falló. Gana sobre cualquier cálculo de edad. */
  commError?: string | null;
}

/**
 * Clasifica una muestra. Función pura del reloj que se le pasa: no llama a
 * Date.now() por dentro, así los tests no necesitan timers.
 */
export function evaluateFreshness(input: FreshnessInput): TelemetrySample {
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const base = {
    measuredAt: input.measuredAt,
    receivedAt: input.receivedAt,
    staleAfterMs,
    telemetry: input.telemetry,
  };

  // Un error de comunicación manda, aunque haya un valor reciente en memoria.
  if (input.commError) {
    return TelemetrySampleSchema.parse({
      ...base,
      ageMs: input.measuredAt === null ? 0 : Math.max(0, input.now - input.measuredAt),
      quality: 'COMM_ERROR',
      errorMessage: input.commError,
    });
  }

  if (input.telemetry === null || input.measuredAt === null) {
    return TelemetrySampleSchema.parse({
      ...base,
      measuredAt: null,
      ageMs: 0,
      quality: 'NO_DATA',
      errorMessage: null,
    });
  }

  const ageMs = Math.max(0, input.now - input.measuredAt);
  return TelemetrySampleSchema.parse({
    ...base,
    ageMs,
    quality: ageMs > staleAfterMs ? 'STALE' : 'LIVE',
    errorMessage: null,
  });
}

/** Solo un dato LIVE puede presentarse como valor actual. */
export function isUsableAsCurrent(sample: TelemetrySample): boolean {
  return sample.quality === 'LIVE' && sample.telemetry !== null;
}

/** Etiqueta para la UI. Nunca dice "actual" si no lo es. */
export function freshnessLabel(sample: TelemetrySample): string {
  switch (sample.quality) {
    case 'LIVE':
      return 'en vivo';
    case 'STALE':
      return `última lectura hace ${(sample.ageMs / 1000).toFixed(0)} s`;
    case 'COMM_ERROR':
      return 'error de comunicación';
    case 'NO_DATA':
      return 'sin datos';
  }
}

/* ────────────────────────────────────────────────────────────────
 * Ventana de series — M2A.2 / punto 4
 * ──────────────────────────────────────────────────────────────── */

export interface SeriesWindow {
  /** Inicio de la ventana pedida. */
  fromMs: number;
  /** Último instante con dato REAL. Nunca posterior a `measuredAt`. */
  toMs: number;
  /** Tramo sin datos: desde el último dato hasta ahora. null si está en vivo. */
  gap: { fromMs: number; toMs: number } | null;
  /** Fracción del ancho del gráfico que ocupa el hueco, 0..1. */
  gapFraction: number;
  /** Si no hay ningún dato que graficar. */
  empty: boolean;
}

/**
 * Recorta la ventana de un gráfico a lo que realmente se midió.
 *
 * M2A.2 / punto 4. Con el enlace caído, generar puntos hasta "ahora" es
 * inventar historia: la curva seguiría dibujándose prolija mientras el
 * medidor no responde, que es la forma más elegante de mentir en un panel.
 *
 * La serie se congela en `measuredAt` y el tramo posterior se representa como
 * período sin datos, no como línea.
 */
export function resolveSeriesWindow(
  nowMs: number,
  rangeMs: number,
  sample: TelemetrySample | null,
): SeriesWindow {
  const fromMs = nowMs - rangeMs;

  if (!sample || sample.telemetry === null || sample.measuredAt === null) {
    return { fromMs, toMs: fromMs, gap: { fromMs, toMs: nowMs }, gapFraction: 1, empty: true };
  }

  /*
   * M2A.3 / punto 2. La serie termina en `measuredAt`, SIEMPRE — tambien con
   * calidad LIVE.
   *
   * `staleAfterMs` define cuando el dato deja de considerarse actual; no
   * autoriza a dibujar mediciones que no existen. Con tolerancia de 5 s y una
   * lectura de hace 4 s, el dato es LIVE y aun asi no hay nada medido en esos
   * 4 s: extender la curva hasta "ahora" seria inventar cuatro segundos de
   * historia solo porque todavia no vencio el plazo.
   */
  const toMs = Math.min(sample.measuredAt, nowMs);
  if (toMs <= fromMs) {
    return { fromMs, toMs: fromMs, gap: { fromMs, toMs: nowMs }, gapFraction: 1, empty: true };
  }
  // Sin hueco solo si la medicion es de este mismo instante.
  const gap = toMs < nowMs ? { fromMs: toMs, toMs: nowMs } : null;
  return {
    fromMs,
    toMs,
    gap,
    gapFraction: gap ? Math.min(1, Math.max(0, (nowMs - toMs) / rangeMs)) : 0,
    empty: false,
  };
}
