'use client';

import type { ShowRuntimeState } from '@trust/shared-types';
import { useEffect, useRef, useState } from 'react';
import {
  EXPERIENCE_VIEWS,
  activeSources,
  clockPlan,
  lightPlan,
  VIEW_GEOMETRY,
  containQuad,
  quadBounds,
  surfacePlan,
  type ComparisonMode,
  type ExperienceView,
} from '@trust/experience-core';
import { presentationSource } from '@trust/experience-core';
import { SurfaceMedia, releaseUnusedSources } from './SurfaceMediaRenderer';

/**
 * EXECUTIVE PRESENTATION RENDERER.
 *
 * Contrato deliberadamente pobre: recibe estado y lo pinta. NO resuelve el
 * show, no tiene reloj propio, no interpola nada. `ShowEngine` sigue siendo la
 * única verdad — si este componente calculara qué debería verse, la
 * presentación dejaría de mostrar el producto y pasaría a mostrar una
 * animación que se le parece.
 *
 * Es una interfaz a propósito: el día que existan los masters fotográficos o
 * un render fotorrealista, se cambia la implementación y el resto de la
 * experiencia no se entera.
 */
export interface ExecutivePresentationRendererProps {
  /** Modo operador: habilita ayudas visuales que el cliente no ve. */
  operador?: boolean;
  state: ShowRuntimeState | null;
  timeMs: number;
  transport: 'stopped' | 'playing' | 'paused' | 'ended';
  view: ExperienceView;
  comparison: ComparisonMode;
  campaign: { client: string; name: string };
  momentName: string | null;
  cinema: boolean;
  /** Muteado por defecto; solo cambia si el operador lo habilita. */
  audioEnabled?: boolean;
}

export type ExecutivePresentationRenderer = (
  props: ExecutivePresentationRendererProps,
) => JSX.Element;

/*
 * M2C.2.1: la geometría en % con `skewY` y el halo único de color salieron de
 * acá. Ahora los provee `experience-core` —`VIEW_GEOMETRY`, `surfacePlan` y
 * `lightPlan`— porque son datos de composición, no detalles de pintado, y
 * cambian cuando entren los masters fotográficos.
 */


/**
 * Implementación actual: fondo fotográfico (hoy placeholder) con las
 * superficies compuestas encima.
 *
 * NO es el SchematicPreviewRenderer del Builder. Ese existe para dirigir un
 * show con precisión; este existe para que alguien entienda de qué se trata
 * en tres segundos. Son dos trabajos distintos y por eso son dos componentes.
 */
