'use client';

import { BUILDING_MODES, type BuildingMode } from '@trust/control-core';
import { freshnessLabel } from '@trust/telemetry';
import { DEMO_INSTALLATION, PHASES, phaseLoadPercent, phaseOf } from '@trust/telemetry';
import { useControlStore } from '../state/useControlStore';
import { HealthBadge, LoadBar, LogicalBadge, Metric, Panel, SimulatedTag, fmt } from './primitives';

const LINE = { A: 'L1', B: 'L2', C: 'L3' } as const;

export function Overview() {
  const { subsystems, sample, alarms, show, showState, transport, safeMode } = useControlStore();
  const { requestedMode, effectiveMode } = useControlStore();
  const { setMode, play, pause, stop, toggleSafeMode } = useControlStore();
  const { overrideEnabled, setOverrideEnabled, preview } = useControlStore();
  const telemetry = sample?.telemetry ?? null;
  const mode = requestedMode;

  const criticas = alarms.filter((a) => a.severity === 'critical');
  const warnings = alarms.filter((a) => a.severity === 'warning');
  const simulados = subsystems.filter((s) => s.provenance === 'SIMULATED').length;
  const spec = DEMO_INSTALLATION;

  return (
    <div className="space-y-4">
      {/* Banda de alarma: informa sin tapar la operación. */}
      {(criticas.length > 0 || warnings.length > 0) && (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            criticas.length > 0
              ? 'border-red-900 bg-red-950/40'
              : 'border-amber-900 bg-amber-950/30'
          }`}
        >
          <span className={`mt-0.5 text-xs font-bold ${criticas.length ? 'text-red-400' : 'text-amber-400'}`}>
            {criticas.length > 0 ? 'CRITICAL' : 'WARNING'}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${criticas.length ? 'text-red-200' : 'text-amber-200'}`}>
              {(criticas[0] ?? warnings[0])?.alarm.message}
            </p>
            {alarms.length > 1 && (
              <p className="mt-0.5 text-[11px] text-neutral-400">
                y {alarms.length - 1} condición(es) más — ver pestaña ENERGY
              </p>
            )}
          </div>
          <SimulatedTag />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Estado de subsistemas */}
        <Panel title="System status" className="lg:col-span-2">
          <div className="mb-2 flex gap-3 border-b border-neutral-800 pb-2 text-[10px] uppercase tracking-wider text-neutral-600">
            <span className="w-48">Subsistema</span>
            <span className="w-20">Estado lógico</span>
            <span className="w-32">Dispositivo</span>
            <span>Detalle</span>
          </div>
          <ul className="divide-y divide-neutral-800/70">
            {subsystems.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <span className="w-48 shrink-0 truncate text-sm text-neutral-200">{s.label}</span>
                <span className="w-20 shrink-0">
                  <LogicalBadge state={s.logicalState} />
                </span>
                <span className="w-32 shrink-0">
                  <HealthBadge status={s.health} provenance={s.provenance} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500">
                  {s.detail}
                  {s.healthDetail && <span className="text-neutral-600"> · {s.healthDetail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Show actual + transporte */}
        <Panel title="Show actual">
          <p className="truncate text-sm font-medium text-neutral-100">{show?.name ?? 'Ninguno cargado'}</p>
          <p className="mt-0.5 font-mono text-[11px] text-neutral-500">{show?.id ?? '—'}</p>

          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                safeMode
                  ? 'bg-red-900 text-red-200'
                  : transport === 'playing'
                    ? 'bg-emerald-900 text-emerald-300'
                    : 'bg-neutral-800 text-neutral-300'
              }`}
            >
              {safeMode ? 'SAFE MODE' : transport}
            </span>
            <span className="font-mono text-sm tabular-nums text-neutral-300">
              {((showState?.timeMs ?? 0) / 1000).toFixed(1)}s
              <span className="text-neutral-600"> / {((show?.durationMs ?? 0) / 1000).toFixed(0)}s</span>
            </span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={play} disabled={!show || safeMode} className="rounded bg-emerald-700 px-2 py-2 text-xs font-semibold text-emerald-50 disabled:opacity-25">
              PLAY
            </button>
            <button onClick={pause} disabled={!show} className="rounded border border-neutral-700 px-2 py-2 text-xs font-semibold text-neutral-200 disabled:opacity-25">
              PAUSE
            </button>
            <button onClick={stop} disabled={!show} className="rounded border border-neutral-700 px-2 py-2 text-xs font-semibold text-neutral-200 disabled:opacity-25">
              STOP
            </button>
          </div>
          <button
            onClick={toggleSafeMode}
            disabled={!show}
            className={`mt-2 w-full rounded px-2 py-2 text-xs font-semibold disabled:opacity-25 ${
              safeMode ? 'bg-red-600 text-white' : 'border border-red-900 text-red-400'
            }`}
          >
            {safeMode ? 'SALIR DE SAFE MODE' : 'SAFE MODE'}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-neutral-600">
            PAUSE congela el frame. STOP va a negro. SAFE MODE fuerza negro y luz segura.
          </p>
        </Panel>
      </div>

      {/* Modos del edificio */}
      <Panel
        title="Modo del edificio"
        right={<SimulatedTag />}
      >
        <div className="flex flex-wrap gap-2">
          {(Object.keys(BUILDING_MODES) as BuildingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1.5 text-xs font-semibold tracking-wide ${
                mode === m
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'border border-neutral-700 text-neutral-300 hover:border-neutral-500'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] leading-snug text-neutral-400">{BUILDING_MODES[mode].description}</p>

        <label className="mt-2.5 flex items-center gap-2 text-[11px] text-neutral-400">
          <input
            type="checkbox"
            checked={overrideEnabled}
            onChange={(e) => setOverrideEnabled(e.target.checked)}
            className="accent-amber-500"
          />
          Previsualizar la escena del modo
          {preview && preview.overrideBlockedReason === 'SHOW_TIMELINE' && overrideEnabled && (
            <span className="text-amber-500">· no se aplica: el show maneja la iluminación</span>
          )}
          {preview?.source === 'MANUAL_OVERRIDE' && (
            <span className="text-amber-500">· mostrando preview, no el motor</span>
          )}
        </label>
        {effectiveMode && !effectiveMode.matches ? (
          <div className="mt-2 rounded border border-amber-900 bg-amber-950/30 px-2.5 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-500">
              Pedido {effectiveMode.requested} · mostrando {effectiveMode.effective ?? 'escena sin modo'}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-amber-200/80">{effectiveMode.explanation}</p>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-neutral-600">
            Escena activa: <span className="font-mono">{effectiveMode?.activeSceneId ?? '—'}</span> · el estado
            simulado coincide con el modo pedido.
          </p>
        )}
        <p className="mt-1 text-[11px] text-neutral-600">
          Los modos no comandan hardware. El preview del modo solo se aplica si el show no maneja iluminación por
          timeline: cuando la maneja, lo que se ve es exactamente lo que resuelve el motor.
        </p>
      </Panel>

      {/* Resumen eléctrico */}
      <Panel
        title="Red eléctrica"
        right={
          <div className="flex items-center gap-2">
            <SimulatedTag />
            {sample && (
              <span className="font-mono text-[11px] text-neutral-500">{freshnessLabel(sample)}</span>
            )}
          </div>
        }
      >
        {telemetry ? (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Metric
                label="Potencia actual"
                value={fmt.n(telemetry.activePowerKw)}
                unit="kW"
                hint={`${((telemetry.activePowerKw / spec.contractedPowerKw) * 100).toFixed(0)} % de ${spec.contractedPowerKw} kW`}
              />
              <Metric label="Factor de potencia" value={fmt.n(telemetry.powerFactor, 2)} tone={telemetry.powerFactor < 0.92 ? 'warning' : 'neutral'} />
              <Metric label="Energía hoy" value={fmt.n(telemetry.energyTodayKwh, 0)} unit="kWh" />
              <Metric label="Demanda máxima" value={fmt.n(telemetry.peakDemandKw)} unit="kW" hint="hoy" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {PHASES.map((id) => {
                const p = phaseOf(telemetry, id);
                const pct = phaseLoadPercent(p, spec);
                const tone = pct > 95 ? 'critical' : pct > 80 ? 'warning' : 'normal';
                return (
                  <div key={id} className="rounded border border-neutral-800 bg-neutral-950/50 p-2.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-semibold text-neutral-400">{LINE[id]}</span>
                      <span className="font-mono text-sm tabular-nums text-neutral-100">{fmt.n(p.currentA)} A</span>
                    </div>
                    <div className="mt-1.5">
                      <LoadBar percent={pct} tone={tone} />
                    </div>
                    <div className="mt-1 font-mono text-[11px] tabular-nums text-neutral-500">
                      {fmt.n(p.voltageV)} V · {pct.toFixed(0)} %
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-500">Sin telemetría.</p>
        )}
      </Panel>

      <p className="text-[11px] leading-snug text-neutral-600">
        {simulados} de {subsystems.length} subsistemas son simulados: ningún dispositivo físico del edificio está
        conectado todavía, así que el estado lógico refleja lo que pide el show, no lo que hace el hardware.
      </p>
    </div>
  );
}
