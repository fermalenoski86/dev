import { it, expect } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_SCENES, EL_TRUST, preflightShow, formatIssue } from '@trust/show-engine';
import { parseShowPackage } from '@trust/shared-types';
import {
  PRESET_MCDONALDS_15S,
  compileTakeoverDraft,
  createRepoRegistry,
  validateDraft,
} from '@trust/show-authoring';

/**
 * GENERADOR DE ARTEFACTOS — `pnpm emit:examples`.
 *
 * ── M2C.1.2 / punto 1 ────────────────────────────────────────────
 *
 * Esto vivia como test dentro de `packages/show-authoring` y por lo tanto
 * corria en `pnpm test`. Era incompatible con el mutation check: cada mutante
 * corre la suite completa con el codigo fuente alterado, asi que los archivos
 * de `docs/examples/` quedaban ESCRITOS POR EL MUTANTE. El source se
 * restauraba; los artefactos no.
 *
 * Es la misma clase de problema que la mutacion que sobrevivio en M2C.1.1: un
 * efecto de borde que nadie mira hasta que el archivo entregado esta mal.
 *
 * Regla: **los unit tests son puros**. No escriben en disco. La generacion es
 * un comando aparte, con su propia config de vitest
 * (`vitest.emit.config.ts`), que `pnpm test` no incluye.
 *
 * Emite los artefactos de ejemplo de la entrega. No es un test de logica:
 * es el generador del draft y del ShowPackage que se entregan, escrito como
 * test para que salgan del MISMO camino que usa el builder.
 */
it('emite los artefactos de ejemplo', () => {
  const dir = resolve(__dirname, '../docs/examples');
  mkdirSync(dir, { recursive: true });

  const registry = createRepoRegistry();
  const ctx = {
    building: EL_TRUST,
    assets: registry,
    sceneIds: new Set(DEMO_SCENES.keys()),
  };
  const preflightCtx = { building: EL_TRUST, scenes: DEMO_SCENES };

  const draft = PRESET_MCDONALDS_15S();
  const compiled = compileTakeoverDraft(draft, ctx);
  expect(compiled.ok).toBe(true);
  const pkg = parseShowPackage(compiled.showPackage);
  const pre = preflightShow(pkg, preflightCtx);
  const val = validateDraft(draft, { ...ctx, preflight: preflightCtx });

  writeFileSync(resolve(dir, 'mcdonalds_takeover_15s.draft.json'), JSON.stringify(draft, null, 2) + '\n');
  writeFileSync(resolve(dir, 'mcdonalds_takeover_15s.show.json'), JSON.stringify(pkg, null, 2) + '\n');

  // En vez de imprimir por consola, el resumen se entrega junto a los archivos.
  const resumen = [
    '# Ejemplos generados',
    '',
    'Generados por `packages/show-authoring/src/emit.test.ts`, que usa el MISMO',
    'camino que el Builder: preset → compileTakeoverDraft → ShowPackage → preflight.',
    'No son archivos escritos a mano.',
    '',
    `- \`mcdonalds_takeover_15s.draft.json\` — el draft, tal como lo guarda el editor.`,
    `- \`mcdonalds_takeover_15s.show.json\` — lo que ejecuta el ShowEngine.`,
    '',
    '## Resultado de la compilación',
    '',
    `| | |`,
    `|---|---|`,
    `| duración | ${pkg.durationMs} ms |`,
    `| eventos | ${pkg.timeline.length} |`,
    `| mediaGroups | ${Object.keys(pkg.mediaGroups).join(', ') || '—'} |`,
    `| validación del draft | ${val.status} |`,
    `| preflight errores | ${pre.errors.length === 0 ? 'ninguno' : pre.errors.map(formatIssue).join(' · ')} |`,
    `| preflight warnings | ${pre.warnings.length === 0 ? 'ninguno' : pre.warnings.map(formatIssue).join(' · ')} |`,
    '',
    '> Los assets son los clips de prueba del repo, no material de McDonald\'s:',
    '> no hay contenido de marca en el repositorio. Ver TAKEOVER_BUILDER.md.',
    '',
  ].join('\n');
  writeFileSync(resolve(dir, 'README.md'), resumen);

  expect(pre.errors).toEqual([]);
});

