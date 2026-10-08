# Registro de decisiones (ADR)

## ADR-001 — El estado se recalcula, no se muta
**Fecha:** 2026-09 · **Estado:** aceptada

Un reductor incremental no puede deshacer fades a medio camino al seekear.
`state(t)` como fold puro desde el inicio elimina la clase entera de bugs de
desincronización, a coste O(n) por frame — despreciable a esta escala.

**Consecuencia:** el motor no tiene estado interno mutable. Todo sale del tiempo.

## ADR-002 — El reloj es inyectable
**Fecha:** 2026-09 · **Estado:** aceptada

`Transport` recibe `now()` por constructor. Permite testear sin timers y, más
importante, deja que EDGE use un reloj sincronizado (PTP/NTP) en lugar de
`performance.now()` cuando haya que sincronizar varias superficies o edificios.

## ADR-003 — RGBW, no RGB
**Fecha:** 2026-09 · **Estado:** aceptada

Las luminarias arquitectónicas reales tienen canal blanco dedicado. Modelar solo
RGB obliga a simular el blanco mezclando, que da un blanco sucio y consume más
potencia. El canal W separado es además lo que hace posible el "cálido elegante"
como estado base en vez del look discoteca.

## ADR-004 — SAFE MODE es primitiva, no escena
**Fecha:** 2026-09 · **Estado:** aceptada

Si SAFE MODE fuera una escena más del catálogo, la programación normal podría
pisarla. Como primitiva del motor, `enterSafeMode()` bloquea cualquier `play()`
posterior hasta salida explícita. Ver `docs/cybersecurity/PRINCIPLES.md` §4.

## ADR-005 — hero_3d es una cámara fija
**Fecha:** 2026-09 · **Estado:** aceptada

El contenido anamórfico se genera para un punto de vista exacto. Si esa cámara se
puede orbitar, el efecto 3D deja de cerrar. El flag `locked` vive en la config
del edificio, no en la UI, para que ninguna interfaz futura pueda saltárselo.

## ADR-006 — Aspect ratio desde medidas físicas, no desde resolución
**Fecha:** 2026-09 · **Estado:** aceptada

Las pantallas LED no siempre tienen píxeles cuadrados. 9.60 × 3.84 m con
1440 × 576 px da 2.5:1 por ambos caminos hoy, pero al cerrar la pantalla
horizontal eso puede no cumplirse. La geometría manda sobre la resolución.

## ADR-007 — Las transiciones viven en el motor, no en el renderer
**Fecha:** 2026-09 · **Estado:** aceptada · **Reemplaza conducta previa a REVIEW-001**

`fadeMs` existía en el schema pero el motor aplicaba saltos y el renderer hacía
la transición con `useFrame(delta)`. Consecuencia: `state(t)` era determinista
y la imagen no. Seekear a 25s y reproducir hasta 25s daban el mismo estado y
píxeles distintos — exactamente el bug que el determinismo existía para evitar.

Ahora cada zona guarda una transición `(desde, hasta, startMs, fadeMs)` y
`resolveStateAt(t)` devuelve el valor ya interpolado. El renderer no tiene
semántica temporal propia.

**Interpolación lineal**, como una consola de iluminación real. Un fade
exponencial dependiente de `delta` no es reproducible entre máquinas con
distinto framerate, y EDGE tiene que poder calcular el mismo valor sin render.

**Consecuencia para EDGE:** el valor DMX de cada zona en cada ms se puede
calcular offline, sin motor gráfico. Eso es lo que permite que EDGE emita a
40 Hz constantes contra hardware sin depender de un navegador.

## ADR-008 — Preflight separado de la validación de schema
**Fecha:** 2026-09 · **Estado:** aceptada

Zod valida forma; `preflightShow()` valida contexto: escenas que existan,
eventos dentro de la duración, media declarada para toda pantalla que se
reproduce, zonas y cámaras reales.

Errores bloquean la carga. Warnings no, pero se muestran: incluyen dos reglas
de negocio — que A y B arranquen en el mismo ms (si no, el anamórfico no cierra)
y que el show no termine con la iluminación de la marca puesta.

## ADR-009 — `cue` y `output` son cosas distintas
**Fecha:** 2026-09 · **Estado:** aceptada · **Origen:** REVIEW-002 P0-1, P0-2

`playing` cumplía tres roles a la vez: lo que comandó el timeline, si el show
corre, y qué se ve. Consecuencias: pausar el show no pausaba los videos (cue
seguía en `playing`, el actuador llamaba `play()` contra un target congelado), y
`pause`, `stop` y SAFE MODE se veían igual.

Separado en:

- **`cue`** (`playing` / `paused` / `stopped`) — lo que ordenó el timeline.
- **transporte** — si el show corre. Lo sabe `ShowEngine`, no el timeline.
- **`output`** (`live` / `hold` / `black`) — lo que se ve, derivado de ambos.

`resolveStateAt(show, ctx, t, { transport, safeMode })` sigue siendo pura: el
estado del transporte entra como argumento, no como efecto.

**`black` es negro real**, opacidad 0 sobre un panel negro. Dejar el 12% del
último frame de una marca visible en un edificio en modo seguro era exactamente
lo que SAFE MODE existe para evitar.

## ADR-010 — Frame-lock por decoder único
**Fecha:** 2026-09 · **Estado:** aceptada; el mecanismo `syncGroup` fue reemplazado por ADR-013 · **Origen:** REVIEW-002 P1-5

Dos `<video>` independientes derivan entre sí. 120 ms de tolerancia son ~3,6
frames a 30 fps: suficiente para que la ilusión anamórfica se abra en la ochava,
que es justo donde la gente la mira.

Solución: grupos de pantallas que comparten **un** archivo y por lo tanto **un**
decoder; cada una recorta su región vía `uvRect`. Un decoder no puede
desincronizarse consigo mismo. (En V3 el grupo se declaraba en el edificio con
`syncGroup`; desde V3.1 lo declara el show — ver ADR-013.)

Implementación: `MediaTextureManager` indexa por URL de fuente. Las vistas
recortadas son `Texture.clone()` que comparten el `image` (el mismo elemento
`<video>`) y difieren sólo en `offset`/`repeat`.

**Consecuencia para producción de contenido:** el anamórfico se autorea como un
lienzo único apilado, no como dos archivos. Eso hay que bajárselo a quien
produzca el contenido antes de que entregue dos MP4 separados.

El objetivo de sincronía pasa de 120 ms a **1 frame (33 ms)**, y preflight lo
bloquea como error, no como advertencia.

## ADR-011 — Cámara: modo interactivo vs. determinista
**Fecha:** 2026-09 · **Estado:** aceptada · **Origen:** REVIEW-002 P1-4

