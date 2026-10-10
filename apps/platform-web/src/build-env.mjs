/**
 * BL-30 · validación de las variables públicas en el build de platform-web.
 *
 * `NEXT_PUBLIC_*` se incrusta en el JavaScript al hacer `next build`
 * (https://nextjs.org/docs/app/guides/environment-variables): el artefacto
 * queda atado a esa API y NO se puede promover a otro entorno con otra API.
 * Por eso TODO `next build` (fase de build de producción) falla si la URL de
 * la API falta o no es HTTPS, sin banderas opt-in (auditoría E3c, [P1]).
 * `next dev` y `next start` no validan: el primero es desarrollo y el segundo
 * sirve un bundle ya construido.
 *
 * Devuelve la lista de errores (vacía = OK). Sin dependencias: lo carga next.config.
 */
export function checkBuildEnv(env) {
  const errores = [];
  const https = (nombre, requerida) => {
    const v = (env[nombre] ?? '').trim();
    if (v === '') {
      if (requerida) errores.push(`${nombre} es obligatoria en \`next build\` (se incrusta en el bundle)`);
      return;
    }
    let u;
    try {
      u = new URL(v);
    } catch {
      errores.push(`${nombre} no es una URL absoluta: «${v}»`);
      return;
    }
    if (u.protocol !== 'https:') errores.push(`${nombre} tiene que ser https (recibido «${u.protocol}»)`);
    if (u.username || u.password) errores.push(`${nombre} no puede llevar credenciales`);
    if (u.search || u.hash) errores.push(`${nombre} no puede llevar query ni fragmento`);
  };
  https('NEXT_PUBLIC_TRUST_API_URL', true);
  https('NEXT_PUBLIC_TRUST_BUILDER_URL', false);
  return errores;
}

/** Fase de `next build` (valor de `PHASE_PRODUCTION_BUILD` en `next/constants`). */
export const PHASE_PRODUCTION_BUILD = 'phase-production-build';

/** Para next.config: en la fase de build de producción, lanza si hay errores. Otras fases no validan. */
export function assertBuildEnv(phase, env) {
  if (phase !== PHASE_PRODUCTION_BUILD) return;
  const errores = checkBuildEnv(env);
  if (errores.length > 0) throw new Error(`platform-web: \`next build\` inválido (BL-30):\n- ${errores.join('\n- ')}`);
}
