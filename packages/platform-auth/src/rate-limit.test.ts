import { describe, expect, it } from 'vitest';
import { LoginRateLimiter, addressKey } from './rate-limit';
import { csrfTokenFor, isWellFormedToken, newSessionToken } from './tokens';

describe('rate limit de login', () => {
  it('agrupa IPv6 por /64 y desarma IPv4 mapeada', () => {
    expect(addressKey('2001:db8:1:2:aaaa::1')).toBe(addressKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(addressKey('2001:db8:1:2::1')).not.toBe(addressKey('2001:db8:1:3::1'));
    expect(addressKey('::ffff:10.0.0.1')).toBe(addressKey('10.0.0.1'));
    expect(addressKey('10.0.0.1')).not.toBe(addressKey('10.0.0.2'));
  });

  it('corta por email y por dirección, con Retry-After y ventana', () => {
    let now = 0;
    const l = new LoginRateLimiter({ windowMs: 1000, maxPerEmail: 2, maxPerAddress: 3 }, () => now);
    expect(l.check('a@x', '1.1.1.1')).toBeNull();
    expect(l.check('a@x', '1.1.1.2')).toBeNull();
    expect(l.check('a@x', '1.1.1.3')).toBe(1000); // por email
    expect(l.check('b@x', '9.9.9.9')).toBeNull();
    expect(l.check('c@x', '2001:db8::1')).toBeNull();
    expect(l.check('d@x', '2001:db8::2')).toBeNull();
    expect(l.check('e@x', '2001:db8::ffff')).toBeNull();
    now = 400;
    expect(l.check('f@x', '2001:db8:0:0:1::9')).toBe(600); // mismo /64
    now = 1000;
    expect(l.check('a@x', '1.1.1.3')).toBeNull(); // venció la ventana
  });

  it('un login exitoso libera el email pero no la dirección', () => {
    const l = new LoginRateLimiter({ windowMs: 1000, maxPerEmail: 1, maxPerAddress: 2 }, () => 0);
    expect(l.check('a@x', '1.1.1.1')).toBeNull();
    l.succeeded('a@x');
    expect(l.check('a@x', '1.1.1.1')).toBeNull();
    expect(l.check('z@x', '1.1.1.1')).not.toBeNull();
  });
});

describe('rate limit: memoria acotada (auditoría C1, OWASP API4:2023)', () => {
  it('reproducción del auditor: después de vencer la ventana, la ola vieja se libera', () => {
    let now = 0;
    const l = new LoginRateLimiter({ windowMs: 1000, maxPerEmail: 5, maxPerAddress: 50 }, () => now);
    for (let i = 0; i < 10_000; i++) l.check(`u${i}@x.test`, `10.0.${i >> 8}.${i & 255}`);
    expect(l.stats().keys).toBe(20_000);
    now = 2_000;
    for (let i = 10_000; i < 20_000; i++) l.check(`u${i}@x.test`, `11.0.${i >> 8}.${i & 255}`);
    expect(l.stats()).toEqual({ keys: 20_000, evicted: 0 }); // antes: 40.000
    now = 10_000;
    l.check('ultimo@x.test', '12.0.0.1');
    expect(l.stats().keys).toBe(2);
  });

  it('una clave que reabre su ventana pasa al final: el barrido no se corta antes de tiempo', () => {
    let now = 0;
    const l = new LoginRateLimiter({ windowMs: 1000, maxPerEmail: 5, maxPerAddress: 50 }, () => now);
    l.check('a@x', '1.1.1.1'); // vence en 1000
    now = 500;
    l.check('b@x', '1.1.1.2'); // vence en 1500
    now = 1200;
    l.check('a@x', '1.1.1.1'); // a reabre: vence en 2200, va al final
    now = 1600; // b y su dirección vencieron; a sigue
    l.check('c@x', '1.1.1.3');
    expect(l.stats().keys).toBe(4); // a + 1.1.1.1 + c + 1.1.1.3
  });

  it('tope duro: nunca más de maxKeys; descarta la más vieja y lo cuenta', () => {
    const l = new LoginRateLimiter({ windowMs: 60_000, maxPerEmail: 5, maxPerAddress: 50, maxKeys: 10 }, () => 0);
    for (let i = 0; i < 100; i++) {
      l.check(`u${i}@x`, `10.0.0.${i}`);
      expect(l.stats().keys).toBeLessThanOrEqual(10);
    }
    expect(l.stats().evicted).toBe(190);
    // la más nueva sigue contando
    for (let i = 0; i < 4; i++) l.check('u99@x', '10.0.0.99');
    expect(l.check('u99@x', '10.0.0.99')).not.toBeNull();
  });

  it('IPs inválidas comparten UN balde; emails gigantes se recortan: ninguna entrada crea claves arbitrarias', () => {
    expect(addressKey('no-es-ip')).toBe(addressKey('tampoco'));
    expect(addressKey(`x${'y'.repeat(10_000)}`)).toBe('?:invalid');
    const l = new LoginRateLimiter({ windowMs: 60_000, maxPerEmail: 5, maxPerAddress: 3 }, () => 0);
    for (let i = 0; i < 3; i++) expect(l.check(`v${i}@x`, `basura-${i}`)).toBeNull();
    expect(l.check('v9@x', 'otra-basura')).not.toBeNull();
    const largo = `${'z'.repeat(400)}@x`;
    l.check(largo, '1.1.1.1');
    expect(l.stats().keys).toBe(6);
  });

  it('configuración inválida se rechaza', () => {
    expect(() => new LoginRateLimiter({ maxKeys: 0 })).toThrow(/maxKeys/);
    expect(() => new LoginRateLimiter({ windowMs: 1.5 })).toThrow(/windowMs/);
  });
});

describe('tokens', () => {
  it('256 bits base64url, distintos, CSRF derivado y distinto del token', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(isWellFormedToken(a)).toBe(true);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(csrfTokenFor(a)).toBe(csrfTokenFor(a));
    expect(csrfTokenFor(a)).not.toBe(a);
    expect(csrfTokenFor(a)).not.toBe(csrfTokenFor(b));
    expect(isWellFormedToken('x'.repeat(42))).toBe(false);
    expect(isWellFormedToken(`${'x'.repeat(42)}=`)).toBe(false);
  });
});
