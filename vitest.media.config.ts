import { defineConfig } from 'vitest/config';

/**
 * Tests de MEDIA contra ffprobe/ffmpeg REALES (M3A.1 B2). Los fixtures se
 * generan con packages/platform-media/scripts/make-fixtures.sh.
 * `pnpm verify` no los corre: van en su propio paso del gate.
 */
export default defineConfig({
  test: {
    include: ['packages/platform-media/src/**/*.real.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
