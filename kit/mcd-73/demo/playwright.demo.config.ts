/**
 * Kit #73 (e): misma corrida real de flow-41 (stack local: PostgreSQL + API +
 * platform-web + Builder detrás del TLS de test), con slowMo para que la
 * grabación se pueda seguir en una reunión. No cambia nada del producto ni
 * de los gates: importa la config de plataforma y solo pisa slowMo y salidas.
 */
import base from '../../../playwright.platform.config';

const p = base.projects![0];
export default {
  ...base,
  testDir: '../../../e2e-platform',
  testMatch: 'flow-41.spec.ts',
  globalSetup: '../../../e2e-platform/global-setup.ts',
  workers: 1,
  outputDir: '../../../test-results/kit73-demo',
  reporter: [['list']],
  projects: [{ ...p, use: { ...p.use, launchOptions: { ...p.use!.launchOptions, slowMo: Number(process.env.KIT_SLOWMO ?? '700') } } }],
};
