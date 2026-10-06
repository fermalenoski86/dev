import type { ShowRuntimeState } from '@trust/shared-types';
import {
  DEMO_INSTALLATION,
  PHASES,
  alarmKey,
  freshnessLabel,
  phaseLoadPercent,
  phaseOf,
  type ElectricalAlarmThresholds,
  type InstallationSpec,
  type TelemetrySample,
  type TrackedAlarm,
} from '@trust/telemetry';
import type { EventLog, TrustEvent } from './events';
import type { BuildingMode, Subsystem } from './system';
import type { EffectiveMode } from './modes';

/**
 * TRUST AI ASSISTANT — contexto y respuesta.
 *
 * ══════════════════════════════════════════════════════════════════
 *  LLM output is advisory only and cannot directly actuate building
 *  hardware.
 * ══════════════════════════════════════════════════════════════════
 *
 * Esa regla no se sostiene sola con un comentario. Acá se sostiene con la
 * forma de los tipos: el asistente recibe un `AiContext` —datos ya
 * serializados, sin referencias a `ShowEngine`, al provider ni a nada
 * accionable— y devuelve texto. No hay un canal por el cual una respuesta
 * pueda convertirse en una acción, porque no existe el tipo que lo permitiría.
 *
 * Si mañana alguien quiere que la IA ejecute algo, va a tener que agregar ese
 * tipo a propósito, y eso es una decisión visible en un diff, no un accidente.
 *
 * ── M2A.1 / punto 4 ──────────────────────────────────────────────
 *
 * El asistente tampoco puede tener CRITERIO TÉCNICO PROPIO. Antes traía sus
 * umbrales hardcodeados (15/25 % de desequilibrio, 0,92/0,85 de factor de
 * potencia) y afirmaba cosas como "riesgo de penalización en factura".
 *
 * Dos problemas distintos, ambos graves:
 *
 *  1. **Duplicación de criterio.** Cambiar `DEMO_THRESHOLDS` dejaba al
 *     asistente evaluando con los viejos. Dos fuentes de verdad sobre cuándo
 *     algo está mal, y la que le habla al operador es la que nadie actualiza.
 *  2. **Afirmaciones sin base.** La penalización por bajo factor de potencia
 *     depende del cuadro tarifario de la distribuidora, que no está cargado
 *     en ningún lado. Decirlo igual es inventar una consecuencia económica.
 *
 * Ahora `evaluateAlarms()` es la única autoridad. El contexto trae el
 * resultado de esa evaluación y el asistente solo lo explica. Cuando no hay
 * regla configurada para algo, lo dice.
 */

/** Condición evaluada por `evaluateAlarms`, tal cual. El AI no la reinterpreta. */
export interface AiContextAlarm {
  key: string;
  code: string;
  metric: string;
  severity: string;
  phase: string | null;
  value: number;
  unit: string;
  /** Umbral CONFIGURADO que se cruzó. Es el criterio, no una opinión del AI. */
  threshold: number;
  message: string;
  acknowledged: boolean;
  firstSeenAt: number;
}

/**
 * Qué reglas existen configuradas. Permite que el asistente distinga
 * "está bien" de "nadie definió qué sería estar mal".
 */
export interface AiContextRules {
  /** Métricas con umbral configurado en `ElectricalAlarmThresholds`. */
  configuredMetrics: string[];
  /**
   * Los umbrales en uso son valores DEMO, no de ingeniería. El asistente tiene
   * que poder decirlo.
   */
  thresholdsAreDemo: boolean;
  /**
   * Cuadro tarifario cargado. Hoy null: sin esto no se puede afirmar nada
   * sobre penalizaciones ni costos en factura.
   */
  tariff: null;
}

export interface AiContextEnergy {
  available: boolean;
  simulated: boolean;
  /** Calidad del dato. Si no es LIVE, el valor es una última lectura. */
  quality: string;
  freshness: string;
  ageMs: number;
  deviceId: string | null;
  timestamp: number | null;
  activePowerKw: number | null;
  apparentPowerKva: number | null;
  reactivePowerKvar: number | null;
  powerFactor: number | null;
  frequencyHz: number | null;
  energyTodayKwh: number | null;
  energyMonthKwh: number | null;
  energyTotalKwh: number | null;
  peakDemandKw: number | null;
  /** Aproximación operativa, NO el valor fiscal de la distribuidora. */
  peakDemandIsApproximate: true;
  contractedPowerKw: number;
  demandPercentOfContracted: number | null;
  voltageImbalancePercent: number | null;
  currentImbalancePercent: number | null;
  phases: Array<{
    id: 'A' | 'B' | 'C';
    line: 'L1' | 'L2' | 'L3';
    voltageV: number;
    currentA: number;
    activePowerKw: number;
    loadPercent: number;
    thdVoltagePercent: number | null;
  }>;
  mostLoadedPhase: 'L1' | 'L2' | 'L3' | null;
  activeAlarms: AiContextAlarm[];
  rules: AiContextRules;
}

