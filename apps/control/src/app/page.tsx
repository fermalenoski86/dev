'use client';

import { useEffect, useState } from 'react';
import { TELEMETRY_SCENARIOS, SCENARIO_LABELS, type TelemetryScenario } from '@trust/telemetry';
import { worstDeviceHealth, hasVerifiedDevices } from '@trust/control-core';
import { useControlStore } from '../state/useControlStore';
import { StatusDot, HEALTH_STYLE, fmt } from '../components/primitives';
import { Overview } from '../components/Overview';
import { Energy } from '../components/Energy';
import { Events } from '../components/Events';
import { Assistant } from '../components/Assistant';
import { TakeoverBuilder } from '../components/builder/TakeoverBuilder';

const TABS = ['OVERVIEW', 'ENERGY', 'EVENTS', 'BUILDER', 'AI'] as const;
type Tab = (typeof TABS)[number];

/**
 * El selector de escenario es una herramienta de desarrollo: permite forzar
 * subtensión o pérdida de fase para probar la UI. En producción no debe estar,
 * porque un operador no tiene por qué poder cambiar lo que "mide" el sistema.
 */
const DEV_MODE = process.env.NODE_ENV !== 'production';

export default function Page() {
  const [tab, setTab] = useState<Tab>('OVERVIEW');
  const { subsystems, unacknowledged, safeMode, scenario, sample, now, faultMode } = useControlStore();
  const { loadShow, tick, setScenario, setFaultMode } = useControlStore();
  const telemetry = sample?.telemetry ?? null;

  useEffect(() => {
    fetch('/shows/trust_signature_001.json')
      .then((r) => r.json())
      .then(loadShow)
      .catch(() => undefined);
  }, [loadShow]);

  // Un tick por segundo: la telemetría de un analizador real ronda 1 Hz y el
  // show se muestrea a la misma cadencia porque acá no se renderiza 3D.
  useEffect(() => {
    tick(Date.now());
    const id = setInterval(() => tick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tick]);

  const overall = subsystems.length ? worstDeviceHealth(subsystems) : 'OFFLINE';
  const verificados = hasVerifiedDevices(subsystems);
  const simulados = subsystems.filter((s) => s.provenance === 'SIMULATED').length;
  const style = HEALTH_STYLE[overall];

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <div>
            <h1 className="text-[13px] font-semibold tracking-[0.22em] text-neutral-100">MASTER OF TRUST</h1>
            <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">Control center</p>
          </div>

          <div className="flex items-center gap-2">
            <StatusDot status={overall} pulse />
            {/*
              M2A.1 / punto 1: el header NO dice "SYSTEM ONLINE" mientras no
              haya un solo dispositivo verificado. Decirlo seria afirmar que
              alguien comprobo el edificio.
            */}
            <span className={`text-[12px] font-semibold tracking-wide ${style.text}`}>
              {safeMode ? 'SAFE MODE' : verificados ? `SYSTEM ${style.label}` : 'SYSTEM SIMULATED'}
            </span>
            {safeMode && <span className="text-[11px] text-red-400">pantallas en negro</span>}
            {!verificados && simulados > 0 && (
              <span className="text-[11px] text-sky-500">{simulados} subsistemas simulados</span>
            )}
          </div>

          {unacknowledged > 0 && (
            <span className="rounded border border-amber-900 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-300">
              {unacknowledged} sin reconocer
            </span>
          )}

          <nav className="ml-auto flex gap-1">
            {TABS.map((t) => (
              <button
                key={t}
                data-testid={`tab-${t.toLowerCase()}`}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1.5 text-[11px] font-semibold tracking-wider ${
                  tab === t ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>

          <a
            href="/experience"
            data-testid="open-experience"
            className="rounded border border-neutral-700 px-3 py-1.5 text-[11px] font-semibold tracking-wider text-neutral-300 hover:border-neutral-500"
          >
            CLIENT EXPERIENCE
          </a>

          <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-neutral-500">
            {telemetry && <span>{fmt.n(telemetry.activePowerKw)} kW</span>}
            <span>{now ? fmt.time(now) : '--:--:--'}</span>
          </div>
        </div>

        {DEV_MODE && (
          <div className="border-t border-neutral-800/70 bg-neutral-900/60">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-5 py-1.5">
              <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Dev
              </span>
              <span className="text-[11px] text-neutral-500">Escenario eléctrico simulado:</span>
              {TELEMETRY_SCENARIOS.map((s) => (
                <button
                  key={s}
                  onClick={() => setScenario(s as TelemetryScenario)}
                  title={SCENARIO_LABELS[s]}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    scenario === s ? 'bg-neutral-200 text-neutral-900' : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {s}
                </button>
              ))}
              <span className="ml-3 text-[11px] text-neutral-500">Enlace con el medidor:</span>
              {(['none', 'stale', 'comm_error'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFaultMode(f)}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    faultMode === f ? 'bg-neutral-200 text-neutral-900' : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {f === 'none' ? 'OK' : f === 'stale' ? 'SIN PUBLICAR' : 'ERROR COMM'}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className={`mx-auto px-5 py-5 ${tab === 'BUILDER' ? 'max-w-[1800px]' : 'max-w-[1500px]'}`}>
        {tab === 'OVERVIEW' && <Overview />}
        {tab === 'ENERGY' && <Energy />}
        {tab === 'EVENTS' && <Events />}
        {tab === 'BUILDER' && <TakeoverBuilder />}
        {tab === 'AI' && <Assistant />}
      </div>

      <footer className="mx-auto max-w-[1500px] px-5 pb-6 text-[11px] leading-snug text-neutral-600">
        TRUST CONTROL · Milestone 2A — centro de control con telemetría <strong className="text-neutral-500">simulada</strong>.
        No hay hardware conectado: ni analizador de red, ni DMX, ni Art-Net, ni procesadores LED. El frontend nunca habla
        con hardware; cuando exista, será TRUST EDGE quien lo haga.
      </footer>
    </main>
  );
}
