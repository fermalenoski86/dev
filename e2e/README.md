# Smoke E2E del Builder

**Estado: EJECUTADO Y PASANDO** — 2 passed / 0 failed (M2C.1.2).

Corre contra Chromium real. Si tu entorno no puede bajar los binarios de
Playwright, `TRUST_CHROMIUM_PATH` permite apuntar a un Chromium existente:
así se ejecutó acá, usando el binario que trae el paquete npm
`@sparticuz/chromium` más `fontconfig` del sistema (sin fuentes instaladas
el renderer aborta en el font manager).

## Cómo correrlo

```bash
pnpm --filter @trust/control build
pnpm dlx playwright install chromium
pnpm e2e
```

`pnpm e2e` usa `pnpm dlx @playwright/test`, así que **no toca el lockfile** ni
obliga a nadie a bajar Playwright para el `pnpm install` de todos los días.
`playwright.config.ts` levanta el servidor solo (`webServer`), o reutiliza uno
ya corriendo en :3001.

## Qué cubre

`builder.spec.ts`, dos tests:

1. **preset, edición, preview, persistencia y export** — el recorrido del
   criterio de aceptación: abrir BUILDER, elegir el preset de McDonald's, ver 5
   moments, PLAY, editar una duración, RESTART usando la nueva, reordenar por
   drag & drop, ver BLOCKED deshabilitando preview/export/present, SAVE,
   recargar y exportar.
2. **cargar otro preset con cambios sin guardar pide confirmación.**

## Selectores

La UI expone estos `data-testid`:

| testid | dónde |
|---|---|
| `preset-select` | selector de presets |
| `preflight-status` | panel de validación |
| `transport-status` | estado del transporte |
| `preview-duration` | duración total, en la cabecera de Moments |
| `moment-count` | cantidad de moments |
| `moment-block` | cada bloque de la timeline (con `data-moment-id`) |
| `moment-duration` | input de duración dentro del bloque |
| `moment-duration-field` | input de duración en PROPERTIES |
| `timeline-scrubber` | scrubber |
| `surface-corrientes` · `surface-pellegrini` · `surface-horizontal` | superficies del preview, con `data-output` |

Los `data-output` de las superficies permiten afirmar `live` / `hold` / `black`
sin leer píxeles.

## Qué costó la primera corrida

Cuatro fallas reales, por si reaparecen: faltaban `data-testid` en las
pestañas de navegación; el servidor servía un build viejo (hay que rebuildear
antes); `selectOption` no acepta regex en `label` (se usa el `value`); y
`moment-duration` existe una vez por moment, así que sin scope el locator es
ambiguo — se usa `moment-duration-field`.
