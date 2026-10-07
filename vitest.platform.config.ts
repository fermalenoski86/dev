import { defineConfig } from 'vitest/config';

/**
 * Tests de plataforma contra PostgreSQL REAL (M3A). Cada archivo crea su
 * propia base descartable. Requiere TRUST_PG_ADMIN_URL (ver .env.example).
 * `pnpm verify` NO los corre: van en su propio paso del gate.
 */
export default defineConfig({
  test: {
    include: ['packages/platform-*/src/**/*.db.test.ts', 'apps/platform-api/src/**/*.db.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
