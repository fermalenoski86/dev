'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DRAFT_PRESETS, MIN_MOMENT_MS, momentSpans, totalDurationMs } from '@trust/show-authoring';
import type { BuilderIssue, ScreenDirective, TakeoverMoment } from '@trust/show-authoring';
import { campaignIdFromSearch } from '@trust/builder-repository';
import { BUILDING, SCENE_IDS, useBuilderStore } from '../../state/useBuilderStore';
import { CampaignStatus } from './CampaignStatus';
import { SchematicPreviewRenderer } from './PreviewRenderer';
import { Panel, fmt } from '../primitives';

/**
 * TAKEOVER BUILDER.
 *
 * Autoría, no operación. No comanda hardware, no publica, no toca EDGE.
 * Exportar un ShowPackage no lo pone al aire.
 *
 * El preview corre sobre un `ShowEngine` real: no hay un segundo motor.
 */

const fmtMs = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;

export function TakeoverBuilder() {
  const {
    draft, validation, previewState, transport, timeMs, compiled,
    selectedMomentId, dirty, presentMode, showCompiled, assets,
  } = useBuilderStore();

  /*
   * M2C.1.1 / punto 2: la UI NO decide si se puede previsualizar. Pregunta al
   * store, que usa `canPreview(validation)` — la misma funcion que aplica la
   * sesion antes de cada comando. Un `disabled` es una comodidad visual, no la
   * regla: la regla ya esta del lado del estado.
   */
  const previewAllowed = useBuilderStore((st) => st.canPreview());
  const engineCurrent = useBuilderStore((st) => st.engineCurrent);
  const {
    loadPreset, selectMoment, patchMoment, patchSurfaces, patchMeta,
    addMomentAt, duplicate, remove, move, revalidate,
    play, pause, stop, restart, scrub, tick, save, loadFromStorage,
    importDraft, setPresentMode, setShowCompiled, connectCampaign, syncCampaign,
  } = useBuilderStore();

  const total = totalDurationMs(draft);
  const spans = momentSpans(draft);
  const selected = draft.moments.find((m) => m.id === selectedMomentId) ?? null;

  useEffect(() => {
    // D3 (#15): con `?campaign=<uuid>` el draft sale del backend (§31). Sin
    // eso, o si la campaña no abre, el Builder sigue como en M2C.
    const campaignId = campaignIdFromSearch(window.location.search);
    if (campaignId) {
      void connectCampaign(campaignId).then((ok) => {
        if (!ok && !loadFromStorage()) revalidate();
      });
      return;
    }
    if (!loadFromStorage()) revalidate();
  }, [loadFromStorage, revalidate, connectCampaign]);

  // D3: al volver la conexión se sube lo pendiente (§9 "online: sincroniza").
  useEffect(() => {
    window.addEventListener('online', syncCampaign);
    return () => window.removeEventListener('online', syncCampaign);
  }, [syncCampaign]);

  // El playhead se lee del motor, no se calcula acá.
  useEffect(() => {
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [tick]);

  // Autosave, con margen para no escribir en cada tecla.
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(save, 1500);
    return () => clearTimeout(id);
  }, [dirty, draft, save]);

  const labels = useMemo(() => {
    const s = draft.surfaces;
    const nombre = (id: string | null) => assets.get(id)?.name;
    return s.upperMode === 'master'
      ? { screen_a: nombre(s.masterAssetId), screen_b: nombre(s.masterAssetId), horizontal: nombre(s.horizontalAssetId) }
      : { screen_a: nombre(s.corrientesAssetId), screen_b: nombre(s.pellegriniAssetId), horizontal: nombre(s.horizontalAssetId) };
  }, [draft.surfaces, assets]);

  if (presentMode) {
    return (
      <PresentMode
        draft={draft}
        state={previewState}
        transport={transport}
        timeMs={timeMs}
        total={total}
        labels={labels}
        onPlay={play}
        onStop={stop}
        onExit={() => setPresentMode(false)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <TopBar
        onPreset={loadPreset}
        onPresent={() => { setPresentMode(true); restart(); }}
        presentDisabled={!previewAllowed}
        onSave={save}
        onImport={importDraft}
        onToggleCompiled={() => setShowCompiled(!showCompiled)}
      />

      <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <AssetsPanel />
        <div className="space-y-3">
          <Panel
            title="Preview"
            right={
              <span className="font-mono text-[11px] tabular-nums text-neutral-500">
                {fmt.n(timeMs / 1000, 1)}s / {fmt.n(total / 1000, 1)}s
              </span>
            }
          >
            <div className="mx-auto aspect-[420/460] max-h-[460px] w-full max-w-[420px]">
              <SchematicPreviewRenderer state={previewState} labels={labels} />
            </div>
            <Transport
              transport={transport}
              onPlay={play}
              onPause={pause}
              onStop={stop}
              onRestart={restart}
              current={engineCurrent}
              blocked={!previewAllowed}
            />
          </Panel>
          {showCompiled && <CompiledView json={compiled} />}
        </div>
        <div className="space-y-3">
          <PreflightPanel />
          <Properties
            moment={selected}
            onPatch={(p) => selected && patchMoment(selected.id, p)}
            onPatchMeta={patchMeta}
            onPatchSurfaces={patchSurfaces}
          />
        </div>
      </div>

      <Timeline
        spans={spans}
        total={total}
        timeMs={timeMs}
        selectedId={selectedMomentId}
        issues={validation?.errors ?? []}
        onSelect={selectMoment}
        onScrub={scrub}
        onAdd={addMomentAt}
        onDuplicate={duplicate}
        onRemove={remove}
        onMove={move}
        onDuration={(id, ms) => patchMoment(id, { durationMs: Math.max(MIN_MOMENT_MS, ms) })}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function TopBar({
  onPreset, onPresent, onSave, onImport, onToggleCompiled, presentDisabled,
}: {
  onPreset: (b: () => ReturnType<(typeof DRAFT_PRESETS)[number]['build']>) => void;
  onPresent: () => void;
  onSave: () => void;
  onImport: (raw: unknown) => { ok: boolean; message?: string };
  onToggleCompiled: () => void;
  presentDisabled: boolean;
}) {
  const { draft, dirty, validation, compiled } = useBuilderStore();
  const needsDiscardConfirmation = useBuilderStore((st) => st.needsDiscardConfirmation);
  const fileRef = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const descargar = (nombre: string, datos: unknown) => {
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importar = async (file: File) => {
    // Cambiar de draft con cambios sin guardar pierde una campaña.
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Importar igual y descartarlos?')) return;
    try {
      const r = onImport(JSON.parse(await file.text()));
      setAviso(r.ok ? 'Draft importado.' : `Draft inválido: ${r.message}`);
    } catch {
      setAviso('El archivo no es JSON válido.');
    }
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <input
            value={draft.campaignName}
            onChange={(e) => useBuilderStore.getState().patchMeta({ campaignName: e.target.value })}
            placeholder="Nombre de campaña"
            className="w-56 border-0 bg-transparent p-0 text-[15px] font-semibold text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
          />
          <input
            value={draft.clientName}
            onChange={(e) => useBuilderStore.getState().patchMeta({ clientName: e.target.value })}
            placeholder="Cliente"
            className="block w-56 border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-neutral-500 placeholder:text-neutral-700 focus:outline-none"
          />
        </div>

        {/*
          M2C.1.2 / punto 4: el estado de guardado se muestra SIEMPRE, no solo
          cuando esta sucio. Un test (y un operador) no puede afirmar sobre la
          ausencia de un cartel: la ausencia tambien ocurre cuando la UI no
          cargo. Con el nodo presente, SAVED es una afirmacion positiva.
        */}
        <span
          data-testid="save-state"
          className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            dirty
              ? 'border-amber-900 bg-amber-950/40 text-amber-400'
              : 'border-neutral-800 bg-neutral-900/60 text-neutral-500'
          }`}
        >
          {dirty ? 'UNSAVED' : 'SAVED'}
        </span>

        <CampaignStatus />

        <select
          data-testid="preset-select"
          onChange={(e) => {
            const p = DRAFT_PRESETS.find((x) => x.id === e.target.value);
            if (!p) return;
            /*
             * M2C.1.1 / punto 3: el selector de presets es un <select>.
             * Cambiarlo sin querer es trivial, y antes se llevaba puesta la
             * campania sin preguntar. Misma confirmacion que IMPORT.
             */
            if (needsDiscardConfirmation() && !window.confirm('Hay cambios sin guardar. ¿Descartarlos y cargar el preset?')) {
              e.target.value = '';
              return;
            }
            onPreset(p.build);
          }}
          defaultValue=""
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-300"
        >
          <option value="" disabled>Cargar preset…</option>
          {DRAFT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Btn onClick={onSave}>Guardar</Btn>
          <Btn onClick={() => descargar(`${draft.id}.draft.json`, draft)}>Exportar draft</Btn>
          <Btn onClick={() => fileRef.current?.click()}>Importar</Btn>
          <Btn onClick={onToggleCompiled}>Ver compilado</Btn>
          <Btn
            onClick={() => compiled && descargar(`${draft.id}.show.json`, compiled)}
            disabled={!validation?.exportable || !compiled}
            title={validation?.exportable ? 'Descargar SHOW PACKAGE' : 'Preflight bloqueado'}
            primary
          >
            Exportar SHOW PACKAGE
          </Btn>
          <Btn onClick={onPresent} disabled={presentDisabled} title={presentDisabled ? 'Preflight bloqueado: no hay nada seguro que mostrar' : undefined}>
            Presentar
          </Btn>
        </div>
      </div>

      {aviso && <p className="mt-2 text-[11px] text-neutral-400">{aviso}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])}
      />
    </div>
  );
}

function Btn({
  children, onClick, disabled, primary, title, testId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-30 ${
        primary
          ? 'bg-neutral-100 text-neutral-900'
          : 'border border-neutral-700 text-neutral-300 hover:border-neutral-500'
      }`}
    >
      {children}
    </button>
  );
}

/* ── Assets ──────────────────────────────────────────────────── */

function AssetsPanel() {
  const { draft, assets, validation } = useBuilderStore();
  const { patchSurfaces } = useBuilderStore();
  const s = draft.surfaces;

  const problemasDe = (assetId: string | null) => {
    if (!assetId || !validation) return [];
    const nombre = assets.get(assetId)?.name;
    return validation.errors
      .concat(validation.warnings)
      .filter((i) => i.origin === 'asset' && nombre && i.message.includes(nombre));
  };

  const Selector = ({
    label,
    value,
    onChange,
    testId,
  }: {
    label: string;
    value: string | null;
    onChange: (v: string | null) => void;
    /** M2C.1.2 / punto 2: el E2E elige assets por ACA, no por el SVG del preview. */
    testId: string;
  }) => {
    const issues = problemasDe(value);
    const estado = issues.some((i) => i.severity === 'error') ? 'BLOCKED' : issues.length ? 'WARNING' : value ? 'OK' : 'VACÍO';
    return (
      <div className="mb-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</span>
          <span
            className={`text-[10px] font-semibold ${
              estado === 'BLOCKED' ? 'text-red-400' : estado === 'WARNING' ? 'text-amber-400' : estado === 'OK' ? 'text-emerald-400' : 'text-neutral-600'
            }`}
          >
            {estado}
          </span>
        </div>
        <select
          data-testid={testId}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[12px] text-neutral-200"
        >
          <option value="">— sin asignar —</option>
          {assets.list().map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.width}×{a.height}
              {a.unmanaged ? ' · LOCAL' : ''}
            </option>
          ))}
        </select>
        {issues.map((i, k) => (
          <p key={k} className={`mt-1 text-[10px] leading-snug ${i.severity === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
            {i.message}
          </p>
        ))}
      </div>
    );
  };

  return (
    <Panel title="Assets de campaña">
      <p className="mb-3 text-[11px] leading-snug text-neutral-500">
        El asset se asigna por superficie a nivel campaña: el contrato del show admite una fuente por pantalla. Los
        moments controlan la reproducción, no el archivo.
      </p>

      <div className="mb-3">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-neutral-500">Torres A+B</span>
        <div className="flex gap-1">
          {(['master', 'independent'] as const).map((m) => (
            <button
              key={m}
              onClick={() => patchSurfaces({ upperMode: m })}
              className={`flex-1 rounded px-2 py-1.5 text-[11px] ${
                s.upperMode === m ? 'bg-neutral-100 text-neutral-900' : 'border border-neutral-700 text-neutral-400'
              }`}
            >
              {m === 'master' ? 'A+B Master' : 'Independiente'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-neutral-600">
          {s.upperMode === 'master'
            ? 'Un lienzo 2592×576 repartido por uvRect. Frame-lock por construcción: un solo decoder.'
            : 'Un archivo por torre, un decoder cada una. Pueden derivar entre sí.'}
        </p>
      </div>

      {s.upperMode === 'master' ? (
        <Selector testId="asset-master-select" label="Master A+B" value={s.masterAssetId} onChange={(v) => patchSurfaces({ masterAssetId: v })} />
      ) : (
        <>
          <Selector testId="asset-corrientes-select" label="Corrientes" value={s.corrientesAssetId} onChange={(v) => patchSurfaces({ corrientesAssetId: v })} />
          <Selector testId="asset-pellegrini-select" label="Pellegrini" value={s.pellegriniAssetId} onChange={(v) => patchSurfaces({ pellegriniAssetId: v })} />
        </>
      )}
      <Selector testId="asset-horizontal-select" label="Horizontal" value={s.horizontalAssetId} onChange={(v) => patchSurfaces({ horizontalAssetId: v })} />

      <label className="mt-1 flex items-start gap-2 text-[11px] text-neutral-400">
        <input
          type="checkbox"
          checked={s.includeHorizontalInMaster}
          disabled={s.upperMode !== 'master'}
          onChange={(e) => patchSurfaces({ includeHorizontalInMaster: e.target.checked })}
          className="mt-0.5 accent-amber-500"
        />
        <span>
          Incluir la horizontal en el grupo
          {s.includeHorizontalInMaster && (
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-amber-500">
              Sync hardware not verified
            </span>
          )}
        </span>
      </label>

      <p className="mt-3 border-t border-neutral-800 pt-2 text-[10px] leading-snug text-neutral-600">
        Solo se admiten assets en <span className="font-mono">/demo/</span> y{' '}
        <span className="font-mono">/assets/</span>. Nada de URLs.
      </p>
    </Panel>
  );
}

/* ── Preflight ───────────────────────────────────────────────── */

function PreflightPanel() {
  const validation = useBuilderStore((s) => s.validation);
  const selectMoment = useBuilderStore((s) => s.selectMoment);
  if (!validation) return null;

  const { status, errors, warnings } = validation;
  const color =
    status === 'BLOCKED' ? 'border-red-900 bg-red-950/30' : status === 'WARNING' ? 'border-amber-900 bg-amber-950/20' : 'border-emerald-900 bg-emerald-950/20';
  const texto = status === 'BLOCKED' ? 'text-red-400' : status === 'WARNING' ? 'text-amber-400' : 'text-emerald-400';

  const fila = (i: BuilderIssue, k: number) => (
    <li key={k} className="py-1">
      <button
        onClick={() => i.momentId && selectMoment(i.momentId)}
        className="text-left text-[11px] leading-snug"
        disabled={!i.momentId}
      >
        <span className={`font-mono text-[10px] ${i.severity === 'error' ? 'text-red-400' : 'text-amber-400'}`}>
          {i.code}
        </span>
        <span className="ml-1.5 text-neutral-400">{i.message}</span>
        <span className="ml-1 text-[10px] text-neutral-600">({i.origin})</span>
      </button>
    </li>
  );

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${color}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Preflight</span>
        <span data-testid="preflight-status" className={`text-[12px] font-bold tracking-wide ${texto}`}>{status}</span>
      </div>
      {errors.length === 0 && warnings.length === 0 ? (
        <p className="mt-1 text-[11px] text-neutral-500">Sin observaciones. El paquete es exportable.</p>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-800/60">
          {errors.map(fila)}
          {warnings.map((w, k) => fila(w, 1000 + k))}
        </ul>
      )}
      {status === 'BLOCKED' && (
        <p className="mt-2 text-[10px] text-red-300/80">No se puede exportar mientras haya bloqueos.</p>
      )}
    </div>
  );
}

/* ── Properties ──────────────────────────────────────────────── */

function Properties({
  moment, onPatch, onPatchMeta, onPatchSurfaces,
}: {
  moment: TakeoverMoment | null;
  onPatch: (p: Partial<TakeoverMoment>) => void;
  onPatchMeta: (p: { closingSceneId?: string }) => void;
  onPatchSurfaces: (p: { upperMode?: 'master' | 'independent' }) => void;
}) {
  const draft = useBuilderStore((s) => s.draft);
  if (!moment) return <Panel title="Propiedades"><p className="text-[12px] text-neutral-600">Seleccioná un moment.</p></Panel>;

  const screens = moment.screens;
  const set = (patch: Partial<typeof screens>) => onPatch({ screens: { ...screens, ...patch } });

  return (
    <Panel title="Propiedades del moment">
      <label className="mb-2 block">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-neutral-500">Nombre</span>
        <input
          value={moment.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[12px] text-neutral-200"
        />
      </label>

      <label className="mb-3 block">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-neutral-500">Duración (ms)</span>
        <input
          data-testid="moment-duration-field"
          type="number"
          min={MIN_MOMENT_MS}
          step={100}
          value={moment.durationMs}
          onChange={(e) => onPatch({ durationMs: Math.max(MIN_MOMENT_MS, Number(e.target.value) || MIN_MOMENT_MS) })}
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-[12px] tabular-nums text-neutral-200"
        />
      </label>

      <div className="mb-3 border-t border-neutral-800 pt-2">
        <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-neutral-500">Pantallas</span>
        {draft.surfaces.upperMode === 'master' ? (
          <DirectiveRow label="Torres A+B" value={screens.upper} onChange={(v) => set({ upper: v })} />
        ) : (
          <>
            <DirectiveRow label="Corrientes" value={screens.corrientes} onChange={(v) => set({ corrientes: v })} />
            <DirectiveRow label="Pellegrini" value={screens.pellegrini} onChange={(v) => set({ pellegrini: v })} />
          </>
        )}
        <DirectiveRow label="Horizontal" value={screens.horizontal} onChange={(v) => set({ horizontal: v })} />
        <p className="mt-1 text-[10px] leading-snug text-neutral-600">
          El modo de las torres es de campaña, no de moment: <span className="font-mono">mediaGroups</span> es global en
          el show package.{' '}
          <button onClick={() => onPatchSurfaces({})} className="underline decoration-dotted">
            Se cambia en Assets.
          </button>
        </p>
      </div>

      <div className="mb-3 border-t border-neutral-800 pt-2">
        <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-neutral-500">Iluminación</span>
        <div className="flex gap-1">
          <ModeBtn active={moment.lighting.mode === 'inherit'} onClick={() => onPatch({ lighting: { mode: 'inherit' } })}>
            Heredar
          </ModeBtn>
          <ModeBtn
            active={moment.lighting.mode === 'scene'}
            onClick={() => onPatch({ lighting: { mode: 'scene', sceneId: SCENE_IDS[0] ?? 'trust_normal' } })}
          >
            Escena
          </ModeBtn>
        </div>
        {moment.lighting.mode === 'scene' && (
          <SceneEditor lighting={moment.lighting} onPatch={onPatch} />
        )}
      </div>

      <div className="mb-3 border-t border-neutral-800 pt-2">
        <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-neutral-500">Reloj</span>
        <div className="flex flex-wrap gap-1">
          <ModeBtn active={moment.clock.mode === 'inherit'} onClick={() => onPatch({ clock: { mode: 'inherit' } })}>
            Heredar
          </ModeBtn>
          {(['normal', 'accent', 'countdown', 'off'] as const).map((v) => (
            <ModeBtn
              key={v}
              active={moment.clock.mode === 'state' && moment.clock.value === v}
              onClick={() => onPatch({ clock: { mode: 'state', value: v } })}
            >
              {v}
            </ModeBtn>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-neutral-600">
          BRAND y EVENT son capacidades futuras: el contrato del motor todavía no las resuelve.
        </p>
      </div>

      <label className="mb-2 block border-t border-neutral-800 pt-2">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-neutral-500">Notas</span>
        <textarea
          value={moment.notes ?? ''}
          onChange={(e) => onPatch({ notes: e.target.value || undefined })}
          rows={2}
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[12px] text-neutral-300"
        />
      </label>

      <label className="block border-t border-neutral-800 pt-2">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-neutral-500">Escena de cierre</span>
        <select
          value={draft.closingSceneId}
          onChange={(e) => onPatchMeta({ closingSceneId: e.target.value })}
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[12px] text-neutral-200"
        >
          {SCENE_IDS.map((id) => (<option key={id} value={id}>{id}</option>))}
        </select>
        <span className="mt-1 block text-[10px] text-neutral-600">
          El edificio vuelve acá al terminar, para no quedar con la marca puesta fuera de pauta.
        </span>
      </label>
    </Panel>
  );
}

/** Editor de escena. Recibe la directiva ya estrechada al caso `scene`. */
function SceneEditor({
  lighting,
  onPatch,
}: {
  lighting: { mode: 'scene'; sceneId: string; fadeMs?: number };
  onPatch: (p: Partial<TakeoverMoment>) => void;
}) {
  const setScene = (sceneId: string, fadeMs: number | undefined) =>
    onPatch({ lighting: fadeMs === undefined ? { mode: 'scene', sceneId } : { mode: 'scene', sceneId, fadeMs } });

  return (
    <div className="mt-1.5 space-y-1.5">
      <select
        value={lighting.sceneId}
        onChange={(e) => setScene(e.target.value, lighting.fadeMs)}
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[12px] text-neutral-200"
      >
        {SCENE_IDS.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span>Fade (ms)</span>
        <input
          type="number"
          min={0}
          step={100}
          value={lighting.fadeMs ?? ''}
          placeholder="escena"
          onChange={(e) => setScene(lighting.sceneId, e.target.value === '' ? undefined : Number(e.target.value))}
          className="w-24 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-[11px] tabular-nums"
        />
      </label>
      <p className="text-[10px] text-neutral-600">Sin valor manda el fade propio de la escena.</p>
    </div>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-[11px] ${active ? 'bg-neutral-100 text-neutral-900' : 'border border-neutral-700 text-neutral-400'}`}
    >
      {children}
    </button>
  );
}

function DirectiveRow({
  label, value, onChange,
}: {
  label: string;
  value: ScreenDirective;
  onChange: (v: ScreenDirective) => void;
}) {
  return (
    <div className="mb-1.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="w-20 shrink-0 text-[11px] text-neutral-400">{label}</span>
        <div className="flex gap-1">
          <ModeBtn active={value.mode === 'hold'} onClick={() => onChange({ mode: 'hold' })}>Mantener</ModeBtn>
          <ModeBtn active={value.mode === 'play'} onClick={() => onChange({ mode: 'play', fromMs: 0 })}>Reproducir</ModeBtn>
          <ModeBtn active={value.mode === 'black'} onClick={() => onChange({ mode: 'black' })}>Negro</ModeBtn>
        </div>
      </div>
      {value.mode === 'play' && (
        <label className="ml-20 flex items-center gap-2 text-[10px] text-neutral-500">
          desde ms
          <input
            type="number"
            min={0}
            step={100}
            value={value.fromMs}
            onChange={(e) => onChange({ mode: 'play', fromMs: Math.max(0, Number(e.target.value) || 0) })}
            className="w-20 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono tabular-nums"
          />
        </label>
      )}
    </div>
  );
}

/* ── Transport ───────────────────────────────────────────────── */

function Transport({
  transport, onPlay, onPause, onStop, onRestart, blocked, current,
}: {
  transport: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  blocked: boolean;
  /** false si el motor quedo viejo respecto del draft. */
  current: boolean;
}) {
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-neutral-800 pt-3">
      <button
        onClick={transport === 'playing' ? onPause : onPlay}
        disabled={blocked}
        className="w-20 rounded bg-emerald-700 px-3 py-2 text-[11px] font-semibold text-emerald-50 disabled:opacity-30"
      >
        {transport === 'playing' ? 'PAUSE' : 'PLAY'}
      </button>
      {/* STOP jamas se deshabilita: es la operacion de seguridad. Que un show
          no se pueda arrancar no implica que no se pueda parar. */}
      <Btn onClick={onStop} testId="stop-button">STOP</Btn>
      <Btn onClick={onRestart} disabled={blocked}>RESTART</Btn>
      <span
        data-testid="transport-status"
        className="ml-auto rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-400"
      >
        {transport}
      </span>
      {!current && !blocked && (
        <span className="text-[10px] text-amber-400" title="El motor se recarga al reproducir">
          draft editado · el preview se actualiza al reproducir
        </span>
      )}
      {blocked && <span className="text-[10px] text-red-400">preflight bloqueado</span>}
    </div>
  );
}

/* ── Timeline ────────────────────────────────────────────────── */

function Timeline({
  spans, total, timeMs, selectedId, issues,
  onSelect, onScrub, onAdd, onDuplicate, onRemove, onMove, onDuration,
}: {
  spans: ReturnType<typeof momentSpans>;
  total: number;
  timeMs: number;
  selectedId: string | null;
  issues: BuilderIssue[];
  onSelect: (id: string) => void;
  onScrub: (ms: number) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onDuration: (id: string, ms: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const conError = new Set(issues.map((i) => i.momentId).filter(Boolean) as string[]);

  return (
    <Panel
      title="Moments"
      right={
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-neutral-500">
            total{' '}
            {/* Nodo propio: el E2E afirma sobre la duración total sin depender
                del resto del texto de la cabecera. */}
            <span data-testid="preview-duration">{(total / 1000).toFixed(1)} s</span> ·{' '}
            <span data-testid="moment-count">{spans.length}</span> moments
          </span>
          <Btn onClick={onAdd}>+ Moment</Btn>
        </div>
      }
    >
      <div className="relative mb-2">
        <input
          data-testid="timeline-scrubber"
          type="range"
          min={0}
          max={Math.max(1, total)}
          value={timeMs}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="w-full accent-amber-500"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {spans.map(({ moment, index, startMs, endMs }) => {
          const activo = timeMs >= startMs && timeMs < endMs;
          const sel = moment.id === selectedId;
          const roto = conError.has(moment.id);
          return (
            <div
              key={moment.id}
              draggable
              data-testid="moment-block"
              data-moment-id={moment.id}
              onDragStart={() => setDrag(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag !== null) onMove(drag, index); setDrag(null); }}
              onClick={() => onSelect(moment.id)}
              style={{ flexBasis: `${Math.max(9, (moment.durationMs / Math.max(1, total)) * 100)}%` }}
              className={`min-w-[120px] shrink-0 cursor-pointer rounded border px-2.5 py-2 transition-colors ${
                roto
                  ? 'border-red-800 bg-red-950/30'
                  : sel
                    ? 'border-neutral-300 bg-neutral-800/60'
                    : activo
                      ? 'border-amber-700/70 bg-neutral-900'
                      : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-600'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12px] font-medium text-neutral-100">{moment.name}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-500">
                  {fmtMs(moment.durationMs)}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] tabular-nums text-neutral-600">
                {(startMs / 1000).toFixed(1)}–{(endMs / 1000).toFixed(1)}s
              </div>
              <div className="mt-1 flex items-center gap-1">
                <input
                  data-testid="moment-duration"
                  type="number"
                  min={MIN_MOMENT_MS}
                  step={500}
                  value={moment.durationMs}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onDuration(moment.id, Number(e.target.value) || MIN_MOMENT_MS)}
                  className="w-16 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 font-mono text-[10px] tabular-nums text-neutral-300"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); onDuplicate(moment.id); }}
                  className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400"
                  title="Duplicar"
                >
                  ⧉
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(moment.id); }}
                  className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400"
                  title="Borrar"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-neutral-600">
        Arrastrá un bloque sobre otro para reordenar. Los tiempos absolutos los calcula el compilador.
      </p>
    </Panel>
  );
}

/* ── Compilado ───────────────────────────────────────────────── */

function CompiledView({ json }: { json: unknown }) {
  const texto = JSON.stringify(json, null, 2);
  return (
    <Panel
      title="Show package compilado (solo lectura)"
      right={
        <Btn onClick={() => navigator.clipboard?.writeText(texto)}>Copiar JSON</Btn>
      }
    >
      <pre className="max-h-72 overflow-auto rounded bg-neutral-950 p-3 font-mono text-[10px] leading-relaxed text-neutral-400">
        {texto || '— sin compilar —'}
      </pre>
      <p className="mt-2 text-[10px] text-neutral-600">
        Esto es exactamente lo que ejecutaría el motor. Exportarlo no lo publica.
      </p>
    </Panel>
  );
}

/* ── Modo presentación ───────────────────────────────────────── */

function PresentMode({
  draft, state, transport, timeMs, total, labels, onPlay, onStop, onExit,
}: {
  draft: ReturnType<typeof useBuilderStore.getState>['draft'];
  state: ReturnType<typeof useBuilderStore.getState>['previewState'];
  transport: string;
  timeMs: number;
  total: number;
  labels: Record<string, string | undefined>;
  onPlay: () => void;
  onStop: () => void;
  onExit: () => void;
}) {
  const spans = momentSpans(draft);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <header className="flex items-baseline gap-4 px-8 pt-7">
        <span className="text-[12px] font-semibold tracking-[0.3em] text-neutral-500">MASTER OF TRUST</span>
        <div className="ml-auto text-right">
          <p className="text-[18px] font-semibold text-neutral-100">{draft.campaignName || draft.name}</p>
          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">{draft.clientName}</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-5">
        <div className="aspect-[420/460] h-full max-h-full">
          <SchematicPreviewRenderer state={state} labels={labels} clean />
        </div>
      </div>

      <footer className="px-8 pb-8">
        <div className="mb-3 flex gap-1">
          {spans.map(({ moment, startMs, endMs }) => {
            const activo = timeMs >= startMs && timeMs < endMs;
            return (
              <div
                key={moment.id}
                style={{ flexBasis: `${(moment.durationMs / Math.max(1, total)) * 100}%` }}
                className={`rounded px-2 py-1.5 text-center text-[11px] transition-colors ${
                  activo ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-900 text-neutral-500'
                }`}
              >
                <span className="truncate">{moment.name}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onPlay}
            className="rounded bg-emerald-700 px-6 py-2.5 text-[12px] font-semibold tracking-wide text-emerald-50"
          >
            {transport === 'playing' ? 'REPRODUCIENDO' : 'PLAY'}
          </button>
          <button onClick={onStop} className="rounded border border-neutral-700 px-5 py-2.5 text-[12px] text-neutral-300">
            STOP
          </button>
          <span className="font-mono text-[13px] tabular-nums text-neutral-400">
            {(timeMs / 1000).toFixed(1)}s / {(total / 1000).toFixed(1)}s
          </span>
          <button onClick={onExit} className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-400">
            Salir de presentación
          </button>
        </div>
        <p className="mt-3 text-[10px] text-neutral-700">
          Simulación de autoría · no hay hardware conectado · {BUILDING.name}
        </p>
      </footer>
    </div>
  );
}