export interface AiContext {
  /** Siempre presente y siempre true en Milestone 2A. */
  readonly advisoryOnly: true;
  generatedAt: number;
  dataIsSimulated: boolean;

  building: {
    id: string;
    /** Lo que el operador pidió. */
    requestedMode: BuildingMode;
    /** Lo que el estado simulado muestra realmente. Puede diferir. */
    effectiveMode: BuildingMode | null;
    modeMatches: boolean;
    modeExplanation: string;
    safeMode: boolean;
    operatingState: 'NORMAL' | 'DEGRADED_OFFLINE' | 'SAFE_MODE';
  };

  show: {
    id: string | null;
    name: string | null;
    transport: 'stopped' | 'playing' | 'paused' | 'ended';
    timeMs: number;
    durationMs: number;
    lightingSceneId: string | null;
    clockState: string | null;
    screens: Array<{ id: string; cue: string; output: string; mediaTimeMs: number; source: string | null }>;
    lightingZones: Array<{ id: string; intensity: number; enabled: boolean }>;
  };

  /** Dos ejes separados: intención del show y salud del dispositivo físico. */
  subsystems: Array<{
    id: string;
    label: string;
    logicalState: string;
    health: string;
    provenance: string;
    detail: string;
    healthDetail: string;
  }>;
  /** False en M2A: ningún dispositivo del edificio está verificado. */
  anyDeviceVerified: boolean;

  energy: AiContextEnergy;

  events: {
    windowMs: number;
    total: number;
    unacknowledged: number;
    recent: Array<{ timestamp: number; category: string; severity: string; source: string; message: string }>;
  };
}

export interface AiContextInput {
  now: number;
  buildingId: string;
  mode: BuildingMode;
  effectiveMode: EffectiveMode;
  safeMode: boolean;
  controlReachable: boolean;
  show: ShowRuntimeState | null;
  showId: string | null;
  showName: string | null;
  showDurationMs: number;
  transport: 'stopped' | 'playing' | 'paused' | 'ended';
  subsystems: readonly Subsystem[];
  sample: TelemetrySample | null;
  /** Alarmas con ciclo de vida, tal cual las produjo el registro. */
  alarms: readonly TrackedAlarm[];
  thresholds: ElectricalAlarmThresholds;
  log: EventLog;
  spec?: InstallationSpec;
  /** Ventana de eventos a incluir. Por defecto 24 h. */
  eventWindowMs?: number;
  maxEvents?: number;
}

const LINE_OF: Record<'A' | 'B' | 'C', 'L1' | 'L2' | 'L3'> = { A: 'L1', B: 'L2', C: 'L3' };

/**
 * Arma el objeto que más adelante se le va a mandar a un LLM.
 *
 * Es solo datos: números, strings y booleanos. Nada de funciones ni handles.
 * Eso también evita el otro riesgo, menos obvio que el de la actuación: que se
 * filtre a un tercero algo que no corresponde. Lo que no está acá no se manda.
 */
