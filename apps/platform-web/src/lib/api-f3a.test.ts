import { describe, expect, it } from 'vitest';
import { type FetchLike, PlatformApiError, PlatformClient, payloadPedido } from './api';
import { Intent, IntentInProgressError, isUncertain, trasResultado } from './intent';

/**
 * F3(a) UI · cliente de versión vigente y ciclo de la "intención" (brief
 * `docs/briefs/F3A_UI.md` §5 y §6.2): key y payload exacto se conservan ante
 * un resultado incierto y se descartan solo ante uno definitivo o a pedido.
 */
const API = 'https://api.trust.test';
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ME = { user: { id: U(1), name: 'Op', email: 'op@x.com', organization: 'A' }, roles: ['OPERATOR'], externalContractIds: [], csrfToken: 'csrf-1', expiresAt: null };
const CHANGE = {
  id: U(5), campaignId: U(9), fromVersionId: null, toVersionId: U(2), toVersionHash: 'a'.repeat(64), reason: 'volver', requestedBy: U(1),
  requestedAt: '2026-10-12T00:00:00.000Z', expiresAt: '2026-10-13T00:00:00.000Z', status: 'PENDING', decidedBy: null, decidedAt: null,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** 200 cuyo cuerpo se corta a mitad de camino (reproducción del auditor en #60). */
const cortado = (status = 200) => new Response(new ReadableStream({ start(c) { c.error(new Error('body connection reset')); } }), { status });

type Llamada = { url: string; init: RequestInit };
function cliente(responder: (url: string, init: RequestInit, n: number) => Response | Promise<Response>, keys: string[] = []) {
  const llamadas: Llamada[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    if (url.endsWith('/api/v1/auth/me')) return json(200, ME);
    llamadas.push({ url, init });
    return responder(url, init, llamadas.length);
  };
  return { llamadas, client: new PlatformClient({ baseUrl: API, fetch, newKey: () => keys[i++] ?? `k-${i}` }) };
}
const hdr = (l: Llamada, h: string) => (l.init.headers as Record<string, string>)[h];
const payload = { versionId: U(2), versionHash: 'a'.repeat(64), reason: 'volver', expectedActiveVersionId: null };

describe('F3(a) UI · cliente', () => {
  it('pedir, confirmar y cancelar: POST con CSRF, la Idempotency-Key DE LA INTENCIÓN y el cuerpo exacto', async () => {
    const { llamadas, client } = cliente(() => json(201, CHANGE));
    await client.requestActiveVersionChange(U(9), payload, 'key-pedir');
    await client.confirmActiveVersionChange(U(5), { versionHash: 'a'.repeat(64) }, 'key-confirmar');
    await client.cancelActiveVersionChange(U(5), 'key-cancelar');
    expect(llamadas.map((l) => [l.init.method, l.url, hdr(l, 'idempotency-key'), hdr(l, 'x-csrf-token')])).toEqual([
      ['POST', `${API}/api/v1/campaigns/${U(9)}/active-version-changes`, 'key-pedir', 'csrf-1'],
      ['POST', `${API}/api/v1/active-version-changes/${U(5)}/confirm`, 'key-confirmar', 'csrf-1'],
      ['POST', `${API}/api/v1/active-version-changes/${U(5)}/cancel`, 'key-cancelar', 'csrf-1'],
    ]);
    expect(JSON.parse(llamadas[0]!.init.body as string)).toEqual(payload);
    expect(JSON.parse(llamadas[1]!.init.body as string)).toEqual({ versionHash: 'a'.repeat(64) });
    expect(llamadas[2]!.init.body).toBeUndefined(); // cancelar no lleva cuerpo
  });

  it('historial: GET paginado; un pedido fuera de contrato no se muestra', async () => {
    const { llamadas, client } = cliente(() => json(200, { items: [CHANGE], nextCursor: null }));
    expect((await client.listActiveVersionChanges(U(9), { cursor: U(5), limit: 5 })).items).toEqual([CHANGE]);
    expect(llamadas[0]!.url).toBe(`${API}/api/v1/campaigns/${U(9)}/active-version-changes?limit=5&cursor=${U(5)}`);
    const raro = cliente(() => json(200, { items: [{ ...CHANGE, status: 'DONE' }], nextCursor: null }));
    await expect(raro.client.listActiveVersionChanges(U(9))).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });
});

describe('F3(a) UI · §5 qué resultado es incierto', () => {
  const casos: Array<[string, () => Response | Promise<Response>, boolean]> = [
    ['red (fetch falla)', () => Promise.reject(new TypeError('Failed to fetch')), true],
    ['200 con el cuerpo cortado', () => cortado(200), true],
    ['201 con cuerpo fuera de contrato', () => json(201, { hola: 1 }), true],
    ['500', () => json(500, { code: 'INTERNAL_ERROR', message: 'Error interno.', requestId: 'r' }), true],
    ['502 de un intermediario (sin cuerpo JSON)', () => new Response('<html>bad gateway</html>', { status: 502 }), true],
    ['504 de un intermediario', () => new Response('timeout', { status: 504 }), true],
    ['409 terminal con cuerpo válido', () => json(409, { code: 'ACTIVE_VERSION_CONFLICT', message: 'x', requestId: 'r', details: { status: 'CANCELLED' } }), false],
    ['403 con cuerpo válido', () => json(403, { code: 'FOUR_EYES_VIOLATION', message: 'x', requestId: 'r' }), false],
    ['400 con cuerpo válido', () => json(400, { code: 'VALIDATION_ERROR', message: 'x', requestId: 'r' }), false],
  ];
  for (const [nombre, resp, incierto] of casos) {
    it(`${nombre} → ${incierto ? 'incierto: se conserva' : 'definitivo: se descarta'}`, async () => {
      const { client } = cliente(() => resp());
      const e = await client.confirmActiveVersionChange(U(5), { versionHash: 'a'.repeat(64) }, 'k').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(PlatformApiError);
      expect(isUncertain(e)).toBe(incierto);
    });
  }
  it('una excepción que no es de la API también es incierta', () => {
    expect(isUncertain(new Error('x'))).toBe(true);
  });
});

describe('F3(a) UI · §5 un 204 en una mutación que promete un recurso es fuera de contrato (#64, hallazgo 3)', () => {
  const ops: Array<[string, (c: PlatformClient, key: string) => Promise<unknown>]> = [
    ['pedir', (c, key) => c.requestActiveVersionChange(U(9), payload, key)],
    ['confirmar', (c, key) => c.confirmActiveVersionChange(U(5), { versionHash: 'a'.repeat(64) }, key)],
    ['cancelar', (c, key) => c.cancelActiveVersionChange(U(5), key)],
  ];
  for (const [nombre, op] of ops) {
    it(`${nombre}: 204 sin cuerpo → UNEXPECTED_RESPONSE incierto; la intención conserva la key (no anuncia éxito)`, async () => {
      const { client } = cliente(() => new Response(null, { status: 204 }));
      const intent = new Intent((pl: { n: number }, key: string) => op(client, key), () => 'k204');
      const r = await intent.start({ n: 1 });
      expect(r.kind).toBe('uncertain');
      expect(r.kind === 'uncertain' && r.error).toMatchObject({ status: 204, code: 'UNEXPECTED_RESPONSE' });
      expect(intent.snapshot?.key).toBe('k204');
    });
  }
  it('logout (ruta sin cuerpo por contrato) sigue aceptando 204', async () => {
    const { llamadas, client } = cliente(() => new Response(null, { status: 204 }));
    await expect(client.logout()).resolves.toBeUndefined();
    expect(llamadas.map((l) => [l.init.method, l.url])).toEqual([['POST', `${API}/api/v1/auth/logout`]]);
  });
});

describe('F3(a) UI · §5 ciclo de la intención', () => {
  it('incierto → se conserva; Reintentar manda la MISMA key y el MISMO payload (sin reconstruir nada)', async () => {
    let n = 0;
    const { llamadas, client } = cliente(() => (++n === 1 ? cortado(201) : json(201, CHANGE)), ['k1', 'k2']);
    const intent = new Intent<typeof payload, unknown>((pl, key) => client.requestActiveVersionChange(U(9), pl, key), () => (n === 0 ? 'k1' : 'k-otra'));
    const r1 = await intent.start({ ...payload });
    expect(r1.kind).toBe('uncertain');
    expect(intent.snapshot).toEqual({ key: 'k1', payload, inFlight: false });
    const r2 = await intent.retry();
    expect(r2).toEqual({ kind: 'ok', value: CHANGE });
    expect(intent.snapshot).toBeNull();
    expect(llamadas.map((l) => hdr(l, 'idempotency-key'))).toEqual(['k1', 'k1']);
    expect(llamadas.map((l) => l.init.body)).toEqual([llamadas[0]!.init.body, llamadas[0]!.init.body]);
  });

  for (const status of [500, 502, 504]) {
    it(`${status} → incierto: se conserva la intención`, async () => {
      const { client } = cliente(() => new Response('x', { status }));
      const intent = new Intent((pl: { changeId: string }, key: string) => client.cancelActiveVersionChange(pl.changeId, key), () => 'k1');
      expect((await intent.start({ changeId: U(5) })).kind).toBe('uncertain');
      expect(intent.snapshot?.key).toBe('k1');
    });
  }

  it('definitivo (2xx válido, 4xx válido, 409 terminal) → se descarta; la operación siguiente usa otra key', async () => {
    const respuestas = [json(201, CHANGE), json(409, { code: 'ACTIVE_VERSION_CHANGE_EXPIRED', message: 'x', requestId: 'r' }), json(201, CHANGE)];
    const { llamadas, client } = cliente(() => respuestas.shift()!);
    let k = 0;
    const intent = new Intent((pl: typeof payload, key: string) => client.requestActiveVersionChange(U(9), pl, key), () => `k${++k}`);
    expect((await intent.start(payload)).kind).toBe('ok');
    expect(intent.snapshot).toBeNull();
    const r = await intent.start(payload);
    expect(r.kind).toBe('definitive-error');
    expect(intent.snapshot).toBeNull();
    expect((await intent.start({ ...payload, reason: 'otro' })).kind).toBe('ok');
    expect(llamadas.map((l) => hdr(l, 'idempotency-key'))).toEqual(['k1', 'k2', 'k3']);
  });

  it('Descartar después de un incierto: la operación nueva (con otros datos) usa otra key', async () => {
    const { llamadas, client } = cliente(() => new Response('x', { status: 502 }));
    let k = 0;
    const intent = new Intent((pl: typeof payload, key: string) => client.requestActiveVersionChange(U(9), pl, key), () => `k${++k}`);
    await intent.start(payload);
    await expect(intent.start({ ...payload, reason: 'otro' })).rejects.toBeInstanceOf(IntentInProgressError);
    intent.discard();
    await intent.start({ ...payload, reason: 'otro' });
    expect(llamadas.map((l) => hdr(l, 'idempotency-key'))).toEqual(['k1', 'k2']);
  });

  it('sin doble envío: con una intención en vuelo no se puede empezar otra ni reintentar ni descartar', async () => {
    let soltar!: () => void;
    const { llamadas, client } = cliente(() => new Promise<Response>((r) => { soltar = () => r(json(200, { ...CHANGE, status: 'CONFIRMED' })); }));
    const intent = new Intent((pl: { changeId: string; versionHash: string }, key: string) => client.confirmActiveVersionChange(pl.changeId, { versionHash: pl.versionHash }, key), () => 'k1');
    const enVuelo = intent.start({ changeId: U(5), versionHash: 'a'.repeat(64) });
    for (let i = 0; i < 50 && llamadas.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
    expect(intent.snapshot?.inFlight).toBe(true);
    await expect(intent.start({ changeId: U(5), versionHash: 'a'.repeat(64) })).rejects.toBeInstanceOf(IntentInProgressError);
    await expect(intent.retry()).rejects.toBeInstanceOf(IntentInProgressError);
    expect(() => intent.discard()).toThrow(IntentInProgressError);
    soltar();
    expect((await enVuelo).kind).toBe('ok');
    expect(llamadas).toHaveLength(1);
  });
});

describe('F3(a) UI · payload y paso siguiente', () => {
  it('payloadPedido: expectedActiveVersionId es la vigente que muestra la página (o null), no la última aprobada', () => {
    const v = { id: U(2), versionHash: 'b'.repeat(64) };
    expect(payloadPedido({ activeVersion: null }, v, 'r')).toEqual({ versionId: U(2), versionHash: 'b'.repeat(64), reason: 'r', expectedActiveVersionId: null });
    expect(payloadPedido({ activeVersion: { id: U(4), versionNumber: 4, versionHash: 'c'.repeat(64) } }, v, 'r').expectedActiveVersionId).toBe(U(4));
    // aunque la campaña tenga otra "última aprobada", manda la vigente
    expect(payloadPedido({ activeVersion: null, latestApprovedVersion: { id: U(6), versionNumber: 6, versionHash: 'd'.repeat(64) } } as never, v, 'r').expectedActiveVersionId).toBeNull();
  });

  it('el payload queda CONGELADO al empezar: cambiar el formulario no cambia lo que se reintenta', async () => {
    const { llamadas, client } = cliente(() => new Response('x', { status: 502 }));
    const intent = new Intent((pl: typeof payload, key: string) => client.requestActiveVersionChange(U(9), pl, key), () => 'k1');
    const formulario = { ...payload };
    await intent.start(formulario);
    formulario.reason = 'otro motivo';
    formulario.expectedActiveVersionId = U(4) as never;
    await intent.retry();
    expect(llamadas.map((l) => JSON.parse(l.init.body as string))).toEqual([payload, payload]);
  });

  it('trasResultado: incierto conserva y no relee; ok y error definitivo descartan y RELEEN', () => {
    expect(trasResultado('uncertain')).toEqual({ phase: 'uncertain', recargar: false });
    expect(trasResultado('ok')).toEqual({ phase: 'idle', recargar: true });
    expect(trasResultado('definitive-error')).toEqual({ phase: 'idle', recargar: true });
  });
});
