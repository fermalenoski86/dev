'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { CameraId, CameraPreset } from '@trust/shared-types';

/**
 * REVIEW-002 / P1-4. Dos modos, porque son dos cosas distintas:
 *
 *  - `interactive`: suavizado por delta. Cómodo para navegar mientras se
 *    programa un show, pero depende del framerate.
 *  - `deterministic`: corte exacto al preset. Es el modo en que la preview
 *    predice lo que se va a ver, y el único válido para aprobar contenido
 *    con un cliente o para comparar dos corridas.
 *
 * El corte duro además es lo honesto: un `camera.switch` en el edificio real
 * no es un dolly, es un cambio de plano. Suavizarlo en PREVIS vende una
 * transición que no existe.
 *
 * hero_3d está marcada `locked`: el contenido anamórfico se genera para ese
 * punto de vista exacto.
 */
export type CameraMode = 'interactive' | 'deterministic';

export function CameraRig({
  presets,
  activeId,
  mode = 'interactive',
  transitionMs = 900,
}: {
  presets: CameraPreset[];
  activeId: CameraId;
  mode?: CameraMode;
  transitionMs?: number;
}) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());
  const desiredPos = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const initialized = useRef(false);

  useEffect(() => {
    const preset = presets.find((p) => p.id === activeId) ?? presets[0];
    if (!preset) return;
    desiredPos.current.set(...preset.position);
    desiredTarget.current.set(...preset.target);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = preset.fov;
      camera.updateProjectionMatrix();
    }
    // Primer montaje o modo determinista: se planta en el preset, sin viaje.
    if (!initialized.current || mode === 'deterministic') {
      camera.position.copy(desiredPos.current);
      target.current.copy(desiredTarget.current);
      camera.lookAt(target.current);
      initialized.current = true;
    }
  }, [activeId, presets, camera, mode]);

  useFrame((_, delta) => {
    if (mode === 'deterministic') {
      // Posición, target y FOV son función del preset activo y de nada más.
      camera.position.copy(desiredPos.current);
      target.current.copy(desiredTarget.current);
      camera.lookAt(target.current);
      return;
    }
    const k = 1 - Math.exp((-delta * 1000) / Math.max(transitionMs / 4, 1));
    camera.position.lerp(desiredPos.current, k);
    target.current.lerp(desiredTarget.current, k);
    camera.lookAt(target.current);
  });

  return null;
}
