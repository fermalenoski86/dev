# M2C.2 EXECUTIVE EXPERIENCE — FROZEN

**Fecha:** 2026-10-06 · **Versión:** M2C.2.3

Gate final (salida completa en `docs/reviews/M2C23_SALIDA.txt`):

| Paso | Resultado |
|---|---|
| pnpm install --frozen-lockfile | exit 0 |
| pnpm verify | exit 0 · 524/524 tests · lint 0 errores |
| pnpm build | exit 0 · previs ✓ · control ✓ |
| mutation-check | 94/94 atrapadas · ejemplos intactos (md5) |
| pnpm e2e | 14/14 (Playwright, Chromium real) |
| pnpm verify (cierre) | exit 0 · 524/524 |

## Qué queda congelado

CLIENT EXPERIENCE para la presentación ejecutiva: Client Mode por defecto,
Operator Tools (`?operator=1`, Shift+O), copy «3 superficies digitales · 1
momento sincronizado», Hero 16:9 no destructivo, geometría y calibración de
pantallas (quads, curva de la marquesina, gabinete), creatividad de campaña
por sustitución de presentación, HOW IT WORKS con NEXT PHASE, end card, DEMO
CHECK (renderer y respaldo requeridos) y backup de 15 s.

Validado en 1920×1080, 1600×900 y 1366×768.

## Regla

NO seguir modificando UI, renderer ni geometría, salvo:
- un bug;
- un nuevo master fotográfico aprobado;
- una nueva creatividad de campaña (se reemplazan
  `/experience/campaign/mcd_towers_master.mp4` y `mcd_horizontal.mp4`).

## Próximo milestone

**M3A — PLATFORM BACKEND.** No iniciado en este trabajo.
