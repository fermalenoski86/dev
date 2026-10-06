'use client';

import { useCallback, useState } from 'react';
import { warmUpAll } from './SurfaceMediaRenderer';
import {
  BACKUP_VIDEO,
  DEMO_CHECKS,
  demoCheckReport,
  requiredAssets,
  type DemoCheckReport,
  type DemoCheckResult,
} from '@trust/experience-core';

/**
 * DEMO CHECK y BACKUP — M2C.2.1 / puntos 11 y 12.
 *
 * Los dos existen para el mismo momento: la media hora antes de la reunión, y
 * los treinta segundos en los que algo falla con la gente sentada.
 *
 * El check corre pruebas REALES contra los archivos locales. No consulta un
 * estado en memoria: pide cada asset por la red local y mira si vuelve. Un
 * check que se declara verde mirando una variable no sirve para lo único que
 * tiene que servir.
 */

async function probeAsset(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'GET', cache: 'reload' });
    if (!r.ok) return false;
    const blob = await r.blob();
    // Un 200 con cuerpo vacío es un archivo roto, no un archivo presente.
    return blob.size > 1024;
  } catch {
    return false;
  }
}

/**
 * Smoke playback real — M2C.2.2 / P0. Abre un `<video>` PROPIO, lo lleva al
 * instante pedido, dibuja un frame en un canvas de 2×2 y mira si salió algo.
 * Al terminar lo suelta: la demo en curso no se entera.
 */
async function probePlayback(source: string, atMs: number): Promise<{ ok: boolean; detail: string }> {
  if (typeof document === 'undefined') return { ok: false, detail: 'sin DOM' };
  const video = document.createElement('video');
  video.src = source;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const soltar = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout de carga')), 8000);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error(`error de media (code ${video.error?.code ?? '?'})`));
      };
    });
    if (!video.videoWidth || !video.videoHeight) return { ok: false, detail: 'el video no reporta dimensiones' };
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const target = dur > 0 ? (atMs / 1000) % dur : atMs / 1000;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 3000);
      video.onseeked = () => {
        clearTimeout(t);
        resolve();
      };
      video.currentTime = target;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, detail: 'sin contexto 2d' };
    ctx.drawImage(video, 0, 0, 2, 2);
    const px = ctx.getImageData(0, 0, 2, 2).data;
    const pinto = px.some((v, i) => i % 4 === 3 && v > 0);
    return pinto
      ? { ok: true, detail: `frame a ${target.toFixed(1)} s · ${video.videoWidth}×${video.videoHeight}` }
      : { ok: false, detail: 'el decoder no entregó frame' };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'fallo desconocido' };
  } finally {
    soltar();
  }
}

