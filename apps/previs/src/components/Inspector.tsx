'use client';

import { EL_TRUST, rgbwToHex, DEMO_SCENES, formatIssue } from '@trust/show-engine';
import type { LightingZoneId } from '@trust/shared-types';
import { useShowStore } from '../state/useShowStore';

export function Inspector() {
  const { state, show, error, warnings, mediaErrors, cameraMode } = useShowStore();
  const { setZone, applyScene, loadShow, setCameraMode, retryMedia } = useShowStore();
  const hayErroresDeMedia = Object.keys(mediaErrors).length > 0;

  // La membresia de grupo la define el show, no el edificio (ADR-013).
  const groupOfScreen = (id: string): string | null => {
    if (!show) return null;
    for (const [gid, g] of Object.entries(show.mediaGroups)) {
      if (id in g.layout) return gid;
    }
    return null;
  };

  // Deriva A/B calculada del estado del motor: si es > 0 el frame-lock fallo.
  const abDrift =
    state && state.screens.screen_a.cue === 'playing' && state.screens.screen_b.cue === 'playing'
      ? Math.abs(state.screens.screen_a.mediaTimeMs - state.screens.screen_b.mediaTimeMs)
      : null;

  const onFile = async (file: File) => {
    try {
      loadShow(JSON.parse(await file.text()));
    } catch {
      useShowStore.setState({ error: 'JSON inválido' });
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-950 text-sm">
      <section className="border-b border-neutral-800 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Show</h2>
        <p className="font-medium text-amber-200">{show?.name ?? 'Ninguno cargado'}</p>
        {show && <p className="mt-0.5 font-mono text-xs text-neutral-500">{show.id}</p>}
        <label className="mt-3 block cursor-pointer rounded border border-dashed border-neutral-700 px-3 py-2 text-center text-xs text-neutral-400 hover:border-amber-600">
          Cargar SHOW PACKAGE (.json)
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
        {error && (
          <div className="mt-2 rounded border border-red-900 bg-red-950/40 p-2">
            <p className="text-[11px] font-semibold uppercase text-red-400">Preflight falló</p>
            <p className="mt-1 text-xs text-red-300">{error}</p>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-2 rounded border border-amber-900 bg-amber-950/30 p-2">
            <p className="text-[11px] font-semibold uppercase text-amber-500">
              {warnings.length} advertencia{warnings.length > 1 ? 's' : ''}
            </p>
            <ul className="mt-1 space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="text-[11px] leading-snug text-amber-200/80">
                  {formatIssue(w)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="border-b border-neutral-800 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Pantallas
          </h2>
          {hayErroresDeMedia && (
            <button
              onClick={retryMedia}
              className="rounded bg-red-900 px-2 py-1 text-[11px] font-semibold text-red-200"
            >
              Reintentar clips
            </button>
          )}
          {abDrift !== null && (
            <span
              className={`font-mono text-[11px] ${abDrift === 0 ? 'text-emerald-400' : 'text-red-400'}`}
            >
              A/B Δ {abDrift}ms
            </span>
          )}
        </div>
        {EL_TRUST.screens.map((surface) => {
          const rt = state?.screens[surface.id];
          return (
            <div key={surface.id} className="mb-2 rounded bg-neutral-900 p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{surface.name}</span>
                <span
                  className={
                    rt?.output === 'live'
                      ? 'text-emerald-400'
                      : rt?.output === 'hold'
                        ? 'text-amber-400'
                        : 'text-neutral-600'
                  }
                >
                  {rt?.output === 'live' ? '● LIVE' : rt?.output === 'hold' ? '⏸ HOLD' : '■ BLACK'}
                </span>
              </div>
              <div className="font-mono text-[11px] text-neutral-600">
                cue: {rt?.cue}
                {groupOfScreen(surface.id) ? ` · grupo ${groupOfScreen(surface.id)}` : ''}
              </div>
              <div className="mt-1 font-mono text-[11px] text-neutral-500">
                {surface.physicalWidthM}×{surface.physicalHeightM} m · {surface.pixelWidth}×
                {surface.pixelHeight} px
              </div>
              <div className="font-mono text-[11px] text-neutral-400">
                clip @ {((rt?.mediaTimeMs ?? 0) / 1000).toFixed(2)}s
              </div>
              {rt?.source && mediaErrors[rt.source] && (
                <div className="mt-1 text-[11px] text-red-400">
                  clip no carga: {mediaErrors[rt.source]}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="border-b border-neutral-800 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Cámara
        </h2>
        <div className="flex gap-2">
          {(['interactive', 'deterministic'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setCameraMode(m)}
              className={`flex-1 rounded px-2 py-1.5 text-xs ${
                cameraMode === m
                  ? 'bg-amber-500 text-neutral-950'
                  : 'border border-neutral-700 text-neutral-300'
              }`}
            >
              {m === 'interactive' ? 'Interactiva' : 'Determinista'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-neutral-500">
          Determinista corta exacto al preset. Es el modo válido para aprobar contenido.
        </p>
      </section>

      <section className="border-b border-neutral-800 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Escenas</h2>
        <div className="flex flex-wrap gap-2">
          {[...DEMO_SCENES.keys()].map((id) => (
            <button
              key={id}
              onClick={() => applyScene(id)}
              className={`rounded px-2.5 py-1.5 text-xs ${
                state?.lightingSceneId === id
                  ? 'bg-amber-500 text-neutral-950'
                  : 'border border-neutral-700 text-neutral-300'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </section>

      <section className="p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Zonas de iluminación
        </h2>
        {EL_TRUST.lightingZones.map((zone) => {
          const rt = state?.zones[zone.id];
          return (
            <div key={zone.id} className="mb-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm border border-neutral-700"
                  style={{
                    background: rt ? rgbwToHex(rt.color) : '#000',
                    opacity: rt ? 0.25 + rt.intensity * 0.75 : 0.2,
                  }}
                />
                <span className="flex-1 truncate text-xs">{zone.name}</span>
                <span className="font-mono text-[11px] text-neutral-500">
                  {Math.round((rt?.intensity ?? 0) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((rt?.intensity ?? 0) * 100)}
                onChange={(e) =>
                  setZone(zone.id as LightingZoneId, { intensity: Number(e.target.value) / 100 })
                }
                className="w-full accent-amber-600"
              />
            </div>
          );
        })}
      </section>
    </aside>
  );
}
