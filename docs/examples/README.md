# Ejemplos generados

Generados por `packages/show-authoring/src/emit.test.ts`, que usa el MISMO
camino que el Builder: preset → compileTakeoverDraft → ShowPackage → preflight.
No son archivos escritos a mano.

- `mcdonalds_takeover_15s.draft.json` — el draft, tal como lo guarda el editor.
- `mcdonalds_takeover_15s.show.json` — lo que ejecuta el ShowEngine.

## Resultado de la compilación

| | |
|---|---|
| duración | 15000 ms |
| eventos | 14 |
| mediaGroups | towers |
| validación del draft | READY |
| preflight errores | ninguno |
| preflight warnings | ninguno |

> Los assets son los clips de prueba del repo, no material de McDonald's:
> no hay contenido de marca en el repositorio. Ver TAKEOVER_BUILDER.md.
