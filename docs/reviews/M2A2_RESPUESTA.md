# M2A.2 — gate final de CONTROL

**Los 6 puntos cerrados. 288 → 321 tests. Mutation check 47/47.
`verify` y `build` con exit 0.**

Salida textual en `M2A2_SALIDA.txt`, diff en `M2A2.patch` (+1242 / −173 sobre 17
archivos). Sin cambios de arquitectura ni de stack.

---

## 1. El motor es la verdad — ADR-025

**Era un bug que introduje yo en M2A.1.** `applyModeToState` corría en cada tick
sobre `engine.getState()`, así que la escena del modo pisaba permanentemente el
timeline: la respiración de la cúpula de `trust_signature_001` quedaba anulada
por NORMAL, y un `lighting.scene: mcd_red_gold` no se veía nunca.

CONTROL mostraba un edificio distinto del que el motor resolvía. Un panel de
supervisión que contradice al motor no sirve para supervisar.

Tres cosas separadas:

| | Qué es |
|---|---|
| `engineState` | verdad inmutable del ShowEngine |
| `requestedMode` | lo que el operador eligió |
| `previewState` | lo que se pinta: `engineState`, salvo override habilitado **y** show que no ilumina |

**Regla dura: el timeline siempre gana.** `resolvePreviewState` devuelve el
**mismo objeto** `engineState` cuando no hay override, así una comparación por
identidad basta para verificar que no se tocó.

El override arranca **deshabilitado**: previsualizar un modo es una acción
explícita, no el estado por defecto.

**Tests obligatorios, ambos pasando:**
- `trust_signature_001` a los 16–20 s: lo mostrado es exactamente lo del motor,
  la cúpula se mueve más de 0.05 en esa ventana, y el valor fijo de
  `trust_normal` no es lo que se ve durante el fade.
- `mcdonalds_takeover_001` a los 9.5 s: `mcd_red_gold` visible, torre en rojo,
  `result.state === engineState`.

Agregué uno más que recorre los dos shows completos cada 500 ms verificando
identidad de objeto en cada paso.

## 2. Una sola fuente de verdad eléctrica — ADR-026

El snapshot leía `telemetry.status`; ENERGY leía el `AlarmRegistry`. Bastaba
construir la telemetría sin pasar por `withAlarms` para que Overview dijera
"normal" mientras ENERGY mostraba un PHASE_LOSS.

`deriveElectricalHealth(sample, alarms)` es el único camino. Test con
`SimulatedTelemetryProvider` real: PHASE_LOSS → alarma CRITICAL **y** resumen
CRITICAL. Y el caso inverso: `telemetry.status: 'critical'` sin alarmas
evaluadas no inventa una crítica.

Una condición crítica gana sobre STALE: medida hace 30 s sigue siendo crítica.

## 3. `provenance` ortogonal a `health` — ADR-027

`SIMULATED` era un valor de salud, y eso mezclaba "cómo está" con "cómo lo
sabemos". Una falla simulada no tenía cómo expresarse sin perder la marca.

- `health`: ONLINE / WARNING / CRITICAL / STALE / OFFLINE
- `provenance`: SIMULATED / REAL

`hasVerifiedDevices` mira **solo** provenance. Hay un test que recorre las 15
combinaciones de escenario × modo de falla y verifica que ninguna lo vuelva
true.

## 4. Las series no inventan puntos — ADR-028

`resolveSeriesWindow` recorta la ventana a `measuredAt` cuando la calidad no es
LIVE y devuelve el hueco, que el gráfico raya como período sin datos.

Con el enlace caído, graficar hasta "ahora" es inventar historia: la curva
seguiría dibujándose prolija mientras el medidor no responde.

## 5. ACK sincronizado — ADR-029

El reconocimiento vivía en dos lados sin hablarse: se podía reconocer una alarma
y que el contador del header siguiera en 1. Un panel donde el operador reconoce
algo y el número no baja es un panel donde el operador deja de reconocer cosas.

`acknowledgeAlarm` y `acknowledgeAll` operan sobre registro y log, y emiten
`ALARM_ACKNOWLEDGED` con actor, condición y severidad. `isAckConsistent()`
expone la invariante.

Cubierto: ACK individual, ACK ALL sin pendientes en ninguno de los dos lados,
que el ACK no borre la alarma, que reconocer dos veces no duplique eventos, y
que una condición que escala vuelva a quedar pendiente.

## 6. Sin afirmaciones tarifarias

La alarma de factor de potencia ahora dice valor y umbral. Un test recorre los
seis escenarios y verifica que ninguna alarma mencione "penaliza", "factura" ni
"tarif".

---

## Dos cosas que encontró el proceso, no el pedido

**Un hueco de tests.** El mutation check dejó un sobreviviente: nada verificaba
que una pantalla en BLACK por decisión del show no degradara la salud del
dispositivo. Si eso pasara, cada STOP encendería alarmas falsas — justo la
confusión que el punto 3 busca evitar. Agregué el test; quedó atrapado.

**Un defecto del propio script.** Al cortarse por timeout, `mutation-check.py`
dejó el repo con una mutación aplicada, y por un rato tuve dos tests "fallando
solos" sin que nadie hubiera tocado nada. Le puse restauración garantizada con
`atexit` y manejo de SIGINT/SIGTERM/SIGHUP.

---

## Resultados

```
pnpm verify        [exit 0]   321 passed · lint limpio · 8 typechecks
pnpm build         [exit 0]   previs ✓ · control ✓
mutation-check     47/47 atrapados
smoke test :3001   GET / → 200 · "MASTER OF TRUST — Control Center"
```

## Pendiente, y no lo puedo cerrar yo

**La prueba visual.** Sigue sin haber navegador en este entorno. Verifiqué
build, servidor sirviendo y typecheck, pero nadie vio la interfaz renderizada.

Lo que conviene mirar en `localhost:3001`, en orden:

1. **Cargar `trust_signature_001` y darle play.** Entre los 16 y 20 s la cúpula
   tiene que respirar. Si queda fija, el punto 1 no cerró en runtime aunque los
   tests pasen.
2. **Marcar "Previsualizar la escena del modo" con ese show cargado.** No debe
   cambiar nada, y tiene que aparecer el aviso de que el show maneja la
   iluminación.
3. **Forzar ERROR COMM en la barra DEV.** Los gráficos tienen que congelarse y
   rayarse en el tramo final, no seguir dibujando.
4. **Forzar PHASE_LOSS y reconocer.** El contador del header tiene que bajar a
   cero y la alarma seguir listada como activa.

**Lo demás** sigue igual: elección del analizador, mapa de registros, umbrales
reales del proyecto eléctrico, datos de placa del tablero, y el GLB +
`TRUST_GEOMETRY_SPEC` del Digital Twin.
