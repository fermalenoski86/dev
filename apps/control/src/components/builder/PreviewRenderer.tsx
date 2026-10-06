'use client';

import type { ShowRuntimeState } from '@trust/shared-types';
import { rgbwToHex } from '@trust/show-engine';

/**
 * PREVIEW RENDERER.
 *
 * La interfaz existe para que `PhotorealPreviewRenderer` pueda reemplazar a
 * este sin tocar una línea del Builder. El contrato es mínimo a propósito:
 * recibe el estado que resuelve el ShowEngine y lo dibuja. No decide nada.
 *
 * Este renderer es una ABSTRACCIÓN, no una maqueta. No intenta parecerse a un
 * 3D barato —eso se lee como un prototipo sin terminar—, sino a un diagrama de
 * dirección: superficies como rectángulos proporcionales a sus medidas reales,
 * zonas de iluminación como bandas, el reloj como un disco. La proporción es
 * fiel; el resto es notación.
 */
export interface PreviewRendererProps {
  state: ShowRuntimeState | null;
  /** Nombre del asset por superficie, para rotular el contenido. */
  labels?: Partial<Record<'screen_a' | 'screen_b' | 'horizontal', string>>;
  /** Oculta rótulos técnicos. Se usa en modo presentación. */
  clean?: boolean;
}

export type PreviewRenderer = (props: PreviewRendererProps) => JSX.Element;

/* ── Geometría del esquema ──────────────────────────────────────
 * Proporciones tomadas de las medidas reales:
 *   Corrientes  7,68 × 3,84 m   (2,0 : 1)
 *   Pellegrini  9,60 × 3,84 m   (2,5 : 1)
 *   Horizontal 14,00 × 3,00 m   (4,67 : 1)
 */
const A_W = 96;
const B_W = 120;
const SCREEN_H = 48;
const H_W = 224;
const H_H = 48;

function screenFill(output: 'live' | 'hold' | 'black' | undefined): { fill: string; opacity: number } {
  if (output === 'live') return { fill: 'url(#contenido)', opacity: 1 };
  if (output === 'hold') return { fill: 'url(#contenido)', opacity: 0.45 };
  return { fill: '#0a0c10', opacity: 1 };
}

