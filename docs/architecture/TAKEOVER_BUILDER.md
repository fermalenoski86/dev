# TAKEOVER BUILDER — M2C.1

Herramienta de **autoría**. Permite armar una campaña sin escribir JSON, y
compila al SHOW PACKAGE que ya ejecuta el motor.

```
TakeoverDraft → compileTakeoverDraft() → ShowPackage → preflightShow() → ShowEngine
```

## La restricción que define el modelo

`SHOW PACKAGE v1` declara `media: Record<ScreenId, string>`: **una fuente por
pantalla para todo el show**. `media.play` no lleva source. Y `mediaGroups`
asocia un grupo a **una** fuente, con una pantalla en un solo grupo.

Por lo tanto:

- Un moment **no puede cambiar de asset**.
- No se puede mezclar A+B independiente y A+B master en la misma campaña.

Como `show-engine` está cerrado en esta etapa, el modelo de autoría se adapta al
contrato. El asset se asigna **por superficie a nivel campaña**; cada moment
controla la reproducción:

| Directiva | Qué emite el compilador |
|---|---|
| `hold` | **nada** — la continuidad es ausencia de evento |
| `black` | `media.stop` |
| `play` | `media.play` con `fromMs` |

Es, además, como se produce un takeover real: un master por superficie,
segmentado. Ver ADR-030.

## Separación de responsabilidades

```
AUTHORING  ≠  PREVIEW  ≠  PUBLISH  ≠  HARDWARE
```

- **Authoring** — el draft y el compilador. Datos puros.
- **Preview** — un `ShowEngine` real cargado con el paquete compilado. **No hay
  un segundo motor**: el timeline del builder dibuja el playhead, no resuelve
  runtime.
- **Publish** — no existe todavía. Exportar un JSON no pone nada al aire.
- **Hardware** — no existe. Ni Modbus, ni DMX, ni Art-Net, ni procesadores.

El compilador produce un objeto serializable: sin funciones ni handles. Hay un
test que lo verifica, por la misma razón que en ADR-018.

## Assets

Solo namespaces controlados: `/demo/` y `/assets/`. La regla no se
reimplementa: se reutiliza `isLocalMediaPath()` de show-engine, la misma que
aplica preflight.

Un archivo arrastrado a la ventana queda `unmanaged`: sirve para mirar y
**bloquea la exportación**. No se sube a ningún lado.

Estados: `OK` / `WARNING` / `BLOCKED`. Bloquean aspecto incompatible, asset
inexistente, ruta fuera de namespace y archivo sin registrar. Advierten
resolución inferior a la pantalla y clip más corto que su uso.

## Validación

`validateDraft()` **no reimplementa** preflight. Compila, pasa el paquete por
`preflightShow()` —el mismo que usa CONTROL— y lo único que agrega es
traducción: mapear cada issue al moment que lo causó para marcarlo en el
timeline.

Si hubiera una segunda copia de las reglas, el editor diría "listo" sobre
paquetes que el motor rechaza, y la versión que le habla al usuario sería la que
nadie actualiza.

## Frame-lock y la horizontal

Modo A+B master usa `mediaGroups` con `uvRect` calculado desde los píxeles
reales de cada superficie (1152 y 1440 sobre 2592), no desde una fracción
inventada: así el aspecto de cada recorte coincide con el físico.

En modo master, **ambas torres reciben el mismo cue**. Cues distintos las
separarían y romperían el frame-lock.

Incluir la horizontal en el grupo es una **preview conceptual**: emite
`SYNC HARDWARE NOT VERIFIED` y nunca se exporta como capacidad confirmada. La
capacidad física depende de que comparta procesador y reloj de video con A y B,
y eso no está confirmado con el integrador.

## Reloj

Solo los estados que el contrato resuelve hoy: `normal`, `off`, `accent`,
`countdown`. BRAND y EVENT aparecen en la UI como capacidades futuras y el
schema los rechaza: inventar un estado que el motor no resuelve produciría un
show que compila y no se ve como el editor prometió.

## Cierre de campaña

El compilador emite siempre un retorno a la escena de identidad al final, con
`fadeMs: 0`. Un evento en el último ms no tiene tiempo de fundir: con el fade
propio de la escena, en `durationMs` el progreso es 0 y el edificio queda
mostrando la escena de marca fuera de pauta.

Es la red de seguridad, no la transición. Una vuelta suave se declara como un
moment de salida.

## Assets de McDonald's

**No hay material de McDonald's en el repositorio.** El preset
`MCDONALDS_TAKEOVER_15S` usa los patrones de prueba con timecode que sí existen.

No lo descargué —sería traer IP de un tercero a un repo— ni lo generé —sería
fabricar una pieza publicitaria de una marca que no la encargó—. La estructura
temporal es la pedida y la escena `mcd_red_gold` sí es real, así que sirve para
mostrar el flujo; lo que se ve en las pantallas es un patrón de test.
