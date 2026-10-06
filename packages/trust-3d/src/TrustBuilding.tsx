'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type {
  BuildingConfig,
  LightingZoneId,
  ScreenSurface,
  ShowRuntimeState,
} from '@trust/shared-types';
import { rgbwToHex } from '@trust/show-engine';
import { MediaTextureManager } from './MediaTextureManager';

/**
 * Digital twin simplificado de EL TRUST.
 *
 * NO es una réplica hiperrealista y no pretende serlo: es masa arquitectónica
 * con IDs estables. Cada mesh lleva el `meshId` que las LightingZone referencian
 * en targetIds, así que cuando entre el GLB del relevamiento real alcanza con
 * conservar esos nombres y el resto del sistema no se entera.
 */

interface Props {
  config: BuildingConfig;
  state: ShowRuntimeState;
  /** Se avisa cuando un clip no carga. En EDGE esto dispara SAFE MODE. */
  onMediaError?: (source: string, message: string) => void;
}

/** Mapa meshId → zona, derivado de la config. No se hardcodea nada acá. */
function useZoneOfMesh(config: BuildingConfig) {
  return useMemo(() => {
    const map = new Map<string, LightingZoneId>();
    for (const zone of config.lightingZones) {
      for (const target of zone.targetIds) map.set(target, zone.id);
    }
    return map;
  }, [config]);
}

/**
 * Material de fachada. Toma color e intensidad de su zona TAL CUAL los entrega
 * el motor.
 *
 * REVIEW-001 / P0: antes este componente hacia su propio fade con
 * `useFrame(delta)`, asi que la imagen dependia de como se habia llegado a t.
 * Ahora la interpolacion vive en show-engine y aca no queda semantica temporal:
 * si el renderer inventa tiempo, el digital twin deja de predecir el edificio.
 */
function LitSurface({
  meshId,
  zoneOfMesh,
  state,
  children,
}: {
  meshId: string;
  zoneOfMesh: Map<string, LightingZoneId>;
  state: ShowRuntimeState;
  children: React.ReactNode;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const scratch = useRef(new THREE.Color());

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;

    const zoneId = zoneOfMesh.get(meshId);
    const zone = zoneId ? state.zones[zoneId] : undefined;

    const intensity = zone && zone.enabled ? zone.intensity : 0;
    scratch.current.set(zone ? rgbwToHex(zone.color) : '#000000');

    mat.emissive.copy(scratch.current);
    mat.emissiveIntensity = intensity * 1.4;
    mat.color.set('#3a342c').lerp(scratch.current, intensity * 0.35);
  });

  return (
    <mesh name={meshId} castShadow receiveShadow>
      {children}
      <meshStandardMaterial ref={matRef} roughness={0.72} metalness={0.08} />
    </mesh>
  );
}

/**
 * Superficie LED. El aspect ratio sale de las medidas fisicas reales, no de la
 * resolucion: asi una pantalla con pixeles no cuadrados se ve bien.
 *
 * REVIEW-002 / P0-2. La visibilidad sale de `output`, no de `cue`:
 *   live  -> se ve, corriendo
 *   hold  -> se ve, frame congelado (pausa global o media.pause)
 *   black -> negro real (stop, SAFE MODE, clip caido, sin fuente)
 */
