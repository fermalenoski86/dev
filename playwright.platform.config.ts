import { defineConfig, devices } from '@playwright/test';

/**
 * E3c · E2E de plataforma (§41, §47) — separado de los 14 de M2C congelados
 * (`playwright.config.ts` + `e2e/`). Igual que M2C, Playwright no está en las
 * dependencias del monorepo: CI lo instala aparte (ver gates.yml, job
 * `e2e-platform`).
 *
 * Topología (ADR-063): web/control/api.trust.test resuelven a 127.0.0.1 con
 * `--host-resolver-rules` y entran por el terminador TLS de test (:8443). Son
 * hosts distintos, no solo puertos, y la API corre en modo producción con la
 * cookie `__Host-trust_session`.
 *
 * BL-25: una cuenta por rol y por worker, más un contrato por worker.
 */
const workers = Number(process.env.E2E_WORKERS ?? '2');
const executablePath = process.env.TRUST_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e-platform',
  testMatch: '*.spec.ts',
  workers,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e-platform/global-setup.ts',
  outputDir: 'test-results/e2e-platform',
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-platform-results.json' }]],
  use: {
    ignoreHTTPSErrors: true, // certificado autofirmado del terminador de test
    trace: 'retain-on-failure',
    video: 'on', // §47: video de cada test; el manifest los indexa con su SHA-256
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        launchOptions: {
          executablePath,
          args: [
            '--host-resolver-rules=MAP *.trust.test 127.0.0.1',
            // sin proxies del entorno: los hosts de test resuelven a 127.0.0.1
            '--no-proxy-server',
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
          ],
        },
      },
    },
  ],
});