/** Respaldo: existe, dura lo que debe, decodifica y el primer frame se ve. */
export async function validateBackup(src: string): Promise<{ ok: boolean; detail: string }> {
  if (!(await probeAsset(src))) return { ok: false, detail: 'no se encuentra el archivo' };
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 10_000);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error(`no decodifica (code ${video.error?.code ?? '?'})`));
      };
    });
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur < 10 || dur > 20) {
      return { ok: false, detail: `duración ${Number.isFinite(dur) ? dur.toFixed(1) : '?'} s, se esperan ~15` };
    }
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, detail: 'sin contexto 2d' };
    ctx.drawImage(video, 0, 0, 4, 4);
    const px = ctx.getImageData(0, 0, 4, 4).data;
    let max = 0;
    for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i]! + px[i + 1]! + px[i + 2]!);
    if (!px.some((v, i) => i % 4 === 3 && v > 0)) return { ok: false, detail: 'sin frame inicial' };
    return { ok: true, detail: `${dur.toFixed(1)} s · ${video.videoWidth}×${video.videoHeight}${max < 30 ? ' · primer frame oscuro' : ''}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'fallo' };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

/** Cuadros por segundo reales del navegador durante `ms`. */
export function medirFps(ms: number): Promise<number> {
  return new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const f = () => {
      n += 1;
      const dt = performance.now() - t0;
      if (dt < ms) requestAnimationFrame(f);
      else resolve((n * 1000) / dt);
    };
    requestAnimationFrame(f);
  });
}

export interface DemoCheckProbes {
  /** Compila el draft actual y devuelve si dio un ShowPackage válido. */
  showPackageOk: () => boolean;
  /** Preflight sin errores. */
  preflightOk: () => boolean;
  /**
   * Qué debería estar reproduciéndose en un instante con contenido. `null` si
   * el motor no resuelve fuente ahí — lo que ya es un fallo de playback.
   */
  playbackTarget: () => { source: string | null; atMs: number; mediaTimeMs: number };
  /** Fondos de las vistas, en orden: hero primero. */
  heroAsset: string;
  viewAssets: string[];
  mediaAssets: string[];
}

export async function runDemoCheck(p: DemoCheckProbes): Promise<DemoCheckResult[]> {
  const out: DemoCheckResult[] = [];

  const hero = await probeAsset(p.heroAsset);
  out.push({
    id: 'hero_master',
    ok: hero,
    detail: hero ? 'master presente' : `no carga: ${p.heroAsset}`,
  });

  const vistas = await Promise.all(p.viewAssets.map(probeAsset));
  const faltanVistas = p.viewAssets.filter((_, i) => !vistas[i]);
  out.push({
    id: 'views',
    ok: faltanVistas.length === 0,
    detail: faltanVistas.length === 0 ? `${vistas.length} vistas` : `faltan: ${faltanVistas.join(', ')}`,
  });

  const medios = await Promise.all(p.mediaAssets.map(probeAsset));
  const faltanMedios = p.mediaAssets.filter((_, i) => !medios[i]);
  out.push({
    id: 'media',
    ok: faltanMedios.length === 0,
    detail: faltanMedios.length === 0 ? `${medios.length} clips` : `faltan: ${faltanMedios.join(', ')}`,
  });

  // Tipografías: no es requerido. Si falta, la presentación corre con la
  // tipografía del sistema y se ve peor, no se rompe.
  let fuentes = true;
  try {
    fuentes = typeof document !== 'undefined' && document.fonts ? document.fonts.status === 'loaded' : true;
  } catch {
    fuentes = false;
  }
  out.push({ id: 'fonts', ok: fuentes, detail: fuentes ? 'cargadas' : 'se usará la del sistema' });

  const pkg = p.showPackageOk();
  out.push({ id: 'show_package', ok: pkg, detail: pkg ? 'compila' : 'el draft no compila' });

  const pre = p.preflightOk();
  out.push({ id: 'preflight', ok: pre, detail: pre ? 'sin errores' : 'hay errores de preflight' });

  const objetivo = p.playbackTarget();
  if (!objetivo.source) {
    out.push({ id: 'playback', ok: false, detail: `el motor no resuelve fuente a ${objetivo.atMs} ms` });
  } else {
    const r = await probePlayback(objetivo.source, objetivo.mediaTimeMs);
    out.push({ id: 'playback', ok: r.ok, detail: r.detail });
  }

  /*
   * M2C.2.3 / 12. El RENDERER entrega frame: se calienta cada clip de campaña
   * en el mismo decoder compartido que usa PLAY y se exige un frame dibujado.
   * `playback` prueba un decoder aparte; este prueba el camino real.
   */
  const calent = await warmUpAll(p.mediaAssets);
  const malos = calent.filter((r) => !r.ok);
  out.push({
    id: 'renderer',
    ok: calent.length > 0 && malos.length === 0,
    detail: malos.length === 0 ? `${calent.length} decoders con frame` : `sin frame: ${malos.map((m) => m.source).join(', ')}`,
  });

  /*
   * M2C.2.2 / 15. No alcanza con que el archivo pese: tiene que tener la
   * duración del show, decodificar, y mostrar un primer frame. Un respaldo
   * corrupto se descubre justo cuando todo lo demás ya falló.
   */
  const bk = await validateBackup(BACKUP_VIDEO);
  out.push({ id: 'backup_video', ok: bk.ok, detail: bk.detail });

  return out;
}

/** Assets que el check prueba, derivados de la misma lista que la precarga. */
export function demoCheckTargets(heroAsset: string): Pick<DemoCheckProbes, 'heroAsset' | 'viewAssets' | 'mediaAssets'> {
  const todos = requiredAssets();
  return {
    heroAsset,
    viewAssets: todos.filter((a) => a !== heroAsset && /\.(jpg|jpeg|png|webp)$/i.test(a)),
    mediaAssets: todos.filter((a) => /\.(mp4|webm)$/i.test(a)),
  };
}

/* ────────────────────────────────────────────────────────────────
 * Panel
 * ──────────────────────────────────────────────────────────────── */

export function DemoCheckPanel({
  probes,
  onClose,
  onPlayBackup,
}: {
  probes: DemoCheckProbes;
  onClose: () => void;
  onPlayBackup: () => void;
}) {
  const [report, setReport] = useState<DemoCheckReport | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [warm, setWarm] = useState<string | null>(null);

  /*
   * M2C.2.2 / 14. Deja los decoders listos para que PLAY sea instantáneo en
   * la reunión. Usa el mismo mapa de fuentes que el renderer, así que lo que
   * se calienta acá es exactamente lo que después reproduce.
   */
  const calentar = useCallback(async () => {
    setWarm('calentando…');
    const r = await warmUpAll(probes.mediaAssets);
    const malos = r.filter((x) => !x.ok);
    setWarm(
      malos.length === 0
        ? `${r.length} clips listos · ${r.map((x) => x.detail).join(' · ')}`
        : `fallaron: ${malos.map((x) => `${x.source} (${x.detail})`).join(', ')}`,
    );
  }, [probes.mediaAssets]);

  const [fps, setFps] = useState<number | null>(null);

  const correr = useCallback(async () => {
    setCorriendo(true);
    setReport(null);
    try {
      setReport(demoCheckReport(await runDemoCheck(probes)));
      /*
       * Fluidez EN ESTA MÁQUINA. Es lo único que no se puede verificar fuera
       * de la notebook de la reunión: depende de su GPU. Debajo de 24 fps el
       * movimiento de las pantallas se nota entrecortado.
       */
      setFps(await medirFps(1500));
    } finally {
      setCorriendo(false);
    }
  }, [probes]);

  const etiqueta = (id: string) => DEMO_CHECKS.find((c) => c.id === id)?.label ?? id;
  const requerido = (id: string) => DEMO_CHECKS.find((c) => c.id === id)?.required ?? false;

  return (
    <div
      data-testid="demo-check-panel"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-neutral-950/95 px-10 backdrop-blur-xl"
    >
      <div className="w-full max-w-2xl">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.3em] text-neutral-200">
            Demo check
          </h2>
          <span className="text-[11px] text-neutral-500">Modo operador · antes de la reunión</span>
        </div>

        {report && (
          <p
            data-testid="demo-check-status"
            className={`mb-4 text-[15px] font-semibold tracking-[0.12em] ${
              report.status === 'PRESENTATION READY' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {report.status}
          </p>
        )}

        <ul className="divide-y divide-neutral-800/70 border-y border-neutral-800/70">
          {DEMO_CHECKS.map((c) => {
            const r = report?.results.find((x) => x.id === c.id);
            return (
              <li key={c.id} data-testid="demo-check-item" data-id={c.id} className="flex items-center gap-3 py-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    !r ? 'bg-neutral-700' : r.ok ? 'bg-emerald-500' : requerido(c.id) ? 'bg-red-500' : 'bg-amber-500'
                  }`}
                />
                <span className="w-64 shrink-0 text-[12px] text-neutral-200">{etiqueta(c.id)}</span>
                {!c.required && <span className="text-[10px] uppercase text-neutral-600">opcional</span>}
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-neutral-500">
                  {r?.detail ?? (corriendo ? 'probando…' : '—')}
                </span>
              </li>
            );
          })}
        </ul>

        {fps !== null && (
          <p
            data-testid="demo-check-fps"
            className={`mt-3 text-[12px] ${fps >= 24 ? 'text-emerald-400' : fps >= 15 ? 'text-amber-300' : 'text-red-400'}`}
          >
            Fluidez en esta máquina: {fps.toFixed(0)} fps
            {fps < 24 && ' — reproducir el show con el video de respaldo si no mejora'}
          </p>
        )}

        {report && report.failures.length > 0 && (
          <p className="mt-3 text-[12px] leading-snug text-red-300">
            No presentes así: {report.failures.map((f) => etiqueta(f.id)).join(', ')}.
          </p>
        )}
        {report && report.warnings.length > 0 && report.failures.length === 0 && (
          <p className="mt-3 text-[12px] leading-snug text-amber-300/90">
            Se puede presentar, con menos red: {report.warnings.map((w) => etiqueta(w.id)).join(', ')}.
          </p>
        )}

        {warm && (
          <p data-testid="warm-up-state" className="mt-3 text-[11px] text-neutral-400">
            {warm}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            data-testid="demo-check-run"
            onClick={correr}
            disabled={corriendo}
            className="rounded bg-white px-5 py-2 text-[11px] font-semibold tracking-[0.12em] text-black disabled:opacity-40"
          >
            {corriendo ? 'PROBANDO…' : 'CORRER CHECK'}
          </button>
          <button
            data-testid="warm-up-media"
            onClick={calentar}
            className="rounded border border-neutral-700 px-5 py-2 text-[11px] tracking-[0.12em] text-neutral-300"
          >
            WARM UP MEDIA
          </button>
          {/*
            Plan B. Está acá y no en la pantalla del cliente a propósito: no es
            una capacidad del producto, es un seguro para el operador.
          */}
          <button
            data-testid="play-backup"
            onClick={onPlayBackup}
            className="rounded border border-neutral-700 px-5 py-2 text-[11px] tracking-[0.12em] text-neutral-300"
          >
            PLAY BACKUP VIDEO
          </button>
          <button
            onClick={onClose}
            className="ml-auto rounded border border-neutral-800 px-5 py-2 text-[11px] tracking-[0.12em] text-neutral-400"
          >
            VOLVER
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reproductor del respaldo, a pantalla completa y sin nada alrededor. */
export function BackupPlayer({ onClose }: { onClose: () => void }) {
  return (
    <div data-testid="backup-player" className="absolute inset-0 z-40 bg-black">
      <video
        src={BACKUP_VIDEO}
        autoPlay
        controls
        className="h-full w-full object-contain"
        onEnded={onClose}
      />
      <button
        onClick={onClose}
        className="absolute right-6 top-6 rounded border border-white/25 px-4 py-2 text-[11px] tracking-[0.12em] text-white/80"
      >
        SALIR
      </button>
    </div>
  );
}