function ScreenPlane({
  surface,
  state,
  media,
}: {
  surface: ScreenSurface;
  state: ShowRuntimeState;
  media: MediaTextureManager;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const runtime = state.screens[surface.id];
  const texture = runtime?.source ? media.acquire(runtime.source, runtime.uv) : null;

  useFrame(({ clock }) => {
    if (runtime) media.sync(runtime, clock.elapsedTime * 1000);
    const mat = matRef.current;
    if (!mat) return;

    const failed = media.hasFailed(runtime?.source ?? null);
    const output = failed ? 'black' : (runtime?.output ?? 'black');

    // `black` es negro de verdad. Dejar el ultimo frame de una marca al 12%
    // en un edificio en modo seguro era exactamente lo que habia que evitar.
    mat.opacity = output === 'black' ? 0 : 1;
    // `hold` se ve, pero un poco apagado: el operador tiene que poder
    // distinguir de un vistazo un show pausado de uno corriendo.
    mat.color.setScalar(output === 'hold' ? 0.62 : 1);
  });

  return (
    <group position={surface.position} rotation={[0, surface.rotationY, 0]}>
      {/* Fondo negro real detras del panel: cuando la salida es `black`, lo que
          se ve es esto, no el frame anterior con opacidad baja. */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[surface.physicalWidthM, surface.physicalHeightM]} />
        <meshBasicMaterial color="#05070a" toneMapped={false} />
      </mesh>
      <mesh name={`screen_${surface.id}`}>
        <planeGeometry args={[surface.physicalWidthM, surface.physicalHeightM]} />
        {texture ? (
          <meshBasicMaterial ref={matRef} map={texture} toneMapped={false} transparent />
        ) : (
          <meshBasicMaterial ref={matRef} color="#0d1219" toneMapped={false} transparent />
        )}
      </mesh>
      <mesh position={[0, 0, -0.12]}>
        <boxGeometry args={[surface.physicalWidthM + 0.4, surface.physicalHeightM + 0.4, 0.25]} />
        <meshStandardMaterial color="#14120f" roughness={0.9} />
      </mesh>
    </group>
  );
}

export function TrustBuilding({ config, state, onMediaError }: Props) {
  const zoneOfMesh = useZoneOfMesh(config);
  const media = useMemo(() => new MediaTextureManager(), []);

  useEffect(() => {
    media.onError = onMediaError;
    // Los <video> no se limpian solos: sin esto se filtran decodificadores.
    return () => media.dispose();
  }, [media, onMediaError]);

  // Al cambiar de show, el clip viejo se pausa y se libera (REVIEW-002 / P2-11).
  const activeSources = useMemo(() => {
    const set = new Set<string>();
    for (const screen of Object.values(state.screens)) {
      if (screen.source) set.add(screen.source);
    }
    return set;
  }, [state.screens]);
  // `activeKey` es la identidad estable del conjunto: el Set cambia de
  // referencia en cada render, la cadena solo cuando cambian las fuentes.
  const activeKey = [...activeSources].sort().join('|');
  const activeRef = useRef(activeSources);
  activeRef.current = activeSources;
  useEffect(() => {
    media.syncActiveSources(activeRef.current);
  }, [media, activeKey]);

  const lit = (meshId: string, node: React.ReactNode) => (
    <LitSurface meshId={meshId} zoneOfMesh={zoneOfMesh} state={state}>
      {node}
    </LitSurface>
  );

  return (
    <group name="el_trust">
      {/* Basamento */}
      <group position={[0, 4, 0]}>{lit('mesh_base', <boxGeometry args={[26, 8, 26]} />)}</group>

      {/* Arcadas inferiores y superiores del cuerpo principal */}
      <group position={[0, 12, 0]}>
        {lit('mesh_arch_l', <boxGeometry args={[25, 8, 25]} />)}
      </group>
      <group position={[0, 20.5, 0]}>
        {lit('mesh_arch_u', <boxGeometry args={[24, 9, 24]} />)}
      </group>

      {/* Fachadas: Corrientes (frente) y Pellegrini (lateral) */}
      <group position={[0, 20, 12.6]}>
        <group position={[-6, 0, 0]}>{lit('mesh_corr_l', <boxGeometry args={[11, 26, 0.6]} />)}</group>
        <group position={[6, 0, 0]}>{lit('mesh_corr_r', <boxGeometry args={[11, 26, 0.6]} />)}</group>
      </group>
      <group position={[12.6, 20, 0]} rotation={[0, Math.PI / 2, 0]}>
        <group position={[-6, 0, 0]}>{lit('mesh_pell_l', <boxGeometry args={[11, 26, 0.6]} />)}</group>
        <group position={[6, 0, 0]}>{lit('mesh_pell_r', <boxGeometry args={[11, 26, 0.6]} />)}</group>
      </group>

      {/* Ochava: la esquina. Es el punto de vista que queremos volver icónico. */}
      <group position={[9.4, 20, 9.4]} rotation={[0, -Math.PI / 4, 0]}>
        {lit('mesh_chamfer', <boxGeometry args={[9, 28, 0.8]} />)}
      </group>

      {/* Torre */}
      <group position={[0, 33, 0]}>{lit('mesh_tower_m', <boxGeometry args={[15, 16, 15]} />)}</group>
      <group position={[0, 46, 0]}>{lit('mesh_tower_u', <boxGeometry args={[12, 12, 12]} />)}</group>

      {/* Cúpula */}
      <group position={[0, 54, 0]}>
        {lit('mesh_dome', <sphereGeometry args={[6.5, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />)}
      </group>
      <group position={[0, 62, 0]}>{lit('mesh_dome', <coneGeometry args={[1.2, 6, 12]} />)}</group>

      {/* Reloj: estado propio, independiente de la programación publicitaria */}
      <group position={[0, 40, 7.7]}>
        <ClockFace state={state} />
      </group>

      {/* Superficies LED */}
      {config.screens.map((surface) => (
        <ScreenPlane key={surface.id} surface={surface} state={state} media={media} />
      ))}
    </group>
  );
}

function ClockFace({ state }: { state: ShowRuntimeState }) {
  /*
   * REVIEW-002 / P1-3. Este componente ya no tiene tiempo propio.
   *
   * Antes la aguja usaba `frame.clock.elapsedTime` y el brillo un easing
   * acumulativo `+= ... * 0.06`. Las dos cosas dependian de cuantos frames se
   * habian renderizado, no de t: seekear a T y reproducir hasta T daban
   * imagenes distintas.
   *
   * Ahora `clockAngleDeg` y `clockIntensity` vienen resueltos del motor.
   */
  const emissive = state.clockState === 'accent' ? '#ffd27a' : '#ffe6bb';

  return (
    <group name="mesh_clock">
      <mesh>
        <circleGeometry args={[3.2, 48]} />
        <meshStandardMaterial
          color="#efe3cc"
          emissive={emissive}
          emissiveIntensity={state.clockIntensity}
        />
      </mesh>
      <group position={[0, 0, 0.06]} rotation={[0, 0, -THREE.MathUtils.degToRad(state.clockAngleDeg)]}>
        <mesh position={[0, 1.1, 0]}>
          <boxGeometry args={[0.16, 2.2, 0.06]} />
          <meshStandardMaterial color="#1a1510" />
        </mesh>
      </group>
    </group>
  );
}

/** Obelisco simplificado: solo referencia espacial y de escala. */
export function Obelisco({ position = [0, 0, 95] as [number, number, number] }) {
  return (
    <group position={position} name="obelisco">
      <mesh position={[0, 30, 0]}>
        <cylinderGeometry args={[1.6, 3.4, 60, 4]} />
        <meshStandardMaterial color="#d8d3c6" roughness={0.85} />
      </mesh>
      <mesh position={[0, 62, 0]}>
        <coneGeometry args={[1.7, 7, 4]} />
        <meshStandardMaterial color="#d8d3c6" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** Suelo: la 9 de Julio. Referencia de escala, no protagonista. */
export function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <planeGeometry args={[600, 600]} />
      <meshStandardMaterial color="#141210" roughness={1} />
    </mesh>
  );
}
