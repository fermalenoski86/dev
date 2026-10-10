/**
 * BL-30 · validación de las variables públicas en el build de platform-web.
 *
 * `NEXT_PUBLIC_*` se incrusta en el JavaScript al hacer `next build`
 * (https://nextjs.org/docs/app/guides/environment-variables): el artefacto
 * queda atado a esa API y NO se puede promover a otro entorno con otra API.
 * Por eso un build para desplegar (o para el E2E) se hace con
 * `TRUST_BUILD_STRICT=1`, y entonces falla si la URL de la API falta o no es
 * HTTPS. Sin la bandera (el `pnpm build` del gate verify-build), el build
 * compila y la app muestra el error de configuración en runtime.
 *
 * Devuelve la lista de errores (vacía = OK). Sin dependencias: lo carga next.config.
 */
export function checkBuildEnv(env) {
  const errores = [];
  const https = (nombre, requerida) => {
    const v = (env[nombre] ?? '').trim();
    if (v === '') {
      if (requerida) errores.push(`${nombre} es obligatoria en un build estricto (TRUST_BUILD_STRICT=1)`);
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

/** Para next.config: lanza si el build es estricto y hay errores. */
export function assertBuildEnv(env) {
  if (env.TRUST_BUILD_STRICT !== '1') return;
  const errores = checkBuildEnv(env);
  if (errores.length > 0) throw new Error(`platform-web: build estricto inválido (BL-30):\n- ${errores.join('\n- ')}`);
}
