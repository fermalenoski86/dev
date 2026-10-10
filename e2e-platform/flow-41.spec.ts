import path from 'node:path';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { ORIGIN, SESSION_COOKIE } from './env';
import { captura, cerrar, contexto, cuenta, loginUI, logoutUI, meConCookie, pdf, registrar, stack } from './support';

/**
 * E3c · §41 en navegador, exactamente el flujo del master (M3A1_MASTER.md §41):
 *
 *   LOGIN operador → crear campaña → Builder guarda draft en backend → subir
 *   assets válidos → enviar → hash visible → logout
 *   LOGIN approver diferente → ver versión → adjuntar evidencia → aprobar
 *   LOGIN operador → APPROVED VERSION + hash exacto + working draft separado
 *   → editar → la versión aprobada NO cambia
 *
 * Los TRES logins son por el formulario, cada uno en un contexto nuevo y sin
 * storageState: un storageState posterior al logout tendría un token revocado.
 * §47: screenshots de cada paso + video de cada test (artifact de CI, BL-29).
 */
test.describe.configure({ mode: 'serial' });

const F: { campaignId?: string; versionPath?: string; versionHash?: string; cookieRevocada?: string; revisionEnviada?: number; nombre?: string; screenshots: string[] } = { screenshots: [] };

async function cookieDeSesion(ctx: BrowserContext): Promise<string> {
  const c = (await ctx.cookies(ORIGIN.api)).find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('sin cookie de sesión del host de la API');
  return c.value;
}

async function abrirBuilder(ctx: BrowserContext, campaignId: string): Promise<Page> {
  const b = await ctx.newPage();
  b.on('dialog', (d) => void d.accept());
  await b.goto(`${ORIGIN.control}/?campaign=${campaignId}`);
  await b.getByTestId('tab-builder').click();
  await expect(b.getByTestId('campaign-status')).toBeVisible();
  return b;
}

async function esperarGuardado(b: Page, campaignId: string, accion: () => Promise<void>): Promise<number> {
  const put = b.waitForResponse((r) => r.url() === `${ORIGIN.api}/api/v1/campaigns/${campaignId}/draft` && r.request().method() === 'PUT');
  await accion();
  const r = await put;
  expect(r.status()).toBe(200);
  await expect(b.getByTestId('campaign-sync')).toHaveAttribute('data-phase', 'saved');
  return ((await r.json()) as { revision: number }).revision;
}

test('1 · OPERATOR: login → crea la campaña → el Builder guarda el draft en el backend → sube assets → envía → hash visible → logout [E3-41] [E3-47]', async ({ browser }, info) => {
  const op = cuenta(info, 'op');
  const ctx = await contexto(browser, info);
  const web = await ctx.newPage();
  await loginUI(web, op);

  F.nombre = `§41 ${Date.now()}`;
  await web.getByLabel('Contrato').selectOption({ index: 1 });
  await web.getByLabel('Nombre').fill(F.nombre);
  await web.getByRole('button', { name: 'Crear campaña' }).click();
  await web.getByRole('link', { name: F.nombre }).click();
  await web.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  F.campaignId = web.url().split('/').pop();
  await expect(web.getByTestId('approved-version')).toHaveText('Sin versión aprobada');
  F.screenshots.push(await captura(web, info, '01-campania-creada'));

  // El Builder (apps/control) desde el enlace de la campaña guarda el draft en el backend (D3).
  const enlace = await web.getByRole('link', { name: 'Editar el draft en el Builder' }).getAttribute('href');
  expect(enlace).toBe(`${ORIGIN.control}/?campaign=${F.campaignId}`);
  const builder = await abrirBuilder(ctx, F.campaignId!);
  await expect(builder.getByTestId('working-draft')).toContainText('rev 1');
  const rev = await esperarGuardado(builder, F.campaignId!, () => builder.getByTestId('preset-select').selectOption('MCDONALDS_15S'));
  expect(rev).toBe(2);
  F.screenshots.push(await captura(builder, info, '02-builder-guardado'));
  await builder.close();

  // Assets reales: ffprobe los valida; se asignan a las ranuras del draft.
  await web.reload();
  await expect(web.getByTestId('working-draft')).toContainText('rev 2');
  const s = stack();
  for (const [superficie, archivo] of [['towers_ab', s.fixtures.master], ['horizontal', s.fixtures.horizontal]] as const) {
    await web.getByLabel('Superficie').selectOption(superficie);
    await web.getByLabel('Archivo MP4').setInputFiles(archivo);
    await web.getByRole('button', { name: 'Subir' }).click();
    await expect(web.getByTestId('upload-result')).toContainText(`«${path.basename(archivo)}» READY · SHA-256 `);
  }
  await web.getByRole('button', { name: 'Usar en Master A+B (torres)' }).first().click();
  await expect(web.getByRole('button', { name: 'Asignado a Master A+B (torres)' })).toBeVisible();
  await web.getByRole('button', { name: 'Usar en Horizontal' }).first().click();
  await expect(web.getByRole('button', { name: 'Asignado a Horizontal' })).toBeVisible();
  await expect(web.getByTestId('working-draft')).toContainText('rev 4');
  F.screenshots.push(await captura(web, info, '03-assets-asignados'));

  // Enviar → el servidor recompila y crea la versión; el hash queda visible.
  await web.getByRole('button', { name: 'Enviar rev 4 a aprobación' }).click();
  const enviada = web.getByTestId('submitted-version');
  await expect(enviada).toContainText('Versión v1 enviada (SUBMITTED)');
  F.versionHash = (await enviada.locator('code.hash').textContent()) ?? '';
  expect(F.versionHash).toMatch(/^[0-9a-f]{64}$/);
  F.versionPath = (await enviada.getByRole('link').getAttribute('href')) ?? '';
  F.revisionEnviada = 4;
  F.screenshots.push(await captura(web, info, '04-enviada-hash-visible'));

  // Logout: la cookie de esta sesión queda revocada en el servidor.
  F.cookieRevocada = await cookieDeSesion(ctx);
  await logoutUI(web);
  expect(await meConCookie(F.cookieRevocada)).toBe(401);
  await cerrar(ctx, info);
});

