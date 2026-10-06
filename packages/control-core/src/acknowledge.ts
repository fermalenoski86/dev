import type { AlarmRegistry, AlarmTransition, TrackedAlarm } from '@trust/telemetry';
import type { EventLog, TrustEvent } from './events';

/**
 * Reconocimiento de alarmas — M2A.2 / punto 5.
 *
 * Antes el ACK vivía en dos lados sin hablarse: `AlarmRegistry.acknowledge`
 * marcaba la condición y `EventLog.acknowledgeAll` marcaba los eventos, y cada
 * botón de la UI llamaba a uno, al otro o a los dos. Resultado: se podía
 * reconocer una alarma y que el contador del header siguiera en 1, o al revés.
 *
 * Un panel donde el operador reconoce algo y el número no baja es un panel
 * donde el operador deja de reconocer cosas.
 *
 * Acá el ACK es una sola operación sobre ambos, y deja registro: quién
 * reconoció qué y cuándo es justamente lo que se va a querer mirar después de
 * un incidente.
 */

export const ALARM_ACKNOWLEDGED = 'ALARM_ACKNOWLEDGED';

/**
 * ── M2A.3 / punto 1 ──────────────────────────────────────────────
 *
 * Logger de transiciones. Es el ÚNICO lugar donde se traduce una transición de
 * alarma a un evento del log.
 *
 * Existe porque el store escribía esos eventos inline, sin `metadata.key`,
 * mientras que `acknowledgeAlarm` busca justamente por `e.metadata.key === key`.
 * Los tests, que construían el evento a mano, sí lo ponían: el ACK funcionaba
 * en los tests y no en la aplicación. Es el peor modo de falla posible —
 * cobertura verde sobre un camino que en producción no existe.
 *
 * La lección es la que importa: si producción y test construyen el mismo
 * artefacto por caminos distintos, el test no prueba producción. Por eso esto
 * se exporta y lo usan los dos.
 */
export function logAlarmTransitions(
  log: EventLog,
  transitions: readonly AlarmTransition[],
  options: { source?: string; simulated?: boolean } = {},
): TrustEvent[] {
  const { source = 'telemetry', simulated = true } = options;
  return transitions.map((tr) =>
    log.add({
      timestamp: tr.at,
      source,
      category: 'ENERGY',
      severity: tr.type === 'RESOLVED' ? 'info' : (tr.currentSeverity ?? 'info'),
      message: tr.message,
      metadata: {
        transition: tr.type,
        // `key` es lo que ata el evento a la condición. Sin esto el ACK no
        // encuentra qué reconocer.
        key: tr.key,
        code: tr.alarm.code,
        metric: tr.alarm.metric,
        phase: tr.alarm.phase,
        value: tr.alarm.value,
        threshold: tr.alarm.threshold,
        simulated,
      },
    }),
  );
}

export interface AcknowledgeResult {
  /** Alarmas de la condición que pasaron a reconocidas. */
  acknowledgedAlarms: TrackedAlarm[];
  /** Eventos del log marcados como reconocidos. */
  acknowledgedEvents: number;
  /** Eventos ALARM_ACKNOWLEDGED emitidos. */
  emitted: TrustEvent[];
}

export interface AcknowledgeOptions {
  registry: AlarmRegistry;
  log: EventLog;
  now: number;
  /** Quién reconoce. Con autenticación será el usuario real. */
  actor?: string;
}

function emit(
  log: EventLog,
  alarm: TrackedAlarm,
  now: number,
  actor: string,
): TrustEvent {
  return log.add({
    timestamp: now,
    source: actor,
    category: 'ENERGY',
    severity: 'info',
    message: `Alarma reconocida: ${alarm.alarm.code}${alarm.alarm.phase ? ` L${alarm.alarm.phase === 'A' ? 1 : alarm.alarm.phase === 'B' ? 2 : 3}` : ''} (${alarm.severity})`,
    metadata: {
      transition: ALARM_ACKNOWLEDGED,
      key: alarm.key,
      code: alarm.alarm.code,
      metric: alarm.alarm.metric,
      phase: alarm.alarm.phase,
      severity: alarm.severity,
      simulated: true,
    },
    // El evento de reconocimiento nace reconocido: no es algo que haya que
    // volver a reconocer.
    acknowledged: true,
  });
}

/** Reconoce UNA condición y sincroniza el log. */
export function acknowledgeAlarm(key: string, opts: AcknowledgeOptions): AcknowledgeResult {
  const { registry, log, now, actor = 'operator' } = opts;
  const alarm = registry.get(key);
  if (!alarm || alarm.acknowledged) {
    return { acknowledgedAlarms: [], acknowledgedEvents: 0, emitted: [] };
  }

  registry.acknowledge(key, now);
  const actualizada = registry.get(key);

  // Los eventos del log que originó ESTA condición quedan reconocidos también.
  let eventos = 0;
  for (const e of log.list('ENERGY', 500)) {
    if (!e.acknowledged && e.metadata.key === key) {
      if (log.acknowledge(e.id)) eventos += 1;
    }
  }

  return {
    acknowledgedAlarms: actualizada ? [actualizada] : [],
    acknowledgedEvents: eventos,
    emitted: actualizada ? [emit(log, actualizada, now, actor)] : [],
  };
}

/**
 * Reconoce TODO: condiciones activas y eventos pendientes del log.
 *
 * Después de esto no puede quedar nada sin reconocer en ninguno de los dos
 * lados. Hay un test que lo verifica, porque es exactamente la inconsistencia
 * que existía antes.
 */
export function acknowledgeAll(opts: AcknowledgeOptions): AcknowledgeResult {
  const { registry, log, now, actor = 'operator' } = opts;

  const pendientes = registry.unacknowledged();
  const emitted: TrustEvent[] = [];

  for (const alarm of pendientes) {
    registry.acknowledge(alarm.key, now);
    const actualizada = registry.get(alarm.key);
    if (actualizada) emitted.push(emit(log, actualizada, now, actor));
  }

  // Todo lo que quedara pendiente en el log, de cualquier categoría.
  const eventos = log.acknowledgeAll();

  return {
    acknowledgedAlarms: registry.active().filter((a) => a.acknowledged),
    acknowledgedEvents: eventos,
    emitted,
  };
}

/** Invariante que la UI puede chequear: nada pendiente en ninguno de los dos. */
export function isAckConsistent(registry: AlarmRegistry, log: EventLog): boolean {
  return registry.unacknowledged().length === 0 && log.unacknowledged().length === 0;
}
