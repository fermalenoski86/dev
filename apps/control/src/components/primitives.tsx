'use client';

import type { DeviceHealth, LogicalState, Provenance } from '@trust/control-core';

/**
 * Primitivas visuales.
 *
 * Criterio de color: el color comunica severidad y NADA mas. Verde solo para
 * normal verificado, ambar advertencia, rojo critico. Todo lo demas neutro.
 * En una sala de control, si el color decora deja de avisar.
 *
 * M2A.2 / punto 3: la salud y la procedencia se pintan por separado. Un
 * dispositivo simulado puede estar CRITICAL — la falla se ve — y sigue
 * marcado SIMULATED en azul, porque nadie lo midio. El verde solo aparece
 * junto a `provenance: REAL`.
 */

export const HEALTH_STYLE: Record<DeviceHealth, { dot: string; text: string; label: string }> = {
  ONLINE: { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'ONLINE' },
  OFFLINE: { dot: 'bg-neutral-600', text: 'text-neutral-400', label: 'OFFLINE' },
  WARNING: { dot: 'bg-amber-500', text: 'text-amber-400', label: 'WARNING' },
  CRITICAL: { dot: 'bg-red-500', text: 'text-red-400', label: 'CRITICAL' },
  STALE: { dot: 'bg-amber-600', text: 'text-amber-300', label: 'STALE' },
};

export const LOGICAL_STYLE: Record<LogicalState, { text: string; label: string }> = {
  LIVE: { text: 'text-neutral-100', label: '● LIVE' },
  HOLD: { text: 'text-neutral-300', label: '⏸ HOLD' },
  BLACK: { text: 'text-neutral-500', label: '■ BLACK' },
  IDLE: { text: 'text-neutral-600', label: '· IDLE' },
};

export function StatusDot({
  status,
  pulse = false,
  muted = false,
}: {
  status: DeviceHealth;
  pulse?: boolean;
  muted?: boolean;
}) {
  const base = HEALTH_STYLE[status];
  const s = muted ? { ...base, dot: 'bg-neutral-500' } : base;
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {pulse && (status === 'CRITICAL' || status === 'STALE') && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${s.dot}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${s.dot}`} />
    </span>
  );
}

/**
 * Salud + procedencia juntas. Un ONLINE simulado se pinta neutro, no verde:
 * el verde comunica "comprobado", y sin instrumento no hay comprobacion.
 */
export function HealthBadge({
  status,
  provenance = 'SIMULATED',
}: {
  status: DeviceHealth;
  provenance?: Provenance;
}) {
  const s = HEALTH_STYLE[status];
  const simulado = provenance === 'SIMULATED';
  const color = simulado && status === 'ONLINE' ? 'text-neutral-400' : s.text;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide">
      <span className={color}>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status={status} muted={simulado && status === 'ONLINE'} />
          {s.label}
        </span>
      </span>
      {simulado && <span className="text-[10px] uppercase text-sky-500">sim</span>}
    </span>
  );
}

export function LogicalBadge({ state }: { state: LogicalState }) {
  const s = LOGICAL_STYLE[state];
  return <span className={`text-[11px] font-medium tracking-wide ${s.text}`}>{s.label}</span>;
}

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-neutral-800 bg-neutral-900/40 ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Dato numérico grande. Tabular para que no baile al actualizarse. */
export function Metric({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: 'neutral' | 'normal' | 'warning' | 'critical';
}) {
  const toneClass =
    tone === 'critical'
      ? 'text-red-400'
      : tone === 'warning'
        ? 'text-amber-400'
        : tone === 'normal'
          ? 'text-emerald-400'
          : 'text-neutral-100';
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums leading-none ${toneClass}`}>
        {value}
        {unit && <span className="ml-1 text-sm text-neutral-500">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] text-neutral-600">{hint}</div>}
    </div>
  );
}

/** Barra horizontal de carga. Sin velocímetros: esto se lee de un vistazo. */
export function LoadBar({ percent, tone }: { percent: number; tone: 'normal' | 'warning' | 'critical' }) {
  const width = Math.min(100, Math.max(0, percent));
  const color = tone === 'critical' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function SimulatedTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-sky-900 bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400 ${className}`}
      title="Dato generado por simulador. No hay analizador de red conectado."
    >
      Simulated
    </span>
  );
}

export const fmt = {
  n: (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d)),
  time: (ms: number) =>
    new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  dateTime: (ms: number) =>
    new Date(ms).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};
