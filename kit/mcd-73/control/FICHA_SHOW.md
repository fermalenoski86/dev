# Ficha del show (TRUST Control · kit #73)

SIMULACIÓN CONCEPTUAL: no conectada a equipos reales.

El pedido escrito ("Tu idea") se convierte en una **ficha JSON**. El motor solo ejecuta fichas validadas (`validarFicha` en `app.js`, y de nuevo `MOTOR.setFicha`).

Hoy la ficha la arma un intérprete local con reglas, sin IA. Más adelante la puede armar un modelo de IA con este mismo formato. Como todo pasa por la validación, la IA no puede pedir nada que el edificio no tenga, ni inventar marcas: los logos y el packaging salen del pack oficial.

```json
{
 "version": 1,
 "creatividad": "P",              // A marca · B producto · C recorrido · D papas · E desayuno · F lanzamiento · P tu idea
 "estilo": "custom",              // rojo · dorado · calido · custom (usa "paleta")
 "intensidad": 1,                 // 0,88–1,12
 "paleta": ["#6CACE4", "#F4F4F4"],// hasta 3 hex; en luces se pasan a RGBW con la regla comercial (2 canales + W)
 "titular": "VAMOS ARGENTINA",    // ≤ 40 caracteres, sin HTML
 "producto": "helado",            // helado · papas · cafe · hamburguesa · null (ilustración genérica)
 "energia": 1,                    // 0,7–1,35 (movimiento del contenido)
 "efecto": "ola",                 // barrido · ola · latido · destello · degrade · respiracion · persecucion · null
 "velocidad": 1,                  // 0,6–1,6
 "zonas": ["superior", "cupula"], // superior · medio · inferior · ochava · cupula; vacío = toda la fachada
 "luces": true,                   // false = «solo pantallas» (la fachada queda cálida)
 "pantallas": true,               // false = «solo luces» (pantallas institucionales); nunca las dos en false
 "cruzar": false                  // regla de corte: true solo si se pide una pieza que cruce las dos pantallas
}
```

## Regla de corte

Entre Corrientes y Pellegrini está la cúpula. Una palabra o un logo que cruza las dos pantallas se lee partido (por ejemplo «McD | ld's»). Por eso:

- **Varias palabras:** se reparten por palabra, cada una entera en su pantalla (VAMOS | ARGENTINA).
- **Una sola palabra o el logo:** va entero en cada pantalla (eco), y el brillo pasa de una a la otra.
- **Partir:** solo si el pedido lo dice («que cruce las dos pantallas», «de punta a punta», «una sola pieza»), o con elementos en movimiento que viajan de una pantalla a otra.

## Biblioteca de efectos para las 46 luminarias

Los efectos corren en el takeover, de 5 a 10 s (`motor.js`, `EFECTOS`).

| efecto | qué hace |
|---|---|
| barrido | una franja de luz recorre la fachada de Corrientes a Pellegrini |
| ola | ondas de color que suben de la planta baja al coronamiento |
| latido | doble pulso en toda la fachada; la ochava toma el segundo color |
| destello | luminarias sueltas destellan sobre una base suave |
| degrade | los colores se funden a lo largo de la fachada y se desplazan lento |
| respiracion | la fachada sube y baja lento, en un solo color |
| persecucion | (base) sectores de 3 que avanzan con los 3 colores |

## Para conectar una IA

Pendiente de autorización de costo. El modelo recibe el pedido y devuelve **solo** la ficha, que pasa por `validarFicha` antes de aplicarse.

La clave queda en un servidor local en la PC del operador. Nunca va en el HTML ni en el repositorio.
