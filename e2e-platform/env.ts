/**
 * E3c · topología del E2E de plataforma (ADR-063): hosts distintos del mismo
 * site, todos por HTTPS en el terminador de test (:8443), y la API en modo
 * producción (cookie `__Host-trust_session`).
 */
export const TLS_PORT = 8443;
export const API_PORT = 4000;
export const WEB_PORT = 3002;
export const CONTROL_PORT = 3001;

export const HOSTS = {
  web: 'web.trust.test',
  control: 'control.trust.test',
  api: 'api.trust.test',
  /** Mismo site, NO listado en TRUST_CORS_ORIGINS: sirve la misma web para probar el bloqueo. */
  evil: 'evil.trust.test',
} as const;

export const ORIGIN = {
  web: `https://${HOSTS.web}:${TLS_PORT}`,
  control: `https://${HOSTS.control}:${TLS_PORT}`,
  api: `https://${HOSTS.api}:${TLS_PORT}`,
  evil: `https://${HOSTS.evil}:${TLS_PORT}`,
} as const;

export const SESSION_COOKIE = '__Host-trust_session';

export interface StackUser { worker: number; key: 'op' | 'ap' | 'admin'; role: string; email: string; password: string; name: string }
export interface StackState {
  apiPort: number;
  users: StackUser[];
  preset: Record<string, unknown>;
  fixtures: { master: string; horizontal: string };
  contracts?: Record<number, string>;
  tlsCertPath?: string;
}