export function buildAiContext(input: AiContextInput): AiContext {
  const spec = input.spec ?? DEMO_INSTALLATION;
  const windowMs = input.eventWindowMs ?? 86_400_000;
  const maxEvents = input.maxEvents ?? 50;
  const sample = input.sample;
  const t = sample?.telemetry ?? null;

  const phases = t
    ? PHASES.map((id) => {
        const p = phaseOf(t, id);
        return {
          id,
          line: LINE_OF[id],
          voltageV: p.voltageV,
          currentA: p.currentA,
          activePowerKw: p.activePowerKw,
          loadPercent: Number(phaseLoadPercent(p, spec).toFixed(1)),
          thdVoltagePercent: p.thdVoltagePercent,
        };
      })
    : [];

  const mostLoaded = phases.length
    ? phases.reduce((a, b) => (b.currentA > a.currentA ? b : a)).line
    : null;

  const recent = input.log
    .since(input.now - windowMs)
    .slice(0, maxEvents)
    .map((e: TrustEvent) => ({
      timestamp: e.timestamp,
      category: e.category,
      severity: e.severity,
      source: e.source,
      message: e.message,
    }));

  return {
    advisoryOnly: true,
    generatedAt: input.now,
    dataIsSimulated: t?.simulated ?? true,

    building: {
      id: input.buildingId,
      requestedMode: input.effectiveMode.requested,
      effectiveMode: input.effectiveMode.effective,
      modeMatches: input.effectiveMode.matches,
      modeExplanation: input.effectiveMode.explanation,
      safeMode: input.safeMode,
      operatingState: input.safeMode
        ? 'SAFE_MODE'
        : input.controlReachable
          ? 'NORMAL'
          : 'DEGRADED_OFFLINE',
    },

    show: {
      id: input.showId,
      name: input.showName,
      transport: input.transport,
      timeMs: input.show?.timeMs ?? 0,
      durationMs: input.showDurationMs,
      lightingSceneId: input.show?.lightingSceneId ?? null,
      clockState: input.show?.clockState ?? null,
      screens: input.show
        ? Object.values(input.show.screens).map((s) => ({
            id: s.id,
            cue: s.cue,
            output: s.output,
            mediaTimeMs: s.mediaTimeMs,
            source: s.source,
          }))
        : [],
      lightingZones: input.show
        ? Object.values(input.show.zones).map((z) => ({
            id: z.id,
            intensity: Number(z.intensity.toFixed(3)),
            enabled: z.enabled,
          }))
        : [],
    },

    subsystems: input.subsystems.map((s) => ({
      id: s.id,
      label: s.label,
      logicalState: s.logicalState,
      health: s.health,
      provenance: s.provenance,
      detail: s.detail,
      healthDetail: s.healthDetail,
    })),
    // M2A.2 / punto 3: mira provenance, no salud. Una falla simulada no
    // vuelve "verificado" a nada.
    anyDeviceVerified: input.subsystems.some((s) => s.provenance === 'REAL'),

    energy: {
      available: t !== null,
      simulated: t?.simulated ?? true,
      quality: sample?.quality ?? 'NO_DATA',
      freshness: sample ? freshnessLabel(sample) : 'sin datos',
      ageMs: sample?.ageMs ?? 0,
      deviceId: t?.deviceId ?? null,
      timestamp: t?.timestamp ?? null,
      activePowerKw: t?.activePowerKw ?? null,
      apparentPowerKva: t?.apparentPowerKva ?? null,
      reactivePowerKvar: t?.reactivePowerKvar ?? null,
      powerFactor: t?.powerFactor ?? null,
      frequencyHz: t?.frequencyHz ?? null,
      energyTodayKwh: t?.energyTodayKwh ?? null,
      energyMonthKwh: t?.energyMonthKwh ?? null,
      energyTotalKwh: t?.energyTotalKwh ?? null,
      peakDemandKw: t?.peakDemandKw ?? null,
      peakDemandIsApproximate: true,
      contractedPowerKw: spec.contractedPowerKw,
      demandPercentOfContracted: t
        ? Number(((t.activePowerKw / spec.contractedPowerKw) * 100).toFixed(1))
        : null,
      voltageImbalancePercent: t?.voltageImbalancePercent ?? null,
      currentImbalancePercent: t?.currentImbalancePercent ?? null,
      phases,
      mostLoadedPhase: mostLoaded,
      // Las alarmas viajan tal cual las evaluo `evaluateAlarms`, con el umbral
      // configurado que se cruzo. El AI no vuelve a decidir si algo esta mal.
      activeAlarms: input.alarms.map((tr) => ({
        key: alarmKey(tr.alarm),
        code: tr.alarm.code,
        metric: tr.alarm.metric,
        severity: tr.severity,
        phase: tr.alarm.phase ? LINE_OF[tr.alarm.phase] : null,
        value: tr.alarm.value,
        unit: tr.alarm.unit,
        threshold: tr.alarm.threshold,
        message: tr.alarm.message,
        acknowledged: tr.acknowledged,
        firstSeenAt: tr.firstSeenAt,
      })),
      rules: {
        configuredMetrics: configuredMetrics(input.thresholds),
        thresholdsAreDemo: input.thresholds.demoValues === true,
        tariff: null,
      },
    },

    events: {
      windowMs,
      total: input.log.size(),
      unacknowledged: input.log.unacknowledged().length,
      recent,
    },
  };
}

