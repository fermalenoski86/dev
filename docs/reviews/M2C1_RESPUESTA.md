# M2C.1 — Takeover Builder

**388 tests (antes 338). Mutation check 65/65. `install --frozen-lockfile`,
`verify` y `build` con exit 0.**

Salida en `M2C1_SALIDA.txt`. Ejemplos en `docs/examples/`.

---

## Nota de procedencia — importante

Al empezar encontré el módulo **ya implementado en el contenedor**: los archivos
de `packages/show-authoring/` y `apps/control/src/components/builder/` estaban
fechados horas antes, con otro usuario, y no salieron de esta conversación. El
contenedor persiste entre sesiones y alguna sesión previa ya había hecho M2C.1.

No lo reescribí. Lo audité contra el pedido, encontré y corregí lo que faltaba,
y verifiqué el flujo completo. Lo que sigue distingue qué estaba y qué agregué.

## Estado encontrado

La implementación previa cubría el pedido casi entero: `TakeoverDraft` con Zod,
`compileTakeoverDraft`, `validateDraft` apoyada en `preflightShow`,
`AssetRegistry` reusando `isLocalMediaPath`, los seis presets, la pestaña
BUILDER con preview 2D, timeline de moments, properties, present mode,
save/load en localStorage, export y vista del compilado. 386 tests en verde.

Las decisiones de fondo estaban bien tomadas, y una es más restrictiva de lo
que yo había anticipado:

> **`ShowPackage.media` es `Record<ScreenId, string>` y `media.play` no lleva
> `source`.** O sea: una fuente por pantalla **para todo el show**. Un moment no
> puede cambiar de asset.

Yo había marcado solo la restricción de `mediaGroups`. La real es más amplia, y
está bien resuelta: el asset se asigna **por campaña** (ADR-030), y los moments
deciden play/hold/black sobre esa fuente. Es la traducción correcta del pedido
§4 a lo que el motor v1 puede ejecutar.

## Lo que encontré mal y corregí

**1. Los assets del registry no existían en el servidor del Builder.**
`createRepoRegistry()` declara `/demo/test_towers_master.mp4` y
`/demo/test_horizontal.mp4`, pero `apps/control/public/` no tenía carpeta
`demo/`: los clips estaban solo bajo `apps/previs`. El draft validaba **READY**
y el archivo daba 404 en pantalla.

Un asset "autorizado" que no existe es peor que uno bloqueado: pasa todas las
validaciones y falla recién delante del cliente. Copié los clips y agregué el
test que lo guarda — verifiqué que falla si la carpeta se borra.

**2. El mutation check no se había vuelto a correr.** Una regla apuntaba a
`timeline.push({ … value: draft.closingSceneId })` y el código ya tenía
`fadeMs: 0`. El script abortaba con `AssertionError` antes de terminar. Corregí
el patrón y agregué cinco reglas nuevas del módulo: `hold` no emite evento,
`black` emite `media.stop`, namespace de assets, ruta local, y que BLOCKED
bloquee el export. **65/65 atrapadas.**

**3. Cinco warnings de lint.** Un `non-null assertion` en `duplicateMoment` y
cuatro `console.log` míos del generador de ejemplos. El generador ahora escribe
`docs/examples/README.md` con el resumen, que sirve más que imprimir en consola.

## Verificación del flujo completo

El preset de McDonald's recorre el camino real —preset → `compileTakeoverDraft`
→ `ShowPackage` → `parseShowPackage` → `preflightShow`— y da:

| | |
|---|---|
| duración | 15000 ms |
| eventos | 14 |
| mediaGroups | `towers` |
| validación del draft | READY |
| preflight | sin errores ni warnings |

Los archivos de `docs/examples/` salen de ese mismo camino, no están escritos a mano.

Smoke test del servidor: `GET /` 200, y los dos clips 200 con su tamaño real.

## Sobre el preset de McDonald's

**No hay assets de McDonald's en el repo.** Solo están los dos clips de prueba
con timecode que generé en su momento. El preset usa esos como placeholder
neutral, con la estructura de 15 s del pedido (0–3 normal, 3–6 reveal, 6–12
takeover, 12–14 signature, 14–15 exit). Está documentado en
`TAKEOVER_BUILDER.md` y en `docs/examples/README.md`.

No descargué logos ni contenido externo.

## Tests

50 en `show-authoring`, cubriendo la lista de §22: schema válido/inválido,
duración > 0, reorder determinista, duplicate con id nuevo, compile
determinista, duración total, atMs acumulativos, pantallas independientes, A+B
master, mediaGroups válidos, assets no autorizados, import malicioso, compilado
contra schema y preflight, preview por ShowEngine, STOP=BLACK, PAUSE=HOLD, SAFE
MODE ganando, ausencia de vía a hardware, los seis presets, y export bloqueado
con BLOCKED.

Más los dos que agregué: existencia real de assets y emisión de ejemplos.

Ningún test anterior se borró ni se relajó.

## Pendiente

**La prueba en navegador.** Sigue sin haber Chromium acá. Verifiqué build,
servidor, assets servidos y typecheck, pero nadie abrió el Builder.

Los 14 puntos del criterio de aceptación dependen de eso. Lo que conviene
recorrer en `localhost:3001` → BUILDER, en orden:

1. Elegir el preset McDonald's y ver los cinco moments en la timeline.
2. Cambiar una duración y ver que los tiempos posteriores se recalculan solos.
3. Reordenar por drag & drop.
4. PLAY — el preview tiene que moverse con el ShowEngine, no por su cuenta.
5. Asignar un asset inválido y ver el BLOCKED con export deshabilitado.
6. Guardar, recargar la página y comprobar que el draft vuelve.
7. EXPORT SHOW PACKAGE y comparar contra `docs/examples/mcdonalds_takeover_15s.show.json`.

**Fuera de alcance, sin tocar:** hardware, Modbus, DMX, Art-Net, GLB, 3D, cloud,
login, scheduler, analytics.
