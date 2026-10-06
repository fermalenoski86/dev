# Respuesta a REVIEW-003

**2 P0 corregidos, 5 P1 corregidos, 4 hallazgos menores corregidos, 3 ADRs
propuestos sin implementar. 113 → 120 tests.**

Los tres checks ejecutables del gate pasan. El cuarto necesita un navegador.

---

## Los tres comandos del gate

```
pnpm install --frozen-lockfile  →  Done in 429ms          (node_modules borrado antes)
pnpm verify                     →  120 passed (120) · lint limpio · typecheck limpio
pnpm build                      →  ✓ Compiled successfully · ✓ 4/4 páginas
```

---

## P0-1 — Lockfile con dos documentos YAML

**Confirmado exactamente como lo describe la review.** Verificado:

```
línea 1   ---
línea 2   lockfileVersion: '9.0'
línea 158 ---
línea 159 lockfileVersion: '9.0'
```

**Causa:** `"packageManager": "pnpm@12.5.1"` en `package.json`. pnpm 12 se
autogestiona y escribe sus propios binarios (`@pnpm/exe.*` para las 8
plataformas) como documento separado. No lo detecté porque
`pnpm install --frozen-lockfile` lo tolera sin chistar — lo probé antes de
tocarlo y pasó. Un lockfile que "funciona" no es lo mismo que un lockfile
canónico, y la review tiene razón en no aceptarlo.

**Corrección:** saqué `packageManager` y regeneré. El pin de versión de pnpm
pasó a `engines` como rango cerrado:

```json
"engines": { "node": ">=20", "pnpm": ">=12 <13" }
```

Rango en vez de versión exacta porque `engines` no descarga nada: solo valida.
Pinnear `12.5.1` exacto haría fallar a cualquiera con 12.5.2 sin motivo.

Resultado: **un solo documento, 3029 líneas** (antes 3187 con los binarios).
`--frozen-lockfile` verificado desde `node_modules` borrado.

## P0-2 — STOP global no garantizaba BLACK

**Correcto, y es el hallazgo más importante de esta review.**

La tabla de `deriveOutput` decía: `cue=playing` + `transport=stopped` → `hold`.
Con un `media.play` en `atMs: 0`, un STOP volvía el transporte a t=0 pero el cue
seguía `playing`, así que la pantalla quedaba en `hold` mostrando el primer
frame del contenido.

En el edificio eso es un frame publicitario colgado con el show fuera del aire.

**Peor:** mi propio test de la tabla de verdad afirmaba
`expect(t('playing', 'stopped')).toBe('hold')`. Otra vez un test verde sobre una
semántica equivocada — el mismo patrón que en REVIEW-001 con los fades. Cuando
escribo la tabla de verdad y el test que la verifica en la misma sesión, el test
no verifica nada: repite mi error con otra sintaxis.

**Corrección:**

```ts
if (transport === 'stopped') return 'black';
```

Semántica ahora explícita en el código:

| Acción | Salida | Razón |
|---|---|---|
| PAUSE global | `hold` | el operador congeló algo que está al aire |
| STOP global | `black` | el show no está al aire |
| SAFE MODE | `black` | estado seguro, sin excepciones |

Cuatro tests nuevos, incluido el caso exacto que pidió la review: `media.play`
en 0 ms, play hasta 9000, stop, y las tres pantallas en negro con el cue todavía
en `playing`.

## P1-3 — Media sources como URLs libres

De acuerdo, y el problema es más amplio de lo que parece: no es solo superficie
de ataque, es también dependencia operativa. Una URL externa significa que el
edificio depende de un servidor de terceros para mostrar la pauta, lo que
contradice el principio de operación offline.

**ADR-014, propuesta, no implementada.** `assetId: "sha256:…"` en vez de URL, con
cuatro consecuencias: el hash es la identidad (así el paquete firmado ata el
contenido, no solo los nombres), resolución local en ambos productos, ingesta
solo por CONTROL, y verificación de hash antes de emitir.

