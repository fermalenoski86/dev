'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_SCENES, EL_TRUST, resolveStateAt } from '@trust/show-engine';
import { BackupPlayer, DemoCheckPanel, demoCheckTargets } from '../../components/experience/DemoCheck';
import { pinSources, warmUpSource } from '../../components/experience/SurfaceMediaRenderer';

/** Contexto para resolver estado fuera del motor de la demo. */
const PREFLIGHT_CTX = { building: EL_TRUST, scenes: DEMO_SCENES };
import {
  BRAND_MOMENTS,
  EXPERIENCE_VIEWS,
  brandMomentAction,
  DEMO_PRESET_ID,
  END_CARD_ACTIONS,
  HOME_HEADLINE,
  END_CARD_BLOCKS,
  INITIAL_EXPERIENCE,
  markFailed,
  presentationSource,
  markLoaded,
  TRANSPARENCY_BADGE,
  TRANSPARENCY_CAPTION,
  TRANSPARENCY_TECHNICAL,
  WHY_BLOCKS,
  canPlay,
  canStop,
  demoReset,
  isReadyToPresent,
  loadProgress,
  requiredAssets,
  setComparison,
  setView,
  shortcutFor,
  viewList,
  type BrandMoment,
  type ExperienceState,
  type ExperienceView,
} from '@trust/experience-core';
import { momentAt, presetById } from '@trust/show-authoring';
import { useBuilderStore } from '../../state/useBuilderStore';
import { PhotographicPresentationRenderer } from '../../components/experience/ExecutivePresentationRenderer';

/**
 * CLIENT EXPERIENCE — `/experience`.
 *
 * Reutiliza el store del Builder, y por lo tanto el MISMO `ShowEngine`. No hay
 * un segundo motor ni un timeline alternativo: lo que el cliente ve es
 * exactamente lo que ejecutaría el edificio.
 *
 * Lo que cambia respecto del Builder es qué se muestra, no qué se calcula.
 */