/** Qué métricas tienen umbral configurado. Lo que no está acá, no tiene regla. */
function configuredMetrics(th: ElectricalAlarmThresholds): string[] {
  const out: string[] = [];
  if (th.voltage) out.push('voltage');
  if (th.current) out.push('current');
  if (th.imbalance) out.push('imbalance_voltage', 'imbalance_current');
  if (th.powerFactor) out.push('power_factor');
  if (th.thd) out.push('thd_voltage');
  if (th.demand) out.push('demand');
  if (th.frequency) out.push('frequency');
  return out;
}

/* ────────────────────────────────────────────────────────────────
 * Asistente mock
 * ──────────────────────────────────────────────────────────────── */

export interface AiAnswer {
  /** Siempre true: marca que la respuesta no puede accionar nada. */
  readonly advisoryOnly: true;
  text: string;
  /** Qué partes del contexto se usaron. Para que el operador sepa de dónde sale. */
  usedFields: string[];
  /** True si la respuesta habla de datos simulados. */
  simulated: boolean;
}

export interface AiAssistant {
  readonly id: string;
  ask(question: string, context: AiContext): AiAnswer;
}

export const SUGGESTED_QUESTIONS = [
  '¿Cómo está la instalación?',
  '¿Qué fase está más cargada?',
  '¿Cuánto consumimos hoy?',
  '¿Hay desequilibrio entre fases?',
  '¿En qué modo está el edificio?',
  '¿Cuál fue la demanda máxima?',
  '¿Hubo eventos eléctricos esta semana?',
  'Resumime las alarmas desde las 18:00.',
  '¿Qué está mostrando el edificio ahora?',
] as const;

/**
 * Asistente de prueba, sin LLM.
 *
 * Existe para poder diseñar y evaluar la UX —cómo se ve una respuesta, qué
 * pasa cuando no hay datos, cómo se marca lo simulado— sin API key, sin costo
 * y sin red. Cuando entre el modelo real, esta clase se reemplaza y la
 * interfaz `AiAssistant` queda igual.
 *
 * No pretende entender lenguaje natural: hace coincidencia por palabras clave.
 * Si no reconoce la pregunta, lo dice, en vez de responder cualquier cosa.
 */
export class MockAiAssistant implements AiAssistant {
  readonly id = 'mock-assistant';