No lo implemento porque necesita un pipeline de ingesta que sin CONTROL no tiene
dónde vivir. Sería construir media función. **Bloqueante para CONTROL/EDGE**, no
para cerrar Milestone 1: mientras PREVIS corra local con archivos del propio
repo, el riesgo es acotado.

## P1-4 — `syncGroup` fijo en el edificio

Correcto, y el señalamiento me hizo ver que mezclé dos cosas distintas:

| | Qué es | Dónde va |
|---|---|---|
| **Capacidad** | qué pantallas *pueden* compartir decoder | edificio (física) |
| **Membresía** | qué pantallas comparten decoder *en esta campaña* | show (editorial) |

Puse las dos en el edificio. La capacidad no cambia; la membresía cambia con
cada takeover.

**ADR-013, propuesta, no implementada.** `ScreenSurface.syncCapableWith:
ScreenId[]` y la membresía en `mediaGroups` del show, con preflight validando
que los miembros sean mutuamente capaces y que ninguna pantalla esté en dos
grupos activos.

No ahora porque rompe `version: 1` y no hay campaña que lo necesite: migrar los
demos por una capacidad hipotética es trabajo desperdiciado. **Pero hay que
resolverlo antes del primer show de un cliente pago** — a partir de ahí migrar
el contrato cuesta plata, no solo tiempo.

## P1-5 — Validación geométrica de `uvRect`

Correcto, y falla en silencio, que es lo peor: three envuelve el muestreo, así
que un rect que se sale muestra el borde opuesto del master pegado al final. Sin
error de consola.

Tres `.refine()` en el schema: `w > 0`, `h > 0`, `x + w <= 1`, `y + h <= 1`. Con
epsilon de `1e-9` para que `0.5 + 0.5` no falle por coma flotante.

Seis casos testeados, incluidos los dos válidos (mitad superior y frame
completo) para que el schema no se pase de estricto.

## P1-6 — Media fallida sin ruta de retry

Correcto. La entrada quedaba pegada con `failed=true` y `syncActiveSources` la
saltaba por estar en las fuentes activas, así que `acquire()` devolvía `null`
para siempre. La única salida era F5.

En una sala de control, refrescar la página para recuperar una pantalla no es
una opción.

**Corrección** en `MediaTextureManager`: `release(source)`, `retry(source)`,
`retryAllFailed()`, `failedSources()`. Y `syncActiveSources` ahora libera una
fuente activa **si está fallada**, para que el próximo `acquire()` la reintente.

En la UI: botón "Reintentar clips" que aparece solo si hay errores. Incrementa
un `mediaEpoch` que va como `key` del árbol de media, forzando remonte.

## P1-7 — `compileShow()` antes de escalar

De acuerdo. `resolveStateAt()` ordenaba el timeline en cada llamada: a 60 fps son
cientos de sorts por segundo sobre un array que no cambia.

`compileShow(show)` → `{ events, discontinuities, lastEventMs }`, congelado. El
motor compila al construir y al cargar otro show, y pasa `events` al resolve.

**Deliberadamente sin árboles de intervalos ni índices por keyframe.** La única
optimización es no repetir lo que ya se hizo. El fold completo se conserva
porque es lo que hace el seek correcto por construcción, y esa propiedad vale
mucho más que los microsegundos de mantener estado incremental consistente.

Test del criterio: compilado y sin compilar dan estados idénticos cada 173 ms a
lo largo del show.

De yapa, `hasDeadTail()`: detecta un show que declara más duración de la que usa.
Es cola muerta facturada como tiempo de pauta.

## Hallazgos menores

**`Transport.snapshot()` con status viejo** — correcto. Leía `this.status` antes
de que `getTimeMs()` llamara a `settle()`, así que en el instante exacto del
final devolvía `playing`. `settle()` movido al inicio de `snapshot()`, con test.

