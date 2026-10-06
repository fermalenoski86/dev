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
  transpilePackages: [
    '@trust/shared-types',
    '@trust/show-engine',
    '@trust/timeline',
    '@trust/telemetry',
    '@trust/control-core',
    '@trust/show-authoring',
    '@trust/experience-core',
  ],
};
export default nextConfig;
