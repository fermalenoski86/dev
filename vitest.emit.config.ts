import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Config APARTE para `pnpm emit:examples`.
 *
 * Los archivos `*.emit.ts` no los incluye `vitest.config.ts`, asi que
 * `pnpm test` (y por lo tanto cada mutante del mutation check) nunca los
 * ejecuta ni escribe artefactos. M2C.1.2 / punto 1.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@trust/shared-types': resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@trust/timeline': resolve(__dirname, 'packages/timeline/src/index.ts'),
      '@trust/show-engine': resolve(__dirname, 'packages/show-engine/src/index.ts'),
      '@trust/telemetry': resolve(__dirname, 'packages/telemetry/src/index.ts'),
      '@trust/control-core': resolve(__dirname, 'packages/control-core/src/index.ts'),
      '@trust/show-authoring': resolve(__dirname, 'packages/show-authoring/src/index.ts'),
      '@trust/experience-core': resolve(__dirname, 'packages/experience-core/src/index.ts'),
    },
  },
  test: { include: ['scripts/**/*.emit.ts'], environment: 'node' },
});
