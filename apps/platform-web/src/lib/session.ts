import type { Me } from './api';

/**
 * Guardas de navegación de platform-web — M3A.1 E3a. Funciones puras: el
 * componente `SessionGate` las aplica; los tests las ejercitan sin navegador.
 *
 * La sesión la decide el servidor (`GET /auth/me`): la UI no reimplementa
 * permisos, solo decide a dónde mandar a alguien sin sesión.
 */
export const HOME_PATH = '/campaigns';
export const LOGIN_PATH = '/login';

/**
 * `next` después del login: solo rutas internas de esta app. Corta open
 * redirects (`//evil`, `/\evil`, `https://…`, `javascript:`) y caracteres de
 * control; ante cualquier duda, el inicio.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return HOME_PATH;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return HOME_PATH;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return HOME_PATH;
  if (raw === LOGIN_PATH || raw.startsWith(`${LOGIN_PATH}?`) || raw.startsWith(`${LOGIN_PATH}/`)) return HOME_PATH;
  return raw;
}

/** A dónde redirigir, o null si la ruta se puede mostrar con esta sesión. */
export function redirectFor(pathname: string, me: Me | null, search = ''): string | null {
  const enLogin = pathname === LOGIN_PATH;
  if (!me) return enLogin ? null : `${LOGIN_PATH}?next=${encodeURIComponent(pathname + search)}`;
  if (enLogin) return safeNextPath(new URLSearchParams(search).get('next'));
  return null;
}
