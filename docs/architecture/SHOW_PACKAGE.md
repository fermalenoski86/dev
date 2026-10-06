# SHOW PACKAGE v1

Contrato único entre PREVIS, CONTROL y EDGE. Definido en
`packages/shared-types/src/index.ts` y validado con Zod en toda frontera.

## Estructura

```json
{
  "id": "mcdonalds_takeover_001",
  "name": "McDonald's Takeover Demo",
  "version": 1,
  "durationMs": 30000,
  "media": { "screen_a": "/demo/mcd_a.mp4" },
  "initialState": { "lightingScene": "trust_normal", "clockState": "normal", "camera": "hero_obelisco" },
  "timeline": [ { "atMs": 5000, "type": "media.play", "target": "screen_a" } ]
}
```

Todo tiempo en **milisegundos enteros**. Sin excepciones.

## Media y grupos

```json
"media": { "horizontal": "/demo/test_horizontal.mp4" },
"mediaGroups": {
  "towers": {
    "source": "/demo/test_towers_master.mp4",
    "canvas": { "width": 2592, "height": 576 },
    "layout": {
      "screen_a": { "x": 0,        "y": 0, "w": 0.444444, "h": 1 },
      "screen_b": { "x": 0.444444, "y": 0, "w": 0.555556, "h": 1 }
    }
  }
}
```

- **`media`** — una fuente por pantalla, decoder propio.
- **`mediaGroups`** — varias pantallas, **un** decoder, un recorte por pantalla.
  Lo define cada show: la misma pantalla puede ir sola en una campaña y en grupo
  en otra. El edificio solo declara qué pantallas *pueden* agruparse
  (`syncCapableWith`). Ver ADR-013.
- Un grupo tiene prioridad sobre `media` para sus miembros.
- Una pantalla no puede estar en dos grupos.

### Fuentes: solo rutas locales

Hasta ADR-014 (assetId), toda fuente tiene que ser una ruta local absoluta:
empieza con `/`, sin esquema, sin host, sin `..`. `https://…`, `//host/…`,
`file:`, `data:` y rutas relativas los rechaza preflight.

### `uvRect`

Coordenadas de textura normalizadas, origen **abajo** a la izquierda.
Validación: `x, y ≥ 0` · `w, h > 0` · `x + w ≤ 1` · `y + h ≤ 1`.

Para no calcular a mano, `uvFromPixels(canvas, rect)` convierte desde pixeles del
lienzo con origen **arriba** a la izquierda, que es como lo piensa quien produce
el contenido.

Con `canvas` declarado, preflight exige que cada recorte tenga el aspecto físico
de su pantalla (±2 %). Un recorte con otro aspecto se ve estirado en el edificio.

### Lienzo superior actual (P6.67)

| Pantalla | Medida | Pixeles | Recorte |
|---|---|---|---|
| screen_a — Corrientes | 7,68 × 3,84 m | 1152 × 576 | x 0 → 1152 |
| screen_b — Pellegrini | 9,60 × 3,84 m | 1440 × 576 | x 1152 → 2592 |
| | | **2592 × 576** | |

El contenido anamórfico se entrega como **un** archivo de 2592 × 576, no como dos.

## Eventos implementados (v1)

| Tipo | Campos | Nota |
|---|---|---|
| `media.play` | `target`, `fromMs?` | `fromMs` arranca el clip desde un offset |
| `media.pause` | `target` | Congela el clip donde está |
| `media.seek` | `target`, `toMs` | Reposiciona dentro del clip |
| `media.stop` | `target` | Detiene y resetea a 0 |
| `lighting.scene` | `value`, `fadeMs?` | Parcial: no toca zonas que no menciona |
| `lighting.zone.set` | `target`, `intensity?`, `color?`, `enabled?`, `fadeMs?` | |
| `clock.state` | `value` | `normal` / `off` / `accent` / `countdown` |
| `camera.switch` | `value` | Solo PREVIS. EDGE lo ignora. |

## Reservados, NO implementados

`external.trigger`, `artnet.scene`, `led.processor.command`, `analytics.marker`.
Aparecen documentados para que el diseño los admita; el schema los **rechaza**
hoy a propósito, para que nadie publique un paquete que EDGE no pueda ejecutar.

## Sincronía entre pantallas

Dos `media.play` con el mismo `atMs` quedan sincronizados al ms. Es requisito
duro para el contenido anamórfico sobre screen_a + screen_b, y está cubierto por
test.

## Compatibilidad

`version` es literal `1`. Cambiar un ID estable o la semántica de un evento
obliga a `version: 2` + migración. Los IDs publicados son contrato.
