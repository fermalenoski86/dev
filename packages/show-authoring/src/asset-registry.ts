import { z } from 'zod';
import type { ScreenSurface } from '@trust/shared-types';
import { isLocalMediaPath } from '@trust/show-engine';

/**
 * ASSET REGISTRY — M2C.1 §5.
 *
 * Nadie escribe una URL. El editor solo puede referenciar assets registrados,
 * y un asset registrado solo puede apuntar a un namespace local controlado.
 *
 * La regla de rutas NO se reimplementa: se reutiliza `isLocalMediaPath()` de
 * show-engine, que es la misma que aplica preflight. Si acá hubiera una
 * segunda definición de "ruta aceptable", tarde o temprano el editor dejaría
 * pasar algo que preflight rechaza — o peor, al revés.
 *
 * Esto es el paso previo a ADR-014 (assetId con hash). Cuando exista la
 * ingesta de CONTROL, `source` se reemplaza por el hash y el resto del
 * registro no cambia.
 */

/** Namespaces permitidos. Cualquier otra cosa se bloquea. */
export const ALLOWED_ASSET_PREFIXES = ['/demo/', '/assets/'] as const;

export const AssetTypeSchema = z.enum(['video', 'image']);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: AssetTypeSchema,
  source: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().positive().optional(),
  tags: z.array(z.string()).default([]),
  client: z.string().optional(),
  /**
   * Un archivo arrastrado a la ventana. Sirve para mirar, no para exportar:
   * no está en ningún namespace controlado y nadie verificó qué contiene.
   */
  unmanaged: z.boolean().default(false),
});
export type Asset = z.infer<typeof AssetSchema>;

export const aspectRatio = (a: { width: number; height: number }): number => a.width / a.height;

/* ────────────────────────────────────────────────────────────────
 * Validación
 * ──────────────────────────────────────────────────────────────── */

export type AssetStatus = 'OK' | 'WARNING' | 'BLOCKED';

export interface AssetIssue {
  status: Exclude<AssetStatus, 'OK'>;
  code: string;
  message: string;
}

export interface AssetValidation {
  status: AssetStatus;
  issues: AssetIssue[];
}

/** Tolerancia de aspecto. Por encima, el contenido se ve estirado. */
export const ASPECT_TOLERANCE = 0.02;

/**
 * Valida un asset contra la superficie donde se va a usar.
 *
 * `target` null valida solo lo intrínseco (ruta, existencia, tipo).
 */
export function validateAsset(
  asset: Asset | undefined,
  target: ScreenSurface | { widthPx: number; heightPx: number; physicalRatio: number } | null,
  options: { minDurationMs?: number } = {},
): AssetValidation {
  const issues: AssetIssue[] = [];
  const block = (code: string, message: string) => issues.push({ status: 'BLOCKED', code, message });
  const warn = (code: string, message: string) => issues.push({ status: 'WARNING', code, message });

  if (!asset) {
    block('ASSET_MISSING', 'El asset referenciado no existe en el registro.');
    return { status: 'BLOCKED', issues };
  }

  if (asset.unmanaged) {
    block(
      'ASSET_UNMANAGED',
      `"${asset.name}" es un archivo local sin registrar. Sirve para previsualizar, no para exportar.`,
    );
  } else if (!isLocalMediaPath(asset.source)) {
    block('ASSET_NOT_LOCAL', `"${asset.source}" no es una ruta local válida.`);
  } else if (!ALLOWED_ASSET_PREFIXES.some((p) => asset.source.startsWith(p))) {
    block(
      'ASSET_NAMESPACE',
      `"${asset.source}" está fuera de los namespaces controlados (${ALLOWED_ASSET_PREFIXES.join(', ')}).`,
    );
  }

  if (target) {
    const targetPx =
      'pixelWidth' in target
        ? { w: target.pixelWidth, h: target.pixelHeight }
        : { w: target.widthPx, h: target.heightPx };
    const targetRatio =
      'physicalWidthM' in target
        ? target.physicalWidthM / target.physicalHeightM
        : target.physicalRatio;

    const desvio = Math.abs(aspectRatio(asset) - targetRatio) / targetRatio;
    if (desvio > ASPECT_TOLERANCE) {
      block(
        'ASPECT_MISMATCH',
        `Aspecto ${aspectRatio(asset).toFixed(3)} contra ${targetRatio.toFixed(3)} de la superficie: se vería estirado un ${(desvio * 100).toFixed(0)} %.`,
      );
    }

    // Menos píxeles que la pantalla es escalado hacia arriba: se ve blando,
    // pero no rompe nada. Advertencia, no bloqueo.
    if (asset.width < targetPx.w || asset.height < targetPx.h) {
      warn(
        'RESOLUTION_LOW',
        `${asset.width}×${asset.height} por debajo de los ${targetPx.w}×${targetPx.h} de la superficie: se va a escalar.`,
      );
    }
  }

  const minDuration = options.minDurationMs;
  if (minDuration !== undefined && asset.type === 'video') {
    if (asset.durationMs === undefined) {
      warn('DURATION_UNKNOWN', 'No se conoce la duración del clip: no puedo verificar si alcanza.');
    } else if (asset.durationMs < minDuration) {
      warn(
        'DURATION_SHORT',
        `El clip dura ${(asset.durationMs / 1000).toFixed(1)} s y la campaña lo usa hasta ${(minDuration / 1000).toFixed(1)} s: el final quedaría congelado o en negro.`,
      );
    }
  }

  const status: AssetStatus = issues.some((i) => i.status === 'BLOCKED')
    ? 'BLOCKED'
    : issues.length > 0
      ? 'WARNING'
      : 'OK';
  return { status, issues };
}

