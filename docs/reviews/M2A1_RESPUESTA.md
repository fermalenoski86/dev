# M2A.1 — correcciones

**Los 7 puntos cerrados. 237 → 288 tests. Mutation check 38/38.
`install --frozen-lockfile`, `verify` y `build` con exit 0, sin warnings.**

Salida textual en `M2A1_SALIDA.txt`. Cero cambios en `show-engine` (salvo tres
escenas nuevas en el catálogo), `timeline`, `trust-3d`, `shared-types` y PREVIS.

---

## 1. Estado lógico vs. salud de dispositivo — ADR-020

Dos ejes, porque responden preguntas distintas:

| | Valores | Qué contesta |
|---|---|---|
| `logicalState` | LIVE / HOLD / BLACK / IDLE | qué pide el show-engine |
| `deviceHealth` | SIMULATED / ONLINE / OFFLINE / WARNING / CRITICAL / STALE | qué sabemos del dispositivo |

En M2A **todo dispositivo físico es SIMULATED**, y `SIMULATED` no cuenta como
verificado, así que nunca se pinta de verde. El header dice **SYSTEM
SIMULATED**, no SYSTEM ONLINE: decirlo sería afirmar que alguien comprobó el
edificio.

La salud se inyecta por parámetro, no se asume: el día que EDGE reporte de
verdad, la forma de la función no cambia.

## 2. Ciclo de vida de alarmas — ADR-021

`ACTIVATED` → `ESCALATED` → `DEESCALATED` → `RESOLVED`, con test del ciclo
completo y del caso obligatorio (UNDERVOLTAGE L1 warning → critical → warning →
desaparece).

**Encontré un bug que el pedido no mencionaba:** la identidad necesitaba
`metric`, no solo código + fase. `PHASE_IMBALANCE` se emite por tensión y por
corriente, ambas con `phase: null` — compartían clave y el ciclo las confundía:
una se "resolvía" cuando en realidad la tapaba la otra. Agregué `metric` a
`ElectricalAlarm` y hay un test que lo cubre.

**ACK no borra.** Reconocer es "la vi", no "la arreglé": la alarma sigue activa
hasta que desaparezca físicamente. Y **escalar invalida el ack**, porque es una
condición distinta de la que se vio; desescalar lo conserva.

Una condición estable no genera eventos repetidos: 50 muestras iguales → cero
eventos.

## 3. Modos coherentes con el preview — ADR-023

`requestedMode` (lo que el operador pidió) vs `effectivePreviewMode` (lo que el
estado muestra, **derivado del estado**). Cuando difieren, la UI muestra los dos
y el motivo: `SAFE_MODE`, `SHOW_TIMELINE`, `MANUAL_SCENE` o `NO_SHOW`.

`applyModeToState` aplica el modo como override de preview sobre el estado
resuelto, sin tocar el show package ni el motor.

Agregué tres escenas al catálogo (`brand_accent`, `event_bright`,
`iconic_signature`) porque BRAND, EVENT e ICONIC apuntaban todas a
`trust_normal`: con escenas compartidas el modo efectivo era ambiguo. Hay un
test que exige que cada modo tenga escena propia.

## 4. IA sin umbrales propios — ADR-024

No queda un solo número de umbral en `ai.ts`. El contexto trae las alarmas
evaluadas con **el umbral configurado que se cruzó**, más
`rules.configuredMetrics`, `rules.thresholdsAreDemo` y `rules.tariff` (hoy
`null`).

- Sin regla configurada, lo dice en vez de opinar.
- Sin cuadro tarifario, no afirma nada sobre facturación. Se fue la frase de la
  penalización.
- Aclara que la demanda máxima es aproximada, no el valor facturable.

Test clave: cambiar los umbrales cambia la respuesta **sin tocar el asistente**.

**Bug lateral que apareció al escribir los tests:** "¿Cómo está el factor de
potencia?" caía en la rama de estado general, porque `como esta` se evaluaba
antes que la rama específica. Reordené: lo específico primero.

## 5. Frescura del dato — ADR-022

`TelemetrySample` envuelve la medida con `measuredAt`, `receivedAt`, `ageMs`,
`quality` (LIVE / STALE / NO_DATA / COMM_ERROR) y `staleAfterMs`. Sobre
separado, no campo adentro: el estado de la comunicación no es una propiedad de
la medición, y mezclarlos es lo que permite que un valor viejo pase por actual.

El último valor se muestra como "última lectura"; `isUsableAsCurrent()` solo
acepta LIVE. La edad se mide contra `measuredAt`, no contra `receivedAt`.

En DEV hay un selector de falla de enlace (OK / SIN PUBLICAR / ERROR COMM) para
poder ver el comportamiento sin hardware.

## 6. Limpiezas del simulador

`energyMonthKwh` ahora usa el **mes calendario local real**, con la cantidad de
días que tenga ese mes. Hay un test que verifica que el 31 acumule 30 días
previos y el 1 del mes siguiente vuelva a cero — con los bloques ficticios de 30
días eso fallaba.

`peakDemandKw` quedó documentado como **aproximación operativa**, no el valor
fiscal de la distribuidora, y el asistente lo aclara al responder.

## 7. Tooling — los dos warnings, resueltos

**El de tsconfig no era del repo.** Rastreándolo encontré un `/tsconfig.json`
suelto en la raíz del filesystem, que dejé yo con un `cd` fallido en la primera
sesión de este proyecto. esbuild sube directorios y lo encontraba. Lo borré:
en una máquina limpia nunca habrían visto ese warning. Antes de eso probé dos
"arreglos" en `vitest.config.ts` que no servían y los revertí.

**El de Next ESLint:** `eslint: { ignoreDuringBuilds: true }` en ambas apps. No
agregué `eslint-config-next` a propósito: el lint del monorepo ya cubre estos
archivos desde la raíz con una configuración, y tener dos linters con reglas
distintas sobre el mismo código genera conflictos que nadie termina resolviendo.

---

## Resultados

```
pnpm install --frozen-lockfile   [exit 0]
pnpm verify                      [exit 0]   288 passed · lint limpio · 8 typechecks
pnpm build                       [exit 0]   previs ✓ · control ✓ · sin warnings
mutation-check                   38/38 atrapados
smoke test :3001                 GET / → 200
```

## Screenshots — no entregados

Sigue sin haber navegador en este entorno: no hay Chromium ni Playwright, y los
binarios no se descargan desde los registros npm disponibles. Verifiqué build y
servidor sirviendo, pero nadie vio la interfaz renderizada.

`pnpm --filter @trust/control dev` → `localhost:3001`.

## Pendientes

- Prueba visual de PREVIS y de CONTROL en navegador.
- Elección del analizador, mapa de registros, umbrales reales del proyecto
  eléctrico y datos de placa del tablero.
- Histéresis y temporización de alarmas (es de EDGE).
- Persistencia, para comparativos contra días anteriores.
- GLB + `TRUST_GEOMETRY_SPEC` del Digital Twin.
