'use client';

import { useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EL_TRUST } from '@trust/show-engine';
import { TrustBuilding, Obelisco, Ground, CameraRig } from '@trust/trust-3d';
import { useShowStore } from '../state/useShowStore';

/** Bombea el motor una vez por frame. Es el unico lugar que avanza el tiempo. */
function EngineTicker() {
  const tick = useShowStore((s) => s.tick);
  useFrame(() => tick());
  return null;
}

export function Viewport() {
  const state = useShowStore((s) => s.state);
  const cameraMode = useShowStore((s) => s.cameraMode);
  const reportMediaError = useShowStore((s) => s.reportMediaError);
  const mediaEpoch = useShowStore((s) => s.mediaEpoch);

  // REVIEW-002 / P1-6: antes un clip caido quedaba silencioso.
  const onMediaError = useCallback(
    (source: string, message: string) => reportMediaError(source, message),
    [reportMediaError],
  );

  return (
    <Canvas shadows camera={{ position: [6, 22, 78], fov: 38, near: 0.5, far: 2000 }}>
      <color attach="background" args={['#07080c']} />
      <fog attach="fog" args={['#07080c', 120, 420]} />

      {/* Noche portenia: casi toda la luz visible es del propio edificio. */}
      <ambientLight intensity={0.12} color="#4a5a7a" />
      <directionalLight position={[40, 90, 40]} intensity={0.18} color="#8aa0c8" />

      <EngineTicker />
      {state && (
        <>
          <CameraRig presets={EL_TRUST.cameras} activeId={state.camera} mode={cameraMode} />
          {/* `key` por epoch: un retry remonta el arbol y vuelve a pedir los clips. */}
          <TrustBuilding
            key={mediaEpoch}
            config={EL_TRUST}
            state={state}
            onMediaError={onMediaError}
          />
        </>
      )}
      <Obelisco />
      <Ground />
    </Canvas>
  );
}