export function PhotographicPresentationRenderer({
  state,
  view,
  comparison,
  campaign,
  momentName,
  cinema,
  audioEnabled = false,
  operador = false,
}: ExecutivePresentationRendererProps) {
  const spec = EXPERIENCE_VIEWS[view];

  /*
   * M2C.2.1 / puntos 2, 3 y 4. El renderer ya no inventa geometría ni color:
   * pide a `experience-core` el plan de cada superficie (fuente, recorte,
   * salida) y el de cada capa de luz, y los pinta.
   */
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1600, h: 900 });

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // BEFORE es puramente visual: el motor sigue en el mismo estado. Es el
  // control que hace evidente el valor sin tener que explicarlo.
  const before = comparison === 'BEFORE';

  // BEFORE apaga las superficies y la luz: es el edificio sin campaña. No
  // toca el motor — el show sigue exactamente donde estaba.
  const master = VIEW_GEOMETRY[view].master;
  const planes = surfacePlan(before ? null : state, view);
  const luces = before ? [] : lightPlan(state, view);
  const reloj = before ? null : clockPlan(state, view);

  useEffect(() => {
    releaseUnusedSources(activeSources(planes));
  }, [planes]);

  return (
    <div
      data-testid="experience-stage"
      data-view={view}
      data-comparison={comparison}
      ref={stage}
      className="relative h-full w-full overflow-hidden bg-neutral-950"
    >
      {/* Relleno de los costados: la misma foto, desenfocada. */}
      <img
        src={spec.background}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: 'blur(48px) brightness(0.45) saturate(0.8)', transform: 'scale(1.1)' }}
        draggable={false}
      />
      {/*
        HERO 16:9 — extensión lateral del master, a la MISMA escala que él y
        centrada: su franja central es el master píxel a píxel, así que la
        geometría aprobada no cambia y desaparecen las bandas borrosas. Si el
        escenario es más ancho que 16:9, los bordes se funden con el fondo.
      */}
      {spec.ext169 && (
        <img
          src={spec.ext169}
          alt=""
          aria-hidden
          data-testid="stage-ext169"
          className="absolute"
          style={(() => {
            const k = Math.min(size.w / master.width, size.h / master.height);
            const w = master.height * (16 / 9) * k;
            const h = master.height * k;
            return {
              width: w,
              height: h,
              left: (size.w - w) / 2,
              top: (size.h - h) / 2,
              maxWidth: 'none',
              filter: before ? 'saturate(0.55) brightness(0.72)' : 'none',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 5%, #000 95%, transparent 100%)',
              maskImage: 'linear-gradient(to right, transparent 0, #000 5%, #000 95%, transparent 100%)',
            };
          })()}
          draggable={false}
        />
      )}
      <img
        src={spec.background}
        alt=""
        data-testid="stage-background"
        className="absolute inset-0 h-full w-full object-contain"
        style={{ filter: before ? 'saturate(0.55) brightness(0.72)' : 'none' }}
        draggable={false}
      />

      {/*
        Capas de luz por zona (M2C.2.1 / punto 4). Un solo círculo borroso no
        podía mostrar que en un takeover la cúpula sigue dorada mientras la
        fachada va de marca — que es justamente lo que se vende.
      */}
      {luces.map((capa) => {
        const b = quadBounds(containQuad(capa.quad, master, size.w, size.h));
        return (
          <div
            key={capa.label}
            data-testid={`light-${capa.label}`}
            data-intensity={capa.intensity.toFixed(2)}
            className="pointer-events-none absolute transition-[background,opacity] duration-700"
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
              background: `radial-gradient(ellipse at center, ${capa.color} 0%, transparent 70%)`,
              opacity: Math.min(0.45, capa.intensity * 0.42),
              filter: `blur(${Math.round(capa.blur * size.w)}px)`,
              mixBlendMode: 'screen',
            }}
          />
        );
      })}

      {/* Reloj: los cuatro estados que el contrato soporta, nada más. */}
      {reloj && reloj.visible && (
        <div
          data-testid="stage-clock"
          data-clock-state={reloj.state}
          className="pointer-events-none absolute rounded-full transition-[opacity] duration-500"
          style={{
            left: `${quadBounds(containQuad(reloj.quad, master, size.w, size.h)).x * 100}%`,
            top: `${quadBounds(containQuad(reloj.quad, master, size.w, size.h)).y * 100}%`,
            width: `${quadBounds(containQuad(reloj.quad, master, size.w, size.h)).w * 100}%`,
            height: `${quadBounds(containQuad(reloj.quad, master, size.w, size.h)).h * 100}%`,
            background:
              reloj.state === 'accent'
                ? 'radial-gradient(circle, rgba(255,210,122,0.95) 0%, rgba(255,190,90,0.25) 60%, transparent 75%)'
                : 'radial-gradient(circle, rgba(255,230,187,0.85) 0%, rgba(255,230,187,0.18) 60%, transparent 75%)',
            opacity: Math.min(1, reloj.intensity / 1.6),
          }}
        />
      )}

      {/*
        Gabinete de 20 cm, sombra sobre la pared y marco: SVG por DEBAJO de las
        caras frontales. Va antes en el DOM a propósito: las caras quedan por
        fuera del frente, así que no lo tapan, y el marco se dibuja encima en
        un segundo SVG.
      */}
      <CabinetLayer planes={planes} master={master} w={size.w} h={size.h} capa="debajo" />

      {planes.map((plan) => (
        <SurfaceMedia
          key={`${plan.id}_${plan.segment}`}
          plan={{
            ...plan,
            // Client Mode muestra la creatividad de campaña, no el clip de prueba.
            source: presentationSource(plan.source),
            quad: containQuad(solapar(plan), master, size.w, size.h),
          }}
          containerW={size.w}
          containerH={size.h}
          audioEnabled={audioEnabled}
          glowStrength={plan.id === 'horizontal' ? 0 : 1}
          atenuarHold={operador}
          angleDim={plan.id === 'screen_b' ? 0.93 : 1}
        />
      ))}

      <CabinetLayer planes={planes} master={master} w={size.w} h={size.h} capa="encima" />

      {/* Gradiente inferior: la tipografía necesita contraste sobre foto. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-6">
        <div>
          {/* M2C.2.3 / 1: la leyenda de la vista es información de operador. */}
          {operador && <p className="text-[10px] uppercase tracking-[0.35em] text-white/45">{spec.label}</p>}
          {operador && !cinema && <p className="mt-1 max-w-sm text-[12px] text-white/50">{spec.caption}</p>}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.35em] text-white/45">{campaign.client}</p>
          <p className="text-sm font-medium text-white/85">{campaign.name}</p>
          {momentName && (
            <p data-testid="stage-moment" className="mt-0.5 text-[11px] uppercase tracking-[0.2em] text-amber-300/80">
              {momentName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


/**
 * Los tramos de la marquesina se dibujan un pelo más anchos que su geometría:
 * dos `matrix3d` vecinos con borde antialiasado dejan una costura oscura justo
 * en el vértice de la curva. El solape es de ~1 px a escala de pantalla.
 */
function solapar(plan: ReturnType<typeof surfacePlan>[number]) {
  if (plan.id !== 'horizontal') return plan.quad;
  const e = 0.0006;
  const { tl, tr, br, bl } = plan.quad;
  return {
    tl: { x: tl.x - e, y: tl.y },
    tr: { x: tr.x + e, y: tr.y },
    br: { x: br.x + e, y: br.y },
    bl: { x: bl.x - e, y: bl.y },
  };
}

/* ────────────────────────────────────────────────────────────────
 * Gabinete — M2C.2.2 / 3
 * ──────────────────────────────────────────────────────────────── */

/**
 * Espesor real: gabinetes de 20 cm.
 *
 * Qué caras se ven depende de la CÁMARA, no de una regla de estilo:
 *   · la foto está tomada desde la vereda mirando hacia arriba ⇒ se ve la
 *     cara INFERIOR, nunca la superior;
 *   · cada fachada se aleja de la cámara hacia su extremo ⇒ se ve el canto
 *     del lado de la CÚPULA (más cerca de la cámara); el exterior queda oculto.
 *
 * Escala: 3,84 m de alto ≈ 184 px del master ⇒ 20 cm ≈ 10 px, que vistos en
 * ángulo quedan en 5–6 px. `OFFSET` es el desplazamiento, en px del master,
 * desde la cara frontal hasta la huella sobre la pared.
 */
const OFFSET: Record<string, [number, number]> = {
  screen_a: [5, 6],   // la pared queda abajo-derecha del frente
  screen_b: [-5, 6],  // espejo
  horizontal: [0, 4.5], // marquesina: solo la cara inferior
};

function CabinetLayer({
  planes,
  master,
  w,
  h,
  capa,
}: {
  planes: ReturnType<typeof surfacePlan>;
  master: { width: number; height: number };
  w: number;
  h: number;
  capa: 'debajo' | 'encima';
}) {
  // Escala del encaje `contain`: px del master → px del escenario.
  const k = Math.min(w / master.width, h / master.height);
  const P = (pt: { x: number; y: number }) => ({ x: pt.x * w, y: pt.y * h });
  const poly = (pts: Array<{ x: number; y: number }>) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const items = planes.map((plan) => {
    const q = containQuad(plan.quad, master, w, h);
    const [ox, oy] = (OFFSET[plan.id] ?? [0, 0]).map((v) => v * k) as [number, number];
    const tl = P(q.tl), tr = P(q.tr), br = P(q.br), bl = P(q.bl);
    const mv = (p: { x: number; y: number }) => ({ x: p.x + ox, y: p.y + oy });
    const inferior = [bl, br, mv(br), mv(bl)];
    const canto =
      plan.id === 'screen_a' ? [tr, br, mv(br), mv(tr)] :
      plan.id === 'screen_b' ? [tl, bl, mv(bl), mv(tl)] : null;
    // sombra sobre la pared, cargada hacia abajo de la huella
    const caida = 0.012 * master.height * k;
    const sombra = [mv(bl), mv(br), { x: br.x + ox, y: br.y + oy + caida }, { x: bl.x + ox, y: bl.y + oy + caida }];
    return { key: `${plan.id}_${plan.segment}`, id: plan.id, frente: [tl, tr, br, bl], inferior, canto, sombra };
  });

  if (capa === 'encima') {
    // Marco del gabinete: borde oscuro fino sobre la cara frontal. Solo en las
    // superiores: en la marquesina partiría la curva en tramos visibles.
    return (
      <svg className="pointer-events-none absolute inset-0" width={w} height={h} aria-hidden>
        {items.filter((i) => i.id !== 'horizontal').map((i) => (
          <polygon key={i.key} points={poly(i.frente)} fill="none" stroke="#0c0c0e" strokeOpacity={0.75} strokeWidth={1.6} strokeLinejoin="round" />
        ))}
      </svg>
    );
  }

  return (
    <svg className="pointer-events-none absolute inset-0" width={w} height={h} aria-hidden data-testid="cabinet-layer">
      <defs>
        <filter id="cab-sombra" x="-20%" y="-20%" width="140%" height="160%">
          <feGaussianBlur stdDeviation={Math.max(1, 0.005 * master.height * k)} />
        </filter>
      </defs>
      {/* oclusión ambiental sobre la pared */}
      <g filter="url(#cab-sombra)">
        {items.map((i) => <polygon key={i.key} points={poly(i.sombra)} fill="#0a0909" fillOpacity={0.5} />)}
      </g>
      {/* caras del gabinete: metal oscuro con algo de luz de calle */}
      <g>
        {items.map((i) => <polygon key={`${i.key}-i`} points={poly(i.inferior)} fill="#2e2824" />)}
        {items.map((i) => i.canto && <polygon key={`${i.key}-c`} points={poly(i.canto)} fill="#181615" />)}
      </g>
    </svg>
  );
}