`interactive` suaviza por `delta` — cómodo para navegar mientras se programa,
pero dependiente del framerate. `deterministic` corta exacto al preset.

Sólo el modo determinista es válido para aprobar contenido con un cliente o
comparar dos corridas. Además es lo honesto: un `camera.switch` en el edificio
real es un cambio de plano, no un dolly. Suavizarlo en PREVIS vende una
transición que no existe.

## ADR-012 — La clave de firma no vive en CONTROL
**Fecha:** 2026-09 · **Estado:** aceptada · **Origen:** REVIEW-002 (seguridad)

"Un compromiso del cloud no debe poder encender una luz" no se cumple si CONTROL
publica paquetes firmados **y además** tiene la clave de firma. Comprometer
CONTROL sería comprometer la firma.

Para CONTROL/EDGE:

1. **Clave en KMS/HSM**, no en el proceso de CONTROL. CONTROL pide una firma; no
   puede extraer la clave.
2. **La firma requiere aprobación humana** (los cuatro ojos del §6). Un CONTROL
   comprometido puede pedir firmas, no obtenerlas solo.
3. **EDGE impone límites a paquetes válidamente firmados.** Una firma prueba
   origen, no que el contenido sea seguro. EDGE rechaza lo que viole brillo
   máximo, restricción horaria o límite de parpadeo, venga firmado o no.

El punto 3 es el que importa: la última línea de defensa es local y no confía en
nadie aguas arriba. Sin eso, la firma sólo mueve el problema de lugar.

## ADR-013 — `mediaGroups` por show, capacidad en el edificio
**Fecha:** 2026-09 · **Estado:** ✅ implementada (Gate V3.1) · **Origen:** REVIEW-003 P1-4

La V3 tenía `syncGroup: "towers"` fijo en `ScreenSurface`: el edificio decidía
quién compartía decoder. Eso mezclaba dos cosas:

| | Qué es | Dónde vive |
|---|---|---|
| **Capacidad** | qué pantallas *pueden* compartir decoder (procesador, reloj de video, latencia) | edificio — `ScreenSurface.syncCapableWith` |
| **Membresía** | qué pantallas comparten decoder *en esta campaña* | show — `ShowPackage.mediaGroups` |

### Qué cambió

- `ScreenSurface.syncGroup` → `ScreenSurface.syncCapableWith: ScreenId[]`.
- `resolveStateAt` busca cada pantalla en los `mediaGroups` **del show**. Si
  aparece en un layout, toma fuente y recorte del grupo; si no, usa `media`.
- `MediaGroup.canvas` opcional (`{ width, height }` en px).
- `uvFromPixels(canvas, rect)`: convierte px del lienzo (origen arriba, como
  piensa producción de contenido) a UV (origen abajo, como muestrea three).

### Por qué no rompe SHOW PACKAGE v1

`mediaGroups` ya estaba en el show desde V3. Lo que cambió es quién decide la
membresía, y eso es config del edificio, no contrato del show. Los shows v1
existentes siguen siendo válidos sin migración.

### Reglas de preflight

| Código | Severidad | Regla |
|---|---|---|
| `GROUP_NOT_SYNC_CAPABLE` | error | cada par del grupo tiene que ser mutuamente capaz |
| `SCREEN_IN_MULTIPLE_GROUPS` | error | una pantalla tiene un solo decoder |
| `GROUP_ASPECT_MISMATCH` | error | con `canvas`, el recorte respeta el aspecto físico (±2 %) |
| `GROUP_SCREEN_NOT_FOUND` | error | el layout no puede nombrar pantallas inexistentes |
| `GROUP_SINGLE_MEMBER` | warning | un grupo de uno no aporta frame-lock |

Si por error una pantalla está en dos grupos, `resolve` es igual determinista
(gana el primer grupo por id ordenado), pero preflight lo bloquea antes.

### Caso actual

| Pantalla | Medida | P6.67 | Recorte en el lienzo |
|---|---|---|---|
| screen_a — Corrientes | 7,68 × 3,84 m | 1152 × 576 | x 0 → 1152 |
| screen_b — Pellegrini | 9,60 × 3,84 m | 1440 × 576 | x 1152 → 2592 |
| **Lienzo superior** | | **2592 × 576** | |

Efecto lateral: con lienzo lado a lado ambas pantallas usan `h = 1`, así que la
ambigüedad de orientación vertical del UV que venía de V2 deja de afectar a las
torres. Solo importa X, que three no invierte.

### A+B+horizontal

Soportado sin cambiar el motor: un show declara un grupo con las tres y un lienzo
que las contenga. Testeado con un lienzo de 2592 × 988 (torres arriba, horizontal
abajo) y las tres con el mismo `mediaTimeMs` en todo el show.

**Supuesto marcado en `building.ts`:** que la horizontal comparta procesador y
reloj de video con A y B. Hoy está declarada capaz. Hay que confirmarlo con el
integrador **antes de vender** un takeover A+B+horizontal frame-locked; si no se
cumple, se saca de `syncCapableWith` y preflight bloquea cualquier show que lo
intente.

## ADR-014 — Los shows referencian assets, no URLs
**Fecha:** 2026-09 · **Estado:** propuesta; guard interino implementado · **Origen:** REVIEW-003 P1-3

### El problema

Un SHOW PACKAGE es un JSON que va a venir de afuera: de una agencia, de un
cliente, de CONTROL. Hoy puede decir `"source": "http://192.168.1.20/admin"` y el
reproductor del edificio hace esa request.

Dos riesgos distintos:

1. **Seguridad.** Un show se vuelve vector para que el reproductor emita
   requests a la red interna del edificio o a terceros. La respuesta, o incluso
   el tiempo que tarda, es información.
2. **Operación.** Una URL externa hace que la pauta dependa de un servidor ajeno.
   Contradice la operación offline (`OPERATING_STATES.md`).

### Decisión

En SHOW PACKAGE v2 el campo deja de ser URL y pasa a ser referencia de contenido:

```json
"media": { "horizontal": { "assetId": "sha256:3f9a…c21e" } },
"mediaGroups": { "towers": { "assetId": "sha256:9b01…77aa", "canvas": { … }, "layout": { … } } }
```

| Principio | Consecuencia |
|---|---|
| **El hash es la identidad** | La firma del paquete ata el contenido, no solo un nombre de archivo |
| **Ingesta solo por CONTROL** | Un show no introduce contenido, solo lo referencia. La ingesta valida, transcodifica y calcula el hash |
| **Resolución local** | PREVIS → `/assets/<hash>`; EDGE → su caché en disco. Ninguno hace una request a un destino que eligió el show |
| **Verificación antes de emitir** | EDGE recalcula el hash del archivo antes de reproducir. Archivo corrupto o sustituido → SAFE MODE (contenido inválido) |
| **Sin URL como escape** | v2 no acepta `source` libre ni siquiera como opción. Si existe, alguien la va a usar |