test('2 · INTERNAL_APPROVER (otro usuario): login → ve la versión → adjunta evidencia → aprueba el hash exacto [E3-41] [E3-47]', async ({ browser }, info) => {
  const ap = cuenta(info, 'ap');
  const ctx = await contexto(browser, info);
  const page = await ctx.newPage();
  await loginUI(page, ap);
  await page.goto(`${ORIGIN.web}${F.versionPath}`);
  await expect(page.getByTestId('version-hash')).toHaveText(F.versionHash!);
  await expect(page.getByTestId('version-status')).toContainText('SUBMITTED');

  await page.getByLabel('Archivo (PDF, email .eml o texto)').setInputFiles({ name: 'ok-cliente.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf()) });
  await page.getByRole('button', { name: 'Adjuntar' }).click();
  await expect(page.getByRole('link', { name: 'ok-cliente.pdf' })).toBeVisible();
  F.screenshots.push(await captura(page, info, '05-evidencia-adjunta'));

  await page.getByLabel('Evidencia de la aprobación').selectOption({ index: 1 });
  await page.getByLabel(/Apruebo exactamente la versión con hash/).check();
  await page.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.getByTestId('version-decision')).toContainText(`APPROVED el `);
  await expect(page.getByTestId('version-decision')).toContainText(F.versionHash!);
  await expect(page.getByTestId('version-status')).toContainText('APPROVED');
  F.screenshots.push(await captura(page, info, '06-aprobada'));
  await logoutUI(page);
  await cerrar(ctx, info);
});

test('3 · OPERATOR (login nuevo): APPROVED VERSION + hash exacto + working draft aparte → edita → la versión aprobada no cambia [E3-41] [E3-47]', async ({ browser }, info) => {
  const op = cuenta(info, 'op');
  const ctx = await contexto(browser, info);
  const web = await ctx.newPage();
  await loginUI(web, op);
  const nueva = await cookieDeSesion(ctx);
  expect(nueva).not.toBe(F.cookieRevocada); // sesión nueva, no la revocada

  await web.goto(`${ORIGIN.web}/campaigns/${F.campaignId}`);
  await expect(web.getByTestId('approved-version')).toHaveText(`APPROVED VERSION v1 · hash ${F.versionHash}`);
  await expect(web.getByTestId('working-draft')).toContainText(`rev ${F.revisionEnviada}`);
  F.screenshots.push(await captura(web, info, '07-aprobada-y-draft-separados'));

  // Editar en el Builder: cambia el working draft, no la versión aprobada.
  const builder = await abrirBuilder(ctx, F.campaignId!);
  await expect(builder.getByTestId('approved-version')).toContainText('APPROVED VERSION v1');
  const rev = await esperarGuardado(builder, F.campaignId!, async () => {
    await builder.locator('[data-testid="moment-block"]').nth(2).click();
    const d = builder.getByTestId('moment-duration-field');
    await d.fill('4000');
    await d.blur();
  });
  expect(rev).toBe(F.revisionEnviada! + 1);
  await builder.close();

  await web.reload();
  await expect(web.getByTestId('working-draft')).toContainText(`rev ${rev}`);
  await expect(web.getByTestId('approved-version')).toHaveText(`APPROVED VERSION v1 · hash ${F.versionHash}`);
  await web.goto(`${ORIGIN.web}${F.versionPath}`);
  await expect(web.getByTestId('version-hash')).toHaveText(F.versionHash!);
  await expect(web.getByTestId('version-status')).toContainText('APPROVED');
  await expect(web.getByText(`desde el draft rev ${F.revisionEnviada}.`)).toBeVisible();
  F.screenshots.push(await captura(web, info, '08-version-inmutable'));

  registrar(info, {
    browser: `${browser.browserType().name()} ${browser.version()}`,
    roles: { operator: op.email, approver: cuenta(info, 'ap').email },
    campaignId: F.campaignId, versionId: F.versionPath?.split('/').pop(), versionHash: F.versionHash,
    screenshots: F.screenshots.map((s) => path.basename(s)),
  });
  await logoutUI(web);
  await cerrar(ctx, info);
});
