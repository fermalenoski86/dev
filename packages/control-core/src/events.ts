import { z } from 'zod';

/**
 * Registro unificado de eventos.
 *
 * El valor está en que sea UNO solo. Cuando a las 3 de la mañana una pantalla
 * se apaga, la pregunta es si fue el show, un clip que falló, SAFE MODE o que
 * se cayó una fase — y esa respuesta no aparece si cada subsistema guarda su
 * propio log con su propio formato y su propio reloj.
 */

export const EventCategorySchema = z.enum([
  'MEDIA',
  'LIGHTING',
  'CLOCK',
  'SYSTEM',
  'ENERGY',
  'SAFETY',
]);
export type EventCategory = z.infer<typeof EventCategorySchema>;

export const EventSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type EventSeverity = z.infer<typeof EventSeveritySchema>;

export const TrustEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().int(),
  /** Quién lo originó: 'show-engine', 'telemetry', 'operator', 'system'. */
  source: z.string().min(1),
  category: EventCategorySchema,
  severity: EventSeveritySchema,
  message: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  /** Solo aplica a eventos que requieren reconocimiento (alarmas). */
  acknowledged: z.boolean().default(false),
});
export type TrustEvent = z.infer<typeof TrustEventSchema>;

export const EVENT_FILTERS = ['TODOS', 'MEDIA', 'LIGHTING', 'CLOCK', 'SYSTEM', 'ENERGY', 'SAFETY'] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];

export interface EventLogOptions {
  /** Tope de eventos en memoria. Los más viejos se descartan. */
  capacity?: number;
}

/**
 * Log acotado en memoria.
 *
 * Es de PREVIS/CONTROL en modo simulación: no es auditoría. La auditoría real
 * (§9 de PRINCIPLES.md, retención 180 días) es persistente y vive en CONTROL
 * con backend, que no existe todavía. Marcado acá para que nadie confunda una
 * cosa con la otra.
 */
export class EventLog {
  private events: TrustEvent[] = [];
  private seq = 0;
  private readonly capacity: number;

  constructor(options: EventLogOptions = {}) {
    this.capacity = options.capacity ?? 500;
  }

  /** Agrega un evento. El id es determinista por secuencia, no aleatorio. */
  add(event: Omit<TrustEvent, 'id' | 'acknowledged'> & { acknowledged?: boolean }): TrustEvent {
    const full = TrustEventSchema.parse({
      ...event,
      id: `evt_${String(this.seq).padStart(6, '0')}`,
      acknowledged: event.acknowledged ?? false,
    });
    this.seq += 1;
    this.events.push(full);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
    return full;
  }

  /** Más reciente primero. */
  list(filter: EventFilter = 'TODOS', limit = 200): TrustEvent[] {
    const base = filter === 'TODOS' ? this.events : this.events.filter((e) => e.category === filter);
    return base.slice(-limit).reverse();
  }

  since(fromMs: number, filter: EventFilter = 'TODOS'): TrustEvent[] {
    return this.list(filter, this.capacity).filter((e) => e.timestamp >= fromMs);
  }

  acknowledge(id: string): boolean {
    const e = this.events.find((x) => x.id === id);
    if (!e || e.acknowledged) return false;
    e.acknowledged = true;
    return true;
  }

  acknowledgeAll(): number {
    let n = 0;
    for (const e of this.events) {
      if (!e.acknowledged && e.severity !== 'info') {
        e.acknowledged = true;
        n += 1;
      }
    }
    return n;
  }

  /** Alarmas sin reconocer. Es lo que el header tiene que contar. */
  unacknowledged(): TrustEvent[] {
    return this.events.filter((e) => !e.acknowledged && e.severity !== 'info').reverse();
  }

  counts(): Record<EventSeverity, number> {
    return {
      info: this.events.filter((e) => e.severity === 'info').length,
      warning: this.events.filter((e) => e.severity === 'warning').length,
      critical: this.events.filter((e) => e.severity === 'critical').length,
    };
  }

  size(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }
}
