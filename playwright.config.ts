import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright NO está en las dependencias del monorepo a propósito: agregarlo
 * obligaría a todos a bajarlo para un suite que no corre en el `verify` de
 * todos los días. Se instala a demanda con `pnpm dlx`, que no toca el lockfile.
 *
 * `TRUST_CHROMIUM_PATH` permite usar un Chromium ya presente en la máquina.
 * Sin esa variable, Playwright usa el que instala `playwright install
 * chromium`. Ver `e2e/README.md`.
 */
const executablePath = process.env.TRUST_CHROMIUM_PATH || undefined;
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Sin reintentos: un smoke test que pasa una de cada tres veces no informa.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath,
          // Sin sandbox porque el contenedor corre como root; sin GPU porque
          // no hay una. El Builder es SVG y DOM: no necesita aceleración.
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @trust/control start',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
