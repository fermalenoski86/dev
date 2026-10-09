import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Los alias apuntan a las fuentes: los packages del monorepo se publican como
 * TypeScript, no compilados.
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
  // JSX de React 17+ (runtime automático), igual que Next en apps/control.
  esbuild: { jsx: 'automatic' },
  test: { include: ['packages/**/*.test.ts', 'apps/control/src/**/*.test.ts', 'scripts/**/*.test.ts'], exclude: ['**/node_modules/**', '**/*.db.test.ts', '**/*.real.test.ts'], environment: 'node' },
});
