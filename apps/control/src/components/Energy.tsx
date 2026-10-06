'use client';

import { useMemo, useState } from 'react';
import {
  DEMO_INSTALLATION,
  DEMO_THRESHOLDS,
  PHASES,
  phaseLoadPercent,
  phaseOf,
  freshnessLabel,
  resolveSeriesWindow,
  type ElectricalTelemetry,
} from '@trust/telemetry';
import { deriveElectricalHealth } from '@trust/control-core';
import { useControlStore } from '../state/useControlStore';
import { HealthBadge, LoadBar, Metric, Panel, SimulatedTag, fmt } from './primitives';

const LINE = { A: 'L1', B: 'L2', C: 'L3' } as const;

const RANGES = [
  { id: '1H', label: '1 H', ms: 3_600_000, points: 60 },
  { id: '6H', label: '6 H', ms: 21_600_000, points: 72 },
  { id: '24H', label: '24 H', ms: 86_400_000, points: 96 },
  { id: '7D', label: '7 D', ms: 604_800_000, points: 84 },
  { id: '30D', label: '30 D', ms: 2_592_000_000, points: 90 },
] as const;

export function Energy() {
  const { sample, alarms, provider, now, log } = useControlStore();
  const acknowledge = useControlStore((s) => s.acknowledgeAll);
  const acknowledgeAlarm = useControlStore((s) => s.acknowledgeAlarm);
  const telemetry = sample?.telemetry ?? null;
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>('24H');
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[2];

  // La serie sale del MISMO muestreo que el dato en vivo: no puede contradecirlo.
  /*
   * M2A.2 / punto 4. La serie se recorta al ultimo dato medido: con el enlace
   * caido, graficar hasta "ahora" seria inventar historia — la curva seguiria
   * dibujandose prolija mientras el medidor no responde.
   */
  const window = useMemo(() => resolveSeriesWindow(now, range.ms, sample), [now, range, sample]);
  const series = useMemo(() => {
    if (!now || window.empty) return [];
    return provider.history(window.fromMs, window.toMs, range.points);
  }, [provider, now, range, window]);

  const spec = DEMO_INSTALLATION;

  if (!telemetry) return <Panel title="Energy"><p className="text-sm text-neutral-500">Sin telemetría.</p></Panel>;

  const alarmEvents = log.list('ENERGY', 60);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-sky-900/70 bg-sky-950/30 px-4 py-2.5">
        <SimulatedTag />
        <p className="text-[12px] text-sky-200/80">
          Todos los valores de este módulo provienen de un simulador determinista. No hay analizador de red conectado.
          Los umbrales de alarma son valores DEMO, no de ingeniería.
        </p>
      </div>

      {sample && sample.quality !== 'LIVE' && (
        <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-500">
            Dato no actual — {freshnessLabel(sample)}
          </p>
          <p className="mt-1 text-[12px] text-amber-200/80">
            Los valores de abajo son la última lectura recibida, no el estado presente de la instalación.
          </p>
        </div>
      )}

      <Panel
        title="General"
        right={
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-neutral-500">{telemetry.deviceId}</span>
            {/* M2A.2 / punto 2: una sola fuente — calidad del dato + alarmas. */}
            <HealthBadge status={deriveElectricalHealth(sample, alarms)} provenance="SIMULATED" />
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label="Potencia activa" value={fmt.n(telemetry.activePowerKw)} unit="kW" />
          <Metric label="Potencia aparente" value={fmt.n(telemetry.apparentPowerKva)} unit="kVA" />
          <Metric label="Reactiva" value={fmt.n(telemetry.reactivePowerKvar)} unit="kVAr" />
          <Metric
            label="Factor de potencia"
            value={fmt.n(telemetry.powerFactor, 2)}
            tone={telemetry.powerFactor < 0.85 ? 'critical' : telemetry.powerFactor < 0.92 ? 'warning' : 'normal'}
          />
          <Metric label="Frecuencia" value={fmt.n(telemetry.frequencyHz, 2)} unit="Hz" />
          <Metric label="Energía hoy" value={fmt.n(telemetry.energyTodayKwh, 0)} unit="kWh" />
          <Metric label="Energía mes" value={fmt.n(telemetry.energyMonthKwh, 0)} unit="kWh" />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-neutral-800 pt-3 font-mono text-[11px] tabular-nums text-neutral-500">
          <span>Demanda máx. hoy: <span className="text-neutral-300">{fmt.n(telemetry.peakDemandKw)} kW</span></span>
          <span>Energía total: <span className="text-neutral-300">{fmt.n(telemetry.energyTotalKwh, 0)} kWh</span></span>
          <span>U<sub>AB</sub> {fmt.n(telemetry.lineVoltageAB)} V</span>
          <span>U<sub>BC</sub> {fmt.n(telemetry.lineVoltageBC)} V</span>
          <span>U<sub>CA</sub> {fmt.n(telemetry.lineVoltageCA)} V</span>
          <span>THD U: <span className="text-neutral-300">{telemetry.thdVoltagePercent === null ? 'n/d' : `${fmt.n(telemetry.thdVoltagePercent, 1)} %`}</span></span>
        </div>
      </Panel>

      {/* Fases */}
      <div className="grid gap-4 md:grid-cols-3">
        {PHASES.map((id) => {
          const p = phaseOf(telemetry, id);
          const pct = phaseLoadPercent(p, spec);
          const tone = pct > 95 ? 'critical' : pct > 80 ? 'warning' : 'normal';
          return (
            <Panel key={id} title={`Fase ${LINE[id]}`}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <Metric label="Voltaje" value={fmt.n(p.voltageV)} unit="V" />
                  <Metric label="Corriente" value={fmt.n(p.currentA)} unit="A" />
                  <Metric label="Potencia" value={fmt.n(p.activePowerKw, 2)} unit="kW" />
                  <Metric label="PF fase" value={p.powerFactor === null ? 'n/d' : fmt.n(p.powerFactor, 2)} />
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between text-[11px]">
                    <span className="uppercase tracking-wider text-neutral-500">Carga</span>
                    <span className={`font-mono tabular-nums ${tone === 'critical' ? 'text-red-400' : tone === 'warning' ? 'text-amber-400' : 'text-neutral-300'}`}>
                      {pct.toFixed(0)} %
                    </span>
                  </div>
                  <LoadBar percent={pct} tone={tone} />
                  <p className="mt-1 text-[11px] text-neutral-600">
                    nominal {spec.ratedCurrentPerPhaseA} A · THD I {p.thdCurrentPercent === null ? 'n/d' : `${fmt.n(p.thdCurrentPercent, 1)} %`}
                  </p>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* Desequilibrio */}
      <Panel title="Desequilibrio entre fases">
        <div className="grid gap-6 sm:grid-cols-2">
          {([
            ['Tensión', telemetry.voltageImbalancePercent, DEMO_THRESHOLDS.imbalance.voltageWarnPercent, DEMO_THRESHOLDS.imbalance.voltageCriticalPercent],
            ['Corriente', telemetry.currentImbalancePercent, DEMO_THRESHOLDS.imbalance.currentWarnPercent, DEMO_THRESHOLDS.imbalance.currentCriticalPercent],
          ] as const).map(([label, value, warn, crit]) => {
            const tone = value > crit ? 'critical' : value > warn ? 'warning' : 'normal';
            return (
              <div key={label}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</span>
                  <span className={`font-mono text-lg tabular-nums ${tone === 'critical' ? 'text-red-400' : tone === 'warning' ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {value.toFixed(2)} %
                  </span>
                </div>
                {/* Escala relativa al umbral crítico, para que la barra signifique algo. */}
                <LoadBar percent={(value / crit) * 100} tone={tone} />
                <p className="mt-1 text-[11px] text-neutral-600">aviso &gt; {warn} % · crítico &gt; {crit} % (NEMA)</p>
              </div>
            );
          })}
        </div>
        <div className="mt-4 space-y-1.5">
          {PHASES.map((id) => {
            const p = phaseOf(telemetry, id);
            const max = Math.max(...PHASES.map((x) => phaseOf(telemetry, x).currentA), 1);
            return (
              <div key={id} className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-[11px] font-semibold text-neutral-400">{LINE[id]}</span>
                <div className="flex-1">
                  <LoadBar percent={(p.currentA / max) * 100} tone="normal" />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-neutral-400">
                  {fmt.n(p.currentA)} A
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Tendencias */}
      <Panel
        title="Tendencias"
        right={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRangeId(r.id)}
                className={`rounded px-2 py-1 text-[11px] font-medium ${
                  rangeId === r.id ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Trend title="Potencia total" unit="kW" series={series} pick={(t) => t.activePowerKw} colors={['#34d399']} gapFraction={window.gapFraction} />
          <Trend
            title="Corriente por fase"
            unit="A"
            series={series}
            multi={[
              { label: 'L1', pick: (t: ElectricalTelemetry) => t.phaseA.currentA, color: '#38bdf8' },
              { label: 'L2', pick: (t: ElectricalTelemetry) => t.phaseB.currentA, color: '#a78bfa' },
              { label: 'L3', pick: (t: ElectricalTelemetry) => t.phaseC.currentA, color: '#fbbf24' },
            ]}
          />
          <Trend
            title="Tensión por fase"
            unit="V"
            series={series}
            multi={[
              { label: 'L1', pick: (t: ElectricalTelemetry) => t.phaseA.voltageV, color: '#38bdf8' },
              { label: 'L2', pick: (t: ElectricalTelemetry) => t.phaseB.voltageV, color: '#a78bfa' },
              { label: 'L3', pick: (t: ElectricalTelemetry) => t.phaseC.voltageV, color: '#fbbf24' },
            ]}
          />
          <Trend title="Factor de potencia" unit="" series={series} pick={(t) => t.powerFactor} colors={['#34d399']} />
          <Trend title="Energía acumulada (día)" unit="kWh" series={series} pick={(t) => t.energyTodayKwh} colors={['#94a3b8']} />
          <Trend title="Demanda máxima" unit="kW" series={series} pick={(t) => t.peakDemandKw} colors={['#f59e0b']} />
        </div>
        <p className="mt-3 text-[11px] text-neutral-600">
          Las series salen del mismo muestreo determinista que el valor en vivo, por eso nunca contradicen al indicador.
          {window.gap && (
            <span className="text-amber-500">
              {' '}
              El tramo final del gráfico ({((window.gap.toMs - window.gap.fromMs) / 60000).toFixed(0)} min) no tiene
              datos: la serie se congela en la última medición en vez de inventar puntos.
            </span>
          )}
        </p>
      </Panel>

      {/* Alarmas */}
      <Panel
        title="Alarmas eléctricas"
        right={
          <button onClick={acknowledge} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500">
            Reconocer todas
          </button>
        }
      >
        {alarms.length === 0 && alarmEvents.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin alarmas activas ni registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
                <tr className="border-b border-neutral-800">
                  <th className="py-2 pr-3 font-medium">Hora</th>
                  <th className="py-2 pr-3 font-medium">Evento</th>
                  <th className="py-2 pr-3 font-medium">Severidad</th>
                  <th className="py-2 pr-3 font-medium">Valor</th>
                  <th className="py-2 pr-3 font-medium">Fase</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 font-medium">Ack</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {alarms.map((a) => (
                  <tr key={a.key} className="text-neutral-300">
                    <td className="py-2 pr-3 font-mono tabular-nums text-neutral-400">{fmt.time(a.firstSeenAt)}</td>
                    <td className="py-2 pr-3 font-medium">{a.alarm.code}</td>
                    <td className={`py-2 pr-3 font-semibold ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>
                      {a.severity.toUpperCase()}
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums">
                      {a.alarm.value} {a.alarm.unit}
                      <span className="text-neutral-600"> / {a.alarm.threshold}</span>
                    </td>
                    <td className="py-2 pr-3">{a.alarm.phase ? LINE[a.alarm.phase] : '—'}</td>
                    <td className="py-2 pr-3 text-red-300">ACTIVA</td>
                    <td className="py-2">
                      {a.acknowledged ? (
                        <span className="text-emerald-500">sí</span>
                      ) : (
                        <button
                          onClick={() => acknowledgeAlarm(a.key)}
                          className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300"
                        >
                          ack
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {alarmEvents
                  .filter((e) => e.severity !== 'info')
                  .map((e) => (
                    <tr key={e.id} className="text-neutral-400">
                      <td className="py-2 pr-3 font-mono tabular-nums text-neutral-500">{fmt.time(e.timestamp)}</td>
                      <td className="py-2 pr-3">{String(e.metadata.code ?? '—')}</td>
                      <td className={`py-2 pr-3 ${e.severity === 'critical' ? 'text-red-400/70' : 'text-amber-400/70'}`}>
                        {e.severity.toUpperCase()}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{String(e.metadata.value ?? '—')}</td>
                      <td className="py-2 pr-3">{e.metadata.phase ? LINE[e.metadata.phase as 'A' | 'B' | 'C'] : '—'}</td>
                      <td className="py-2 pr-3 text-neutral-500">REGISTRADA</td>
                      <td className="py-2">{e.acknowledged ? <span className="text-emerald-500">sí</span> : <span className="text-amber-500">no</span>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-neutral-600">
          Reconocer una alarma no la borra: la condición sigue activa hasta que desaparezca físicamente. Si una alarma
          escala de warning a critical, el reconocimiento se invalida. No hay comandos automáticos sobre contactores.
        </p>
      </Panel>
    </div>
  );
}

/* ── Gráfico de línea en SVG, sin librería ──────────────────────── */

function Trend({
  title,
  unit,
  series,
  pick,
  colors = ['#34d399'],
  multi,
  gapFraction = 0,
}: {
  title: string;
  unit: string;
  series: ElectricalTelemetry[];
  pick?: (t: ElectricalTelemetry) => number;
  colors?: string[];
  multi?: Array<{ label: string; pick: (t: ElectricalTelemetry) => number; color: string }>;
  /** Fraccion final del ancho sin datos. Se raya, no se dibuja curva. */
  gapFraction?: number;
}) {
  const lines = multi ?? (pick ? [{ label: '', pick, color: colors[0] ?? '#34d399' }] : []);
  if (series.length < 2 || lines.length === 0) {
    return (
      <div>
        <h3 className="mb-1 text-[11px] uppercase tracking-wider text-neutral-500">{title}</h3>
        <div className="h-28 rounded border border-neutral-800 bg-neutral-950/40" />
      </div>
    );
  }

  const values = lines.flatMap((l) => series.map(l.pick));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.12 || Math.abs(max) * 0.05 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const W = 300;
  const H = 88;

  // El area con datos ocupa solo la parte no hueca del ancho.
  const drawW = W * (1 - Math.min(0.95, gapFraction));

  const path = (p: (t: ElectricalTelemetry) => number) =>
    series
      .map((t, i) => {
        const x = (i / (series.length - 1)) * drawW;
        const y = H - ((p(t) - lo) / (hi - lo)) * H;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const ultima = series[series.length - 1];
  const last = ultima ? lines.map((l) => l.pick(ultima)) : lines.map(() => 0);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-neutral-500">{title}</h3>
        <div className="flex gap-2 font-mono text-[11px] tabular-nums">
          {lines.map((l, i) => (
            <span key={l.label || i} style={{ color: l.color }}>
              {l.label && `${l.label} `}
              {(last[i] ?? 0).toFixed(unit === '' ? 2 : 1)}
            </span>
          ))}
        </div>
      </div>
      <div className="rounded border border-neutral-800 bg-neutral-950/40 p-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="#262626" strokeWidth={0.5} />
          ))}
          {lines.map((l, i) => (
            <path key={l.label || i} d={path(l.pick)} fill="none" stroke={l.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          ))}
          {gapFraction > 0.005 && (
            <rect
              x={drawW}
              y={0}
              width={W - drawW}
              height={H}
              fill="#f59e0b"
              fillOpacity={0.08}
              stroke="#f59e0b"
              strokeOpacity={0.25}
              strokeDasharray="2 3"
              strokeWidth={0.5}
            />
          )}
        </svg>
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-neutral-600">
        <span>{lo.toFixed(unit === '' ? 2 : 0)}{unit && ` ${unit}`}</span>
        <span>{hi.toFixed(unit === '' ? 2 : 0)}{unit && ` ${unit}`}</span>
      </div>
    </div>
  );
}