**Comentario de SAFE MODE en `building.ts`** — correcto, seguía diciendo "pérdida
de red". Unificado con `PRINCIPLES.md` §4: la pérdida de nube es
`DEGRADED_OFFLINE`; SAFE MODE es solo por fallo local.

**`tsbuildinfo` en el ZIP** — correcto, se coló pese al `.gitignore`. Eliminado y
verificado que no vuelve.

**La horizontal con decoder separado** — correcto. Hoy A+B están frame-locked y
la horizontal no. Para un golpe simultáneo en las tres superficies hace falta
ADR-013 (grupo de tres) o ADR-015 (render frame-exacto). Queda anotado.

## P2-8 y P2-9 — Fotometría y render exportable

De acuerdo con los dos, y con el orden: el relevamiento va primero.

P2-9 quedó como **ADR-015**: modo de render que avanza en pasos fijos de
`1000/fps` y espera el frame exacto con `requestVideoFrameCallback` antes de
capturar, sin tiempo de pared. El motor ya lo permite —`resolveStateAt(t)` es
pura y la cámara determinista existe—, así que es trabajo de la capa de render.

P2-8 no lo convierto en ADR porque no es una decisión de arquitectura: es una
lista de insumos del relevamiento. Está en `docs/hardware/README.md`.

---

## Gate — estado

| # | Check | Estado |
|---|---|---|
| 1 | lockfile único + `--frozen-lockfile` | ✅ **verificado desde node_modules borrado** |
| 2 | STOP global = BLACK con test | ✅ 4 tests, incluido `media.play` en 0 ms |
| 3 | Prueba visual en Chrome/Edge de `test_sync_001` | ❌ **no tengo navegador** |
| 4 | 3 minutos de play/pause/seek/stop sin stutter | ❌ **no tengo navegador** |

### Sobre el check 3 — avancé lo que se puede sin navegador

La vez pasada dije que la orientación del UV era "lo más probable que falle".
Lo razoné en vez de dejarlo como incógnita:

1. Extraje un frame del master con ffmpeg y confirmé que la mitad de **arriba**
   dice SCREEN A.
2. `VideoTexture` tiene `flipY = true` por defecto, así que la imagen se ve
   derecha sobre el plano. El muestreo es `v = v_plano * repeat.y + offset.y`, y
   con la imagen derecha `v = 0` cae abajo.
3. Entonces `offset.y = 0.5, repeat.y = 0.5` → `v ∈ [0.5, 1]` → mitad de arriba
   → SCREEN A.

Que es lo que dicen los shows demo. **El mapeo debería estar bien**, y el
razonamiento quedó escrito en el código para que el próximo que lo lea no tenga
que rederivarlo.

Sigue necesitando el chequeo visual: es una cadena de tres supuestos sobre
comportamiento de three y del navegador, y ninguno lo ejecutó nadie.

### Los checks 3 y 4 no los puedo cerrar yo

No hay Chromium ni Playwright en este entorno, y los binarios de navegador no se
descargan desde los registros npm a los que tengo acceso. Lo verifiqué, no lo
asumí.

Lo que sí hice: build de producción, servidor levantado, y confirmación de que
sirve la página, los shows y los MP4 con range requests (206).

Lo que falta medir, en orden de probabilidad de encontrar algo:

1. **Los umbrales de deriva (120/600 ms)** sobre MP4 real. Son valores de
   partida, nunca medidos. El check 4 del gate es exactamente esto.
2. **Barras rojas simultáneas** en A y B. Si alguna vez aparecen en frames
   distintos, el decoder único falló y hay que entender por qué.
3. **La orientación del UV**, aunque ahora tengo razones para creer que está bien.

---

## Lo que sigue bloqueado por afuera del software

El relevamiento físico. La geometría del edificio sigue inventada salvo A y B, y
todo lo de Milestone 2 —fotometría, perfiles IES, hero viewpoints medidos—
depende de eso. No lo destraba ningún modelo ni más código.