/* ────────────────────────────────────────────────────────────────
 * Registro
 * ──────────────────────────────────────────────────────────────── */

export class AssetRegistry {
  private assets = new Map<string, Asset>();

  constructor(initial: readonly Asset[] = []) {
    for (const a of initial) this.assets.set(a.id, AssetSchema.parse(a));
  }

  get(id: string | null | undefined): Asset | undefined {
    return id ? this.assets.get(id) : undefined;
  }

  list(): Asset[] {
    return [...this.assets.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  has(id: string): boolean {
    return this.assets.has(id);
  }

  /** Registra un asset controlado. Rechaza rutas fuera de los namespaces. */
  register(asset: Asset): Asset {
    const parsed = AssetSchema.parse(asset);
    if (!parsed.unmanaged) {
      const v = validateAsset(parsed, null);
      const bloqueo = v.issues.find((i) => i.status === 'BLOCKED');
      if (bloqueo) throw new Error(`No se puede registrar "${parsed.id}": ${bloqueo.message}`);
    }
    this.assets.set(parsed.id, parsed);
    return parsed;
  }

  /**
   * Archivo arrastrado por el usuario. Queda marcado `unmanaged` y bloquea la
   * exportación: se ve en preview y nada más. No se sube a ningún lado.
   */
  registerLocalPreview(asset: Omit<Asset, 'unmanaged'> & { source: string }): Asset {
    const parsed = AssetSchema.parse({ ...asset, unmanaged: true });
    this.assets.set(parsed.id, parsed);
    return parsed;
  }

  remove(id: string): boolean {
    return this.assets.delete(id);
  }

  /** Assets sin registrar presentes. Si hay alguno en uso, no se exporta. */
  unmanagedIds(): string[] {
    return this.list()
      .filter((a) => a.unmanaged)
      .map((a) => a.id);
  }
}

/* ────────────────────────────────────────────────────────────────
 * Catálogo del repo
 * ──────────────────────────────────────────────────────────────── */

/**
 * Assets que existen realmente en el repositorio.
 *
 * Son patrones de prueba con timecode, no contenido de marca. No hay material
 * de McDonald's ni de ningún cliente: descargarlo sería traer IP de terceros a
 * un repositorio, y generarlo sería falsificar una pieza publicitaria.
 */
export const REPO_ASSETS: Asset[] = [
  AssetSchema.parse({
    id: 'test_towers_master',
    name: 'Test — Master A+B (timecode)',
    type: 'video',
    source: '/demo/test_towers_master.mp4',
    width: 2592,
    height: 576,
    durationMs: 30000,
    tags: ['test', 'master', 'towers'],
  }),
  AssetSchema.parse({
    id: 'test_horizontal',
    name: 'Test — Horizontal (timecode)',
    type: 'video',
    source: '/demo/test_horizontal.mp4',
    width: 1920,
    height: 412,
    durationMs: 30000,
    tags: ['test', 'horizontal'],
  }),
];

export function createRepoRegistry(): AssetRegistry {
  return new AssetRegistry(REPO_ASSETS);
}