### Qué hay implementado hoy (interino)

`isLocalMediaPath()` + regla de preflight `MEDIA_SOURCE_NOT_LOCAL`. Un show v1
solo puede apuntar a rutas locales absolutas del propio servidor.

Rechaza: cualquier esquema (`http:`, `https:`, `file:`, `data:`, `blob:`,
`javascript:`), protocol-relative (`//host`), rutas relativas, `..`, barras
invertidas y caracteres de control. Cubierto por tests y por el mutation check.

**No reemplaza a este ADR.** No hay hash, ni ingesta, ni verificación de
integridad: una ruta local puede apuntar a cualquier archivo que esté en el
servidor. Impide lo peor mientras tanto.

### Por qué el resto no se implementa ahora

Necesita el pipeline de ingesta de CONTROL, que no existe. Implementarlo hoy
sería construir media función sin dónde conectarla.

**Bloqueante para CONTROL/EDGE:** ningún show de producción sale del repo hasta
que esto esté.

## ADR-015 — Modo de render frame-exacto para aprobación contractual
**Fecha:** 2026-09 · **Estado:** propuesta, NO implementada · **Origen:** REVIEW-003 P2-9

El playback interactivo con `video.currentTime` y tolerancia de deriva es
correcto para edición, pero no para generar el MP4 que una marca firma como
aprobación. Dos corridas pueden diferir en un frame según carga de CPU.

Propuesta: un modo `render` que avance el show en pasos fijos de `1000/fps` ms,
espere a que cada `<video>` reporte el frame exacto (`requestVideoFrameCallback`)
y recién ahí capture el canvas. Sin tiempo de pared: el reloj del show lo maneja
el renderer, no el sistema.

El motor ya lo permite —`resolveStateAt(t)` es pura y la cámara determinista ya
existe—, así que es trabajo de la capa de render, no de arquitectura.

Va después del relevamiento: renderizar con precisión de frame una geometría
inventada no aprueba nada.

## ADR-016 — La telemetría simulada es una función pura del tiempo
**Fecha:** 2026-09 · **Estado:** ✅ implementada (Milestone 2A)

`sampleTelemetry(seed, escenario, t)` no acumula estado. Misma entrada, misma
salida, siempre. Es la misma decisión que ADR-001 para el show-engine, aplicada
a los datos eléctricos.

No es purismo. Un simulador con estado genera la serie histórica por un camino
y el valor en vivo por otro, y tarde o temprano **el gráfico de 24 h contradice
al número grande de la pantalla**. En un panel de operación eso no es un bug
cosmético: destruye la confianza en todo lo demás que muestra el panel, incluido
lo que sí es correcto.

Consecuencias:
- La serie de tendencias es literalmente el mismo muestreo que la lectura en
  vivo. Hay un test que lo verifica punto por punto.
- Un comportamiento raro se reproduce con `(seed, escenario, t)`. No existe
  "se veía mal ayer".
- Los tests no necesitan timers ni esperas.

El ruido es suave (interpolación smoothstep entre valores de hash), no
independiente entre muestras: un analizador real no salta de 62 A a 71 A entre
dos lecturas consecutivas.

## ADR-017 — El simulador no decide alarmas
**Fecha:** 2026-09 · **Estado:** ✅ implementada (Milestone 2A)

`sampleTelemetry` devuelve siempre `status: 'normal'` y `alarmCodes: []`.
Evaluar condiciones es trabajo de `evaluateAlarms(telemetría, umbrales, specs)`,
que es otra función pura.

Si el simulador marcara las alarmas, no habría forma de testear el evaluador:
se estaría verificando que el generador de datos coincide consigo mismo.
Separados, el evaluador se puede probar contra datos construidos a mano y, más
importante, **es el mismo evaluador que va a correr contra datos reales** —
cambiar de simulador a Modbus no toca una línea de la lógica de alarmas.

**Los umbrales de `DEMO_THRESHOLDS` son de demostración, no de ingeniería.**
Están elegidos para que los escenarios disparen algo visible. Los definitivos
salen del proyecto eléctrico y los firma alguien con matrícula.

Todavía no hay histéresis ni temporización. Eso es de EDGE, donde importa no
disparar una alarma por un transitorio de 200 ms.

## ADR-018 — La restricción "advisory only" se sostiene con tipos
**Fecha:** 2026-09 · **Estado:** ✅ implementada (Milestone 2A)

> LLM output is advisory only and cannot directly actuate building hardware.

Un comentario que dice esto no impide nada. Acá la garantía es estructural:

- `AiContext` es **solo datos** — números, strings, booleanos. Nada de
  funciones, handles, referencias a `ShowEngine` ni al provider. Un test
  serializa el contexto entero y verifica que sobreviva un `JSON.parse(JSON.stringify(...))`.
- `AiAssistant.ask()` devuelve `AiAnswer`, que tiene `text`, `usedFields`,
  `simulated` y `advisoryOnly: true`. No hay campo por el cual una respuesta
  pueda expresar una acción, ni quien la ejecute.

El resultado: para que la IA pudiera accionar algo, alguien tendría que agregar
el tipo que lo permita. Eso es una decisión visible en un diff, no un accidente.

`usedFields` acompaña cada respuesta: cuando entre un LLM real, esa trazabilidad
es lo que permite auditar de dónde salió una afirmación.

## ADR-019 — El provider Modbus falla ruidosamente en vez de devolver ceros
**Fecha:** 2026-09 · **Estado:** ✅ implementada (Milestone 2A)

`ModbusTelemetryProvider` existe como tipo pero su constructor lanza error.

La alternativa —devolver ceros o valores plausibles hasta que se implemente— es
la forma más rápida de que alguien mire un panel con `simulated: false` y crea
que el edificio está medido cuando no lo está. Un dato eléctrico falso que se
presenta como real es peor que la ausencia de dato.

Cuando se implemente, **va a vivir en TRUST EDGE, no en el navegador**
(PRINCIPLES.md §2). El frontend nunca habla Modbus: EDGE lee el analizador y
publica esta misma forma de dato por la API.

Lo mismo aplica a la bandera `simulated`, que es obligatoria en el schema: no se
puede omitir por olvido, y un test lo verifica.

## ADR-020 — Estado lógico y salud de dispositivo son ejes separados
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.1) · **Origen:** M2A.1 punto 1

Un subsistema tenía un solo estado, y una pantalla aparecía `ONLINE` en verde
sin que exista ningún hardware conectado. Un panel de operación no puede
presentar como verificado algo que nadie verificó.

