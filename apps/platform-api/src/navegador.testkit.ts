import { expect } from 'vitest';
import type { FetchLike } from '../../platform-web/src/lib/api';

/**
 * Solo tests (E3a/E3b): un "navegador" mínimo para el cliente de platform-web.
 * Guarda la cookie de sesión del host de la API (jar), manda `Origin` y exige
 * los headers CORS con credenciales que el navegador exigiría para dejar leer
 * la respuesta. El navegador real con hosts distintos y TLS es E3c.
 */
export function navegador(origin: string, cookieName: string) {
  let cookie: string | null = null;
  const vistas: { method: string; url: string; status: number }[] = [];
  const fetchNav: FetchLike = async (url, init) => {
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(url, { ...init, headers });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith(`${cookieName}=`)) {
      const par = set.split(';')[0] ?? '';
      cookie = /Expires=Thu, 01 Jan 1970/i.test(set) || par.endsWith('=') ? null : par;
    }
    vistas.push({ method: init.method ?? 'GET', url, status: res.status });
    if (res.headers.get('access-control-allow-origin') !== origin || res.headers.get('access-control-allow-credentials') !== 'true') {
      throw new TypeError('Failed to fetch (CORS)');
    }
    return res;
  };
  return { fetch: fetchNav, vistas, cookie: () => cookie };
}
