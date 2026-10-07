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