Dos ejes, porque responden preguntas distintas:

| | Valores | Qué contesta |
|---|---|---|
| `logicalState` | LIVE / HOLD / BLACK / IDLE | qué pide el show-engine |
| `deviceHealth` | SIMULATED / ONLINE / OFFLINE / WARNING / CRITICAL / STALE | qué sabemos del dispositivo |

El show-engine puede decir LIVE con total legitimidad: describe la intención
del show, no el estado de un LED en la calle. En Milestone 2A **todo
dispositivo físico es SIMULATED**, y `SIMULATED` no cuenta como verificado
(`DEVICE_HEALTH_IS_VERIFIED`), así que nunca se pinta de verde ni el header
dice "SYSTEM ONLINE".

El eléctrico es la excepción parcial: su salud sí puede degradarse, porque la
frescura del dato se mide aunque el dato sea simulado (ADR-022).

La salud se inyecta por parámetro (`deviceHealth`), no se asume: el día que
EDGE reporte de verdad, la forma de la función no cambia.

## ADR-021 — Las alarmas tienen ciclo de vida, no presencia
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.1) · **Origen:** M2A.1 punto 2

Antes se guardaba un `Set<string>` de códigos reportados. Eso solo distingue
"estaba" de "no estaba": **una subtensión que empeoraba de warning a critical
no generaba ningún evento**, porque la condición ya estaba en el Set. El
sistema se quedaba callado justo cuando la situación se agravaba.

Ahora se recuerda el estado anterior de cada condición y se emiten
transiciones: `ACTIVATED`, `ESCALATED`, `DEESCALATED`, `RESOLVED`.

**La identidad es `código + fase + métrica`.** La métrica no es decoración:
`PHASE_IMBALANCE` se emite por tensión y por corriente, ambas con `phase: null`.
Sin `metric` compartían clave, y el ciclo de vida las confundía — una se
"resolvía" cuando en realidad la tapaba la otra.

`diffAlarms` es pura (estado anterior + actual → transiciones); el estado vive
en `AlarmRegistry`.

**Reconocer no borra.** El ack registra que alguien vio la condición, no que la
arregló: la alarma sigue activa hasta que desaparezca físicamente. Y **escalar
invalida el ack**, porque es una condición distinta de la que se vio;
desescalar lo conserva.

Una condición estable no genera eventos repetidos: sin esto el log sumaría 3600
entradas por hora y dejaría de servir.

## ADR-022 — La frescura del dato es un sobre, no un campo
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.1) · **Origen:** M2A.1 punto 5

Cuando EDGE lea Modbus y el analizador deje de responder, la tentación del
código es conservar el último valor. El panel muestra 47,3 kW con un punto
verde y nadie se entera de que ese número es de hace veinte minutos.

`TelemetrySample` envuelve la medida con `measuredAt`, `receivedAt`, `ageMs`,
`quality` (LIVE / STALE / NO_DATA / COMM_ERROR) y `staleAfterMs`. Es un sobre
**separado** porque el estado de la comunicación no es una propiedad de la
medición, y mezclarlos es lo que permite que un valor viejo se presente como
actual.

El último valor sí se muestra, etiquetado como "última lectura". Lo que no
puede es seguir pareciendo ONLINE: `isUsableAsCurrent()` solo acepta LIVE.

La edad se mide contra `measuredAt`, no contra `receivedAt`: importa cuán viejo
es el número, no cuándo llegó el paquete. Un error de comunicación gana sobre
cualquier cálculo de edad.

`staleAfterMs` por defecto 5 s: con un analizador a 1 Hz tolera cuatro lecturas
perdidas sin alarmar por un hipo de red. Configurable, porque el valor correcto
depende de la cadencia del equipo, que no está elegido.

## ADR-023 — El modo pedido y el efectivo se muestran por separado
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.1) · **Origen:** M2A.1 punto 3

El modo era una etiqueta suelta: la UI podía decir `MODE = TAKEOVER` mientras
el `showState` mostraba `trust_normal`. Un panel que afirma un estado que su
propia vista contradice es peor que un panel sin esa etiqueta.

La solución no es que el modo comande algo — sigue sin tocar hardware — sino
separar `requestedMode` (lo que el operador pidió) de `effectivePreviewMode`
(lo que el estado simulado muestra, **derivado del estado**, no de la
intención). Cuando coinciden, la UI muestra uno; cuando no, muestra los dos y
el motivo: `SAFE_MODE`, `SHOW_TIMELINE`, `MANUAL_SCENE` o `NO_SHOW`.

Es la misma disciplina que `cue` vs `output` (ADR-009): lo pedido y lo efectivo
son cosas distintas.

`applyModeToState` aplica el modo como override de **preview** sobre el estado
resuelto, sin tocar el show package ni el motor, y sin fade: es la selección de
un operador en un panel, no una transición programada.

Cada modo tiene escena propia (`trust_normal`, `brand_accent`, `mcd_red_gold`,
`event_bright`, `iconic_signature`) — si dos compartieran escena, el modo
efectivo sería ambiguo. Hay un test que lo impide.

## ADR-024 — El asistente no tiene criterio técnico propio
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.1) · **Origen:** M2A.1 punto 4

`MockAiAssistant` traía sus umbrales hardcodeados (15/25 % de desequilibrio,
0,92/0,85 de factor de potencia) y afirmaba "riesgo de penalización en
factura". Dos problemas:

1. **Duplicación de criterio.** Cambiar `DEMO_THRESHOLDS` dejaba al asistente
   evaluando con los viejos. Dos fuentes de verdad sobre cuándo algo está mal,
   y la que le habla al operador es la que nadie actualiza.
2. **Afirmación sin base.** La penalización por bajo factor de potencia depende
   del cuadro tarifario de la distribuidora, que no está cargado en ningún
   lado. Decirlo igual es inventar una consecuencia económica.

`evaluateAlarms()` es la única autoridad. El contexto trae las alarmas
evaluadas con **el umbral configurado que se cruzó**, más
`rules.configuredMetrics`, `rules.thresholdsAreDemo` y `rules.tariff` (hoy
`null`). El asistente lee y explica.

Cuando no hay regla configurada para algo, lo dice, en vez de opinar. Sin
cuadro tarifario, no afirma nada sobre facturación. Y aclara que la demanda
máxima es una aproximación operativa, no el valor facturable.

No queda un solo número de umbral en `ai.ts`. Hay un test que cambia los
umbrales y verifica que la respuesta cambie sin tocar el asistente.

## ADR-025 — El motor es la verdad; el modo es un preview opcional
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.2) · **Origen:** M2A.2 punto 1

