# Respuesta a REVIEW-002

**11 de 11 hallazgos corregidos. 107 tests (antes 77). `pnpm verify` y
`pnpm build` corridos de verdad, con lockfile commiteado.**

Lo que sigue sin verificar está al final, en su propia sección.

---

## Resultados reales, no inferidos

Esta vez pude instalar y ejecutar. Salida textual:

```
pnpm verify   →  107 passed (107) · lint limpio · typecheck limpio (5 paquetes)
pnpm build    →  ✓ Compiled successfully · ✓ Generating static pages (4/4)
                 Route (app) /  237 kB · First Load JS 325 kB
pnpm-lock.yaml → 3187 líneas, commiteado
```

Servidor de producción levantado en el puerto 3111:

```
GET /                                 200
GET /shows/test_sync_001.json         200
GET /demo/test_towers_master.mp4      200 · 2.853.370 bytes
Range request (bytes=0-1)             206   ← necesario para seek de <video>
```

El build encontró dos errores reales que el análisis estático no había visto:
`CameraMode` sin exportar y `@types/react` faltando en `trust-3d`. Eso solo
aparece compilando.

---

## P0-1 — PAUSE global no pausaba los videos

Correcto, y la causa raíz era más profunda que el síntoma: `playing` cumplía
tres roles distintos a la vez.

**Modelo nuevo** (ADR-009):

| Concepto | Valores | Quién manda |
|---|---|---|
| `cue` | playing / paused / stopped | eventos `media.*` del timeline |
| transporte | playing / paused / stopped / ended | el operador |
| `output` | live / hold / black | derivado de los dos |

`resolveStateAt(show, ctx, t, { transport, safeMode })` sigue siendo pura: el
transporte entra como argumento, no como efecto. El actuador obedece a `output`,
nunca a `cue`.

**Test del criterio pedido:**

```
play → pause en 10.000 ms → 40 ticks con el reloj de pared corriendo
  mediaTimeMs = 9000 en los 40  ✓
  output = 'hold' en los 40     ✓
  timeMs = 10000 en los 40      ✓
```

## P0-2 — pause / stop / SAFE MODE sin semántica visual separada

Correcto.

- `media.pause` → **hold**: frame congelado, visible pero atenuado al 62% para
  que el operador distinga de un vistazo un show pausado de uno corriendo.
- `media.stop` → **black**: opacidad 0 sobre un panel negro real.
- SAFE MODE → **black en las tres, sin excepción**. Gana incluso sobre una
  pantalla en hold.

El 12% del último frame publicitario ya no existe. Hay un test que recorre las
tres pantallas y exige `black` en SAFE MODE, y otro con la tabla de verdad
completa de `deriveOutput`.

## P1-3 — El reloj rompía `state(t)`

Correcto, y era el mismo error que el de los fades en REVIEW-001: semántica
temporal en el renderer.

`ClockFace` ya no tiene tiempo propio. El motor entrega `clockIntensity` (con
fade de 1200 ms resuelto como transición) y `clockAngleDeg` (función de la hora
de pared inyectada, o del show si no hay ninguna). El componente solo pinta.

Test: seek y reproducción a 2400/2600/5000/9300/9800/11000 ms dan el mismo
`clockIntensity` y el mismo `clockAngleDeg`, con igualdad exacta.

## P1-4 — Transiciones de cámara dependientes del framerate

Correcto. Dos modos explícitos (ADR-011), con toggle en la UI:

- `interactive` — suavizado por delta, para navegar mientras se programa.
- `deterministic` — corte exacto al preset. **El único válido para aprobar
  contenido con un cliente.**

Además es lo honesto: un `camera.switch` en el edificio real es un cambio de
plano, no un dolly. Suavizarlo vendía una transición que no existe.

## P1-5 — 120 ms es demasiado para A+B

De acuerdo, y adopté la recomendación del master video porque es
estructuralmente mejor, no solo más preciso: **un decoder no puede
desincronizarse consigo mismo.** Cualquier tolerancia sobre dos decoders es
gestión de un problema que se puede eliminar.

`syncGroup` en `ScreenSurface`, `mediaGroups` en el show package. `screen_a` y
`screen_b` declaran `syncGroup: "towers"` y comparten un archivo con un `uvRect`
cada una. El manager indexa por URL, así que piden la misma textura; las vistas
recortadas son `Texture.clone()` sobre el mismo `<video>`, difiriendo solo en
`offset`/`repeat`.

Objetivo de sincronía: **33 ms (1 frame), como error de preflight**, no 120 ms
como advertencia. Con `mediaGroup` la deriva es 0 por construcción, y hay un
test que la verifica cada 137 ms a lo largo del show entero.

**Consecuencia operativa que conviene bajar a producción de contenido:** el
anamórfico se autorea como un lienzo único apilado, no como dos MP4. Si el
proveedor entrega dos archivos, preflight lo marca (`SCREENS_SEPARATE_DECODERS`).

## P1-6 — MP4 inexistentes y `onMediaError` desconectado

Ambos correctos.

**Clips generados con ffmpeg**, incluidos en el repo:

| Archivo | Dimensiones | Contenido |
|---|---|---|
| `test_towers_master.mp4` | 1440×1152, 900 frames @30 | A arriba, B abajo, línea cian de división, timecode + contador de frames por mitad, barra roja cada 30 frames |
| `test_horizontal.mp4` | 1920×412, 900 frames @30 | timecode, contador, barra roja cada segundo |

Sin contenido de marca: sirven para medir, no para mostrar. Las barras rojas
sincronizadas entre las dos mitades son el chequeo visual de frame-lock: si
alguna vez aparecen en frames distintos, el decoder único falló.

