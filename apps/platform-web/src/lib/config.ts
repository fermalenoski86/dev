import { PlatformClient, normalizeBaseUrl } from './api';

/**
 * `NEXT_PUBLIC_TRUST_API_URL` (la misma convención que D3 en apps/control):
 * base absoluta de platform-api. Next la incrusta en el build.
 */
export function apiBaseUrl(): string | null {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_TRUST_API_URL);
}

let cliente: PlatformClient | null = null;

/** Un cliente por pestaña (el token CSRF vive solo en su memoria). */
export function browserClient(): PlatformClient | null {
  const base = apiBaseUrl();
  if (!base) return null;
  if (!cliente) cliente = new PlatformClient({ baseUrl: base, fetch: (input, init) => window.fetch(input, init) });
  return cliente;
}

/**
 * E3b · `NEXT_PUBLIC_TRUST_BUILDER_URL`: base absoluta de apps/control (Builder,
 * D3). El enlace abre `<base>/?campaign=<id>`. Sin la variable no hay enlace.
 */
export function builderUrlFor(campaignId: string): string | null {
  const base = normalizeBaseUrl(process.env.NEXT_PUBLIC_TRUST_BUILDER_URL);
  return base ? `${base}/?campaign=${encodeURIComponent(campaignId)}` : null;
}