`applyModeToState` corría en **cada tick** sobre `engine.getState()`, así que la
escena del modo pisaba permanentemente lo que el timeline del show estaba
haciendo: la respiración de la cúpula de `trust_signature_001` quedaba anulada
por el modo NORMAL, y un `lighting.scene: mcd_red_gold` no se veía nunca.

CONTROL mostraba un edificio distinto del que el motor resolvía. Un panel de
supervisión que contradice al motor no sirve para supervisar.

Tres cosas separadas:

| | Qué es |
|---|---|
| `engineState` | verdad inmutable del ShowEngine. Nunca se modifica |
| `requestedMode` | lo que el operador eligió |
| `previewState` | lo que se pinta: `engineState`, salvo override habilitado **y** show que no ilumina |

**Regla dura: el timeline siempre gana.** Si el show tiene eventos
`lighting.scene` o `lighting.zone.set`, el override no se aplica y la
divergencia se informa (`SHOW_TIMELINE`), no se resuelve pisando al motor.

`resolvePreviewState` devuelve el **mismo objeto** `engineState` cuando no hay
override, así una comparación por identidad basta para verificar que no se tocó.
Hay tests que recorren `trust_signature_001` y `mcdonalds_takeover_001` completos
verificando `result.state === engineState` en cada paso.

El override arranca **deshabilitado**: previsualizar un modo es una acción
explícita, no el estado por defecto.

## ADR-026 — Una sola fuente de verdad para el estado eléctrico
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.2) · **Origen:** M2A.2 punto 2

El snapshot de sistema leía `telemetry.status`; ENERGY leía el `AlarmRegistry`.
Dos caminos para la misma pregunta. Bastaba construir la telemetría sin pasar
por `withAlarms` para que Overview dijera "normal" mientras ENERGY mostraba un
PHASE_LOSS.

`deriveElectricalHealth(sample, alarms)` es ahora el único camino: combina
calidad del dato y alarmas del registro. `telemetry.status` no se consulta desde
el snapshot.

Una condición crítica gana sobre STALE: medida hace 30 s sigue siendo crítica.

## ADR-027 — `provenance` es ortogonal a `health`
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.2) · **Origen:** M2A.2 punto 3

`SIMULATED` era un valor de salud, y eso mezclaba "cómo está" con "cómo lo
sabemos". Una falla simulada no tenía cómo expresarse sin perder la marca: o se
veía CRITICAL (y parecía real) o SIMULATED (y la falla desaparecía).

- `health`: ONLINE / WARNING / CRITICAL / STALE / OFFLINE
- `provenance`: SIMULATED / REAL

Un PHASE_LOSS simulado es `CRITICAL` + `SIMULATED`: la falla se ve y sigue
constando que nadie midió nada. `hasVerifiedDevices` mira **solo** provenance,
así que ninguna falla simulada puede volverlo true — si pudiera, una alarma de
mentira convertiría el panel en "verificado".

El estado lógico tampoco contamina la salud: una pantalla en BLACK porque el
show la detuvo está funcionando bien. Si el negro degradara la salud, cada STOP
encendería alarmas falsas.

## ADR-028 — Las series se congelan en la última medición
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.2) · **Origen:** M2A.2 punto 4

Con el enlace caído, generar puntos hasta "ahora" es inventar historia: la curva
seguiría dibujándose prolija mientras el medidor no responde, que es la forma más
elegante de mentir en un panel.

`resolveSeriesWindow` recorta la ventana a `measuredAt` cuando la calidad no es
LIVE y devuelve el hueco. El gráfico lo raya como período sin datos.

## ADR-029 — El ACK es una sola operación sobre registro y log
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2A.2) · **Origen:** M2A.2 punto 5

El reconocimiento vivía en dos lados sin hablarse: se podía reconocer una alarma
y que el contador del header siguiera en 1. Un panel donde el operador reconoce
algo y el número no baja es un panel donde el operador deja de reconocer cosas.

`acknowledgeAlarm(key, …)` y `acknowledgeAll(…)` operan sobre ambos y emiten un
evento `ALARM_ACKNOWLEDGED` con quién, qué y cuándo — justamente lo que se va a
querer mirar después de un incidente.

`isAckConsistent()` expone la invariante: nada pendiente en ninguno de los dos.

## ADR-030 — El asset se asigna por campaña, no por moment
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.1)

`SHOW PACKAGE v1` declara `media: Record<ScreenId, string>` y `media.play` no
lleva source: hay **una fuente por pantalla para todo el show**. `mediaGroups`
asocia un grupo a una sola fuente, y una pantalla no puede estar en dos grupos.

Un moment, por lo tanto, no puede cambiar de asset, y una campaña no puede
mezclar torres independientes con A+B master.

Se consideró extender el contrato. Se descartó: `show-engine` está cerrado en
esta etapa, y cambiarlo para acomodar una herramienta de autoría invertiría la
relación correcta entre runtime y editor.

El modelo de autoría se adapta: el asset es de campaña, el moment controla la
reproducción (`hold` / `black` / `play desde X`). Coincide con cómo se produce
un takeover real — un master por superficie, segmentado.

`hold` se compila a **ausencia de evento**: la continuidad es lo que el motor
hace por construcción cuando nadie le pide nada (ADR-001).

**Si en el futuro se quiere un asset por moment**, hace falta `media.load` o un
`source` en `media.play`, y eso es SHOW PACKAGE v2 con migración.

## ADR-031 — El builder no reimplementa validación
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.1)

`validateDraft()` compila y pasa el paquete por `preflightShow()`. Lo único que
agrega es traducción: mapear cada issue al moment que lo causó.

Lo mismo con assets: la regla de rutas es `isLocalMediaPath()` de show-engine,
no una copia. Dos definiciones de "ruta aceptable" terminan divergiendo, y la
que le habla al usuario es siempre la que nadie actualiza.

Mismo criterio que ADR-024 con el asistente: una sola autoridad por pregunta.

## ADR-032 — El preview usa el ShowEngine, no un motor del editor
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.1)

PLAY compila el draft, carga el `ShowPackage` en un `ShowEngine` real y lee
`engine.getState()`. El timeline del builder dibuja el playhead; no resuelve
runtime.

La alternativa —un intérprete propio del draft, más simple— haría que lo
aprobado con un cliente no fuera lo que después ejecuta el edificio. Es el mismo
problema que ADR-025 resolvió en CONTROL, y por el mismo motivo.

Hay tests que verifican que sobre el paquete compilado siguen valiendo
STOP = BLACK, PAUSE = HOLD y SAFE MODE ganando.

