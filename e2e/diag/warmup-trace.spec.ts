import { expect, test } from '@playwright/test';

/**
 * DIAGNÓSTICO — issue #26, experimento E3. NO es parte del gate.
 *
 * Reproduce `experience.spec.ts:17` (primera carga, Client Mode) registrando
 * cada 250 ms durante 20 s el estado de la precarga (`__TRUST_EXP__`) y, si
 * existe (nivel 2 de instrumentación), `__TRUST_VIDEOS__` con
 * readyState/networkState/buffered/error de cada <video> compartido.
 *
 * Objetivo: saber CUÁL de los motivos de `warmUpSource` ocurre cuando READY
 * no llega ('timeout de carga', 'el decoder no entregó frame', 'sin
 * dimensiones de video', 'error de media') y en qué segundo.
 */

const BASE = process.env.TRUST_CONTROL_URL ?? 'http://localhost:3001';

test('E3: traza de precarga en la primera carga', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const consola: string[] = [];
  page.on('console', (m) => consola.push(`${Date.now()} ${m.type()} ${m.text()}`));

  const t0 = Date.now();
  await page.goto(`${BASE}/experience`);

  const muestras: unknown[] = [];
  const listo = page.getByTestId('ready-state');
  for (let i = 0; i < 80; i++) {
    const estado = await page.evaluate(() => {
      const w = window as unknown as { __TRUST_EXP__?: unknown; __TRUST_VIDEOS__?: () => unknown };
      return { exp: w.__TRUST_EXP__ ?? null, videos: w.__TRUST_VIDEOS__?.() ?? 'sin __TRUST_VIDEOS__ (nivel 2 no aplicado)' };
    });
    // Una sola lectura por muestra: con dos lecturas, READY podía llegar entre
    // ambas y el resumen decía "LOADING" en una corrida que sí había llegado.
    const texto = await listo.textContent();
    muestras.push({ t: Date.now() - t0, texto, ...estado });
    if (texto === 'READY TO PRESENT') break;
    await page.waitForTimeout(250);
  }

  await testInfo.attach('e3-precarga.json', { body: JSON.stringify(muestras, null, 2), contentType: 'application/json' });
  await testInfo.attach('e3-consola.txt', { body: consola.join('\n'), contentType: 'text/plain' });
  const ultimo = muestras[muestras.length - 1] as { t: number; texto: string | null };
  console.log('[E3] READY en', ultimo.t, 'ms →', ultimo.texto);

  // Documenta, no juzga: el gate real es experience.spec.ts.
  expect(muestras.length).toBeGreaterThan(0);
});
