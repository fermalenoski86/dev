import { describe, expect, it } from 'vitest';
import type { Me } from './api';
import { HOME_PATH, redirectFor, safeNextPath } from './session';

/** E3a · guardas de navegación: sin sesión → login; `next` solo interno (sin open redirect). */
const ME: Me = { user: { id: '11111111-1111-4111-8111-111111111111', name: 'Op', email: 'op@x', organization: 'A' }, roles: ['OPERATOR'], externalContractIds: [], csrfToken: 'c', expiresAt: null };

describe('E3a · guardas de sesión', () => {
  it('sin sesión: cualquier ruta salvo /login manda a /login con next', () => {
    expect(redirectFor('/campaigns', null)).toBe('/login?next=%2Fcampaigns');
    expect(redirectFor('/campaigns', null, '?x=1')).toBe('/login?next=%2Fcampaigns%3Fx%3D1');
    expect(redirectFor('/login', null)).toBeNull();
  });

  it('con sesión: las rutas se muestran; /login manda a next (o al inicio)', () => {
    expect(redirectFor('/campaigns', ME)).toBeNull();
    expect(redirectFor('/login', ME)).toBe(HOME_PATH);
    expect(redirectFor('/login', ME, '?next=%2Fcampaigns%3Fx%3D1')).toBe('/campaigns?x=1');
  });

  it('next: solo rutas internas; open redirects y basura van al inicio', () => {
    expect(safeNextPath('/campaigns')).toBe('/campaigns');
    for (const malo of [null, undefined, '', 'https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', 'campaigns', '/campaigns\n', '/a\\b', '/login', '/login?next=/x', '/'.padEnd(600, 'a')]) {
      expect(safeNextPath(malo), String(malo)).toBe(HOME_PATH);
    }
    expect(redirectFor('/login', ME, '?next=%2F%2Fevil.test')).toBe(HOME_PATH);
  });
});
