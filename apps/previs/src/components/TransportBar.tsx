'use client';

import { EL_TRUST } from '@trust/show-engine';
import type { CameraId } from '@trust/shared-types';
import { useShowStore } from '../state/useShowStore';

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(
    Math.floor((ms % 1000) / 100),
  )}`;
};

export function TransportBar() {
  const { show, status, timeMs, durationMs, safeMode, state } = useShowStore();
  const { play, pause, stop, seek, nudge, setCamera, toggleSafeMode } = useShowStore();

  return (
    <div className="border-t border-neutral-800 bg-neutral-950/95 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={status === 'playing' ? pause : play}
          disabled={!show || safeMode}
          className="w-24 rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-30"
        >
          {status === 'playing' ? 'PAUSE' : status === 'ended' ? 'REPLAY' : 'PLAY'}
        </button>
        <button onClick={stop} disabled={!show} className="rounded border border-neutral-700 px-3 py-2 text-sm disabled:opacity-30">
          STOP
        </button>
        <button onClick={() => nudge(-5000)} disabled={!show} className="rounded border border-neutral-700 px-3 py-2 text-sm disabled:opacity-30">
          −5s
        </button>
        <button onClick={() => nudge(5000)} disabled={!show} className="rounded border border-neutral-700 px-3 py-2 text-sm disabled:opacity-30">
          +5s
        </button>

        <span
          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            status === 'playing'
              ? 'bg-emerald-900 text-emerald-300'
              : status === 'ended'
                ? 'bg-neutral-800 text-neutral-400'
                : 'bg-amber-900/60 text-amber-300'
          }`}
        >
          {status}
        </span>
        <span className="font-mono text-sm tabular-nums text-amber-200">
          {fmt(timeMs)} <span className="text-neutral-600">/ {fmt(durationMs)}</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={state?.camera ?? 'hero_obelisco'}
            onChange={(e) => setCamera(e.target.value as CameraId)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            {EL_TRUST.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.locked ? ' · fija' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={toggleSafeMode}
            className={`rounded px-3 py-2 text-sm font-semibold ${
              safeMode ? 'bg-red-600 text-white' : 'border border-red-900 text-red-400'
            }`}
          >
            SAFE MODE
          </button>
        </div>
      </div>

      {/* Timeline scrub + marcas de eventos */}
      <div className="relative mt-3">
        <input
          type="range"
          min={0}
          max={durationMs}
          value={timeMs}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!show}
          className="w-full accent-amber-500"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-2">
          {show?.timeline.map((e, i) => (
            <div
              key={i}
              title={`${e.type} @ ${e.atMs}ms`}
              className="absolute h-2 w-0.5 bg-amber-400/70"
              style={{ left: `${(e.atMs / durationMs) * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
