import { describe, expect, it } from 'vitest';
import { type FetchLike, PlatformApiError, PlatformClient } from './api';

/** BL-31 · cliente: GET del historial con limit/cursor, sin CSRF, validado con Zod y errores tal cual. */
const API = 'https://api.trust.test';
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ITEM = { id: U(2), versionNumber: 2, versionHash: 'a'.repeat(64), status: 'APPROVED', sourceDraftRevision: 4, submittedAt: '2026-10-10T10:00:00.000Z' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function cliente(responder: (url: string) => Response) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    llamadas.push({ url, init });
    return responder(url);
  };
  return { llamadas, client: new PlatformClient({ baseUrl: API, fetch }) };
}

describe('BL-31 · cliente del historial', () => {
  it('primera página: limit=20 por default, sin cursor, GET con credenciales y sin CSRF', async () => {
    const { llamadas, client } = cliente(() => json(200, { items: [ITEM], nextCursor: U(2) }));
    const p = await client.listCampaignVersions(U(9));
    expect(p).toEqual({ items: [ITEM], nextCursor: U(2) });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.url).toBe(`${API}/api/v1/campaigns/${U(9)}/versions?limit=20`);
    expect(llamadas[0]!.init.method).toBe('GET');
    expect(llamadas[0]!.init.credentials).toBe('include');
    expect((llamadas[0]!.init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('siguiente página con el cursor recibido; el id de campaña va codificado', async () => {
    const { llamadas, client } = cliente(() => json(200, { items: [], nextCursor: null }));
    await client.listCampaignVersions(U(9), { cursor: U(2), limit: 5 });
    expect(llamadas[0]!.url).toBe(`${API}/api/v1/campaigns/${U(9)}/versions?limit=5&cursor=${U(2)}`);
    await client.listCampaignVersions('../x?y', {});
    expect(llamadas[1]!.url).toBe(`${API}/api/v1/campaigns/..%2Fx%3Fy/versions?limit=20`);
  });

  it('404 del servidor llega como PlatformApiError; una respuesta con campos fuera de formato no se muestra', async () => {
    const { client } = cliente(() => json(404, { code: 'CAMPAIGN_NOT_FOUND', message: 'La campaña no existe.', requestId: 'r1' }));
    await expect(client.listCampaignVersions(U(9))).rejects.toMatchObject({ status: 404, code: 'CAMPAIGN_NOT_FOUND', requestId: 'r1' });
    const raro = cliente(() => json(200, { items: [{ ...ITEM, status: 'DRAFT' }], nextCursor: null }));
    const e = await raro.client.listCampaignVersions(U(9)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PlatformApiError);
    expect((e as PlatformApiError).code).toBe('UNEXPECTED_RESPONSE');
  });
});
