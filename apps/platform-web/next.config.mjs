import { assertBuildEnv } from './src/build-env.mjs';

// BL-30: con TRUST_BUILD_STRICT=1 el build falla si la URL de la API falta o no es https.
assertBuildEnv(process.env);

/**
 * platform-web — M3A.1 E3a (docs/briefs/M3A1_FASE_E3.md, ADR-063).
 *
 * SIN rewrites ni proxy a la API: el navegador llama directo a
 * `NEXT_PUBLIC_TRUST_API_URL`. La cookie de sesión es host-only del host de la
 * API (`__Host-trust_session`); un proxy la dejaría en el host de la web y el
 * Builder (apps/control), que también va directo a la API, no la vería.
 *
 * Igual que apps/control: el lint lo corre el monorepo (`pnpm lint`).
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default nextConfig;
