import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { ORIGIN } from './env';
import { apiSesion, captura, cerrar, contexto, contrato, cuenta, loginUI } from './support';

/**
 * F3(a) UI · versión vigente administrativa en el navegador real (brief
 * `docs/briefs/F3A_UI.md` §6.4): dos sesiones reales, hosts HTTPS distintos y
 * cookie `__Host-`. El aprobador interno entra por `/campaigns` (no por el
 * detalle de campaña: #43 sigue abierto). Las versiones aprobadas se preparan
 * por la API con las cuentas del worker (no son parte de este recorrido).
 */
async function sinViolaciones(page: Page, vista: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `axe en ${vista}`).toEqual([]);
}

/** Campaña con dos versiones APPROVED (v1, v2) por la API: op envía, ap aprueba con evidencia. */
async function dosAprobadas(info: Parameters<typeof cuenta>[0], nombre: string) {
  const op = await apiSesion(cuenta(info, 'op'));
  const campaignId = await op.campañaLista(contrato(info), nombre);
  const v1 = await op.enviar(campaignId);
  const d = await op.llamar('GET', `/api/v1/campaigns/${campaignId}/draft`);
  await op.llamar('PUT', `/api/v1/campaigns/${campaignId}/draft`, { takeoverDraft: d.takeoverDraft, expectedRevision: d.revision });
  const v2 = await op.enviar(campaignId);
  await op.logout();
  const ap = await apiSesion(cuenta(info, 'ap'));
  for (const v of [v1, v2]) {
    const ev = await ap.evidencia(v.id as string);
    await ap.llamar('POST', `/api/v1/show-versions/${v.id as string}/approve`, { evidenceId: ev.id, versionHash: v.versionHash }, { 'idempotency-key': `e2e-f3a-${Date.now()}-${Math.random()}` });
  }
  await ap.logout();
  return { campaignId, v1, v2 };
}

/**
 * Deja `version` como VIGENTE por el flujo autorizado de la API, con cuatro
 * ojos reales: op pide (primera selección) y ap confirma. No es parte del
 * recorrido en el navegador; solo prepara el punto de partida.
 */
async function fijarVigente(info: Parameters<typeof cuenta>[0], campaignId: string, version: { id?: unknown; versionHash?: unknown }) {
  const k = () => `e2e-f3a-${Date.now()}-${Math.random()}`;
  const op = await apiSesion(cuenta(info, 'op'));
  const ch = await op.llamar('POST', `/api/v1/campaigns/${campaignId}/active-version-changes`, { versionId: version.id, versionHash: version.versionHash, reason: 'preparación: primera selección', expectedActiveVersionId: null }, { 'idempotency-key': k() });
  await op.logout();
  const ap = await apiSesion(cuenta(info, 'ap'));
  const r = await ap.llamar('POST', `/api/v1/active-version-changes/${ch.id as string}/confirm`, { versionHash: version.versionHash }, { 'idempotency-key': k() });
  expect(r.status).toBe('CONFIRMED');
  await ap.logout();
}

async function abrirVigente(page: Page, nombre: string, campaignId: string) {
  await page.goto(`${ORIGIN.web}/campaigns`);
  await page.getByRole('row', { name: new RegExp(nombre) }).getByRole('link', { name: 'Versión vigente' }).click();
  await expect(page).toHaveURL(`${ORIGIN.web}/campaigns/${campaignId}/active-version`);
  await expect(page.getByTestId('admin-notice')).toHaveText('Versión vigente administrativa: no despliega contenido al edificio.');
}

