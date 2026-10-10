import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from '@playwright/test';
import { ORIGIN } from './env';
import { apiSesion, cerrar, contexto, contrato, cuenta, loginUI } from './support';

/**
 * E3c · BL-28: accesibilidad operativa de platform-web.
 *  - axe (reglas WCAG 2.x A/AA + best practices) en login, campañas, detalle y
 *    revisión: CERO violaciones;
 *  - el recorrido principal SOLO con teclado, con foco visible en cada paso y
 *    errores anunciados (role="alert").
 * No se afirma conformidad WCAG completa: es un escaneo automático más
 * recorridos; la evaluación manual queda fuera.
 * Los datos que no son parte del recorrido (assets, evidencia) se preparan por
 * la API con las cuentas del worker (BL-25).
 */
async function sinViolaciones(page: Page, vista: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const resumen = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(resumen, `axe en ${vista}`).toEqual([]);
}

/** Tab hasta que `destino` tenga el foco (máx. 40), exigiendo foco visible en cada paso. */
async function tabHasta(page: Page, destino: Locator) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const visible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return true;
      const s = getComputedStyle(el);
      return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
    });
    expect(visible, 'foco visible').toBe(true);
    if (await destino.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('no se llegó al destino con Tab');
}

async function loginTeclado(page: Page, email: string, password: string) {
  await page.goto(`${ORIGIN.web}/login`);
  await tabHasta(page, page.getByLabel('Email'));
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
}

test('axe: login, campañas, detalle de campaña y revisión sin violaciones [BL-28]', async ({ browser }, info) => {
  const op = cuenta(info, 'op');
  const ap = cuenta(info, 'ap');
  const s = await apiSesion(op);
  const campaignId = await s.campañaLista(contrato(info), `a11y axe ${Date.now()}`);
  const v = await s.enviar(campaignId);
  await s.logout();

  const ctx = await contexto(browser, info);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN.web}/login`);
  await expect(page.getByLabel('Email')).toBeVisible();
  await sinViolaciones(page, '/login');
  await loginUI(page, op);
  await expect(page.getByRole('table')).toBeVisible();
  await sinViolaciones(page, '/campaigns');
  await page.goto(`${ORIGIN.web}/campaigns/${campaignId}`);
  await expect(page.getByTestId('working-draft')).toBeVisible();
  await sinViolaciones(page, '/campaigns/[id]');
  await cerrar(ctx, info);

  const ctx2 = await contexto(browser, info);
  const rev = await ctx2.newPage();
  await loginUI(rev, ap);
  await rev.goto(`${ORIGIN.web}/versions/${v.id as string}`);
  await expect(rev.getByTestId('version-hash')).toBeVisible();
  await sinViolaciones(rev, '/versions/[id]');
  await cerrar(ctx2, info);
});

test('teclado: login (error anunciado) → campaña → enviar; login → revisión → aprobar, con foco visible [BL-28]', async ({ browser }, info) => {
  const op = cuenta(info, 'op');
  const ap = cuenta(info, 'ap');
  const s = await apiSesion(op);
  const nombre = `a11y teclado ${Date.now()}`;
  const campaignId = await s.campañaLista(contrato(info), nombre);
  await s.logout();

  // OPERATOR, solo teclado
  const ctx = await contexto(browser, info);
  const page = await ctx.newPage();
  await loginTeclado(page, op.email, 'contraseña equivocada');
  await expect(page.locator('p.error[role="alert"]')).toContainText('INVALID_CREDENTIALS');
  await tabHasta(page, page.getByLabel('Contraseña'));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(op.password);
  await page.keyboard.press('Enter');
  await page.waitForURL(`${ORIGIN.web}/campaigns`);
  await tabHasta(page, page.getByRole('link', { name: nombre }));
  await page.keyboard.press('Enter');
  await page.waitForURL(`${ORIGIN.web}/campaigns/${campaignId}`);
  const enviar = page.getByRole('button', { name: /^Enviar rev \d+ a aprobación$/ });
  await tabHasta(page, enviar);
  await page.keyboard.press('Enter');
  const enviada = page.getByTestId('submitted-version');
  await expect(enviada).toContainText('enviada (SUBMITTED)');
  const hash = (await enviada.locator('code.hash').textContent()) ?? '';
  const versionPath = (await enviada.getByRole('link').getAttribute('href')) ?? '';
  await tabHasta(page, page.getByRole('button', { name: 'Salir' }));
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/login/);
  await cerrar(ctx, info);

  // La evidencia (archivo) se adjunta por la API: el selector de archivos del sistema no es parte del recorrido de teclado.
  const sa = await apiSesion(ap);
  await sa.evidencia(versionPath.split('/').pop() ?? '');
  await sa.logout();

  // INTERNAL_APPROVER, solo teclado
  const ctx2 = await contexto(browser, info);
  const rev = await ctx2.newPage();
  await loginTeclado(rev, ap.email, ap.password);
  await rev.waitForURL(`${ORIGIN.web}/campaigns`);
  await rev.goto(`${ORIGIN.web}${versionPath}`);
  await expect(rev.getByTestId('version-hash')).toHaveText(hash);
  await tabHasta(rev, rev.getByLabel('Evidencia de la aprobación'));
  await rev.keyboard.press('ArrowDown');
  await expect(rev.getByLabel('Evidencia de la aprobación')).not.toHaveValue('');
  await tabHasta(rev, rev.getByLabel(/Apruebo exactamente la versión con hash/));
  await rev.keyboard.press('Space');
  await expect(rev.getByLabel(/Apruebo exactamente la versión con hash/)).toBeChecked();
  await tabHasta(rev, rev.getByRole('button', { name: 'Aprobar' }));
  await rev.keyboard.press('Enter');
  await expect(rev.getByTestId('version-decision')).toContainText(hash);
  await expect(rev.getByTestId('version-status')).toContainText('APPROVED');
  await cerrar(ctx2, info);
});