`onMediaError` conectado: `Viewport` → `TrustBuilding` → store. Un clip caído
ahora **pausa el show** y se muestra en el Inspector bajo la pantalla afectada.
En EDGE ese mismo camino dispara SAFE MODE.

## P1-7 — Preflight de negocio superficial

Correcto en los dos ejemplos. Reescrito para evaluar el **estado resuelto** en
todos los puntos de discontinuidad: cada evento, ±1 ms, fin de cada fade, y el
cierre.

Casos nuevos que el chequeo por nombre de evento no veía, cada uno con test:

- desincronía creada por un `media.seek` **posterior** al play,
- desincronía por `fromMs` distintos en el mismo `atMs`,
- un `lighting.zone.set` que vuelve a pintar la cúpula **después** de la escena
  de cierre,
- una pantalla que termina en `hold` en vez de negro,
- un `mediaGroup` cuyo layout no coincide con el `syncGroup` de las pantallas.

El cierre ya no compara nombres de escena: compara el estado real en
`durationMs` contra un estado canónico de identidad, sobre las zonas de firma
(cúpula y reloj).

## P1-8 — Fin de show mantenía `playing`

Correcto. `ended` es ahora un estado propio del transporte, no `playing`
clampeado. `settle()` lo evalúa en cada consulta, y seekear hacia atrás desde el
final devuelve a `paused`.

Con el show terminado, `output` cae a `hold`: el actuador deja de corregir
contra un target congelado. El botón del transporte muestra REPLAY.

## P2-9 — `enabled` ignoraba el fade

Correcto. `enabled` es el relé de la luminaria, un corte duro. Semántica
definida y documentada:

- `enabled: true` → **inmediato**. Primero el relé, después la subida.
- `enabled: false` → **al terminar el fade**. Primero baja la luz, recién ahí
  corta.

Así una zona que se apaga con fade de 4 s baja durante 4 s y corta al final, en
vez de cortarse en seco al inicio.

## P2-10 — Lockfile

**Resuelto.** `pnpm-lock.yaml`, 3187 líneas, en el repo. También quedó
`pnpm-workspace.yaml` con `allowBuilds` explícito: ningún paquete corre scripts
de instalación sin estar listado. Un postinstall es ejecución de código ajeno en
la máquina que compila lo que va al edificio.

## P2-11 — Media vieja decodificando

Correcto. `syncActiveSources(activeSources)` pausa, descarga y libera todo clip
que el show actual ya no usa. `TrustBuilding` lo llama cuando cambia el conjunto
de fuentes.

Sin esto, al volver a un show anterior el decoder arrancaba desfasado.

## Seguridad — firma en KMS/HSM

De acuerdo, y el punto es correcto: "un compromiso del cloud no debe poder
encender una luz" no se cumple si CONTROL publica **y además** tiene la clave.

Registrado como ADR-012 y en `PRINCIPLES.md` §6-bis. Tres capas: clave en
KMS/HSM, firma que requiere aprobación humana, y **EDGE imponiendo límites
físicos incluso a paquetes válidamente firmados**.

La tercera es la que importa. Una firma prueba origen, no que el contenido sea
seguro. Sin un EDGE que rechace lo que viole brillo máximo o restricción horaria
venga de donde venga, la firma solo mueve el problema de lugar.

---

## Gate para V3 — estado honesto

| # | Criterio | Estado |
|---|---|---|
| 1 | Play/pause/seek/stop sin drift ni tartamudeo | ⚠️ correcto en el motor, **sin verificar en navegador** |
| 2 | `pause = hold`, `stop = black`, SAFE MODE = negro | ✅ testeado en el motor; render escrito, sin verificar visualmente |
| 3 | A+B frame-locked con clip visible | ⚠️ deriva 0 por construcción y testeada; **el chequeo visual falta** |
| 4 | Seek y reproducción dan la misma iluminación, reloj y render | ✅ testeado (fades, reloj, cámara determinista) |
| 5 | Preflight detecta desincronía post-seek y cierre incorrecto | ✅ testeado |
| 6 | `pnpm verify` + `pnpm build` con lockfile | ✅ **corridos de verdad** |

### Por qué 1 y 3 siguen en amarillo

**No tengo navegador.** El entorno donde trabajo no tiene Chromium ni Playwright,
y los binarios de navegador no se descargan desde los registros npm a los que
tengo acceso. Pude compilar, levantar el servidor de producción y confirmar que
sirve la página, los shows y los MP4 con range requests — pero nadie ejecutó
WebGL ni decodificó un frame.

Concretamente, lo que falta medir en una máquina con pantalla:

1. Que las barras rojas del master aparezcan en el **mismo frame** en A y en B.
2. Que pausar no produzca tartamudeo ni correcciones de `currentTime` en bucle.
3. Que los umbrales de deriva (120/600 ms) sean razonables sobre un MP4 real.
   Son valores de partida, no medidos.
4. Que el `Texture.clone()` con `offset`/`repeat` recorte donde esperamos — el
   eje Y de UV en three va hacia arriba, así que la mitad **superior** de la
   imagen es `y: 0.5`. Si quedó invertido, A y B muestran la mitad del otro.

El punto 4 es el más probable que falle y el más fácil de ver: abrí
`test_sync_001`, dale play, y fijate si la torre A dice "SCREEN A". Si dice
"SCREEN B", hay que dar vuelta los `uvRect` en el JSON del show — un cambio de
dos líneas, sin tocar código.

### Lo demás que sigue sin resolverse

La geometría del edificio sigue inventada salvo A y B. El relevamiento físico es
el bloqueante real de todo lo que viene después, y no lo puede resolver ningún
modelo.
