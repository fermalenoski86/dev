# Mejora visual del portal EL TRUST (rama `portal/73-visual`)

SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar. Pedido de Fer del 19/10/2026 con la orden `ORDEN_PARA_CLAUDE.md` (kit visual de ChatGPT).

## Dónde vive el portal (confirmado)
- Repo `fermalenoski86/dev`, rama **`kit/73-mcd`** (no `main`): `kit/mcd-73/web/public/index.html` (portal) y `kit/mcd-73/web/src/worker.js` (entrada con clave, API, material).
- Publica `.github/workflows/kit-web.yml` **solo con push a `kit/73-mcd`**. Esta rama no despliega nada; se publica recién al mergear el PR.
- No se tocó el simulador (`kit/mcd-73/control/`), ni el worker, ni `apps/previs`, ni `main`.

## Archivos cambiados
| Archivo | Cambio |
|---|---|
| `web/public/index.html` | Orden nuevo de secciones, secciones anchas para las demostraciones, fotos reales con pie, CTAs del inicio, piezas oficiales debajo del show. La lógica de crear pieza, material, sesión y gasto no cambia. |
| `web/public/img/foto-*.webp` (4) | Fotos reales del kit (`assets_web/`), sin retoque. |
| `web/public/img/sim-*.webp` (3) | Capturas nuevas del simulador actual (la interfaz del kit era vieja). |
| `web/public/img/color-*.webp` (4) | Renders nuevos del simulador con cada receta de color, pantallas apagadas. |
| `web/public/img/` 5 borradas | `calida`, `estudio`, `hamburguesa-pantallas`, `linea-de-tiempo`, `software`: quedaron sin uso. |
| `web/TEXTOS.md` | P-45 sacado, P-46 reescrito al juntar capítulos, P-88/P-89 corregidos (el Cuarto de Libra no es de la campaña de la Selección), P-92 a P-101 nuevos. |

## Orden de la página
1. **Inicio**: EL TRUST, los tres datos, «Ver simulador» + «Ver la campaña», «Simulación, no conectada a los equipos reales.», pie «Foto de referencia».
2. **Con material real de la marca** (subió desde el puesto 11): el show de la campaña en vivo, a todo el ancho, y abajo, chicas, las 6 piezas oficiales cargadas.
3. **Un edificio que ya es un medio**: foto real del Obelisco con EL TRUST.
4. **De noche y de día**: tres fotos reales (día, atardecer, noche) + la toma partida del simulador, rotulada.
5. **Cómo funciona el edificio** (grupo): tres pantallas · una idea, tres pantallas · 46 luces · probador de efectos a todo el ancho · colores RGBW con la fachada en 4 recetas.
6. **El simulador por dentro**: captura grande + dos estados.
7. **De una frase a un show** (junta los dos capítulos que se repetían) con botón «Crear pieza».
8. Plataforma (estados sin cambios) · Lo que sigue · Herramientas.

## Origen de cada imagen
| Imagen | Origen | Rótulo en la página |
|---|---|---|
| `foto-obelisco-noche.webp` | kit `assets_web/` ← `Trust_referencia_nocturna_10.jpg` | Foto de referencia |
| `foto-fachada-dia.webp` | kit ← `Referencia_fachada_completa_dia_04.jpg` | De día · Foto de referencia |
| `foto-fachada-atardecer.webp` | kit ← `Referencia_fachada_atardecer_aires_02.jpg` | Atardecer · Foto de referencia |
| `foto-fachada-noche.webp` | kit ← `Trust_referencia_nocturna_04.jpg` | De noche · Foto de referencia |
| `sim-takeover/base/calida.webp` | Capturas de TRUST Control actual (este commit), 1920×1080 | Captura del simulador · … |
| `color-calido/blanco/celeste/rojo.webp` | TRUST Control en modo vitrina, recetas del motor (celeste = `hexARGBW('#6CACE4')`), pantallas en 0 | Simulación |
| Hero `trust-noche-completa.jpg` | La foto real del simulador (sin cambios) + luces animadas | Foto de referencia · luces animadas sobre la foto |
| Show de la campaña y 6 piezas | Material oficial que Fer cargó en el portal (R2 privado, detrás de la clave). **No está en el repo.** | Campaña de la Selección… · simulación |

**No se usaron** las capturas del kit `simulador-*.webp`: muestran la interfaz vieja (con «EL TRUST» en las pantallas) y una tiene texto de depuración. En su lugar se capturó el simulador de hoy. `simulador-takeover-rojo` tampoco se usó como campaña oficial.

## Comprobaciones (local, `wrangler dev`, 6 archivos de material cargados)
```
enlaces {"/":200,"/control/":200,"#t-ia":true,"#t-material":true,"/salir":"no se prueba (cierra la sesión)","#cap-material":true,"/control/?pieza=campana-seleccion":200}
material en el portal 6 archivos
show en vivo /control/?vitrina=1&pieza=campana-seleccion
show corriendo {"cargado":true,"t":4.9332,"reproduciendo":true}
probador ola true
piezas oficiales visibles 6
imagenes 16 OK
errores []
```
Las capturas antes/después (1440 px y 390 px) van en el ZIP aparte porque muestran material de McDonald's, que no se sube al repo público.

## Cambios del 20/10/2026 (pedidos de Fer y hallazgo de Codex)
- **Textos en tono formal y explicativo** para gerencia de marketing: se reescribieron todos los de la presentación y las herramientas con los mismos datos (medidas, 3/46/15 s, receta del celeste, estados de los módulos, campaña). Detalle por código en `TEXTOS.md`.
- **Biblioteca de efectos**: en lugar de los puntos sobre fondo oscuro, el efecto corre en el simulador mismo, sobre la foto real del edificio (encuadre de fachada, pantallas apagadas), en bucle del tramo 5–10 s. Debajo, la descripción de cada efecto. El portal maneja el simulador por la misma pestaña (`iframe.contentWindow.MOTOR`): no se cambió el código del simulador.
- **Codex P2 (index.html:539)**: la grilla de piezas oficiales se rehace después de cada subida o reemplazo (`piezasOficiales()`), con `?v=<bytes>` para no mostrar la versión vieja.
- Se sumó `kit/73-mcd` (shows de McÁlvarez, McAllister y McFernández en «Piezas guardadas»).

## Para decidir (Fer)
- Fer había pedido no mostrar las imágenes sueltas; la orden pide mostrar las 6. Quedaron **chicas y debajo del show**, que es el protagonista. Si no las quiere, se saca el bloque `#piezas-of`.
- Siguen en algunas simulaciones (`luminarias.webp`, captura del takeover) las letras «McDonald's» que dibuja el simulador en la banda. Ya estaban publicadas; si se prefiere, se cambian por capturas sin texto.