`PreviewRenderer` es una interfaz: `PhotorealPreviewRenderer` puede reemplazar
al esquemático sin tocar el Builder. El renderer actual es una abstracción con
proporciones reales, no una maqueta 3D barata — que se lee como prototipo sin
terminar.

## ADR-030 — La composición de la experiencia vive en el core, no en el renderer
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.2.1) · **Origen:** M2C.2.1 puntos 2, 3 y 4

El renderer ejecutivo tenía la geometría de cada superficie escrita en
porcentajes con `skewY`, y pintaba un degradado de color cuando la salida era
`live`. Alcanza para un diagrama; no alcanza para mostrarle a un cliente lo que
va a salir al aire.

`packages/experience-core/src/composition.ts` concentra tres cosas que el
renderer no debe deducir:

- **`VIEW_GEOMETRY`** — un cuadrilátero por superficie y por vista, con el
  tamaño del master. Medido sobre las fotografías reales.
- **`surfacePlan(state, view)`** — qué fuente, qué recorte y qué salida
  corresponde a cada superficie, leído de `ShowRuntimeState`.
- **`lightPlan` / `clockPlan`** — capas de luz por zona y estado del reloj.

Todo puro y testeable. El renderer pinta; el ShowEngine sigue siendo la única
autoridad sobre qué pasa.

El motivo práctico: cuando lleguen los masters fotográficos definitivos, lo
único que cambia son ocho coordenadas por superficie en una constante. Si eso
viviera repartido en el JSX, cada cambio de foto sería una reescritura.

## ADR-031 — Perspectiva por homografía, no por `skewY`
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.2.1) · **Origen:** M2C.2.1 punto 3

Una pantalla vista en ángulo no es un paralelogramo: los bordes verticales
convergen. Con `skewY` el contenido se desliza respecto del edificio, y en la
ochava —donde las dos torres se encuentran— el error es justo donde el cliente
está mirando.

`quadToMatrix3d` resuelve la homografía 2D en forma cerrada y devuelve la
`matrix3d` de CSS. Se usa CSS y no WebGL a propósito: una sola capa compuesta
por el navegador, sin un canvas por superficie, y el video sigue siendo un
`<video>` normal con su decodificador de hardware.

Dos cosas que costaron y conviene no volver a descubrir:

1. **La escala se aplicaba dos veces** —una en el tamaño del elemento y otra
   dentro de la matriz— y las superficies salían enormes. El elemento mide el
   contenedor entero y se lo reduce a 1×1 con `scale(1/W, 1/H)` ANTES de la
   matriz. Mantenerlo a tamaño completo es lo que permite que el canvas
   rasterice a resolución real.
2. **Un trapecio de lados paralelos es afín**, y que el término de perspectiva
   dé cero ahí no es un error. Hay un test que lo fija, porque parece un bug.

## ADR-032 — `contain` y no `cover` para el master
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.2.1) · **Origen:** M2C.2.1 punto 3

Los masters son fotos verticales de la esquina y el escenario suele ser
apaisado. Con `cover` el navegador recorta arriba y abajo — y ahí están el
reloj y la pantalla horizontal, dos de las cuatro superficies.

La foto entra entera y los costados los ocupa una copia desenfocada de la misma
imagen, que se lee como profundidad de campo y no como un recorte fallido.

`containQuad` replica ese encaje para los cuadriláteros. Sin eso, las pantallas
quedan corridas respecto del edificio: el fondo se ajusta de una manera y la
geometría de otra.

`coverQuad` se conserva por si un master futuro es apaisado.

## ADR-033 — La pantalla horizontal se compone por segmentos
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.2.1) · **Origen:** M2C.2.1 punto 3

La horizontal envuelve la ochava: es una banda curva que sube hacia la esquina
y baja hacia los extremos. Un solo cuadrilátero recto deja el vértice
descubierto, y por ese hueco se ve el contenido REAL que la pantalla estaba
mostrando cuando se sacó la foto — un anuncio ajeno asomando en medio de la
presentación.

Una superficie puede declarar `Quad | Quad[]`. Cada tramo toma su franja del
recorte que ya traía la superficie, así que entre todos muestran el clip
completo repartido en vez de repetirlo. Hay tests de que los tramos son
contiguos en el edificio y que el reparto del `uv` no deja huecos ni solapes.

## ADR-034 — Un fallo de carga no cuenta como cargado
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.2.1) · **Origen:** M2C.2.1 punto 6

El handler de precarga marcaba "listo" tanto en `onload` como en `onerror`.
READY TO PRESENT podía encenderse con el Hero Corner roto, y el fallo aparecía
recién al apretar PLAY.

`loaded` y `failed` están separados, y un asset requerido se considera resuelto
solo si cargó o si su reemplazo local cargó. Si falta el Hero Corner no hay
READY: es la vista por defecto, y abrir la presentación sobre un rectángulo
vacío es peor que demorar.

El estado de fallback se muestra únicamente en modo operador. El cliente no
necesita enterarse de que una imagen anda por reemplazo.

## ADR-035 — DEMO CHECK prueba de verdad; el respaldo existe de verdad
**Fecha:** 2026-09 · **Estado:** ✅ implementada (M2C.2.1) · **Origen:** M2C.2.1 puntos 11 y 12

Las dos piezas existen para el mismo momento: la media hora antes de la
reunión, y los treinta segundos en los que algo falla con la gente sentada.

El check pide cada archivo por la red local y verifica que vuelva con cuerpo.
No consulta una variable en memoria: un check que se declara verde mirando su
propio estado no sirve para lo único que tiene que servir. Solo `fonts` y
`backup_video` son opcionales; el resto bloquea.

El respaldo es un MP4 local de 15 s, y hay un test que verifica que el archivo
esté y pese lo que tiene que pesar. Un `BACKUP_VIDEO` apuntando a un archivo
inexistente es peor que no tener respaldo: se descubre en el momento exacto en
que se lo necesita.

El botón vive en el panel de operador, no en la pantalla del cliente. No es una
capacidad del producto, es un seguro.

## ADR-036 — Creatividad de campaña por sustitución de presentación
**Fecha:** 2026-10 · **Estado:** ✅ · **Origen:** Final Executive Polish

El ShowPackage sigue referenciando los clips de prueba, que usan el Builder y
los tests. Client Mode los reemplaza AL DIBUJAR (`CAMPAIGN_MEDIA`,
`presentationSource`) por `mcd_towers_master` (2592×576) y `mcd_horizontal`
(1920×412). Así delante del cliente nunca aparece un timecode, y el show no
cambia. La pieza actual es neutral, sin logos ni marcas de terceros: cuando la
agencia entregue el spot real se reemplazan esos dos archivos y nada más.

