import { describe, expect, it } from 'vitest';
import { type FetchLike, PlatformApiError, PlatformClient, normalizeBaseUrl } from './api';

/**
 * E3a · cliente HTTP de platform-web (ADR-063): directo a la API, siempre con
 * credenciales, CSRF en memoria en toda mutación, errores del servidor tal cual.
 */
const API = 'https://api.trust.test';
const ME = {
  user: { id: '11111111-1111-4111-8111-111111111111', name: 'Op', email: 'op@x', organization: 'Affinitas' },
  roles: ['OPERATOR'], externalContractIds: [], csrfToken: 'csrf-1', expiresAt: '2026-10-10T00:00:00.000Z',
};
const CAMPAIGN = {
  id: '22222222-2222-4222-8222-222222222222', contractId: '33333333-3333-4333-8333-333333333333', name: 'Launch', lifecycleStatus: 'ACTIVE',
  currentDraft: { id: '44444444-4444-4444-8444-444444444444', revision: 2, updatedAt: 't' },
  latestApprovedVersion: { id: '55555555-5555-4555-8555-555555555555', versionNumber: 1, versionHash: 'a'.repeat(64) },
  createdAt: 't', updatedAt: 't',
};

interface Llamada { url: string; init: RequestInit }
const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function falso(responder: (url: string, init: RequestInit) => Response) {
  const llamadas: Llamada[] = [];
  const fetch: FetchLike = async (url, init) => {
    llamadas.push({ url, init });
    return responder(url, init);
  };
  return { llamadas, client: new PlatformClient({ baseUrl: API, fetch }) };
}
const hdr = (l: Llamada, k: string) => (l.init.headers as Record<string, string>)[k];

describe('E3a · cliente de platform-web', () => {
  it('la base tiene que ser absoluta http(s); se normaliza sin barra final', () => {
    expect(normalizeBaseUrl('https://api.trust.test/')).toBe('https://api.trust.test');
    expect(normalizeBaseUrl(' http://localhost:4000 ')).toBe('http://localhost:4000');
    for (const m of [undefined, '', '/api', 'api.trust.test', 'javascript:alert(1)', 'ftp://x']) expect(normalizeBaseUrl(m), String(m)).toBeNull();
    expect(() => new PlatformClient({ baseUrl: '/api', fetch: async () => json(200, {}) })).toThrow(/absoluta/);
  });

  it('toda llamada va directo al host de la API con credentials: include y sin caché', async () => {
    const { llamadas, client } = falso((url) => (url.endsWith('/auth/me') ? json(200, ME) : json(200, { items: [CAMPAIGN], nextCursor: null })));
    await client.me();
    await client.listCampaigns();
    expect(llamadas.map((l) => l.url)).toEqual([`${API}/api/v1/auth/me`, `${API}/api/v1/campaigns?limit=100`]);
    for (const l of llamadas) {
      expect(l.init.credentials).toBe('include');
      expect(l.init.cache).toBe('no-store');
    }
  });

  it('login guarda el CSRF en memoria; las mutaciones lo mandan y los GET no', async () => {
    const { llamadas, client } = falso((url, init) => {
      if (url.endsWith('/auth/login')) return json(200, ME);
      if (init.method === 'POST' && url.endsWith('/campaigns')) return json(201, CAMPAIGN);
      return json(200, { items: [], nextCursor: null });
    });
    await client.login('op@x', 'pw');
    expect(hdr(llamadas[0]!, 'x-csrf-token')).toBeUndefined();
    expect(JSON.parse(String(llamadas[0]!.init.body))).toEqual({ email: 'op@x', password: 'pw' });
    await client.listCampaigns();
    expect(hdr(llamadas[1]!, 'x-csrf-token')).toBeUndefined();
    const c = await client.createCampaign({ contractId: CAMPAIGN.contractId, name: 'Launch' });
    expect(c.id).toBe(CAMPAIGN.id);
    expect(hdr(llamadas[2]!, 'x-csrf-token')).toBe('csrf-1');
    expect(hdr(llamadas[2]!, 'content-type')).toBe('application/json');
  });

  it('una mutación sin token todavía pide /auth/me primero (p. ej. después de recargar la página)', async () => {
    const { llamadas, client } = falso((url) => (url.endsWith('/auth/me') ? json(200, ME) : json(201, CAMPAIGN)));
    await client.createCampaign({ contractId: CAMPAIGN.contractId, name: 'Launch' });
    expect(llamadas.map((l) => `${l.init.method} ${l.url.slice(API.length)}`)).toEqual(['GET /api/v1/auth/me', 'POST /api/v1/campaigns']);
    expect(hdr(llamadas[1]!, 'x-csrf-token')).toBe('csrf-1');
  });

  it('sin sesión: me() da null y una mutación falla con 401 sin llegar a mandarse', async () => {
    const { llamadas, client } = falso(() => json(401, { code: 'UNAUTHENTICATED', message: 'Sin sesión.', requestId: 'r1' }));
    expect(await client.me()).toBeNull();
    await expect(client.createCampaign({ contractId: CAMPAIGN.contractId, name: 'x' })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(llamadas.every((l) => l.init.method === 'GET')).toBe(true);
  });

  it('errores de la API: código, mensaje y requestId del servidor; un 401 borra el CSRF', async () => {
    let n = 0;
    const { client } = falso((url) => {
      if (url.endsWith('/auth/login')) return json(200, ME);
      n++;
      return n === 1 ? json(403, { code: 'FORBIDDEN', message: 'Tu rol no puede.', requestId: 'r2' }) : json(401, { code: 'UNAUTHENTICATED', message: 'Venció.', requestId: 'r3' });
    });
    await client.login('op@x', 'pw');
    const e = await client.createCampaign({ contractId: CAMPAIGN.contractId, name: 'x' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PlatformApiError);
    expect(e).toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Tu rol no puede.', requestId: 'r2' });
    expect(client.hasCsrfToken).toBe(true);
    await expect(client.listCampaigns()).rejects.toMatchObject({ status: 401 });
    expect(client.hasCsrfToken).toBe(false);
  });

  it('respuesta con formato inesperado o red caída: error propio, sin mostrar datos crudos', async () => {
    const roto = falso(() => json(200, { items: [{ id: 'no-uuid' }], nextCursor: null })).client;
    await expect(roto.listCampaigns()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
    const sinRed = new PlatformClient({ baseUrl: API, fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(sinRed.me()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    const html = falso(() => new Response('<html>502</html>', { status: 502 })).client;
    await expect(html.me()).rejects.toMatchObject({ status: 502, code: 'UNEXPECTED_RESPONSE' });
  });

  it('logout: POST con CSRF y el token se olvida; si la sesión ya había vencido, igual queda afuera', async () => {
    const { llamadas, client } = falso((url) => (url.endsWith('/auth/login') ? json(200, ME) : new Response(null, { status: 204 })));
    await client.login('op@x', 'pw');
    await client.logout();
    expect(llamadas[1]!.init.method).toBe('POST');
    expect(llamadas[1]!.url).toBe(`${API}/api/v1/auth/logout`);
    expect(hdr(llamadas[1]!, 'x-csrf-token')).toBe('csrf-1');
    expect(client.hasCsrfToken).toBe(false);
    const vencida = falso(() => json(401, { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' })).client;
    await expect(vencida.logout()).resolves.toBeUndefined();
  });
});
