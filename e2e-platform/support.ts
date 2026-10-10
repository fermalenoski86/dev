import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, type BrowserContext, type Page, type TestInfo, expect } from '@playwright/test';
import { API_PORT, ORIGIN, type StackState, type StackUser } from './env';

/** Estado que dejó global-setup (usuarios por worker, contrato, preset, fixtures). */
export function stack(): StackState {
  const dir = process.env.E2E_STATE_DIR;
  if (!dir) throw new Error('E2E_STATE_DIR no está: ¿corrió global-setup?');
  return JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as StackState;
}

/** BL-25: cada worker usa sus propias cuentas y su propio contrato. */
export function cuenta(info: TestInfo, key: StackUser['key']): StackUser {
  const u = stack().users.find((x) => x.worker === info.parallelIndex && x.key === key);
  if (!u) throw new Error(`sin cuenta ${key} para el worker ${info.parallelIndex}`);
  return u;
}
export function contrato(info: TestInfo): string {
  const c = stack().contracts?.[info.parallelIndex];
  if (!c) throw new Error(`sin contrato para el worker ${info.parallelIndex}`);
  return c;
}

/**
 * Contexto NUEVO (sin storageState) con video (§47). Los contextos creados a
 * mano no adjuntan el video al reporte: `cerrar` lo hace, para que el manifest
 * (BL-29) los indexe con su SHA-256.
 */
const VIDEOS = new WeakMap<BrowserContext, Array<NonNullable<ReturnType<Page['video']>>>>();

export async function contexto(browser: Browser, info: TestInfo): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, recordVideo: { dir: path.join(info.outputDir, 'videos'), size: { width: 1280, height: 900 } } });
  const lista: Array<NonNullable<ReturnType<Page['video']>>> = [];
  VIDEOS.set(ctx, lista);
  // también las páginas que se cierran antes (el Builder): su video queda igual
  ctx.on('page', (p) => {
    const v = p.video();
    if (v) lista.push(v);
  });
  return ctx;
}

export async function cerrar(ctx: BrowserContext, info: TestInfo) {
  const videos = VIDEOS.get(ctx) ?? [];
  await ctx.close();
  for (const v of videos) await info.attach('video', { path: await v.path(), contentType: 'video/webm' });
}

/** Login por el formulario de la UI de platform-web (siempre en un contexto nuevo). */
export async function loginUI(page: Page, u: StackUser) {
  await page.goto(`${ORIGIN.web}/login`);
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL(`${ORIGIN.web}/campaigns`);
  await expect(page.getByLabel('Sesión')).toContainText(u.name);
}

export async function logoutUI(page: Page) {
  await page.getByRole('button', { name: 'Salir' }).click();
  await page.waitForURL(/\/login/);
}

/** `GET /auth/me` con una cookie dada, directo a la API (sin navegador). */
export async function meConCookie(valor: string): Promise<number> {
  const r = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/auth/me`, { headers: { cookie: `__Host-trust_session=${valor}` } });
  return r.status;
}

/**
 * Preparación de datos por la API (sin navegador): para los specs que no
 * prueban ese tramo (a11y). Usa las cuentas del worker.
 */
export async function apiSesion(u: StackUser) {
  const base = `http://127.0.0.1:${API_PORT}`;
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password }) });
  expect(r.status).toBe(200);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const csrf = ((await r.json()) as { csrfToken: string }).csrfToken;
  const llamar = async (method: string, url: string, body?: unknown, extra: Record<string, string> = {}) => {
    const x = await fetch(`${base}${url}`, {
      method, headers: { cookie, 'x-csrf-token': csrf, ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...extra },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const j = (await x.json().catch(() => null)) as Record<string, unknown> | null;
    if (x.status >= 300) throw new Error(`${method} ${url}: ${x.status} ${JSON.stringify(j)}`);
    return j as Record<string, unknown>;
  };
  const key = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    llamar,
    /** Campaña con draft completo y los dos assets reales asignados, lista para enviar. */
    async campañaLista(contractId: string, nombre: string) {
      const s = stack();
      const c = await llamar('POST', '/api/v1/campaigns', { contractId, name: nombre });
      const id = c.id as string;
      const subir = async (archivo: string, surfaceType: string) => {
        const fd = new FormData();
        fd.append('surfaceType', surfaceType);
        fd.append('file', new Blob([new Uint8Array(readFileSync(archivo))], { type: 'video/mp4' }), path.basename(archivo));
        return (await llamar('POST', '/api/v1/assets', fd, { 'idempotency-key': key() })).id as string;
      };
      const master = await subir(s.fixtures.master, 'towers_ab');
      const horizontal = await subir(s.fixtures.horizontal, 'horizontal');
      const d = await llamar('GET', `/api/v1/campaigns/${id}/draft`);
      const preset = s.preset as { surfaces: Record<string, unknown> };
      const draft = { ...preset, name: nombre, surfaces: { ...preset.surfaces, masterAssetId: master, horizontalAssetId: horizontal } };
      await llamar('PUT', `/api/v1/campaigns/${id}/draft`, { takeoverDraft: draft, expectedRevision: d.revision });
      return id;
    },
    async enviar(campaignId: string) {
      const d = await llamar('GET', `/api/v1/campaigns/${campaignId}/draft`);
      return llamar('POST', `/api/v1/campaigns/${campaignId}/submit`, { draftRevision: d.revision }, { 'idempotency-key': key() });
    },
    async evidencia(versionId: string) {
      const fd = new FormData();
      fd.append('type', 'PDF');
      fd.append('file', new Blob([pdf()], { type: 'application/pdf' }), 'ok-cliente.pdf');
      return llamar('POST', `/api/v1/show-versions/${versionId}/evidence`, fd, { 'idempotency-key': key() });
    },
    logout: () => fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf } }),
  };
}

export function pdf(): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n% e2e ${Date.now()}\n`);
}

/* ── §47 / BL-29: evidencia para el manifest ─────────────────────────── */

export const EVIDENCE_DIR = path.resolve(__dirname, '..', 'test-results', 'e2e-platform-evidence');

/** Screenshot de un paso de §47, guardado en el directorio de evidencia. */
export async function captura(page: Page, info: TestInfo, paso: string): Promise<string> {
  mkdirSync(path.join(EVIDENCE_DIR, 'screenshots'), { recursive: true });
  const archivo = path.join(EVIDENCE_DIR, 'screenshots', `${info.parallelIndex}-${paso}.png`);
  await page.screenshot({ path: archivo, fullPage: true });
  return archivo;
}

/** Datos del flujo para el manifest (campaña, versión, hash, roles). */
export function registrar(info: TestInfo, datos: Record<string, unknown>) {
  mkdirSync(path.join(EVIDENCE_DIR, 'parts'), { recursive: true });
  const id = createHash('sha256').update(info.titlePath.join(' › ')).digest('hex').slice(0, 16);
  writeFileSync(path.join(EVIDENCE_DIR, 'parts', `${id}.json`), JSON.stringify({ test: info.titlePath.slice(1).join(' › '), file: path.basename(info.file), ...datos }, null, 2));
}