## ADR-037 — Client Mode por defecto, Operator Mode explícito
Por defecto el cliente no ve Demo Check, Reset, Backup, estado de carga,
atajos, notas técnicas (EDGE) ni el selector con una sola vista. El operador
entra con `?operator=1` o Shift+O. La atenuación de HOLD (ayuda para
distinguir congelado de vivo) también es solo del operador: en Client Mode un
Brand Moment congelado es una imagen para mostrar.

## ADR-038 — Hero 16:9 sin tocar la geometría aprobada
Las coordenadas de las pantallas están referidas al master (2560×1733). En vez
de reemplazarlo, `hero-corner-169.jpg` lo envuelve: su franja central es el
master píxel a píxel y los costados continúan la toma. Se dibuja debajo, a la
misma escala del master.

## ADR-039 — Video de respaldo renderizado, no grabado
Sin GPU la app corre a ~1,5 fps: una grabación sale entrecortada. El recorrido
y el respaldo se renderizan cuadro por cuadro (1920×1080, 25 fps) con las
mismas piezas que la app y la línea de tiempo del ShowPackage cada 40 ms.

## ADR-040 — Gancho de captura `?capture=1`
**Fecha:** 2026-10 · **Estado:** ✅ · **Origen:** M2C.2.3 / 14
Las capturas oficiales congelan el show en el instante exacto (pausa +
posicionamiento ya existentes en la página). Sin GPU una captura a 1920×1080
tarda segundos y el show, en tiempo real, se pasaba del momento. Solo existe
con el parámetro; no toca motor ni Builder.

## ADR-041 — FREEZE de M2C.2
Ver `docs/architecture/FREEZE_M2C2.md`.

## ADR-042 — Cloud administra, EDGE ejecuta
**Fecha:** 2026-10 · **Estado:** ✅ · **Origen:** M3A.1 §0
M3A implementa solo el control plane en la nube (PostgreSQL + object storage
S3-compatible, sin atarse a un proveedor). La ejecución en el edificio es
TRUST EDGE (M3C) y deberá operar aunque la nube no esté disponible.

## ADR-043 — ShowVersion absolutamente inmutable
Sin columna de estado. SUBMITTED = sin Approval; APPROVED/REJECTED = la
decisión de su única Approval. La base rechaza UPDATE, DELETE y TRUNCATE
(trigger) y el usuario de runtime no tiene esos permisos.

## ADR-044 — Autoridad del compiler en el servidor
El servidor compila el TakeoverDraft con `compileTakeoverDraft` y lo pasa por
el `preflightShow` existente (vía `validateDraft`). Nunca confía en un
ShowPackage compilado por el navegador. Compiler y preflight no se modifican.
(Se implementa en Fase C; el esquema ya lo refleja: `source_draft_id`.)

## ADR-045 — Canonicalización y hash de versión
JCS RFC 8785 (`canonicalize@5.1.0`) → UTF-8 → SHA-256 sobre el envelope
`{hashEnvelopeVersion, showPackageSchemaVersion, showPackage, assets[{logicalRef, sha256}]}`
ordenado por logicalRef. `compilerVersion` es metadata y NO entra en el hash.
Constantes explícitas y atadas a su fuente por tests.

## ADR-046 — Objetos físicos content-addressed
`stored_objects` separa el blob físico (sha256 único, `storage_key` derivada
del contenido, inmutable) de las entidades de negocio (Asset, ApprovalEvidence).

## ADR-047 — Cuatro ojos por contrato
`contracts.four_eyes_required DEFAULT true`, aplicado por trigger al aprobar.
Desactivarlo: ADMIN + motivo + AuditEvent `FOUR_EYES_DISABLED` (API en Fase C).

## ADR-048 — Cadena de auditoría serializada
`eventHash = SHA256(previousEventHash + canonicalEvent)`. Lock exclusivo de
transacción antes de leer la cabeza; trigger que exige seq continua y
predecesor = cabeza; `previous_event_hash UNIQUE`. Tamper-evident
(`verifyChain`), no imposible de alterar para quien controla la infraestructura.

## ADR-049 — Idempotencia con fingerprint
`(actor_id, key)` + `request_fingerprint`: mismo fingerprint = replay; distinto
= 409 `IDEMPOTENCY_KEY_REUSED`. La reserva y la operación van en la misma
transacción.

## ADR-050 — Formatos derivados del modelo del edificio
`deriveSurfaceFormats(EL_TRUST)`: A+B = suma de anchos de A y B. Ni la API ni la
base repiten resoluciones.

## ADR-051 — Retiro de `apps/api`
Era un placeholder sin código (solo README). Búsqueda completa: ningún script,
workspace, import ni documento dependía de él. Reemplazado por `apps/platform-api`.

## ADR-052 — Abstracción de almacenamiento
**Fecha:** 2026-10 · **Estado:** ✅ · **Origen:** M3A.1 Fase B1
`ObjectStorage` con zona temporal y zona content-addressed inmutable. Claves
derivadas del sha256, nunca de input del usuario. LocalDiskStorage (link()
atómico, O_NOFOLLOW, lstat por componente) y S3CompatibleStorage (protocolo
S3, sin acoplar el dominio a AWS) cumplen el mismo contrato de tests.
Detalle: `docs/platform/STORAGE.md`.

## ADR-053 — Integridad de almacenamiento (Integrity Gate B1.1)
Clave final canónica `sha256/<2>/<64>` sin extensión. Un blob final existente
se acepta solo si su SHA-256 REAL coincide con la clave (antes se comparaba el
tamaño: bug P0 reproducido y corregido). Reserva atómica de temporales (mkdir /
If-None-Match), metadata escrita al final y validada, estados parciales nunca
reutilizados. Permisos endurecidos al arrancar. Detalle: `docs/platform/STORAGE.md`.

## ADR-054 — Inspección de medios: dos compuertas y fuente materializada
**Fecha:** 2026-10 · **Estado:** ✅ · **Origen:** M3A.1 Fase B2
ffprobe (metadata) **y** decode real de un frame con ffmpeg: un MP4 con índice
intacto y frames destruidos pasa ffprobe con metadata perfecta (fixture
`corrupt_frames`). El temporal se materializa en una copia privada verificada
por sha256 (ffprobe necesita acceso aleatorio; vale igual para S3). Validador
puro contra `deriveSurfaceFormats(EL_TRUST)`; fps como racional exacto; MP4
reconocido por `major_brand` (MOV comparte demuxer). Procesos con
`shell:false`, `file:` + `protocol_whitelist`, timeout con SIGKILL y
concurrencia limitada. Detalle: `docs/platform/MEDIA.md`.