export default function ExperiencePage() {
  const { draft, previewState, transport, timeMs, validation } = useBuilderStore();
  const { loadPreset, play, pause, stop, scrub, tick } = useBuilderStore();

  const [exp, setExp] = useState<ExperienceState>(INITIAL_EXPERIENCE);
  const [showWhy, setShowWhy] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [puedeFullscreen, setPuedeFullscreen] = useState(false);
  useEffect(() => {
    setPuedeFullscreen(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
  }, []);

  /*
   * M2C.2.3 / 7: en cinema el cursor desaparece a los 2 s sin movimiento y
   * vuelve al mover el mouse. STOP y ESC siguen funcionando igual.
   */
  const [cursorOculto, setCursorOculto] = useState(false);
  useEffect(() => {
    if (!exp.cinema) { setCursorOculto(false); return; }
    let t = window.setTimeout(() => setCursorOculto(true), 2000);
    const mover = () => {
      setCursorOculto(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setCursorOculto(true), 2000);
    };
    window.addEventListener('mousemove', mover);
    return () => { window.clearTimeout(t); window.removeEventListener('mousemove', mover); };
  }, [exp.cinema]);
  const [showEnd, setShowEnd] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  /*
   * CLIENT MODE vs OPERATOR MODE. Por defecto, Client Mode: el cliente ve la
   * experiencia y nada de la maquinaria (Demo Check, Reset, Backup, estado de
   * carga, atajos). El operador lo activa con `?operator=1` en la URL o con
   * Shift+O, antes de la reunión.
   */
  const [operador, setOperador] = useState(false);
  /*
   * Gancho de CAPTURA — solo con `?capture=1`. Congela el show en un instante
   * exacto para las capturas oficiales: sin GPU, una captura a 1920×1080 tarda
   * segundos y el show (que corre en tiempo real) se pasaba del momento.
   * Usa la pausa y el posicionamiento que la página ya tiene; no toca el motor.
   * En Client Mode el HOLD no se atenúa, así que la foto es la del momento.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('capture') !== '1') return;
    (window as unknown as { __TRUST_CAPTURE__?: unknown }).__TRUST_CAPTURE__ = {
      congelar: (ms: number) => { pause(); scrub(ms); },
      reanudar: () => play(),
    };
  }, [pause, scrub, play]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('operator') === '1') setOperador(true);
    const tecla = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === 'O' || e.key === 'o')) setOperador((v) => !v);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);
  const [showBackup, setShowBackup] = useState(false);
  const cargado = useRef(false);
  const warmups = useRef<Record<string, unknown>>({});

  /* ── Preset de demo ─────────────────────────────────────────── */
  useEffect(() => {
    if (cargado.current) return;
    cargado.current = true;
    const preset = presetById(DEMO_PRESET_ID);
    if (preset) loadPreset(preset.build);
  }, [loadPreset]);

  /* ── Precarga: PLAY no se habilita hasta tener FRAMES, no archivos ── */
  useEffect(() => {
    /*
     * Sin guard de "montado": el componente puede montarse dos veces durante
     * la hidratación, y el primer efecto quedaba marcado como muerto justo
     * cuando el decoder terminaba. En React 18 un setState tras desmontar es
     * inocuo, y el resultado del warm-up vale aunque lo haya pedido otra
     * instancia: el decoder es compartido.
     */
    const ok = (src: string) => setExp((s) => ({ ...s, ...markLoaded(s, src) }));
    const fallo = (src: string) => setExp((s) => ({ ...s, ...markFailed(s, src) }));

    // Fijar antes de calentar: así el renderer no los libera mientras cargan.
    pinSources(requiredAssets().filter((a) => a.endsWith('.mp4')));
    for (const src of requiredAssets()) {
      if (src.endsWith('.mp4')) {
        /*
         * M2C.2.2 / 12 y 14. El video se calienta en el MISMO decoder que usa
         * PLAY y cuenta como cargado solo si entregó un frame. Antes un
         * `error` se marcaba como cargado "para no colgar la demo": eso
         * convertía READY TO PRESENT en una mentira delante del cliente. Si
         * falla, falla, y el operador lo ve en rojo antes de la reunión.
         */
        void warmUpSource(src).then((r) => {
          // Issue #26: el motivo de un warm-up fallido tiene que quedar en algún lado.
          warmups.current[src] = { ...r, at: Date.now() };
          if (!r.ok) console.warn('[trust:warmup] falló', src, r.detail);
          return r.ok ? ok(src) : fallo(src);
        });
      } else {
        const img = new Image();
        img.onload = () => ok(src);
        img.onerror = () => fallo(src);
        img.src = src;
      }
    }
  }, []);

  useEffect(() => {
    setExp((s) => (s.phase === 'LOADING' && isReadyToPresent(s) ? { ...s, phase: 'READY' } : s));
  }, [exp.loaded, exp.failed, exp.fallbacks]);

  // Diagnóstico de operador: estado de precarga legible desde consola y E2E.
  useEffect(() => {
    (window as unknown as { __TRUST_EXP__?: unknown }).__TRUST_EXP__ = {
      phase: exp.phase,
      loaded: exp.loaded,
      failed: exp.failed,
      required: requiredAssets(),
      warmup: warmups.current,
    };
  }, [exp.phase, exp.loaded, exp.failed]);

  /* ── Un tick por frame: el estado sale del ShowEngine ────────── */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  /* ── Fin del show: end card ejecutiva ───────────────────────── */
  useEffect(() => {
    if (transport === 'ended') {
      setShowEnd(true);
      setExp((s) => ({ ...s, phase: 'ENDED' }));
    }
  }, [transport]);

  const listo = canPlay(exp);
  const progreso = loadProgress(exp);

  const reproducir = useCallback(() => {
    if (!canPlay(exp)) return;
    setShowEnd(false);
    setExp((s) => ({ ...s, cinema: true, phase: 'PLAYING' }));
    play();
  }, [exp, play]);

  /**
   * STOP siempre disponible, y SALE de cinema.
   *
   * Detener es la salida de cualquier situación: si dejara al presentador
   * dentro del modo cine sin controles, el botón de seguridad no llevaría a
   * ningún lado seguro.
   */
  const detener = useCallback(() => {
    stop();
    setShowEnd(false);
    setExp((s) => ({ ...s, cinema: false, phase: isReadyToPresent(s) ? 'READY' : 'LOADING' }));
  }, [stop]);

  const resetear = useCallback(() => {
    stop();
    const preset = presetById(DEMO_PRESET_ID);
    if (preset) loadPreset(preset.build);
    setShowEnd(false);
    setShowWhy(false);
    setExp((s) => demoReset(s));
  }, [loadPreset, stop]);

  /*
   * M2C.2.1 / punto 7. `BRAND_MOMENTS.SIGNATURE` declaraba `seekToMs: 12000` y
   * la UI lo ignoraba: al elegir SIGNATURE el show arrancaba desde NORMAL y el
   * cliente veía cualquier cosa menos el Signature.
   *
   * Ahora se carga el preset y, si el momento declara un instante, se hace
   * seek y se queda PAUSADO ahí: un Brand Moment es una imagen para mostrar y
   * comentar, no un playback.
   */
  const elegirMomento = useCallback(
    (id: BrandMoment) => {
      const accion = brandMomentAction(id);
      const preset = presetById(accion.presetId);
      if (preset) loadPreset(preset.build);
      setExp((s) => ({ ...s, brandMoment: id }));

      const destino = accion.seekToMs;
      if (destino !== null) {
        // El seek va después del load: el motor necesita el show nuevo antes
        // de poder posicionarse en él.
        requestAnimationFrame(() => {
          scrub(destino);
          if (accion.pauseAfterSeek) pause();
        });
      }
    },
    [loadPreset, scrub, pause],
  );

  /* ── Atajos: R, SPACE, ESC ──────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const destino = (e.target as HTMLElement | null)?.tagName;
      if (destino === 'INPUT' || destino === 'TEXTAREA') return;
      const accion = shortcutFor(e.key);
      if (!accion) return;
      e.preventDefault();
      if (accion === 'reset') resetear();
      if (accion === 'exitCinema') setExp((s) => ({ ...s, cinema: false }));
      if (accion === 'playPause') {
        if (transport === 'playing') detener();
        else reproducir();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detener, reproducir, resetear, transport]);

  const spans = useMemo(() => (draft ? momentAt : null) && draft, [draft]);
  const momentoActual = useMemo(() => {
    if (!spans) return null;
    return momentAt(spans, timeMs)?.moment ?? null;
  }, [spans, timeMs]);

  const total = draft?.moments.reduce((a, m) => a + m.durationMs, 0) ?? 0;
  const campaign = {
    client: draft?.clientName || "McDonald's",
    name: draft?.campaignName || draft?.name || 'Takeover Experience',
  };

  return (
    <main
      className="flex h-screen flex-col overflow-hidden bg-black text-neutral-100"
      data-testid="experience-root"
      data-cursor={cursorOculto ? 'oculto' : 'visible'}
      style={{ cursor: cursorOculto ? 'none' : undefined }}
    >
      {/* ── Cabecera: se retira en cinema ─────────────────────── */}
      {!exp.cinema && (
        <header className="flex shrink-0 items-center gap-6 px-8 py-5" data-mode={operador ? 'operator' : 'client'}>
          <div>
            <h1 className="text-[15px] font-semibold tracking-[0.32em]">MASTER OF TRUST</h1>
            <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              {campaign.client} × Obelisco · Takeover Experience
            </p>
          </div>

          <span
            data-testid="transparency-badge"
            className="rounded border border-neutral-700 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
            title={operador ? TRANSPARENCY_TECHNICAL : undefined}
          >
            {TRANSPARENCY_BADGE} · {TRANSPARENCY_CAPTION}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowWhy((v) => !v)}
              className="rounded px-3 py-1.5 text-[11px] tracking-wider text-neutral-400 hover:text-neutral-100"
            >
              WHY MASTER OF TRUST
            </button>
            <button
              onClick={() => setShowHow((v) => !v)}
              data-testid="how-it-works"
              className="rounded border border-neutral-800 px-3 py-1.5 text-[11px] tracking-wider text-neutral-400 hover:border-neutral-600 hover:text-neutral-100"
            >
              HOW IT WORKS
            </button>
            {operador && (
              <>
            {/*
              DEMO CHECK: modo operador. Se corre ANTES de la reunión, no
              durante. Descubrir que un master no carga con la gente sentada no
              es recuperable.
            */}
            <button
              data-testid="demo-check"
              onClick={() => setShowCheck(true)}
              className="rounded border border-neutral-800 px-3 py-1.5 text-[11px] tracking-wider text-neutral-400 hover:border-neutral-600"
              title="Verificación local previa"
            >
              DEMO CHECK
            </button>
            <button
              data-testid="demo-reset"
              onClick={resetear}
              className="rounded border border-neutral-800 px-3 py-1.5 text-[11px] tracking-wider text-neutral-400 hover:border-neutral-600"
              title="R"
            >
              DEMO RESET
            </button>
              </>
            )}
          </div>
        </header>
      )}

      {/* ── Escenario ─────────────────────────────────────────── */}
      <section className={`relative min-h-0 flex-1 ${exp.cinema ? '' : 'mx-8 overflow-hidden rounded-lg'}`}>
        <PhotographicPresentationRenderer
          state={previewState}
          timeMs={timeMs}
          transport={transport}
          view={exp.view}
          comparison={exp.comparison}
          campaign={campaign}
          momentName={momentoActual?.name ?? null}
          cinema={exp.cinema}
          operador={operador}
        />

        {exp.cinema && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-6">
            <span className="text-[11px] font-semibold tracking-[0.3em] text-white/55">MASTER OF TRUST</span>
            <span className="text-[11px] tracking-[0.2em] text-white/55">
              {campaign.client} × MASTER OF TRUST
            </span>
          </div>
        )}

        {showEnd && <EndCard onReplay={reproducir} onClose={() => setShowEnd(false)} />}

        {showCheck && (
          <DemoCheckPanel
            probes={{
              ...demoCheckTargets(EXPERIENCE_VIEWS[exp.view].background),
              showPackageOk: () => Boolean(draft) && validation?.compile.showPackage !== null,
              preflightOk: () => validation?.status !== 'BLOCKED',
              // El motor responde si resuelve estado a mitad del show.
              // M2C.2.2 / P0: reproducción DE VERDAD, no `Boolean(previewState)`.
              playbackTarget: () => {
                const pkg = validation?.compile.showPackage ?? null;
                const AT_MS = 4000;
                if (!pkg) return { source: null, atMs: AT_MS, mediaTimeMs: 0 };
                const estado = resolveStateAt(pkg, PREFLIGHT_CTX, AT_MS, { transport: 'playing' });
                const sa = estado.screens.screen_a;
                return {
                  source: sa.output === 'black' ? null : presentationSource(sa.source),
                  atMs: AT_MS,
                  mediaTimeMs: sa.mediaTimeMs,
                };
              },
            }}
            onClose={() => setShowCheck(false)}
            onPlayBackup={() => {
              setShowCheck(false);
              setShowBackup(true);
            }}
          />
        )}

        {showBackup && <BackupPlayer onClose={() => setShowBackup(false)} />}
        {showWhy && !exp.cinema && <WhyPanel onClose={() => setShowWhy(false)} />}
        {showHow && !exp.cinema && <HowPanel onClose={() => setShowHow(false)} />}

        {!listo && (
          <div
            data-testid="loading-overlay"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80"
          >
            <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">Preparando la presentación</p>
            <div className="h-0.5 w-56 overflow-hidden rounded bg-neutral-800">
              <div className="h-full bg-neutral-200 transition-[width]" style={{ width: `${progreso * 100}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* ── Controles ─────────────────────────────────────────── */}
      <footer className="shrink-0 px-8 py-5">
        {/*
          Tiempo en ms, invisible. El E2E necesita afirmar sobre el seek de
          SIGNATURE, y leerlo del texto "3.2s / 15.0s" sería frágil.
        */}
        <span data-testid="stage-time" className="pointer-events-none absolute opacity-0">
          {Math.round(timeMs)}
        </span>
        <MomentBar
          moments={draft?.moments ?? []}
          timeMs={timeMs}
          total={total}
          cinema={exp.cinema}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            data-testid="play-the-moment"
            onClick={reproducir}
            disabled={!listo || transport === 'playing'}
            className="rounded bg-white px-6 py-2.5 text-[12px] font-semibold tracking-[0.12em] text-black disabled:opacity-25"
          >
            {listo ? 'PLAY THE MOMENT' : 'CARGANDO…'}
          </button>

          {/*
            STOP siempre accesible: es la salida de cualquier situación. La
            condición vive en `canStop` y no como un `disabled` acá, para que
            nadie le agregue una restricción sin darse cuenta.
          */}
          <button
            data-testid="stop-experience"
            disabled={!canStop(exp)}
            onClick={detener}
            className="rounded border border-neutral-700 px-4 py-2.5 text-[12px] tracking-[0.12em] text-neutral-200"
          >
            STOP
          </button>
          {/*
            M2C.2.3 / 7: pantalla completa opcional. La experiencia no la exige:
            si el navegador no la permite, simplemente no aparece el botón.
          */}
          {!exp.cinema && puedeFullscreen && (
            <button
              data-testid="enter-fullscreen"
              onClick={() => {
                document.documentElement.requestFullscreen?.().catch(() => {});
              }}
              className="rounded border border-neutral-800 px-4 py-2.5 text-[11px] tracking-[0.12em] text-neutral-400 hover:border-neutral-600"
            >
              ENTER FULLSCREEN
            </button>
          )}

          <span
            data-testid="ready-state"
            data-visible={operador}
            className={
              operador
                ? `text-[10px] font-semibold uppercase tracking-[0.2em] ${listo ? 'text-emerald-400' : 'text-neutral-500'}`
                : 'sr-only'
            }
          >
            {listo ? 'READY TO PRESENT' : 'LOADING'}
          </span>

          {!exp.cinema && (
            <>
              {viewList(true).length > 1 && (
              <div className="ml-auto flex gap-1" data-testid="view-switcher">
                {viewList(true).map((v) => (
                  <button
                    key={v.id}
                    data-testid={`view-${v.id.toLowerCase()}`}
                    onClick={() => setExp((s) => setView(s, v.id as ExperienceView))}
                    className={`rounded px-3 py-1.5 text-[11px] tracking-wider ${
                      exp.view === v.id ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:text-neutral-100'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              )}

              <div className="flex overflow-hidden rounded border border-neutral-800">
                {(['BEFORE', 'TAKEOVER'] as const).map((c) => (
                  <button
                    key={c}
                    data-testid={`comparison-${c.toLowerCase()}`}
                    onClick={() => setExp((s) => setComparison(s, c))}
                    className={`px-3 py-1.5 text-[11px] tracking-wider ${
                      exp.comparison === c ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {!exp.cinema && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* M2C.2.3 / 1: los Brand Moments son herramienta del operador. */}
            {operador && <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-600">Brand moments</span>}
            {operador && (Object.keys(BRAND_MOMENTS) as BrandMoment[]).map((id) => (
              <button
                key={id}
                data-testid={`brand-${id.toLowerCase()}`}
                onClick={() => elegirMomento(id)}
                title={BRAND_MOMENTS[id].pitch}
                className={`rounded border px-3 py-1 text-[11px] tracking-wider ${
                  exp.brandMoment === id
                    ? 'border-neutral-300 text-neutral-100'
                    : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'
                }`}
              >
                {BRAND_MOMENTS[id].label}
              </button>
            ))}

            <span data-testid="home-headline" className="ml-auto text-[11px] uppercase tracking-[0.22em] text-neutral-400">
              {HOME_HEADLINE}
            </span>
          </div>
        )}

        {/* Los atajos son para el operador: el cliente no tiene por qué verlos. */}
        {exp.cinema && operador && (
          <p className="mt-3 text-center text-[10px] tracking-[0.2em] text-neutral-600">
            ESC para salir · R para reiniciar · Shift+O modo operador
          </p>
        )}
      </footer>

      {/*
        Nota técnica (EDGE, estado del draft): solo para el operador. El brief
        ejecutivo pide no mostrar implementación en la pantalla del cliente; la
        transparencia hacia el cliente la da el badge CAMPAIGN PREVIEW ·
        VISUALIZACIÓN CONCEPTUAL, que sigue a la vista.
      */}
      {!exp.cinema && operador && (
        <p className="shrink-0 px-8 pb-4 text-[10px] text-neutral-700">
          {TRANSPARENCY_TECHNICAL} {validation?.status === 'BLOCKED' ? '· Draft con observaciones.' : ''}
        </p>
      )}
    </main>
  );
}

/* ────────────────────────────────────────────────────────────── */

function MomentBar({
  moments,
  timeMs,
  total,
  cinema,
}: {
  moments: Array<{ id: string; name: string; durationMs: number }>;
  timeMs: number;
  total: number;
  cinema: boolean;
}) {
  if (moments.length === 0 || total === 0) return null;
  let cursor = 0;
  return (
    <div data-testid="moment-bar" className="flex gap-1">
      {moments.map((m) => {
        const start = cursor;
        cursor += m.durationMs;
        const activo = timeMs >= start && timeMs < cursor;
        const avance = activo ? (timeMs - start) / m.durationMs : timeMs >= cursor ? 1 : 0;
        return (
          <div
            key={m.id}
            data-testid="moment-chip"
            data-name={m.name}
            data-active={activo}
            className="relative min-w-0 flex-1 overflow-hidden rounded-sm bg-neutral-900"
            style={{ flexGrow: m.durationMs }}
          >
            <div
              className="absolute inset-y-0 left-0 bg-neutral-700/70"
              style={{ width: `${avance * 100}%` }}
            />
            <span
              className={`relative block truncate px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] ${
                activo ? 'text-neutral-100' : 'text-neutral-500'
              }`}
            >
              {cinema ? '' : m.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EndCard({ onReplay, onClose }: { onReplay: () => void; onClose: () => void }) {
  return (
    <div
      data-testid="end-card"
      /*
       * `backdrop-blur` además del fondo: con solo bg-black/92 las superficies
       * oscuras del renderer se ven a través como bloques sólidos y cortan el
       * texto — quedaba tapando el badge de MEASUREMENT. El desenfoque mantiene
       * la profundidad sin que nada compita con la lectura.
       */
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-10 bg-black/[0.82] px-10 backdrop-blur-[3px]"
    >
      <p className="text-[11px] tracking-[0.35em] text-neutral-500">MASTER OF TRUST</p>
      <div className="grid w-full max-w-5xl gap-8 md:grid-cols-3">
        {END_CARD_BLOCKS.map((b) => (
          <div key={b.title}>
            <h3 className="text-[14px] font-semibold tracking-[0.22em] text-white">{b.title}</h3>
            <p className="mt-2.5 text-[13px] leading-relaxed text-neutral-300">{b.body}</p>
            {b.planned && (
              <span
                data-testid="planned-capability"
                className="mt-3 inline-block rounded border border-amber-700/60 bg-amber-950/30 px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-300/90"
              >
                FUTURE CAPABILITY
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button
          data-testid="end-card-replay"
          onClick={onReplay}
          className="rounded bg-white px-5 py-2 text-[11px] font-semibold tracking-[0.12em] text-black"
        >
          {END_CARD_ACTIONS.replay}
        </button>
        <button
          data-testid="end-card-back"
          onClick={onClose}
          className="rounded border border-neutral-700 px-5 py-2 text-[11px] tracking-[0.12em] text-neutral-300"
        >
          {END_CARD_ACTIONS.back}
        </button>
      </div>
    </div>
  );
}

function WhyPanel({ onClose }: { onClose: () => void }) {
  return (
    <div data-testid="why-panel" className="absolute inset-0 z-20 flex flex-col justify-center gap-10 bg-neutral-950/[0.97] px-14 backdrop-blur-2xl">
      {WHY_BLOCKS.map((b) => (
        <div key={b.title} className="max-w-3xl">
          <h3 className="text-[15px] font-semibold leading-snug tracking-[0.08em] text-neutral-100">{b.title}</h3>
          <p className="mt-2 text-[13px] text-neutral-400">{b.body}</p>
        </div>
      ))}
      <button
        onClick={onClose}
        className="absolute right-8 top-8 text-[11px] tracking-[0.2em] text-neutral-500 hover:text-neutral-200"
      >
        CERRAR
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * HOW IT WORKS — M2C.2.3 / 10
 * ──────────────────────────────────────────────────────────────── */

/**
 * Esquema extremadamente simple: cuatro pasos y la próxima fase. Iluminación
 * arquitectónica y reloj viven acá como NEXT PHASE, no como capacidad instalada.
 * El detalle técnico (EDGE, protocolos) solo se abre a pedido.
 */
const PASOS = [
  { paso: 'CREATE', que: 'Takeover Builder' },
  { paso: 'PREVIEW', que: 'Client Experience' },
  { paso: 'OPERATE', que: 'TRUST CONTROL + EDGE' },
  { paso: 'MEASURE', que: 'Proof of Play' },
] as const;
const PROXIMA_FASE = ['Architectural Lighting', 'Clock Integration', 'Audience Analytics'] as const;

function HowPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      data-testid="how-panel"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-14 bg-black/[0.86] px-14 backdrop-blur-[3px]"
    >
      <p className="text-[11px] uppercase tracking-[0.4em] text-neutral-500">How it works</p>
      <ol className="grid w-full max-w-5xl grid-cols-4 gap-6">
        {PASOS.map((p, i) => (
          <li key={p.paso} className="border-t border-neutral-700 pt-5">
            <p className="text-[11px] tracking-[0.3em] text-neutral-500">{String(i + 1).padStart(2, '0')}</p>
            <h3 className="mt-2 text-[20px] font-semibold tracking-[0.18em] text-white">{p.paso}</h3>
            <p className="mt-2 text-[14px] text-neutral-300">{p.que}</p>
          </li>
        ))}
      </ol>
      <div data-testid="next-phase" className="w-full max-w-5xl border-t border-neutral-800 pt-6">
        <p className="text-[11px] uppercase tracking-[0.3em] text-amber-300/80">Next phase</p>
        <div className="mt-3 flex flex-wrap gap-x-10 gap-y-2">
          {PROXIMA_FASE.map((f) => (
            <span key={f} className="text-[15px] text-neutral-400">{f}</span>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="rounded bg-white px-5 py-2 text-[11px] font-semibold tracking-[0.12em] text-black">
          VOLVER
        </button>
        <a href="/" className="rounded border border-neutral-800 px-5 py-2 text-[11px] tracking-[0.12em] text-neutral-500 hover:text-neutral-300">
          DETALLE TÉCNICO
        </a>
      </div>
    </div>
  );
}
