# Gate V3.1 — entrega

**Los 8 puntos cerrados. 120 → 159 tests. `install --frozen-lockfile`, `verify`
y `build` con exit 0, salida textual en `GATE_V3.1_SALIDA.txt`.**

Sin cambios de stack, sin reescrituras, sin CONTROL/EDGE/Art-Net/DMX/hardware.
El edificio real no se modeló: solo se cargaron las medidas confirmadas de las
dos pantallas superiores.

---

## Cómo leer esta entrega

Los puntos 1, 2, 3, 5 y 7 ya los había empezado en una pasada anterior sobre
REVIEW-003, que armé antes de recibir este gate. No conservé el ZIP de V3, así
que el diff tiene dos partes:

| Parte | Qué cubre | Dónde |
|---|---|---|
| **A — pasada previa** | lockfile, STOP=black, `snapshot()`, validación UV, retry, compileShow | `REVIEW_003_RESPUESTA.md` (descripción por archivo) |
| **B — este gate** | mediaGroups por show, lienzo real, tests de retry, límites UV, guard de URLs, estados de operación | `GATE_V3.1.patch` (diff unificado, +1070 / −157) |

**Algo que estaba en la parte A y está fuera del alcance de este gate:**
`compileShow()` (REVIEW-003 P1-7). Precompila el orden del timeline; no cambia
comportamiento y hay un test que verifica estado idéntico con y sin compilar.
Lo dejo porque sacarlo ahora sería otro cambio sin pedir, pero queda marcado:
si prefieren la base mínima, se revierte sin tocar nada más.

---

## 1. Lockfile reproducible

**Causa** (parte A): `"packageManager": "pnpm@12.5.1"` hacía que pnpm 12 se
autogestionara y escribiera sus 8 binarios de plataforma como segundo documento
YAML. `--frozen-lockfile` lo toleraba, así que "funcionaba" sin ser canónico.

**Corrección:** saqué `packageManager`; la versión quedó en
`engines: { pnpm: ">=12 <13" }`. Lockfile regenerado: **un documento, 3029
líneas, cero separadores `---`**.

Verificado en este gate con `node_modules` borrado:

```
pnpm install --frozen-lockfile   [exit 0]
pnpm verify                      [exit 0]   159 passed · lint limpio · 5 typechecks limpios
pnpm build                       [exit 0]   ✓ Compiled · ✓ 4/4 páginas · / = 238 kB
```

Nota honesta: el install tarda milisegundos porque pnpm resuelve desde su store
local, sin red. Un install en una máquina limpia va a descargar; el resultado
tiene que ser el mismo porque el lockfile fija integridad por hash.

**El primer `verify` de este gate falló.** Lint marcó `no-control-regex` en el
guard de URLs nuevo. Lo reemplacé por un loop explícito sobre los códigos de
carácter y agregué casos de test con `\u0000` y `\n`. El archivo de salida
registra la corrida limpia posterior, desde cero.

## 2. Semántica del transporte

| Acción | Salida | Dónde |
|---|---|---|
| PAUSE global | `hold` | `deriveOutput`: `cue=playing` + transporte no-playing |
| STOP global | `black`, incluso con `media.play` en 0 ms | `if (transport === 'stopped') return 'black'` |
| SAFE MODE | `black` + escena `safe_mode` sin fade | `resolveStateAt(…, { safeMode: true })` |
| Fin del show | transporte `ended`, pantallas en `hold` | `Transport.settle()` |
| `snapshot()` al cruzar el final | nunca `playing` viejo | `settle()` al inicio de `snapshot()` |

El caso de STOP es el que importaba: con `media.play` en 0 ms, el STOP devuelve
el transporte a t=0 donde el cue sigue en `playing`. Antes quedaba en `hold` con
el primer frame del contenido colgado en la pantalla, fuera de pauta.

**Nuevo en este gate:** tests a nivel **actuador** (`MediaTextureManager.sync`).
Hasta ahora solo se probaba que el motor dijera `hold`; nada verificaba que el
`<video>` efectivamente no recibiera `play()`. Ahora: 60 frames en `hold` → cero
llamadas a `play()` y **una sola** escritura de `currentTime`, no 60.

## 3. Validación de `uvRect`

`x ≥ 0` · `y ≥ 0` · `w > 0` · `h > 0` · `x + w ≤ 1` · `y + h ≤ 1`, con epsilon
`1e-9` para que el reparto real del lienzo (`1152/2592 + 1440/2592`) no falle por
coma flotante.

**Tests de límites agregados en este gate:** bordes exactos aceptados
(`x + w = 1`, `y + h = 1`, rect mínimo en la esquina), origen negativo, ancho y
alto cero o negativos, salida por derecha y por arriba, salida por encima del
epsilon (`w = 0.5000001`), componentes mayores a 1, `NaN` y strings.

