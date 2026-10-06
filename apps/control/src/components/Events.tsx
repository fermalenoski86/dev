'use client';

import { EVENT_FILTERS, type EventFilter } from '@trust/control-core';
import { useControlStore } from '../state/useControlStore';
import { Panel, fmt } from './primitives';

const SEVERITY_STYLE = {
  info: 'text-neutral-400',
  warning: 'text-amber-400',
  critical: 'text-red-400',
} as const;

const CATEGORY_STYLE: Record<string, string> = {
  MEDIA: 'border-sky-900 text-sky-400',
  LIGHTING: 'border-amber-900 text-amber-400',
  CLOCK: 'border-neutral-700 text-neutral-400',
  SYSTEM: 'border-neutral-700 text-neutral-400',
  ENERGY: 'border-emerald-900 text-emerald-400',
  SAFETY: 'border-red-900 text-red-400',
};

export function Events() {
  const { events, eventFilter, unacknowledged, log } = useControlStore();
  const { setEventFilter, acknowledgeAll } = useControlStore();
  const counts = log.counts();

  return (
    <div className="space-y-4">
      <Panel
        title="Event log"
        right={
          <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
            <span className="text-neutral-500">{log.size()} eventos</span>
            <span className="text-amber-400">{counts.warning} warn</span>
            <span className="text-red-400">{counts.critical} crit</span>
            {unacknowledged > 0 && (
              <button onClick={acknowledgeAll} className="rounded border border-neutral-700 px-2 py-1 font-sans text-[11px] text-neutral-300 hover:border-neutral-500">
                Reconocer {unacknowledged}
              </button>
            )}
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {EVENT_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setEventFilter(f as EventFilter)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                eventFilter === f ? 'bg-neutral-100 text-neutral-900' : 'border border-neutral-800 text-neutral-400 hover:border-neutral-600'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-600">Sin eventos en esta categoría.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
                <tr className="border-b border-neutral-800">
                  <th className="py-2 pr-3 font-medium">Hora</th>
                  <th className="py-2 pr-3 font-medium">Categoría</th>
                  <th className="py-2 pr-3 font-medium">Origen</th>
                  <th className="py-2 pr-3 font-medium">Sev.</th>
                  <th className="py-2 pr-3 font-medium">Mensaje</th>
                  <th className="py-2 font-medium">Ack</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {events.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono tabular-nums text-neutral-500">
                      {fmt.dateTime(e.timestamp)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_STYLE[e.category] ?? 'border-neutral-700 text-neutral-400'}`}>
                        {e.category}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-neutral-500">{e.source}</td>
                    <td className={`py-1.5 pr-3 font-semibold ${SEVERITY_STYLE[e.severity]}`}>
                      {e.severity === 'info' ? '·' : e.severity.toUpperCase()}
                    </td>
                    <td className="py-1.5 pr-3 text-neutral-300">
                      {e.message}
                      {e.metadata.simulated === true && (
                        <span className="ml-1.5 text-[10px] uppercase text-sky-600">sim</span>
                      )}
                    </td>
                    <td className="py-1.5 text-[11px]">
                      {e.severity === 'info' ? (
                        <span className="text-neutral-700">—</span>
                      ) : e.acknowledged ? (
                        <span className="text-emerald-500">sí</span>
                      ) : (
                        <span className="text-amber-500">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-snug text-neutral-600">
          Log en memoria, acotado a 500 eventos. No es la auditoría: esa es persistente, con retención de 180 días, y
          llega con el backend de CONTROL.
        </p>
      </Panel>
    </div>
  );
}
