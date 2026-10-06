/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /*
   * M2A.1 / punto 7. `next build` avisa que no encuentra su plugin de ESLint.
   * No se agrega `eslint-config-next`: el lint del monorepo ya cubre estos
   * archivos desde la raiz con una sola configuracion (`pnpm lint`), y tener
   * dos linters con reglas distintas sobre el mismo codigo genera conflictos
   * que nadie termina resolviendo. El build compila; el lint se corre aparte.
   */
  eslint: { ignoreDuringBuilds: true },
  // Los packages del monorepo se publican como fuente TS, no compilados.
  transpilePackages: ['@trust/shared-types', '@trust/show-engine', '@trust/timeline', '@trust/trust-3d'],
};
export default nextConfig;
