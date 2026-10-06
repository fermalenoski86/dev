import { alarmKey, type AlarmSeverity, type ElectricalAlarm } from './alarms';

/**
 * Ciclo de vida de alarmas — M2A.1 / punto 2.
 *
 * Antes se guardaba un `Set<string>` de códigos ya reportados. Eso solo
 * distingue "estaba" de "no estaba", así que una subtensión que empeora de
 * warning a critical no generaba ningún evento: la condición ya estaba en el
 * Set y el sistema se quedaba callado justo cuando la situación se agravaba.
 *
 * Ahora se recuerda el ESTADO ANTERIOR de cada condición y se emiten
 * transiciones:
 *
 *   ACTIVATED     no estaba  →  está
 *   ESCALATED     warning    →  critical
 *   DEESCALATED   critical   →  warning
 *   RESOLVED      estaba     →  no está
 *
 * `diffAlarms` es pura: recibe el estado anterior y el actual, devuelve
 * transiciones. El registro con estado vive aparte, en `AlarmRegistry`.
 */

export type AlarmTransitionType = 'ACTIVATED' | 'ESCALATED' | 'DEESCALATED' | 'RESOLVED';

export interface TrackedAlarm {
  key: string;
  alarm: ElectricalAlarm;
  severity: AlarmSeverity;
  /** Cuándo apareció por primera vez esta condición (no la última muestra). */
  firstSeenAt: number;
  lastSeenAt: number;
  /**
   * Reconocida por el operador. NO borra la alarma: sigue activa hasta que la
   * condición física desaparezca. Reconocer es "la vi", no "la arreglé".
   */
  acknowledged: boolean;
  /** Al escalar, el ack se invalida: es una condición nueva que nadie vio. */
  acknowledgedAt: number | null;
}

export interface AlarmTransition {
  type: AlarmTransitionType;
  key: string;
  /** La alarma en su estado actual. En RESOLVED, la última observada. */
  alarm: ElectricalAlarm;
  previousSeverity: AlarmSeverity | null;
  currentSeverity: AlarmSeverity | null;
  at: number;
  message: string;
}

const RANK: Record<AlarmSeverity, number> = { info: 0, warning: 1, critical: 2 };

/**
 * Compara dos conjuntos de alarmas y devuelve qué cambió. Pura.
 *
 * Si la misma condición aparece varias veces en `current` (no debería, pero
 * los umbrales podrían solaparse), gana la de mayor severidad: subestimar es
 * peor que sobreestimar.
 */
export function diffAlarms(
  previous: ReadonlyMap<string, TrackedAlarm>,
  current: readonly ElectricalAlarm[],
  now: number,
): AlarmTransition[] {
  const actuales = new Map<string, ElectricalAlarm>();
  for (const a of current) {
    const k = alarmKey(a);
    const existente = actuales.get(k);
    if (!existente || RANK[a.severity] > RANK[existente.severity]) actuales.set(k, a);
  }

  const out: AlarmTransition[] = [];

  for (const [key, alarm] of actuales) {
    const antes = previous.get(key);
    if (!antes) {
      out.push({
        type: 'ACTIVATED',
        key,
        alarm,
        previousSeverity: null,
        currentSeverity: alarm.severity,
        at: now,
        message: `${alarm.code}${faseTxt(alarm)} activada (${alarm.severity}): ${alarm.message}`,
      });
      continue;
    }
    if (RANK[alarm.severity] > RANK[antes.severity]) {
      out.push({
        type: 'ESCALATED',
        key,
        alarm,
        previousSeverity: antes.severity,
        currentSeverity: alarm.severity,
        at: now,
        message: `${alarm.code}${faseTxt(alarm)} escaló de ${antes.severity} a ${alarm.severity}: ${alarm.message}`,
      });
    } else if (RANK[alarm.severity] < RANK[antes.severity]) {
      out.push({
        type: 'DEESCALATED',
        key,
        alarm,
        previousSeverity: antes.severity,
        currentSeverity: alarm.severity,
        at: now,
        message: `${alarm.code}${faseTxt(alarm)} bajó de ${antes.severity} a ${alarm.severity}: ${alarm.message}`,
      });
    }
  }

  for (const [key, antes] of previous) {
    if (actuales.has(key)) continue;
    out.push({
      type: 'RESOLVED',
      key,
      alarm: antes.alarm,
      previousSeverity: antes.severity,
      currentSeverity: null,
      at: now,
      message: `${antes.alarm.code}${faseTxt(antes.alarm)} normalizada (venía ${antes.severity})`,
    });
  }

  // Orden estable: primero lo que empeora. Un operador lee de arriba.
  const peso: Record<AlarmTransitionType, number> = {
    ESCALATED: 0,
    ACTIVATED: 1,
    DEESCALATED: 2,
    RESOLVED: 3,
  };
  return out.sort((a, b) => peso[a.type] - peso[b.type] || a.key.localeCompare(b.key));
}

