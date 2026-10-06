# TRUST PLATFORM

Plataforma propia de **EL TRUST — Buenos Aires**: pantallas LED, iluminación
arquitectónica, cúpula y reloj, operados como una sola experiencia urbana.

Tres productos, un contrato compartido:

- **TRUST PREVIS** — digital twin para previsualizar campañas. *Milestone 1 cerrado.*
- **TRUST CONTROL** — centro de control operativo. *Milestone 2A: simulación, sin hardware.*
- **TRUST EDGE** — servicio local que ejecuta shows contra hardware real. *(pendiente)*

```bash
pnpm --filter @trust/previs dev     # :3000  digital twin
pnpm --filter @trust/control dev    # :3001  centro de control
```

> **Ningún dispositivo físico del edificio existe todavía.** CONTROL muestra dos
> ejes separados: `logicalState` (lo que pide el show) y `deviceHealth` (lo que
> sabemos del dispositivo) y `provenance` (SIMULATED o REAL — hoy simulado en
> todos). Una falla simulada se ve como CRITICAL y sigue sin contar como
> verificada. Ver ADR-020 y ADR-027.
>
> **El motor manda:** lo que CONTROL muestra sobre iluminación es exactamente lo
> que resuelve `ShowEngine`. El preview de modo solo se aplica si el show no
> maneja iluminación por timeline (ADR-025).
>
> **Nada de este repo habla con hardware.** No hay Modbus, DMX, Art-Net ni
> procesadores LED. Toda la telemetría eléctrica es **simulada** — ver
> `docs/architecture/ENERGY.md`.

## Arrancar

```bash
pnpm install
pnpm dev          # → http://localhost:3000
pnpm test         # suite completa
pnpm verify       # lint + typecheck + tests
pnpm typecheck
```

Requiere Node 20+ y pnpm 9+ (fijado en `engines`). Corre 100 % offline.

> El primer `pnpm install` genera `pnpm-lock.yaml`. **Commitealo**: sin lockfile
> la build no es reproducible y dos máquinas pueden resolver versiones distintas
> de three.js, que es exactamente el tipo de diferencia que aparece recién en el
> edificio.

## Estado — Milestone 1

| # | Objetivo | |
|---|---|---|
| 1 | Escena 3D del edificio simplificado | ✅ |
| 2 | Tres superficies de pantalla | ✅ |
| 3 | Asignar media a cada pantalla | ✅ vía show package |
| 4 | Reproducción sincronizada de las 3 | ✅ con tolerancia de deriva |
| 5 | Iluminación por zonas (12) | ✅ |
| 6 | Cambio entre 3 cámaras | ✅ |
| 7 | Cargar SHOW PACKAGE JSON | ✅ con validación Zod |
| 8 | Reproducir timeline | ✅ |
| 9 | Play / Pause / Stop / Seek | ✅ |
| 10 | Mostrar tiempo actual | ✅ |
| 11 | Cambio manual de LightingZone | ✅ |
| 12 | trust_normal / mcd_red_gold / safe_mode | ✅ |
| 13 | Estado de pantallas y zonas en UI | ✅ |

## Estado verificado

```
pnpm install --frozen-lockfile  →  exit 0 (lockfile único, 3029 líneas)
pnpm verify                     →  321 tests · lint limpio · typecheck limpio
pnpm build                      →  ✓ Compiled successfully · 4/4 páginas
python3 scripts/mutation-check.py → 47/47 reglas críticas atrapadas
```

Respuestas a las auditorías en `docs/reviews/`.

**Modelo de estado de pantalla** — tres conceptos separados:

| | Valores | Quién manda |
|---|---|---|
| `cue` | playing / paused / stopped | eventos `media.*` |
| transporte | playing / paused / stopped / ended | el operador |
| `output` | live / hold / black | derivado de ambos |

| Acción | Salida |
|---|---|
| PAUSE global | `hold` — frame congelado |
| STOP global | `black` — el show no está al aire |
| SAFE MODE | `black` + iluminación segura |

**Frame-lock** — cada show define sus `mediaGroups`: pantallas que comparten un
archivo y un decoder, con un recorte cada una. El edificio solo declara quién
*puede* agruparse (`syncCapableWith`). Lienzo superior actual: **2592 × 576**
(Corrientes 1152 + Pellegrini 1440, P6.67). Ver ADR-013.

**Estados de operación** — perder internet es `DEGRADED_OFFLINE` y la
programación sigue; `SAFE_MODE` es solo por causa local. Definición canónica en
`docs/architecture/OPERATING_STATES.md`.

> **El edificio no está modelado.** La geometría es placeholder. El Digital Twin
> arquitectónico se desarrolla aparte y entra como GLB + `TRUST_GEOMETRY_SPEC`.

## Chequeo visual pendiente

Nada de esto se ejecutó nunca en un navegador. Abrí `test_sync_001`, dale play y
mirá, en orden de probabilidad de encontrar algo:

1. **Play/pause/seek/stop durante 3 minutos.** Buscás tartamudeo o correcciones
   en bucle. Los umbrales de deriva (120/600 ms) son valores de partida, nunca
   medidos sobre un MP4 real.
2. **Barras rojas simultáneas** en A y B. Si aparecen en frames distintos, el
   decoder único falló.
3. **A dice "A · CORRIENTES" y B dice "B · PELLEGRINI".** Con el lienzo lado a
   lado ya no depende de la orientación vertical del UV.

## Por dónde entrar al código

| Si querés entender… | Leé |
|---|---|
| cómo funciona el todo | `docs/architecture/OVERVIEW.md` |
| por qué está hecho así | `docs/architecture/DECISIONS.md` |
| el formato de los shows | `docs/architecture/SHOW_PACKAGE.md` |
| la postura de seguridad | `docs/cybersecurity/PRINCIPLES.md` |
| cómo trabajar con dos IA | `docs/ai-workflow/CLAUDE_Y_CHATGPT.md` |
| el motor | `packages/show-engine/src/resolve.ts` |
| la geometría del edificio | `packages/show-engine/src/building.ts` |

## Regla de oro

La lógica de show vive en `packages/show-engine`. **Nunca** en un componente React.

Si mañana EDGE tiene que ejecutar el mismo show contra procesadores LED reales,
importa ese paquete y listo. Todo `if` sobre tipos de evento que aparezca en la
UI es un bug de arquitectura.

## Supuestos pendientes de confirmar

- Medidas de la pantalla horizontal (hoy 14 × 3 m, inventadas).
- Si la horizontal comparte procesador y reloj de video con A y B (hoy declarada
  capaz de sincronizar; ver `building.ts`).
- Posición exacta de A y B en la torre.
- Agrupación real de las ~78 luminarias en las 12 zonas lógicas.
- Alturas del edificio (hoy estimadas para que la masa cierre visualmente).

Todo eso sale del relevamiento físico y se reemplaza en `building.ts` sin tocar
una línea del motor.
