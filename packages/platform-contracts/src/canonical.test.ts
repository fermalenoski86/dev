import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICALIZATION_VERSION, canonicalize, computeVersionHash, sha256Hex } from './index';

const fx = (f: string) => readFileSync(resolve(__dirname, '__fixtures__', f), 'utf-8');

describe('RFC 8785 — vectores del propio RFC', () => {
  it('CRITERIO: §3.2.4 — números, strings y literales dan la salida canónica exacta', () => {
    expect(canonicalize(JSON.parse(fx('rfc8785-input.json')))).toBe(fx('rfc8785-expected.txt'));
  });

  it('§3.2.3 — las claves se ordenan por unidades UTF-16', () => {
    const out = canonicalize(JSON.parse(fx('rfc8785-order.json')));
    const orden = ['\\r', '"1"', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33'].map((k) => out.indexOf(k));
    expect(orden.every((v) => v >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it('la versión de canonicalización queda identificada', () => {
    expect(CANONICALIZATION_VERSION).toBe('jcs-rfc8785/canonicalize@5.1.0');
  });

  it('rechaza lo que JSON no representa: un hash no puede depender de eso', () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalize([1, undefined])).toThrow();
    expect(() => canonicalize({ f: () => 1 })).toThrow();
  });
});

/* ── hash de ShowVersion ─────────────────────────────────────────── */

const SHA_A = sha256Hex('video master');
const SHA_B = sha256Hex('video marquesina');
const pkg = { id: 'show', name: 'Takeover', version: 1, durationMs: 15000, media: {}, timeline: [{ atMs: 0, type: 'x' }] };
const assets = [
  { logicalRef: 'masterAssetId', sha256: SHA_A },
  { logicalRef: 'horizontalAssetId', sha256: SHA_B },
];

describe('CRITERIO: hash de versión determinista', () => {
  it('mismo contenido y mismos assets = mismo hash', () => {
    expect(computeVersionHash(pkg, assets).versionHash).toBe(computeVersionHash(structuredClone(pkg), [...assets]).versionHash);
  });

  it('el orden de las claves del paquete no cambia el hash', () => {
    const reordenado = { timeline: pkg.timeline, media: {}, durationMs: 15000, version: 1, name: 'Takeover', id: 'show' };
    expect(computeVersionHash(reordenado, assets).versionHash).toBe(computeVersionHash(pkg, assets).versionHash);
  });

  it('el orden de los assets no cambia el hash', () => {
    expect(computeVersionHash(pkg, [...assets].reverse()).versionHash).toBe(computeVersionHash(pkg, assets).versionHash);
  });

  it('cambiar UN byte de un asset cambia el hash', () => {
    const otro = [{ ...assets[0]!, sha256: sha256Hex('video master!') }, assets[1]!];
    expect(computeVersionHash(pkg, otro).versionHash).not.toBe(computeVersionHash(pkg, assets).versionHash);
  });

  it('cambiar el ShowPackage cambia el hash', () => {
    expect(computeVersionHash({ ...pkg, durationMs: 15001 }, assets).versionHash).not.toBe(computeVersionHash(pkg, assets).versionHash);
  });

  it('mover un asset de ranura cambia el hash (la ranura es parte del contenido)', () => {
    const cruzados = [
      { logicalRef: 'masterAssetId', sha256: SHA_B },
      { logicalRef: 'horizontalAssetId', sha256: SHA_A },
    ];
    expect(computeVersionHash(pkg, cruzados).versionHash).not.toBe(computeVersionHash(pkg, assets).versionHash);
  });

  it('el hash es SHA-256 (UTF-8) de la forma canónica JCS del envelope versionado', () => {
    const r = computeVersionHash(pkg, assets);
    expect(r.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.versionHash).toBe(sha256Hex(Buffer.from(r.canonical, 'utf-8')));
    expect(r.hashAlgorithm).toBe('sha256');
    const env = JSON.parse(r.canonical);
    expect(Object.keys(env).sort()).toEqual(['assets', 'hashEnvelopeVersion', 'showPackage', 'showPackageSchemaVersion']);
    expect(env.hashEnvelopeVersion).toBe(1);
    expect(env.showPackageSchemaVersion).toBe(1);
    expect(env.assets.map((a: { logicalRef: string }) => a.logicalRef)).toEqual(['horizontalAssetId', 'masterAssetId']);
  });

  it('CRITERIO: compilerVersion NO entra en el hash', () => {
    // El envelope no tiene dónde llevarla: dos compilers compatibles que
    // producen el mismo paquete dan el mismo hash.
    expect(computeVersionHash(pkg, assets).canonical).not.toContain('compiler');
  });

  it('cambiar la versión del envelope cambia el hash (cambio de formato deliberado)', () => {
    const r = computeVersionHash(pkg, assets);
    const env = { ...JSON.parse(r.canonical), hashEnvelopeVersion: 2 };
    expect(sha256Hex(canonicalize(env))).not.toBe(r.versionHash);
  });

  it('rechaza sha256 inválidos y ranuras duplicadas', () => {
    expect(() => computeVersionHash(pkg, [{ logicalRef: 'x', sha256: 'nope' }])).toThrow();
    expect(() => computeVersionHash(pkg, [assets[0]!, { ...assets[0]! }])).toThrow();
  });
});
