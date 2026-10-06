import { preflightShow, type PreflightIssue, type ResolveContext } from '@trust/show-engine';
import { validateAsset } from './asset-registry';
import type { AssetRegistry, AssetStatus } from './asset-registry';
import { compileTakeoverDraft, type CompileContext, type CompileIssue, type CompileResult } from './compiler';
import { momentSpans, type TakeoverDraft } from './draft-schema';
import type { ScreenSurface } from '@trust/shared-types';

/**
 * VALIDACIÓN — panel PREFLIGHT del builder.
 *
 * Deliberadamente NO reimplementa las reglas de `preflightShow()`. El paquete
 * compilado se pasa por el mismo preflight que usa CONTROL, y lo único que
 * agrega este módulo es TRADUCCIÓN: mapear cada issue al moment que lo causó,
 * para poder marcarlo en el timeline.
 *
 * Si acá hubiera una segunda copia de las validaciones, el editor diría "listo"
 * sobre paquetes que el motor rechaza, o al revés — y la que le habla al
 * usuario es siempre la que nadie actualiza.
 */

export type PreflightStatus = 'READY' | 'WARNING' | 'BLOCKED';

export interface BuilderIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** De dónde viene: útil para no mezclar peras con manzanas en la UI. */
  origin: 'draft' | 'asset' | 'compiler' | 'preflight';
  momentId?: string;
  momentIndex?: number;
}

export interface BuilderValidation {
  status: PreflightStatus;
  errors: BuilderIssue[];
  warnings: BuilderIssue[];
  compile: CompileResult;
  /** Solo true si no hay un solo bloqueo. */
  exportable: boolean;
}

export interface ValidateOptions extends CompileContext {
  preflight: ResolveContext;
}

export function validateDraft(draft: TakeoverDraft, opts: ValidateOptions): BuilderValidation {
  const errors: BuilderIssue[] = [];
  const warnings: BuilderIssue[] = [];
  const push = (i: BuilderIssue) => (i.severity === 'error' ? errors : warnings).push(i);

  /* ── Estructura del draft ────────────────────────────────────── */

  if (draft.moments.length === 0) {
    push({ severity: 'error', code: 'NO_MOMENTS', origin: 'draft', message: 'La campaña no tiene moments.' });
  }
  for (const { moment, index } of momentSpans(draft)) {
    if (moment.durationMs <= 0) {
      push({
        severity: 'error',
        code: 'INVALID_DURATION',
        origin: 'draft',
        message: `"${moment.name}" tiene duración inválida.`,
        momentId: moment.id,
        momentIndex: index,
      });
    }
  }

  /* ── Assets contra la superficie donde se usan ───────────────── */

  for (const issue of validateCampaignAssets(draft, opts.assets, opts.building.screens)) push(issue);

  /* ── Compilación ─────────────────────────────────────────────── */

  const compile = compileTakeoverDraft(draft, opts);
  for (const i of [...compile.errors, ...compile.warnings]) push(fromCompile(i));

  /* ── Preflight sobre el paquete real ─────────────────────────── */

  if (compile.showPackage) {
    const pre = preflightShow(compile.showPackage, opts.preflight);
    const spans = momentSpans(draft);
    const ubicar = (issue: PreflightIssue): { momentId?: string; momentIndex?: number } => {
      if (issue.atMs === undefined) return {};
      const at = issue.atMs;
      const s = spans.find((x) => at >= x.startMs && at < x.endMs);
      return s ? { momentId: s.moment.id, momentIndex: s.index } : {};
    };
    for (const e of pre.errors) {
      push({ severity: 'error', code: e.code, origin: 'preflight', message: e.message, ...ubicar(e) });
    }
    for (const w of pre.warnings) {
      push({ severity: 'warning', code: w.code, origin: 'preflight', message: w.message, ...ubicar(w) });
    }
  }

  const status: PreflightStatus = errors.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARNING' : 'READY';
  return { status, errors, warnings, compile, exportable: errors.length === 0 };
}

