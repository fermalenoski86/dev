import { expect, test } from '@playwright/test';
import { API_PORT, HOSTS, ORIGIN, SESSION_COOKIE } from './env';
import { cerrar, contexto, cuenta, loginUI, logoutUI } from './support';

/**
 * E3c · gate multihost (ADR-063; reproducción del [P1] de la auditoría del
 * brief, ahora como test). Hosts distintos con TLS real y la cookie de
 * producción `__Host-trust_session`:
 *   login en web → la cookie existe SOLO para el host de la API → el Builder
 *   (control) hace /auth/me → 200 → guarda con PUT + CSRF → un origen no
 *   listado queda bloqueado y no escribe → logout → el Builder recibe 401.
 */
test('sesión multihost: login en web, el Builder en control usa la cookie del host de la API, CSRF, origen bloqueado y logout [E3-41]', async ({ browser }, info) => {
  const op = cuenta(info, 'op');
  const ctx = await contexto(browser, info);
  const web = await ctx.newPage();
  await loginUI(web, op);

  // 1. La cookie es host-only del host de la API, Secure, HttpOnly, SameSite=Lax.
  const cookies = await ctx.cookies();
  expect(cookies.map((c) => `${c.name}@${c.domain}`)).toEqual([`${SESSION_COOKIE}@${HOSTS.api}`]);
  expect(cookies[0]).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(await ctx.cookies(ORIGIN.web)).toHaveLength(0);
  expect(await ctx.cookies(ORIGIN.control)).toHaveLength(0);

  // Una campaña de este worker, creada por la UI.
  const nombre = `Multihost ${Date.now()}`;
  await web.getByLabel('Contrato').selectOption({ index: 1 });
  await web.getByLabel('Nombre').fill(nombre);
  await web.getByRole('button', { name: 'Crear campaña' }).click();
  const href = await web.getByRole('link', { name: nombre }).getAttribute('href');
  const campaignId = href?.split('/').pop() ?? '';
  expect(campaignId).toMatch(/^[0-9a-f-]{36}$/);

  // 2. El Builder (apps/control, sin cambios de código) en otro host: /auth/me → 200 con la misma cookie.
  const control = await ctx.newPage();
  control.on('dialog', (d) => void d.accept());
  await control.goto(`${ORIGIN.control}/?campaign=${campaignId}`);
  const me = control.waitForResponse((r) => r.url() === `${ORIGIN.api}/api/v1/auth/me`);
  await control.getByTestId('tab-builder').click();
  expect((await me).status()).toBe(200);
  await expect(control.getByTestId('working-draft')).toContainText('rev 1');

  // 3. Guardar desde el Builder: PUT con X-CSRF-Token → 200, revisión nueva.
  const put = control.waitForResponse((r) => r.url() === `${ORIGIN.api}/api/v1/campaigns/${campaignId}/draft` && r.request().method() === 'PUT');
  await control.getByTestId('preset-select').selectOption('MCDONALDS_15S');
  const respuesta = await put;
  expect(respuesta.status()).toBe(200);
  expect(respuesta.request().headers()['x-csrf-token']).toBeTruthy();
  expect(respuesta.headers()['access-control-allow-origin']).toBe(ORIGIN.control);
  await expect(control.getByTestId('working-draft')).toContainText('rev 2');
  await expect(control.getByTestId('campaign-sync')).toHaveAttribute('data-phase', 'saved');

  // 4. La misma web servida desde un origen NO listado: el navegador no deja ni leer ni escribir.
  const contar = () => web.evaluate(async (api) => ((await (await fetch(`${api}/api/v1/campaigns?limit=100`, { credentials: 'include' })).json()) as { items: unknown[] }).items.length, ORIGIN.api);
  const antes = await contar();
  const evil = await ctx.newPage();
  await evil.goto(`${ORIGIN.evil}/login`);
  const intento = await evil.evaluate(async ([api, contractId]) => {
    const out: string[] = [];
    for (const init of [
      { method: 'GET' },
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contractId, name: 'desde evil' }) },
    ]) {
      try {
        await fetch(`${api}/api/v1/${init.method === 'GET' ? 'auth/me' : 'campaigns'}`, { ...init, credentials: 'include' });
        out.push(`${init.method}:leído`);
      } catch (e) {
        out.push(`${init.method}:${(e as Error).name}`);
      }
    }
    return out;
  }, [ORIGIN.api, campaignId] as const);
  expect(intento).toEqual(['GET:TypeError', 'POST:TypeError']);
  // del lado del servidor: preflight y mutación de un origen no listado → 403 sin headers CORS
  const pre = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/campaigns`, { method: 'OPTIONS', headers: { origin: ORIGIN.evil, 'access-control-request-method': 'POST' } });
  expect(pre.status).toBe(403);
  expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  expect(await contar()).toBe(antes);

  // 5. Logout en la web revoca la sesión: el Builder, en el otro host, recibe 401.
  await logoutUI(web);
  expect(await ctx.cookies()).toHaveLength(0);
  const me2 = control.waitForResponse((r) => r.url() === `${ORIGIN.api}/api/v1/auth/me`);
  await control.reload();
  await control.getByTestId('tab-builder').click();
  expect((await me2).status()).toBe(401);
  await cerrar(ctx, info);
});