  /**
   * M2A.1 / punto 4: este método NO evalúa nada técnico.
   *
   * No hay un solo número de umbral en este archivo. Todo juicio sobre si algo
   * está bien o mal sale de `context.energy.activeAlarms`, que viene de
   * `evaluateAlarms()` con sus umbrales configurados. El asistente lee,
   * agrupa y explica.
   */
  ask(question: string, context: AiContext): AiAnswer {
    const q = normalize(question);
    const e = context.energy;
    const answer = (text: string, usedFields: string[]): AiAnswer => ({
      advisoryOnly: true,
      text,
      usedFields,
      simulated: context.dataIsSimulated,
    });

    // Antes que nada: si el dato no está vivo, se dice. Un valor viejo
    // presentado como actual es el error más caro de un panel de operación.
    const avisoFrescura =
      e.available && e.quality !== 'LIVE'
        ? ` (atención: el dato no está en vivo — ${e.freshness})`
        : '';

    if (!e.available && /consum|fase|energ|potenc|demanda|electric|tension|corriente|factor/.test(q)) {
      return answer(
        `No hay telemetría eléctrica disponible (${e.freshness}), así que no puedo responder sobre consumo ni fases.`,
        ['energy.available', 'energy.quality'],
      );
    }

    /* ── Desequilibrio ──────────────────────────────────────────── */
    if (/fase.*cargad|cual fase|desbalance|desequilibr|imbalance/.test(q)) {
      const lines = e.phases
        .map((p) => `${p.line}: ${p.currentA.toFixed(1)} A (${p.loadPercent.toFixed(0)} % del nominal)`)
        .join(' · ');

      const dealarmas = e.activeAlarms.filter((a) => a.metric.startsWith('imbalance'));
      const hayRegla =
        e.rules.configuredMetrics.includes('imbalance_current') ||
        e.rules.configuredMetrics.includes('imbalance_voltage');

      const juicio = !hayRegla
        ? 'No hay umbral de desequilibrio configurado, así que no puedo decir si este valor es aceptable.'
        : dealarmas.length > 0
          ? `Hay ${dealarmas.length} alarma(s) de desequilibrio activa(s): ${dealarmas.map((a) => `${a.message} — umbral configurado ${a.threshold} ${a.unit}`).join('; ')}`
          : 'No hay alarma de desequilibrio activa: los valores están dentro de los umbrales configurados.';

      return answer(
        `La fase más cargada es ${e.mostLoadedPhase ?? '—'}. ${lines}. Desequilibrio de corriente: ${e.currentImbalancePercent?.toFixed(1) ?? '—'} %, de tensión: ${e.voltageImbalancePercent?.toFixed(1) ?? '—'} %. ${juicio}${avisoFrescura}`,
        ['energy.phases', 'energy.mostLoadedPhase', 'energy.currentImbalancePercent', 'energy.activeAlarms', 'energy.rules'],
      );
    }

    /* ── Consumo ────────────────────────────────────────────────── */
    if (/cuanto consum|energia hoy|consumo hoy|kwh|energia del mes/.test(q)) {
      return answer(
        `Hoy van ${e.energyTodayKwh?.toFixed(1) ?? '—'} kWh y en el mes calendario ${e.energyMonthKwh?.toFixed(0) ?? '—'} kWh. La potencia actual es ${e.activePowerKw?.toFixed(1) ?? '—'} kW, un ${e.demandPercentOfContracted?.toFixed(0) ?? '—'} % de los ${e.contractedPowerKw} kW contratados.${avisoFrescura}`,
        ['energy.energyTodayKwh', 'energy.energyMonthKwh', 'energy.activePowerKw', 'energy.demandPercentOfContracted'],
      );
    }

    /* ── Demanda máxima ─────────────────────────────────────────── */
    if (/demanda maxima|pico|peak/.test(q)) {
      const dealarma = e.activeAlarms.find((a) => a.metric === 'demand');
      return answer(
        `La demanda máxima registrada hoy fue ${e.peakDemandKw?.toFixed(1) ?? '—'} kW sobre ${e.contractedPowerKw} kW contratados. Es un valor aproximado calculado sobre las muestras del sistema, no la demanda facturable de la distribuidora, que se mide con las ventanas del cuadro tarifario. ${dealarma ? `Hay una alarma de demanda activa: ${dealarma.message}.` : 'No hay alarma de demanda activa.'}${avisoFrescura}`,
        ['energy.peakDemandKw', 'energy.peakDemandIsApproximate', 'energy.activeAlarms'],
      );
    }

    /* ── Alarmas y eventos ──────────────────────────────────────── */
    if (/alarma|evento|incidente|paso algo|desde las/.test(q)) {
      const alarmas = e.activeAlarms;
      const eventos = context.events.recent.filter((x) => x.severity !== 'info');
      if (alarmas.length === 0 && eventos.length === 0) {
        return answer(
          `No hay alarmas activas ni eventos de severidad en la ventana consultada. ${e.rules.thresholdsAreDemo ? 'Tener en cuenta que los umbrales cargados son valores de demostración, no de ingeniería.' : ''}`,
          ['energy.activeAlarms', 'events.recent', 'energy.rules'],
        );
      }
      const lista = alarmas
        .map(
          (a) =>
            `${a.code}${a.phase ? ` (${a.phase})` : ''} ${a.severity}: ${a.value} ${a.unit} contra umbral ${a.threshold} ${a.unit}${a.acknowledged ? ' [reconocida]' : ''}`,
        )
        .join('; ');
      return answer(
        [
          alarmas.length ? `Alarmas activas: ${lista}.` : 'Sin alarmas eléctricas activas.',
          eventos.length
            ? `En la ventana hay ${eventos.length} evento(s) de severidad, ${context.events.unacknowledged} sin reconocer.`
            : 'No hay eventos de severidad registrados.',
          e.rules.thresholdsAreDemo ? 'Los umbrales cargados son de demostración.' : '',
        ]
          .filter(Boolean)
          .join(' '),
        ['energy.activeAlarms', 'events.recent', 'events.unacknowledged', 'energy.rules'],
      );
    }

    /* ── Factor de potencia ─────────────────────────────────────── */
    if (/factor de potencia|coseno|pf/.test(q)) {
      const alarma = e.activeAlarms.find((a) => a.metric === 'power_factor');
      const hayRegla = e.rules.configuredMetrics.includes('power_factor');

      let juicio: string;
      if (!hayRegla) {
        juicio = 'No hay umbral de factor de potencia configurado, así que no puedo decir si este valor es aceptable.';
      } else if (alarma) {
        juicio = `Hay una alarma ${alarma.severity} activa: el valor cruzó el umbral configurado de ${alarma.threshold}.`;
      } else {
        juicio = 'No hay alarma activa: está dentro del umbral configurado.';
      }

      // Sin cuadro tarifario cargado no se afirma nada sobre facturación.
      const tarifa =
        e.rules.tariff === null
          ? ' No hay cuadro tarifario cargado en el sistema, así que no puedo estimar impacto en la factura.'
          : '';

      return answer(`El factor de potencia es ${e.powerFactor?.toFixed(3) ?? '—'}. ${juicio}${tarifa}${avisoFrescura}`, [
        'energy.powerFactor',
        'energy.activeAlarms',
        'energy.rules',
      ]);
    }

    /* ── Modo del edificio ──────────────────────────────────────── */
    if (/modo|takeover|iconic/.test(q)) {
      const b = context.building;
      return answer(
        b.modeMatches
          ? `El edificio está en modo ${b.requestedMode} y el estado simulado coincide.`
          : `El modo pedido es ${b.requestedMode}, pero el estado muestra ${b.effectiveMode ?? 'una escena sin modo asociado'}. ${b.modeExplanation}`,
        ['building.requestedMode', 'building.effectiveMode', 'building.modeExplanation'],
      );
    }

    /*
     * Estado general — va AL FINAL a proposito. "como esta el factor de
     * potencia" contiene "como esta"; si esta rama fuera primero, se comeria
     * todas las preguntas especificas que empiezan igual.
     */
    if (/como esta|estado general|instalacion|resumen|todo bien/.test(q)) {
      const criticos = context.subsystems.filter(
        (s) => s.health === 'CRITICAL' || s.health === 'OFFLINE',
      );
      const degradados = context.subsystems.filter(
        (s) => s.health === 'WARNING' || s.health === 'STALE',
      );
      const cabecera =
        criticos.length > 0
          ? `Hay ${criticos.length} subsistema(s) en estado crítico: ${criticos.map((s) => s.label).join(', ')}.`
          : degradados.length > 0
            ? `Operación con ${degradados.length} subsistema(s) degradado(s): ${degradados.map((s) => s.label).join(', ')}.`
            : 'Ningún subsistema reporta problemas.';

      const aviso = context.anyDeviceVerified
        ? ''
        : ' Importante: ningún dispositivo físico está conectado todavía, así que el estado de pantallas, iluminación y reloj es simulado, no verificado.';

      const modo = context.building.modeMatches
        ? `modo ${context.building.requestedMode}`
        : `modo pedido ${context.building.requestedMode}, pero el estado muestra ${context.building.effectiveMode ?? 'una escena que no corresponde a ningún modo'} (${context.building.modeExplanation})`;

      return answer(
        `${cabecera} El edificio está en ${modo}, estado operativo ${context.building.operatingState}. Consumo actual ${e.activePowerKw?.toFixed(1) ?? '—'} kW.${avisoFrescura}${aviso}`,
        ['subsystems', 'anyDeviceVerified', 'building', 'energy.activePowerKw'],
      );
    }

    /* ── Show ───────────────────────────────────────────────────── */
    if (/que esta mostrando|show|pantalla|contenido/.test(q)) {
      const s = context.show;
      if (!s.id) return answer('No hay ningún show cargado en este momento.', ['show.id']);
      const pantallas = s.screens.map((x) => `${x.id}: ${x.output}`).join(', ');
      return answer(
        `Show "${s.name}" en estado ${s.transport}, segundo ${(s.timeMs / 1000).toFixed(1)} de ${(s.durationMs / 1000).toFixed(0)}. Pantallas: ${pantallas}. Escena de iluminación: ${s.lightingSceneId}. El estado de las pantallas es el que pide el show; los dispositivos físicos todavía no existen.`,
        ['show', 'subsystems'],
      );
    }

    /* ── Comparativos ───────────────────────────────────────────── */
    if (/compar|ayer|versus|vs/.test(q)) {
      return answer(
        'No tengo serie histórica de días anteriores en el contexto: el comparativo contra ayer requiere persistencia, que llega con el backend de CONTROL. Hoy puedo responder sobre el día en curso.',
        ['events.windowMs'],
      );
    }

    return answer(
      'No entendí la pregunta. Puedo responder sobre estado general, consumo, fases, desequilibrio, demanda máxima, factor de potencia, alarmas, modo del edificio y qué está mostrando el show.',
      [],
    );
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