## ADR-055 — Pipeline de Asset: fronteras DB/storage y consistencia en la base
**Fecha:** 2026-10 · **Estado:** propuesto (auditoría B3) · **Origen:** M3A.1 Fase B3
Sin transacción distribuida: temporal hasta validar, commit content-addressed
idempotente, y StoredObject + Asset READY + `ASSET_VALIDATED` en UNA
transacción. Un fallo de la base después del commit deja un blob huérfano
seguro (nunca se borra un blob final) y el Asset no terminal; el retry con la
misma Idempotency-Key recupera. El Asset se crea después del stream para que el
fingerprint incluya el sha256 del contenido. La migración 0002 hace cumplir en
PostgreSQL la consistencia READY ↔ StoredObject (sha256, tamaño, MIME) y la
lista cerrada de `rejection_code`. Detalle: `docs/platform/ASSETS.md`.

## ADR-056 — platform-api: upload en una solicitud, identidad enchufable
**Fecha:** 2026-10 · **Estado:** propuesto (auditoría B4) · **Origen:** M3A.1 Fase B4
Fastify 5 en `apps/platform-api`. Upload multipart en UNA solicitud (campos
antes del archivo) con Idempotency-Key obligatoria: la idempotencia por
contenido de B3 hace innecesario un `uploads`+`finalize`. Rechazos con HTTP
coherente (413/415/422/503) y contrato `{code,message,details?,requestId}`;
remediación derivada de la autoridad (BL-03). Identidad por `ActorProvider`:
hoy solo `DevelopmentActorProvider` (DEV ONLY, se niega en producción); Fase C
lo reemplaza sin tocar rutas. Detalle: `docs/platform/API.md`.

## ADR-057 — Auth y roles: sesión server-side, CSRF atado a la sesión, scope por contrato
**Fecha:** 2026-10 · **Estado:** propuesto (auditoría C1) · **Origen:** M3A.1 Fase C1 + decisiones del auditor sobre el brief C
`@trust/platform-auth`. Passwords Argon2id (`@node-rs/argon2`) con parámetros
explícitos m=19 MiB/t=2/p=1 (mínimo OWASP); subirlos exige el benchmark
reproducible `bench:argon2` en la infraestructura real. Sesión server-side en
`sessions`: token de 256 bits, en la base solo su sha256; vencimiento absoluto
del servidor; revocable; nueva en cada login (revoca la previa) y todas
revocadas en un cambio de roles. CSRF = HMAC(token, "trust-csrf-v1"),
exigido en `X-CSRF-Token` en toda mutación con sesión. Cookie HttpOnly,
SameSite=Lax, Path=/, sin Domain; en producción `__Host-trust_session` y
Secure. Rate limit de login por email y por dirección (IPv6 /64) ANTES de
Argon2 y del audit; `AUTH_LOGIN_SUCCEEDED`/`AUTH_LOGIN_FAILED` sin email, IP,
password, cookie ni token (inexistente → actor null). Roles efectivos y
contratos externos los deriva el backend; EXTERNAL_APPROVER solo cuenta con el
flag global y el contrato habilitados. Alta de usuarios solo por CLI. El
provider DEV queda solo para tests. Detalle: `docs/platform/AUTH.md`.

## ADR-058 — Aprobación: evidencia atada a la versión, decisión sobre el hash exacto
**Fecha:** 2026-10 · **Estado:** propuesto (auditoría C2) · **Origen:** M3A.1 Fase C2 + decisiones 2 y 4 del brief C
`@trust/platform-approval`. Migración 0003: `approval_evidence.show_version_id`
NOT NULL (la evidencia se sube a una versión y solo respalda esa versión, FK
compuesta desde `approvals`), `approvals.version_hash` verificado por trigger
contra la versión, allowlist tipo↔MIME y "sin evidencia después de la
decisión" también en la base. La evidencia se clasifica SOLO por bytes
(PDF, email RFC 5322, texto UTF-8 no-markup; OTHER sin ningún tipo habilitado
hasta tener un decoder que valide la imagen completa): los mismos bytes dan
siempre el mismo MIME, lo que mantiene coherente `stored_objects` único por
sha256; se sirve siempre como descarga con `nosniff`, CSP sandbox y un nombre
generado por el servidor (`evidence-<id>.<ext>` según el MIME validado). Las
decisiones serializan por campaña (`FOR UPDATE` sobre `campaigns`, porque
`trust_app` no tiene UPDATE sobre `show_versions`), usan `withIdempotency` y
escriben audit en la misma transacción. Cuatro ojos: chequeo en la app con el
trigger de 0001 como segunda barrera; la política la cambia solo ADMIN por
`PUT /contracts/:id/four-eyes` con `FOUR_EYES_DISABLED`. Detalle:
`docs/platform/APPROVAL.md`.

## ADR-059 — Submit server-side sobre el Draft persistido
**Fecha:** 2026-10 · **Estado:** propuesto (auditoría C3) · **Origen:** M3A.1 Fase C3 + decisión 1 del brief C
`submitCampaign` en `@trust/platform-approval`. El servidor no confía en un
paquete compilado por el cliente: relee el Draft de la base, lo valida con
`TakeoverDraftSchema`, arma el registro de assets desde Assets READY de la
superficie de cada ranura y corre `validateDraft` (el mismo compilador y el
mismo `preflightShow` del Builder) contra el modelo real del edificio. El
`source` de cada asset en el ShowPackage es `/assets/sha256/<sha256>.mp4`, así
el hash (sobre del punto 8) depende solo del contenido. La revisión del draft
la cita el cliente (concurrencia optimista) y una revisión se envía una sola
vez; la campaña bloqueada `FOR UPDATE` serializa envíos y decisiones. La
versión se crea por `createShowVersion` con `VERSION_SUBMITTED` en la misma
transacción, detrás de `withIdempotency`.

## ADR-060 — Draft con concurrencia optimista y superficies del contrato en el servidor
**Fecha:** 2026-10 · **Estado:** propuesto (auditoría D1) · **Origen:** M3A.1 Fase D1 + brief D aprobado (#13)
`@trust/platform-campaigns`. `PUT /campaigns/:id/draft` escribe con un único
`UPDATE … WHERE revision = expectedRevision` dentro de una transacción. Si no
coincide, 409 `DRAFT_CONFLICT` con `serverRevision`, `clientRevision` y
`serverUpdatedAt`, sin escribir ni hacer merge. No hay Idempotency-Key: la
revisión es el único contrato de concurrencia. La regla de superficies del
master §6 se calcula desde el draft (directivas que no son `hold`, traducidas
a pantallas como lo hace el compilador) y se aplica al crear, en el PUT y en
el submit, siempre contra el contrato vigente. No reescribe datos históricos.
Advertiser/Contract los escribe solo ADMIN. El audit guarda hashes del draft,
no su contenido.