## 4. Media failure / retry

La implementación (`retry`, `retryAllFailed`, `release`, `failedSources`, y
`syncActiveSources` liberando fuentes activas falladas) estaba en la parte A,
**sin un solo test**: `MediaTextureManager` creaba el `<video>` con `document`
y no se podía instanciar en node.

**Cambio en este gate:** fábrica de video inyectable
(`new MediaTextureManager({ createVideo })`), sin cambiar el comportamiento por
defecto. Con un doble de `<video>`: 19 tests.

| Caso | Verifica |
|---|---|
| Fallo | marca, avisa por `onError`, deja de entregar textura |
| Retry | crea un `<video>` **nuevo**, vuelve a entregar textura, sin recargar la app |
| Retry libera | el decoder viejo queda pausado, descargado y sin `src` |
| Retry en clip sano o desconocido | no hace nada |
| Segundo fallo | se vuelve a reportar |
| `retryAllFailed` | reintenta solo los fallados |
| **Recarga del show** | una fuente activa pero fallada se libera (el bug de REVIEW-003) |
| Frame-lock | dos pantallas del grupo comparten el **mismo** `<video>` |
| Master caído | fallan todas las pantallas del grupo juntas |

En la UI: botón "Reintentar clips" que aparece solo con errores de media.

## 5. SAFE MODE / DEGRADED_OFFLINE

La contradicción de fondo ya estaba resuelta; el problema que quedaba es que la
definición estaba repartida en cuatro archivos.

**Nuevo: `docs/architecture/OPERATING_STATES.md`, documento canónico.** Si otro
archivo dice algo distinto, gana este. `PRINCIPLES.md`, `building.ts`,
`engine.ts` y el README de EDGE apuntan ahí.

- **DEGRADED_OFFLINE:** pérdida de internet o de CONTROL. La programación local
  cacheada continúa. No dispara SAFE MODE.
- **SAFE_MODE:** fallo local, seguridad, contenido inválido, watchdog o
  intervención manual (más restricción normativa).

**Una decisión que no es técnica y les queda a ustedes:** el lease de operación.
CONTROL da a EDGE permiso de operar solo por N horas (propuse 72). Al vencer sin
renovar, SAFE MODE. Lo clasifiqué como *seguridad* porque acota cuánto puede
emitir un EDGE comprometido, pero la consecuencia es que **un corte de
conectividad de más de 72 h termina en SAFE MODE**. Si comercialmente no sirve,
se sube el número; lo que no recomiendo es sacar el lease.

## 6. Media groups por show — el cambio de fondo

**ADR-013, implementado.** Separé dos cosas que la V3 tenía mezcladas en el
edificio:

| | Qué es | Dónde vive |
|---|---|---|
| **Capacidad** | qué pantallas *pueden* compartir decoder | edificio — `syncCapableWith` |
| **Membresía** | quién comparte decoder *en esta campaña* | show — `mediaGroups` |

**No rompe SHOW PACKAGE v1.** `mediaGroups` ya vivía en el show; cambió quién
decide la membresía, y eso es config del edificio. Los shows existentes siguen
válidos sin migrar.

**Medidas cargadas** (no es modelado del edificio, son specs de pantalla):

| | Medida | P6.67 | En el lienzo |
|---|---|---|---|
| screen_a — Corrientes | 7,68 × 3,84 m | 1152 × 576 | x 0 → 1152 |
| screen_b — Pellegrini | 9,60 × 3,84 m | 1440 × 576 | x 1152 → 2592 |
| **Lienzo superior** | | **2592 × 576** | |

Regeneré el master de test a 2592 × 576: A a la izquierda, B a la derecha,
timecode y contador por pantalla, barras rojas cada 30 frames a lo ancho de las
dos. Verifiqué un frame extraído con ffmpeg.

**Efecto lateral bueno:** con lienzo lado a lado, A y B usan `h = 1`. La duda de
orientación vertical del UV que arrastraba desde V2 ya no afecta a las torres:
solo importa X, que three no invierte.

**Herramientas nuevas:**
- `uvFromPixels(canvas, rect)` — px del lienzo (origen arriba) a UV (origen
  abajo). Nadie invierte el eje Y a mano en un JSON.
- `MediaGroup.canvas` opcional. Con él, preflight exige que cada recorte tenga el
  aspecto físico de su pantalla (±2 %). Repartir el lienzo 50/50 lo bloquea:
  estiraría Corrientes y aplastaría Pellegrini.

**Preflight:** `GROUP_NOT_SYNC_CAPABLE` (capacidad mutua por par),
`SCREEN_IN_MULTIPLE_GROUPS`, `GROUP_ASPECT_MISMATCH` — los tres son error.

**A+B+horizontal:** funciona sin tocar el motor. Testeado con lienzo 2592 × 988:
una sola fuente para las tres y el mismo `mediaTimeMs` en todo el show.