function faseTxt(a: ElectricalAlarm): string {
  if (!a.phase) return '';
  return ` L${a.phase === 'A' ? 1 : a.phase === 'B' ? 2 : 3}`;
}

/**
 * Registro con estado. Mantiene las condiciones vivas y sus reconocimientos.
 */
export class AlarmRegistry {
  private tracked = new Map<string, TrackedAlarm>();

  /** Aplica una lectura nueva y devuelve las transiciones que produjo. */
  update(current: readonly ElectricalAlarm[], now: number): AlarmTransition[] {
    const transitions = diffAlarms(this.tracked, current, now);

    const actuales = new Map<string, ElectricalAlarm>();
    for (const a of current) {
      const k = alarmKey(a);
      const e = actuales.get(k);
      if (!e || RANK[a.severity] > RANK[e.severity]) actuales.set(k, a);
    }

    for (const t of transitions) {
      if (t.type === 'RESOLVED') {
        this.tracked.delete(t.key);
        continue;
      }
      const antes = this.tracked.get(t.key);
      this.tracked.set(t.key, {
        key: t.key,
        alarm: t.alarm,
        severity: t.alarm.severity,
        firstSeenAt: antes?.firstSeenAt ?? now,
        lastSeenAt: now,
        // Escalar invalida el ack: es una condición distinta de la que se vio.
        // Desescalar lo conserva: si ya la reconocieron peor, sigue reconocida.
        acknowledged: t.type === 'ESCALATED' ? false : (antes?.acknowledged ?? false),
        acknowledgedAt: t.type === 'ESCALATED' ? null : (antes?.acknowledgedAt ?? null),
      });
    }

    // Condiciones sin transición: solo se refresca lastSeenAt y el valor.
    for (const [key, alarm] of actuales) {
      const e = this.tracked.get(key);
      if (e && !transitions.some((t) => t.key === key)) {
        this.tracked.set(key, { ...e, alarm, lastSeenAt: now });
      }
    }

    return transitions;
  }

  /** Alarmas vivas ahora mismo. */
  active(): TrackedAlarm[] {
    return [...this.tracked.values()].sort(
      (a, b) => RANK[b.severity] - RANK[a.severity] || a.key.localeCompare(b.key),
    );
  }

  get(key: string): TrackedAlarm | undefined {
    return this.tracked.get(key);
  }

  /**
   * Reconocer NO borra la alarma. La condición sigue activa hasta que
   * físicamente desaparezca; el ack solo registra que alguien la vio.
   */
  acknowledge(key: string, now: number): boolean {
    const e = this.tracked.get(key);
    if (!e || e.acknowledged) return false;
    this.tracked.set(key, { ...e, acknowledged: true, acknowledgedAt: now });
    return true;
  }

  acknowledgeAll(now: number): number {
    let n = 0;
    for (const key of this.tracked.keys()) if (this.acknowledge(key, now)) n += 1;
    return n;
  }

  unacknowledged(): TrackedAlarm[] {
    return this.active().filter((a) => !a.acknowledged);
  }

  size(): number {
    return this.tracked.size;
  }

  /** Solo para reiniciar el seguimiento (p. ej. al cambiar de escenario DEV). */
  reset(): void {
    this.tracked.clear();
  }
}