function fromCompile(i: CompileIssue): BuilderIssue {
  return {
    severity: i.severity,
    code: i.code,
    message: i.message,
    origin: 'compiler',
    momentId: i.momentId,
    momentIndex: i.momentIndex,
  };
}

/** Valida cada asset de campaña contra la superficie real donde se muestra. */
export function validateCampaignAssets(
  draft: TakeoverDraft,
  registry: AssetRegistry,
  screens: readonly ScreenSurface[],
): BuilderIssue[] {
  const out: BuilderIssue[] = [];
  const surface = (id: string) => screens.find((s) => s.id === id) ?? null;
  const { surfaces } = draft;
  const usadoHasta = maxUsageMs(draft);

  const revisar = (assetId: string | null, target: Parameters<typeof validateAsset>[1], etiqueta: string, minMs?: number) => {
    if (!assetId) return;
    const v = validateAsset(registry.get(assetId), target, minMs === undefined ? {} : { minDurationMs: minMs });
    for (const i of v.issues) {
      out.push({
        severity: i.status === 'BLOCKED' ? 'error' : 'warning',
        code: i.code,
        origin: 'asset',
        message: `${etiqueta}: ${i.message}`,
      });
    }
  };

  if (surfaces.upperMode === 'master') {
    const a = surface('screen_a');
    const b = surface('screen_b');
    // El master tiene que tener el aspecto del LIENZO combinado, no el de una
    // torre: 2592×576 si A es 1152 y B es 1440.
    const canvas =
      a && b
        ? {
            widthPx: a.pixelWidth + b.pixelWidth,
            heightPx: Math.max(a.pixelHeight, b.pixelHeight),
            physicalRatio:
              (a.pixelWidth + b.pixelWidth) / Math.max(a.pixelHeight, b.pixelHeight),
          }
        : null;
    revisar(surfaces.masterAssetId, canvas, 'Master A+B', usadoHasta);
  } else {
    revisar(surfaces.corrientesAssetId, surface('screen_a'), 'Corrientes', usadoHasta);
    revisar(surfaces.pellegriniAssetId, surface('screen_b'), 'Pellegrini', usadoHasta);
  }
  revisar(surfaces.horizontalAssetId, surface('horizontal'), 'Horizontal', usadoHasta);

  return out;
}

/** Cota superior de cuánto clip consume la campaña. */
function maxUsageMs(draft: TakeoverDraft): number {
  let max = 0;
  for (const { moment, startMs, endMs } of momentSpans(draft)) {
    for (const d of [
      moment.screens.upper,
      moment.screens.corrientes,
      moment.screens.pellegrini,
      moment.screens.horizontal,
    ]) {
      if (d.mode === 'play') max = Math.max(max, d.fromMs + (endMs - startMs));
    }
  }
  return max;
}

/** Resumen de estado por asset, para pintar el panel de la izquierda. */
export function assetStatuses(
  draft: TakeoverDraft,
  registry: AssetRegistry,
  screens: readonly ScreenSurface[],
): Record<string, AssetStatus> {
  const issues = validateCampaignAssets(draft, registry, screens);
  const out: Record<string, AssetStatus> = {};
  for (const a of registry.list()) out[a.id] = a.unmanaged ? 'BLOCKED' : 'OK';
  const ids = [
    draft.surfaces.masterAssetId,
    draft.surfaces.corrientesAssetId,
    draft.surfaces.pellegriniAssetId,
    draft.surfaces.horizontalAssetId,
  ].filter((x): x is string => x !== null);
  for (const id of ids) {
    const propias = issues.filter((i) => i.message.includes(registry.get(id)?.name ?? '\u0000'));
    if (propias.some((i) => i.severity === 'error')) out[id] = 'BLOCKED';
    else if (propias.length > 0 && out[id] === 'OK') out[id] = 'WARNING';
  }
  return out;
}
