import type { VersionSummary } from './api';

/** BL-31: une una página nueva del historial sin repetir ids (por si la misma página llega dos veces). */
export function appendPage(prev: VersionSummary[], next: VersionSummary[]): VersionSummary[] {
  const vistos = new Set(prev.map((v) => v.id));
  return [...prev, ...next.filter((v) => !vistos.has(v.id))];
}

/** Lee todas las páginas de versiones: no se supone que una versión vieja esté en la primera. */
export async function todasLasVersiones(list: (cursor: string | null) => Promise<{ items: VersionSummary[]; nextCursor: string | null }>): Promise<VersionSummary[]> {
  const out: VersionSummary[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const pg: { items: VersionSummary[]; nextCursor: string | null } = await list(cursor);
    for (const v of pg.items) if (!out.some((x) => x.id === v.id)) out.push(v);
    if (!pg.nextCursor) break;
    cursor = pg.nextCursor;
  }
  return out;
}
