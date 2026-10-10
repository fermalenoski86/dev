import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ORIGIN } from './env';
import { apiSesion, cerrar, contexto, contrato, cuenta, loginUI } from './support';

/**
 * BL-31 · historial de versiones por campaña en el navegador real (hosts
 * HTTPS distintos, cookie `__Host-`). El aprobador llega a una versión por el
 * enlace del operador y desde ahí recorre el historial de ESA campaña, sin
 * copiar enlaces fuera de TRUST. Datos por la API con las cuentas del worker.
 */
test('historial: el aprobador va de la versión al historial de su campaña (más nueva primero), abre otra versión y axe sin violaciones [BL-31]', async ({ browser }, info) => {
  const op = cuenta(info, 'op');
  const ap = cuenta(info, 'ap');
  const s = await apiSesion(op);
  const campaignId = await s.campañaLista(contrato(info), `historial ${Date.now()}`);
  const v1 = await s.enviar(campaignId);
  // nueva revisión del draft (mismo contenido) → segunda versión
  const d = await s.llamar('GET', `/api/v1/campaigns/${campaignId}/draft`);
  await s.llamar('PUT', `/api/v1/campaigns/${campaignId}/draft`, { takeoverDraft: d.takeoverDraft, expectedRevision: d.revision });
  const v2 = await s.enviar(campaignId);
  await s.logout();
  expect([v1.versionNumber, v2.versionNumber]).toEqual([1, 2]);

  const ctx = await contexto(browser, info);
  const page = await ctx.newPage();
  await loginUI(page, ap);
  await page.goto(`${ORIGIN.web}/versions/${v2.id as string}`);
  await expect(page.getByTestId('version-hash')).toHaveText(v2.versionHash as string);
  await page.getByRole('link', { name: 'Historial de versiones de la campaña' }).click();
  await expect(page).toHaveURL(`${ORIGIN.web}/campaigns/${campaignId}/versions`);

  const tabla = page.getByTestId('versions-table');
  await expect(tabla).toBeVisible();
  const filas = tabla.locator('tbody tr');
  await expect(filas).toHaveCount(2);
  await expect(filas.nth(0).getByRole('link')).toHaveText('v2');
  await expect(filas.nth(1).getByRole('link')).toHaveText('v1');
  await expect(filas.nth(1)).toContainText(v1.versionHash as string);
  await expect(filas.nth(1)).toContainText('SUBMITTED');
  await expect(page.getByRole('button', { name: 'Ver versiones anteriores' })).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), 'axe en /campaigns/[id]/versions').toEqual([]);

  await filas.nth(1).getByRole('link', { name: 'v1' }).click();
  await expect(page).toHaveURL(`${ORIGIN.web}/versions/${v1.id as string}`);
  await expect(page.getByTestId('version-hash')).toHaveText(v1.versionHash as string);
  await cerrar(ctx, info);
});
