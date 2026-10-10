import type { VersionSummary } from './api';

/** BL-31: une una página nueva del historial sin repetir ids (por si la misma página llega dos veces). */
export function appendPage(prev: VersionSummary[], next: VersionSummary[]): VersionSummary[] {
  const vistos = new Set(prev.map((v) => v.id));
  return [...prev, ...next.filter((v) => !vistos.has(v.id))];
}