**Supuesto marcado que hay que confirmar antes de venderlo:** declaré la
horizontal capaz de sincronizar con A y B. Eso depende de que compartan
procesador y reloj de video, y no lo sé. Si el integrador dice que no, se saca
de `syncCapableWith` en `building.ts` y preflight bloquea todo show que lo
intente.

## 7. Asset security — ADR-014

Actualizado con la propuesta completa para v2: `assetId: "sha256:…"`, ingesta
solo por CONTROL, resolución local, verificación de hash antes de emitir, y sin
`source` libre ni como opción de escape.

**Además implementé un guard interino, y lo marco porque es una línea fina con
el alcance:** `MEDIA_SOURCE_NOT_LOCAL` en preflight. Un show v1 solo puede
apuntar a rutas locales absolutas; rechaza esquemas, `//host`, rutas relativas,
`..`, barras invertidas y caracteres de control. Son ~15 líneas.

Lo hice porque el objetivo del punto 7 es que un show "no pueda apuntar
libremente a cualquier URL", y esto lo cumple hoy sin esperar al asset manager.
No reemplaza al ADR: no hay hash ni verificación de integridad. Si prefieren
dejarlo solo en diseño, es una regla de preflight que se borra sola.

## 8. Tests

| Pedido | Archivo | Tests |
|---|---|---|
| STOP con `media.play` a 0 ms | `playback.test.ts` | 4 (parte A) |
| PAUSE → HOLD | `playback.test.ts` + **`MediaTextureManager.test.ts`** | motor + actuador |
| SAFE MODE → BLACK | `playback.test.ts` + actuador | incluye "gana sobre hold" |
| Fin de timeline | `playback.test.ts` | `ended`, `snapshot()`, seek desde el final |
| UV fuera de rango | **`groups.test.ts`** | 6 bloques de límites |
| Retry de media | **`MediaTextureManager.test.ts`** | 10 |
| mediaGroups por show | **`groups.test.ts`** | 11, incluido A+B+horizontal |

### Mutation check — por qué confío en estos tests

Dos veces en esta serie de reviews tuve tests verdes sobre semántica equivocada:
los fades en REVIEW-001 y STOP=hold en REVIEW-003. En ambos casos escribí la regla
y el test en la misma sesión, y el test repetía el error.

Así que esta vez **rompí a propósito cada regla crítica** y verifiqué que algún
test fallara. `scripts/mutation-check.py`, resultado en el archivo de salida:

```
ATRAPADA  STOP -> black                ATRAPADA  guard de URLs
ATRAPADA  SAFE MODE -> black           ATRAPADA  ended en transporte
ATRAPADA  PAUSE -> hold                ATRAPADA  retry: libera fallada activa
ATRAPADA  uv x+w <= 1                  ATRAPADA  retry: recrea el video
ATRAPADA  uv w,h > 0                   ATRAPADA  actuador obedece output
ATRAPADA  capacidad del edificio       ATRAPADA  membresia por show
ATRAPADA  doble membresia              TODAS ATRAPADAS  (14/14)
ATRAPADA  aspecto del recorte
```

No corre en `pnpm verify` (tarda un minuto). Conviene correrlo antes de cerrar
cada gate.

---

## ADRs

| | Estado |
|---|---|
| **ADR-013** — mediaGroups por show, capacidad en el edificio | ✅ implementado |
| **ADR-014** — assetId en vez de URL | propuesta · guard interino implementado |
| ADR-010 — frame-lock por decoder único | actualizado: el mecanismo pasó a ADR-013 |
| ADR-015 — render frame-exacto para aprobación | propuesta (de REVIEW-003, sin cambios) |

---

## Lo que sigue sin cerrar

**La prueba en navegador.** No hay Chromium en este entorno. Verifiqué build,
servidor de producción, que sirva el master nuevo y que responda range requests
(206). Nadie ejecutó WebGL ni decodificó un frame.

Lo que hay que mirar en Chrome/Edge con `test_sync_001`, en orden:

1. **Play/pause/seek/stop durante 3 minutos.** Tartamudeo o correcciones en
   bucle. Los umbrales de deriva (120/600 ms) nunca se midieron sobre MP4 real.
2. **Barras rojas simultáneas** en A y B.
3. **A dice "A · CORRIENTES", B dice "B · PELLEGRINI".** Con el lienzo lado a
   lado esto ya no depende de la orientación vertical del UV.

**La confirmación del integrador** sobre si la horizontal comparte procesador y
reloj con A y B, antes de ofrecer un takeover de tres superficies frame-locked.

**El Digital Twin real.** Esperando GLB + `TRUST_GEOMETRY_SPEC`. La geometría
actual es placeholder y está marcada así en `building.ts`.
