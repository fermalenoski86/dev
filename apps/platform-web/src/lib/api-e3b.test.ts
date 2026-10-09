import { describe, expect, it } from 'vitest';
import { type FetchLike, PlatformApiError, PlatformClient, randomKey } from './api';

/**
 * E3b · cliente: uploads multipart con Idempotency-Key y CSRF, asset rechazado
 * como resultado, submit con draftRevision, decisiones que citan el hash.
 */
const API = 'https://api.trust.test';
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ME = { user: { id: U(1), name: 'Op', email: 'op@x', organization: 'A' }, roles: ['OPERATOR'], externalContractIds: [], csrfToken: 'csrf-1', expiresAt: null };
const HASH = 'c'.repeat(64);
const ASSET = { id: U(2), status: 'READY', surfaceType: 'horizontal', originalFilename: 'h.mp4', sha256: 'd'.repeat(64), sizeBytes: 10, width: 1920, height: 412, fps: 30, codec: 'H264', durationMs: 15000, rejection: null };
const VERSION = {
  id: U(3), campaignId: U(4), contractId: U(5), versionNumber: 1, versionHash: HASH, sourceDraftRevision: 3, submittedBy: U(1), submittedAt: 't',
  status: 'SUBMITTED', fourEyesRequired: true, approval: null, evidence: [], assets: [{ logicalRef: 'horizontalAssetId', assetId: U(2), sha256: 'd'.repeat(64) }],
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
interface Llamada { url: string; init: RequestInit }

function cliente(responder: (url: string, init: RequestInit) => Response) {
  const llamadas: Llamada[] = [];
  let n = 0;
  const fetch: FetchLike = async (url, init) => {
    llamadas.push({ url, init });
    return url.endsWith('/auth/me') ? json(200, ME) : responder(url, init);
  };
  return { llamadas, client: new PlatformClient({ baseUrl: API, fetch, newKey: () => `key-${++n}` }) };
}
const hdr = (l: Llamada, k: string) => (l.init.headers as Record<string, string>)[k];
const ultima = (ls: Llamada[]) => ls[ls.length - 1]!;
const claves = (f: FormData) => {
  const out: string[] = [];
  f.forEach((_v, k) => out.push(k));
  return out;
};

describe('E3b · cliente de platform-web', () => {
  it('upload de asset: multipart (campos antes que el archivo), Idempotency-Key nueva por intento, CSRF y sin content-type propio', async () => {
    const { llamadas, client } = cliente(() => json(201, ASSET));
    const a = await client.uploadAsset({ surfaceType: 'horizontal', file: new Blob(['x'], { type: 'video/mp4' }), filename: 'h.mp4' });
    expect(a.status).toBe('READY');
    const l = ultima(llamadas);
    expect(l.url).toBe(`${API}/api/v1/assets`);
    expect(hdr(l, 'idempotency-key')).toBe('key-1');
    expect(hdr(l, 'x-csrf-token')).toBe('csrf-1');
    expect(hdr(l, 'content-type')).toBeUndefined();
    const form = l.init.body as FormData;
    expect(claves(form)).toEqual(['surfaceType', 'file']);
    expect(form.get('surfaceType')).toBe('horizontal');
    expect((form.get('file') as File).name).toBe('h.mp4');
    await client.uploadAsset({ surfaceType: 'horizontal', file: new Blob(['y']), filename: 'h2.mp4' });
    expect(hdr(ultima(llamadas), 'idempotency-key')).toBe('key-2');
  });

  it('asset rechazado por ffprobe (422 con details.asset): vuelve como asset REJECTED con su motivo; otros errores siguen siendo errores', async () => {
    const rechazado = { ...ASSET, status: 'REJECTED', sha256: null, width: null, height: null, fps: null, codec: null, durationMs: null, rejection: { code: 'ASSET_CORRUPT', message: 'No es un video legible.', remediation: { summary: 'Exportá de nuevo en MP4 H.264.' } } };
    const { client } = cliente(() => json(422, { code: 'ASSET_CORRUPT', message: 'No es un video legible.', requestId: 'r', details: { asset: rechazado } }));
    const a = await client.uploadAsset({ surfaceType: 'horizontal', file: new Blob(['no']), filename: 'x.mp4' });
    expect(a).toMatchObject({ status: 'REJECTED', rejection: { code: 'ASSET_CORRUPT', remediation: { summary: 'Exportá de nuevo en MP4 H.264.' } } });
    const otro = cliente(() => json(400, { code: 'INVALID_SURFACE_TYPE', message: 'No existe.', requestId: 'r', details: { accepted: ['horizontal'] } })).client;
    await expect(otro.uploadAsset({ surfaceType: 'x', file: new Blob(['y']), filename: 'y.mp4' })).rejects.toMatchObject({ status: 400, code: 'INVALID_SURFACE_TYPE' });
  });

  it('putDraft manda expectedRevision; un 409 DRAFT_CONFLICT llega como error con sus detalles', async () => {
    const { llamadas, client } = cliente(() => json(409, { code: 'DRAFT_CONFLICT', message: 'Otro guardó antes.', requestId: 'r', details: { serverRevision: 4, clientRevision: 3 } }));
    const e = await client.putDraft(U(4), { takeoverDraft: { surfaces: {} }, expectedRevision: 3 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PlatformApiError);
    expect(e).toMatchObject({ status: 409, code: 'DRAFT_CONFLICT', details: { serverRevision: 4 } });
    const l = ultima(llamadas);
    expect(l.init.method).toBe('PUT');
    expect(JSON.parse(String(l.init.body))).toEqual({ takeoverDraft: { surfaces: {} }, expectedRevision: 3 });
    expect(hdr(l, 'x-csrf-token')).toBe('csrf-1');
  });

  it('submit: draftRevision + Idempotency-Key + CSRF; devuelve la versión con su hash', async () => {
    const { llamadas, client } = cliente(() => json(201, VERSION));
    const v = await client.submit(U(4), 3);
    expect(v.versionHash).toBe(HASH);
    const l = ultima(llamadas);
    expect(l.url).toBe(`${API}/api/v1/campaigns/${U(4)}/submit`);
    expect(JSON.parse(String(l.init.body))).toEqual({ draftRevision: 3 });
    expect(hdr(l, 'idempotency-key')).toBe('key-1');
    expect(hdr(l, 'x-csrf-token')).toBe('csrf-1');
  });

  it('evidencia multipart y decisiones: aprobar cita evidencia + hash, rechazar cita motivo + hash, cada una con su Idempotency-Key', async () => {
    const ev = { id: U(6), showVersionId: U(3), type: 'PDF', originalFilename: 'ok.pdf', mimeType: 'application/pdf', sizeBytes: 10, sha256: 'e'.repeat(64), uploadedBy: U(7), uploadedAt: 't' };
    const { llamadas, client } = cliente((url) => (url.endsWith('/evidence') ? json(201, ev) : json(201, { ...VERSION, status: 'APPROVED' })));
    await client.uploadEvidence(U(3), { type: 'PDF', file: new Blob(['%PDF']), filename: 'ok.pdf' });
    const evl = ultima(llamadas);
    expect(claves(evl.init.body as FormData)).toEqual(['type', 'file']);
    expect(hdr(evl, 'idempotency-key')).toBe('key-1');
    await client.approve(U(3), { evidenceId: U(6), versionHash: HASH });
    expect(JSON.parse(String(ultima(llamadas).init.body))).toEqual({ evidenceId: U(6), versionHash: HASH });
    expect(ultima(llamadas).url).toBe(`${API}/api/v1/show-versions/${U(3)}/approve`);
    expect(hdr(ultima(llamadas), 'idempotency-key')).toBe('key-2');
    await client.reject(U(3), { reason: 'no', versionHash: HASH });
    expect(JSON.parse(String(ultima(llamadas).init.body))).toEqual({ reason: 'no', versionHash: HASH });
    expect(hdr(ultima(llamadas), 'idempotency-key')).toBe('key-3');
  });

  it('cuatro ojos y hash distinto: los errores del servidor llegan tal cual (la UI no duplica la regla)', async () => {
    const { client } = cliente(() => json(403, { code: 'FOUR_EYES_VIOLATION', message: 'Quien envió no puede aprobar.', requestId: 'r' }));
    await expect(client.approve(U(3), { evidenceId: U(6), versionHash: HASH })).rejects.toMatchObject({ status: 403, code: 'FOUR_EYES_VIOLATION' });
  });

  it('URL de evidencia: absoluta, en el host de la API, con ids escapados', () => {
    const c = new PlatformClient({ baseUrl: API, fetch: async () => json(200, {}) });
    expect(c.evidenceUrl(U(3), U(6))).toBe(`${API}/api/v1/show-versions/${U(3)}/evidence/${U(6)}`);
    expect(c.evidenceUrl('a/b', 'c?d')).toBe(`${API}/api/v1/show-versions/a%2Fb/evidence/c%3Fd`);
  });

  it('Idempotency-Key sin crypto.randomUUID (host http de desarrollo, contexto no seguro): UUID v4 con getRandomValues, distinta cada vez', () => {
    const sinUUID = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => globalThis.crypto.getRandomValues(a as Uint8Array) as unknown as T };
    const a = randomKey(sinUUID);
    const b = randomKey(sinUUID);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(randomKey({ getRandomValues: sinUUID.getRandomValues, randomUUID: () => 'nativo' })).toBe('nativo');
  });
});
