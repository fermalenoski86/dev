import { expect, test } from '@playwright/test';

/**
 * DIAGNÓSTICO — issue #26, experimento E1. NO es parte del gate.
 *
 * Reproduce la secuencia de `experience.spec.ts:267` (PLAY → 7 s → ESC →
 * SIGNATURE) y, con UN solo `page.evaluate`, muestrea cada 20 ms durante 3 s
 * lo que `__TRUST_SURFACES__` dice de screen_a contra lo que dice el DOM.
 * El muestreo corre dentro de la página: sin round-trips por CDP, así no
 * altera el timing que queremos observar.
 *
 * Hipótesis H1 (auditoría externa): `diagnostics` conserva entradas de
 * pintores ya desregistrados; en el remount de SIGNATURE el test lee
 * `framesDrawn ≈ 217` de una entrada muerta y después compara contra el
 * contador nuevo, que arrancó en 0.
 *
 * Qué se espera ver si H1 es cierta: una ventana donde el DOM ya dice
 * `data-output="hold"` y `stage-moment` dice Signature, pero el diagnóstico
 * todavía dice `output: 'live'` con framesDrawn alto; después framesDrawn cae
 * a 0 y vuelve a subir. La duración de esa ventana es el dato.
 */

const BASE = process.env.TRUST_CONTROL_URL ?? 'http://localhost:3001';

interface Muestra {
  t: number;
  domOutput: string | null;
  domMoment: string | null;
  diag: { output: string; framesDrawn: number; readyState: number; paused: boolean; currentTime: number } | null;
}

test('E1: ventana stale de __TRUST_SURFACES__ al elegir SIGNATURE', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.goto(`${BASE}/experience?operator=1`);
  await page.getByTestId('ready-state').getByText('READY TO PRESENT').waitFor({ timeout: 40_000 });
  await page.getByTestId('play-the-moment').click();

  const hora = () => page.getByTestId('stage-time').textContent().then(Number);
  while ((await hora()) < 7000) await page.waitForTimeout(80);
  await page.keyboard.press('Escape');

  // Armar el muestreador ANTES del click, sin esperar su resultado.
  await page.evaluate(() => {
    const w = window as unknown as {
      __TRUST_SURFACES__?: () => Array<Record<string, unknown>>;
      __E1__?: { muestras: Muestra[]; fin: Promise<Muestra[]> };
    };
    const muestras: Muestra[] = [];
    const t0 = performance.now();
    const fin = new Promise<Muestra[]>((resolve) => {
      const id = setInterval(() => {
        const t = performance.now() - t0;
        const el = document.querySelector('[data-testid="surface-screen_a"]');
        const d = (w.__TRUST_SURFACES__?.() ?? []).find((x) => x.id === 'screen_a' && x.segment === 0);
        muestras.push({
          t: Math.round(t),
          domOutput: el?.getAttribute('data-output') ?? null,
          domMoment: document.querySelector('[data-testid="stage-moment"]')?.textContent ?? null,
          diag: d
            ? {
                output: String(d.output),
                framesDrawn: Number(d.framesDrawn),
                readyState: Number(d.readyState),
                paused: Boolean(d.paused),
                currentTime: Number(d.currentTime),
              }
            : null,
        });
        if (t > 3000) {
          clearInterval(id);
          resolve(muestras);
        }
      }, 20);
    });
    w.__E1__ = { muestras, fin };
  });

  await page.getByTestId('brand-signature').click();
  // Mismo flujo que el test congelado, para que la carrera sea la misma.
  await expect(page.getByTestId('stage-moment')).toHaveText(/signature/i);

  const muestras = await page.evaluate(
    () => (window as unknown as { __E1__: { fin: Promise<Muestra[]> } }).__E1__.fin,
  );

  // Análisis: ¿hubo muestras donde el DOM ya estaba en hold/Signature y el
  // diagnóstico seguía en live? ¿Cuánto duró? ¿framesDrawn bajó?
  const stale = muestras.filter(
    (m) => m.domOutput === 'hold' && m.diag?.output === 'live',
  );
  let maxFrames = -1;
  let primeraCaida: Muestra | null = null;
  for (const m of muestras) {
    const f = m.diag?.framesDrawn ?? -1;
    if (f < maxFrames && !primeraCaida) primeraCaida = m;
    maxFrames = Math.max(maxFrames, f);
  }
  const resumen = {
    totalMuestras: muestras.length,
    ventanaStaleMs: stale.length ? stale[stale.length - 1]!.t - stale[0]!.t + 20 : 0,
    primeraMuestraStale: stale[0] ?? null,
    ultimaMuestraStale: stale[stale.length - 1] ?? null,
    primeraCaidaDeFrames: primeraCaida,
    chrome: await page.evaluate(() => navigator.userAgent),
  };
  await testInfo.attach('e1-resumen.json', { body: JSON.stringify(resumen, null, 2), contentType: 'application/json' });
  await testInfo.attach('e1-muestras.json', { body: JSON.stringify(muestras), contentType: 'application/json' });
  console.log('[E1]', JSON.stringify(resumen));

  // Este test no falla por la hipótesis: documenta. Solo falla si no midió nada.
  expect(muestras.length).toBeGreaterThan(50);
});

