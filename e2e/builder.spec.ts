import { expect, test } from '@playwright/test';

/**
 * SMOKE E2E DEL BUILDER — M2C.1.1 / punto 4.
 *
 * ⚠️ ESTE SCRIPT NUNCA SE EJECUTÓ.
 *
 * El entorno donde se escribió no tiene Chromium ni Playwright, y los binarios
 * de navegador no se descargan desde los registros npm disponibles. Está
 * escrito para correr, no verificado corriendo. Tratarlo como un borrador
 * hasta la primera ejecución real: es muy probable que algún selector haya que
 * ajustarlo.
 *
 * Para ejecutarlo:
 *
 *   pnpm add -D -w @playwright/test
 *   npx playwright install chromium
 *   pnpm --filter @trust/control build && pnpm --filter @trust/control start &
 *   npx playwright test e2e/builder.spec.ts
 *
 * Los `data-testid` que usa ya existen todos en la UI: se agregaron para este
 * suite (ver `e2e/README.md`). Las superficies del preview exponen ademas
 * `data-output` con live/hold/black, asi que el test afirma sobre el estado
 * sin leer pixeles. Lo que puede fallar en la primera corrida son las esperas
 * (el preview arranca con un requestAnimationFrame) y alguna asercion de texto
 * exacta.
 */

const BASE = process.env.TRUST_CONTROL_URL ?? 'http://localhost:3001';

test.describe('TRUST CONTROL — Takeover Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    // El draft guardado de una corrida anterior contaminaría el test.
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.getByTestId('tab-builder').click();
    await expect(page.getByTestId('preset-select')).toBeVisible();
  });

  test('preset, edición, preview, persistencia y export', async ({ page }) => {
    /* ── 1. Preset McDonald's con sus cinco moments ───────────── */
    await page.getByTestId('preset-select').selectOption('MCDONALDS_15S');

    const bloques = page.locator('[data-testid="moment-block"]');
    await expect(bloques).toHaveCount(5);
    await expect(page.getByText('15.0 s')).toBeVisible();

    /* ── 2. PLAY usa el ShowEngine ───────────────────────────── */
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.getByTestId('transport-status')).toHaveText('playing');

    /* ── 3. Editar duración y RESTART usa la NUEVA ───────────── */
    // M2C.1.2 / punto 3: `moment-duration` existe una vez POR MOMENT. Sin
    // scope, el locator resuelve a 5 elementos y Playwright falla por
    // ambigüedad. Se usa el campo único de PROPERTIES, que refiere al moment
    // seleccionado.
    await bloques.nth(2).click();
    const duracion = page.getByTestId('moment-duration-field');
    await expect(duracion).toHaveCount(1);
    await duracion.fill('12000');
    await duracion.blur();
    await expect(page.getByText('21.0 s')).toBeVisible();

    await page.getByRole('button', { name: 'RESTART' }).click();
    // El total del preview tiene que ser el del draft editado, no 15 s.
    await expect(page.getByTestId('preview-duration')).toHaveText('21.0 s');

    /* ── 4. Reordenar por drag & drop ────────────────────────── */
    const primero = await bloques.nth(0).innerText();
    await bloques.nth(0).dragTo(bloques.nth(1));
    await expect(bloques.nth(1)).toContainText(primero.split('\n')[0]!);

    /* ── 5. Un bloqueo deshabilita preview, present y export ── */
    // Asignar a la horizontal el master de torres (2592×576, aspecto 4.5)
    // contra una superficie de 1920×412 (4.66): incompatible.
    // El asset se elige en su <select>, NO en el <g> del preview.
    await page.getByTestId('asset-horizontal-select').selectOption('test_towers_master');
    await expect(page.getByTestId('preflight-status')).toHaveText('BLOCKED');

    for (const boton of ['PLAY', 'RESTART', 'Presentar', 'Exportar show']) {
      await expect(page.getByRole('button', { name: boton })).toBeDisabled();
    }
    // STOP es la operación de seguridad: jamás se deshabilita (M2C.1.2 / 5).
    await expect(page.getByTestId('stop-button')).toBeEnabled();
    await page.getByTestId('stop-button').click();
    await expect(page.getByTestId('transport-status')).toHaveText('stopped');

    // Y el bloqueo no se saltea por el scrubber: el transporte no arranca.
    await page.getByTestId('timeline-scrubber').click({ position: { x: 100, y: 5 } });
    await expect(page.getByTestId('transport-status')).not.toHaveText('playing');

    // Se deshace el bloqueo.
    await page.getByTestId('asset-horizontal-select').selectOption('test_horizontal');
    await expect(page.getByTestId('preflight-status')).not.toHaveText('BLOCKED');

    /* ── 6. SAVE + reload devuelve el draft ──────────────────── */
    await expect(page.getByTestId('save-state')).toHaveText('UNSAVED');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByTestId('save-state')).toHaveText('SAVED');

    await page.reload();
    await page.getByTestId('tab-builder').click();
    await expect(page.getByTestId('preset-select')).toBeVisible();
    await expect(page.locator('[data-testid="moment-block"]')).toHaveCount(5);
    await expect(page.getByText('21.0 s')).toBeVisible();

    /* ── 7. Export del ShowPackage ───────────────────────────── */
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar show' }).click();
    const archivo = await descarga;
    expect(archivo.suggestedFilename()).toMatch(/\.json$/);
  });

  test('cargar otro preset con cambios sin guardar pide confirmación', async ({ page }) => {
    await page.getByTestId('preset-select').selectOption('MCDONALDS_15S');
    await page.getByTestId('moment-block').first().click();
    // Campo único de PROPERTIES: `moment-duration` hay uno por moment.
    await page.getByTestId('moment-duration-field').fill('4000');
    await page.getByTestId('moment-duration-field').blur();

    let preguntó = false;
    page.on('dialog', async (d) => {
      preguntó = true;
      await d.dismiss();
    });
    await page.getByTestId('preset-select').selectOption('ICONIC_15S');
    expect(preguntó).toBe(true);
  });
});