export const SchematicPreviewRenderer: PreviewRenderer = ({ state, labels = {}, clean = false }) => {
  const zone = (id: keyof ShowRuntimeState['zones']) => state?.zones[id];
  const glow = (id: keyof ShowRuntimeState['zones']) => {
    const z = zone(id);
    if (!z || !z.enabled) return { fill: '#15171c', opacity: 1 };
    return { fill: rgbwToHex(z.color), opacity: 0.12 + z.intensity * 0.78 };
  };

  const a = state?.screens.screen_a;
  const b = state?.screens.screen_b;
  const h = state?.screens.horizontal;

  return (
    <svg viewBox="0 0 420 460" className="h-full w-full" role="img" aria-label="Esquema del edificio">
      <defs>
        <linearGradient id="contenido" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9fd5ff" />
          <stop offset="55%" stopColor="#5f8fd8" />
          <stop offset="100%" stopColor="#2d4f88" />
        </linearGradient>
        <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a0d14" />
          <stop offset="100%" stopColor="#05070a" />
        </linearGradient>
        <filter id="halo" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      <rect width="420" height="460" fill="url(#cielo)" />

      {/* Halo general: el edificio tiñe el aire a su alrededor */}
      {state && (
        <ellipse
          cx="210"
          cy="230"
          rx="150"
          ry="190"
          fill={rgbwToHex(state.zones.tower_upper.color)}
          opacity={state.zones.tower_upper.intensity * 0.1}
          filter="url(#halo)"
        />
      )}

      {/* ── Cúpula ── */}
      <g>
        <path d="M210 36 L210 62" stroke="#4a4438" strokeWidth="2" />
        <path d="M178 96 Q210 50 242 96 Z" {...asFill(glow('dome'))} />
        <path d="M178 96 Q210 50 242 96 Z" fill="none" stroke="#2a2a30" strokeWidth="1" />
      </g>

      {/* ── Reloj ── */}
      <g transform="translate(210 122)">
        <circle
          r="15"
          fill="#efe3cc"
          opacity={Math.min(1, (state?.clockIntensity ?? 0.9) * 0.62)}
        />
        <circle r="15" fill="none" stroke="#3a352c" strokeWidth="1" />
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="-10"
          stroke="#14100a"
          strokeWidth="1.6"
          transform={`rotate(${state?.clockAngleDeg ?? 0})`}
        />
      </g>

      {/* ── Torre superior: las dos pantallas ── */}
      <g transform="translate(210 150)">
        <rect x={-(A_W + B_W) / 2 - 10} y="-4" width={A_W + B_W + 20} height={SCREEN_H + 16} rx="3" {...asFill(glow('tower_upper'))} />
        <Surface testId="surface-corrientes" x={-(A_W + B_W) / 2} y={4} w={A_W} h={SCREEN_H} output={a?.output} label={clean ? undefined : 'CORRIENTES'} asset={labels.screen_a} />
        <Surface testId="surface-pellegrini" x={-(A_W + B_W) / 2 + A_W} y={4} w={B_W} h={SCREEN_H} output={b?.output} label={clean ? undefined : 'PELLEGRINI'} asset={labels.screen_b} />
        {/* Línea divisoria: recuerda que son dos superficies físicas. */}
        <line x1={-(A_W + B_W) / 2 + A_W} y1="4" x2={-(A_W + B_W) / 2 + A_W} y2={4 + SCREEN_H} stroke="#0a0c10" strokeWidth="1.5" />
      </g>

      {/* ── Cuerpo de la torre ── */}
      <g transform="translate(210 222)">
        <rect x="-78" y="0" width="156" height="52" rx="2" {...asFill(glow('tower_mid'))} />
      </g>

      {/* ── Ochava ── */}
      <g transform="translate(210 276)">
        <rect x="-52" y="0" width="104" height="44" rx="2" {...asFill(glow('chamfer'))} />
      </g>

      {/* ── Pantalla horizontal ── */}
      <g transform="translate(210 322)">
        <Surface testId="surface-horizontal" x={-H_W / 2} y={0} w={H_W} h={H_H} output={h?.output} label={clean ? undefined : 'HORIZONTAL'} asset={labels.horizontal} />
      </g>

      {/* ── Arcadas y basamento ── */}
      <g transform="translate(210 376)">
        <rect x="-104" y="0" width="208" height="30" rx="2" {...asFill(glow('arches_upper'))} />
        <rect x="-112" y="32" width="224" height="26" rx="2" {...asFill(glow('arches_lower'))} />
        <rect x="-120" y="60" width="240" height="20" rx="2" {...asFill(glow('base'))} />
      </g>

      {/* Suelo */}
      <rect x="0" y="440" width="420" height="20" fill="#080a0e" />

      {!clean && (
        <text x="210" y="452" textAnchor="middle" fill="#3c4250" fontSize="8" letterSpacing="2">
          ESQUEMA — PROPORCIONES REALES, NO ES UNA MAQUETA
        </text>
      )}
    </svg>
  );
};

function asFill(v: { fill: string; opacity: number }) {
  return { fill: v.fill, opacity: v.opacity };
}

function Surface({
  x,
  y,
  w,
  h,
  output,
  label,
  asset,
  testId,
}: {
  testId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  output: 'live' | 'hold' | 'black' | undefined;
  label?: string;
  asset?: string;
}) {
  const { fill, opacity } = screenFill(output);
  return (
    // `data-testid` + `data-output`: el E2E necesita poder afirmar qué está
    // mostrando cada superficie sin leer píxeles.
    <g data-testid={testId} data-output={output ?? 'none'}>
      <rect x={x} y={y} width={w} height={h} fill="#05070a" />
      <rect x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#1d2129" strokeWidth="1" />
      {output === 'hold' && (
        <text x={x + w / 2} y={y + h / 2 + 3} textAnchor="middle" fill="#0a0c10" fontSize="9" fontWeight="700">
          HOLD
        </text>
      )}
      {label && (
        <text x={x + w / 2} y={y - 4} textAnchor="middle" fill="#525b6b" fontSize="6.5" letterSpacing="1.4">
          {label}
        </text>
      )}
      {asset && output !== 'black' && (
        <text x={x + w / 2} y={y + h + 9} textAnchor="middle" fill="#3f4654" fontSize="6">
          {asset}
        </text>
      )}
    </g>
  );
}
