import { describe, expect, it } from 'vitest';
import { requestFingerprint } from './idempotency';

describe('CRITERIO: fingerprint canónico (JCS), no JSON.stringify', () => {
  it('el mismo objeto con claves en distinto orden da el mismo fingerprint', () => {
    const a = requestFingerprint('submit', { campaignId: 'c1', expectedRevision: 3, meta: { x: 1, y: [1, 2] } });
    const b = requestFingerprint('submit', { meta: { y: [1, 2], x: 1 }, expectedRevision: 3, campaignId: 'c1' });
    expect(a).toBe(b);
  });
  it('otro contenido u otra operación dan otro fingerprint', () => {
    const base = requestFingerprint('submit', { campaignId: 'c1' });
    expect(requestFingerprint('submit', { campaignId: 'c2' })).not.toBe(base);
    expect(requestFingerprint('approve', { campaignId: 'c1' })).not.toBe(base);
    // el orden de un ARREGLO sí importa: es contenido
    expect(requestFingerprint('submit', { a: [1, 2] })).not.toBe(requestFingerprint('submit', { a: [2, 1] }));
  });
  it('es SHA-256 hex', () => {
    expect(requestFingerprint('x', {})).toMatch(/^[0-9a-f]{64}$/);
  });
});