test('versión vigente: con v2 vigente, OPERATOR pide volver a v1, INTERNAL_APPROVER (otra sesión) entra por /campaigns y confirma viendo los dos hashes; las dos sesiones ven v1; axe sin violaciones [F3A-UI-1]', async ({ browser }, info) => {
  const nombre = `vigente ${Date.now()}`;
  const { campaignId, v1, v2 } = await dosAprobadas(info, nombre);
  await fijarVigente(info, campaignId, v2);

  const ctxOp = await contexto(browser, info);
  const pOp = await ctxOp.newPage();
  await loginUI(pOp, cuenta(info, 'op'));
  await abrirVigente(pOp, nombre, campaignId);
  await expect(pOp.getByTestId('active-version')).toContainText(v2.versionHash as string);
  await expect(pOp.getByTestId('latest-approved')).toContainText('v2');
  await sinViolaciones(pOp, '/campaigns/[id]/active-version (operador)');
  // la vigente (v2) no se ofrece como destino
  await expect(pOp.getByLabel('Versión aprobada').locator(`option[value="${v2.id as string}"]`)).toHaveCount(0);
  await pOp.getByLabel('Versión aprobada').selectOption(v1.id as string);
  await pOp.getByLabel('Motivo').fill('Volver a la primera versión aprobada');
  await pOp.getByRole('button', { name: 'Pedir cambio' }).click();
  await expect(pOp.getByTestId('active-version-notice')).toHaveText('Pedido creado: lo tiene que confirmar otra persona.');
  await expect(pOp.getByTestId('pending')).toContainText(v1.versionHash as string);
  await expect(pOp.getByTestId('pending')).toContainText(v2.versionHash as string);
  await expect(pOp.getByRole('button', { name: 'Revisar y confirmar' })).toHaveCount(0);
  await captura(pOp, info, 'f3a-1-pedido');

  const ctxAp = await contexto(browser, info);
  const pAp = await ctxAp.newPage();
  await loginUI(pAp, cuenta(info, 'ap'));
  await abrirVigente(pAp, nombre, campaignId);
  await expect(pAp.getByTestId('pending')).toContainText('Volver a la primera versión aprobada');
  await pAp.getByRole('button', { name: 'Revisar y confirmar' }).click();
  // paso explícito: origen v2 y destino v1, cada uno con su hash
  await expect(pAp.getByTestId('confirm-step')).toContainText(`Vas a cambiar la vigente de v2 (${v2.versionHash as string}) a v1 (${v1.versionHash as string})`);
  await sinViolaciones(pAp, '/campaigns/[id]/active-version (paso de confirmación)');
  await captura(pAp, info, 'f3a-2-confirmar');
  await pAp.getByRole('button', { name: 'Confirmar cambio' }).click();
  await expect(pAp.getByTestId('active-version-notice')).toHaveText('Cambio confirmado: la versión vigente cambió.');
  await expect(pAp.getByTestId('active-version')).toContainText(v1.versionHash as string);
  await expect(pAp.getByTestId('no-pending')).toBeVisible();
  await expect(pAp.getByTestId('active-history').locator('tbody tr').first()).toContainText('CONFIRMED');
  await expect(pAp.getByTestId('active-history').locator('tbody tr').first()).toContainText('v2 → v1');

  await pOp.reload();
  await expect(pOp.getByTestId('active-version')).toContainText(v1.versionHash as string);
  await captura(pOp, info, 'f3a-3-vigente');
  await cerrar(ctxAp, info);
  await cerrar(ctxOp, info);
});

test('cuatro ojos en el navegador: ADMIN pide y no ve "Confirmar" (lo tiene que confirmar otra persona); cancela su pedido [F3A-UI-2]', async ({ browser }, info) => {
  const nombre = `vigente-4ojos ${Date.now()}`;
  const { campaignId, v2 } = await dosAprobadas(info, nombre);
  const ctx = await contexto(browser, info);
  const page = await ctx.newPage();
  await loginUI(page, cuenta(info, 'admin'));
  await abrirVigente(page, nombre, campaignId);
  await page.getByLabel('Versión aprobada').selectOption(v2.id as string);
  await page.getByLabel('Motivo').fill('Primera selección');
  await page.getByRole('button', { name: 'Pedir cambio' }).click();
  await expect(page.getByTestId('four-eyes-note')).toHaveText('Lo tiene que confirmar otra persona.');
  await expect(page.getByRole('button', { name: 'Revisar y confirmar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByTestId('active-version-notice')).toHaveText('Pedido cancelado.');
  await expect(page.getByTestId('active-version')).toHaveText('Sin versión vigente');
  await expect(page.getByTestId('active-history').locator('tbody tr').first()).toContainText('CANCELLED');
  await cerrar(ctx, info);
});

test('decisión opuesta bloqueada: ADMIN (no pidió) abre la confirmación, la cancelación queda INCIERTA (red cortada) y "Confirmar cambio" no se puede usar hasta resolverla; Reintentar cancela con la misma intención [F3A-UI-3]', async ({ browser }, info) => {
  const nombre = `vigente-opuesta ${Date.now()}`;
  const { campaignId, v1 } = await dosAprobadas(info, nombre);
  const op = await apiSesion(cuenta(info, 'op'));
  await op.llamar('POST', `/api/v1/campaigns/${campaignId}/active-version-changes`, { versionId: v1.id, versionHash: v1.versionHash, reason: 'pedido de otro', expectedActiveVersionId: null }, { 'idempotency-key': `e2e-f3a-${Date.now()}-${Math.random()}` });
  await op.logout();

  const ctx = await contexto(browser, info);
  const page = await ctx.newPage();
  await loginUI(page, cuenta(info, 'admin'));
  await abrirVigente(page, nombre, campaignId);
  await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
  await expect(page.getByTestId('confirm-step')).toBeVisible();
  const keys: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/cancel')) keys.push(r.headers()['idempotency-key'] ?? '');
  });
  await page.route('**/api/v1/active-version-changes/*/cancel', (r) => r.abort('connectionreset'));
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByTestId('uncertain-cancel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar cambio' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancelar pedido' })).toBeDisabled();
  await captura(page, info, 'f3a-4-opuesta-bloqueada');
  await page.unroute('**/api/v1/active-version-changes/*/cancel');
  await page.getByTestId('uncertain-cancel').getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByTestId('active-version-notice')).toHaveText('Pedido cancelado.');
  await expect(page.getByTestId('active-history').locator('tbody tr').first()).toContainText('CANCELLED');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]); // misma intención, misma key
  await cerrar(ctx, info);
});
