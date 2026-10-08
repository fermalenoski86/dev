import type { TakeoverDraft } from '@trust/show-authoring';

/**
 * Superficies que un draft UTILIZA — master §6: "una Campaign no puede
 * utilizar una superficie fuera de su Contract. El backend valida esto
 * server-side." (decisión 1 del brief D, aprobada).
 *
 * "Utilizar" = cualquier directiva que no sea `hold` (reproducir o mandar a
 * negro) sobre esa pantalla en algún moment: las dos le dan órdenes a una
 * pantalla física. La traducción ranura → pantalla es la del compilador:
 *
 *   upperMode 'master'      → upper              → screen_a + screen_b
 *                              (+ horizontal si includeHorizontalInMaster)
 *   upperMode 'independent' → corrientes         → screen_a
 *                              pellegrini         → screen_b
 *   siempre                 → horizontal         → horizontal
 *
 * Asignar un asset a una ranura sin usarla en ningún moment no cuenta.
 */
export function screensUsedByDraft(draft: TakeoverDraft): string[] {
  const usadas = new Set<string>();
  const activa = (d: { mode: string }) => d.mode !== 'hold';
  for (const m of draft.moments) {
    if (draft.surfaces.upperMode === 'master') {
      if (activa(m.screens.upper)) {
        usadas.add('screen_a');
        usadas.add('screen_b');
        if (draft.surfaces.includeHorizontalInMaster) usadas.add('horizontal');
      }
    } else {
      if (activa(m.screens.corrientes)) usadas.add('screen_a');
      if (activa(m.screens.pellegrini)) usadas.add('screen_b');
    }
    if (activa(m.screens.horizontal)) usadas.add('horizontal');
  }
  return [...usadas].sort();
}

/** Pantallas usadas por el draft que el contrato NO incluye (vacío = OK). */
export function screensOutsideContract(draft: TakeoverDraft, allowedSurfaces: readonly string[]): string[] {
  const permitidas = new Set(allowedSurfaces);
  return screensUsedByDraft(draft).filter((s) => !permitidas.has(s));
}
