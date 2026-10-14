# TRUST Control — presets, zonas y valores RGBW (visual polish, 14/10/2026)

SIMULACIÓN CONCEPTUAL, no conectada a equipos. Los valores son **intensidades visuales de referencia** y canales RGBW (0–100) de previsualización: no son un patch DMX ni potencias calibradas.

## Zonas
| Zona | Equipos | Control |
|---|---|---|
| Fachada superior | SUP-01…16 | intensidad 0–100 % + RGBW |
| Fachada media | MED-01…16 | intensidad 0–100 % + RGBW |
| Fachada inferior | INF-01…14 (fuera de cuadro en esta foto) | intensidad 0–100 % + RGBW |
| Esquina / ochava | SUP-07…11 · MED-09…12 · INF-07…10 (13) | intensidad + RGBW; manda sobre la fila |
| Cúpula | baño de la cúpula (zona `dome` de composition.ts) | intensidad + RGBW |
| Cornisas | **PROPUESTA**: lineales adicionales, fuera de las 46 | intensidad + RGBW |
| **Master iluminación** | todas | escala la intensidad; **no** cambia la mezcla RGBW |

El dimmer de pantallas es otro (screen dimmer); no hay master común. Salida = escena × individual × zona × master.

## Colores (canales R · G · B · W)
| Color | R | G | B | W | Regla |
|---|---|---|---|---|---|
| Blanco cálido (≈3000–3200 K visual) | 30 | 7 | 0 | 78 | W dominante + R leve |
| Blanco arquitectónico | 0 | 0 | 2 | 95 | el W del equipo |
| Rojo McDonald's | 100 | 3 | 0 | 10 | R alto, W bajo |
| Oro | 100 | 55 | 0 | 35 | R alto, G medio, W moderado |
| Ámbar | 100 | 40 | 0 | 18 | puente rojo ↔ cálido |
| Diagnóstico: azul / verde / magenta | 0·25·100·0 / 0·100·15·0 / 100·0·75·0 | | | | solo RGB_DIAGNOSTIC |

En escenas comerciales nunca se usan R, G y B juntos (2 canales + W). Lo verifica `prueba_control.py`.

## Presets
| Preset | Fachada (filas) | Ochava | Cúpula | Cornisas | Pantallas | Reloj (next phase) |
|---|---|---|---|---|---|---|
| ARCHITECTURAL_WARM | 40 % cálido | 46 % | 50 % cálido | 35 % cálido | institucional | neutro |
| NIGHT_IDLE | 37 % cálido | 42 % | 45 % | 32 % | institucional | acento cálido |
| MCD_TAKEOVER | sectores: rojo 70 · oro 40 · cálido 22 % | (patrón) | 40 % oro | 22 % cálido | takeover | oro |
| MCD_SIGNATURE | oro 50 · cálido 45 · rojo 30 % | (patrón) | 55 % oro | 40 % cálido | firma | oro |
| RGB_DIAGNOSTIC | W 45 % + SUP-04 azul, SUP-11 verde, MED-08 magenta | — | 30 % | 25 % | **DIAGNOSTIC MODE** | neutro |
| ALL_OFF | 0 % (queda la luz urbana) | 0 | 0 | 0 | sin cambio | neutro |
| Técnicos | ARCH_WHITE 42 % W · RGBW_FREE 45 % W · CLOSE 30 % | | | | | |

Transición entre presets: 0,5 / 1 / 2 / 3 / 5 s (default 2 s), parte de lo que se ve en ese momento.

## Show MCD_TAKEOVER (15 s, fundidos de 1 s entre momentos)
| t | Momento | Luces | Pantallas (una sola pieza) |
|---|---|---|---|
| 0–2 | NORMAL | cálida 38 % (ochava 42 %) | noche institucional → negro |
| 2–5 | BRAND REVEAL | cálida baja a 25 % (ochava 34 % de volumen); rojo sube a 55 % de Corrientes a Pellegrini | una luz nace en Corrientes, cruza a Pellegrini y aterriza en la media; lo recorrido se enciende |
| 5–10 | FULL TAKEOVER | rojo 72 · oro 42 · cálido 22 % × jerarquía 0,92 → 66 · 39 · 20 % | máxima presencia: A nombre gigante entre las 2 superiores · B producto + macro · C cinta continua + marca en la media |
| 10–13 | SIGNATURE | oro 50 · cálido 45 · rojo 30 % | onda dorada como firma, marca serena |
| 13–15 | EXIT | a ARCHITECTURAL_WARM | vuelve la noche institucional |

Marca: nombre en tipografía y colores de campaña; el logo oficial lo aporta la agencia. Producto: hamburguesa genérica ilustrada.

## Creatividades de pantallas (las 3 como una sola pieza)
| | Nombre | Qué se ve |
|---|---|---|
| A | Marca | el nombre en grande cruzando las dos pantallas de arriba + columnas de luz |
| B | Producto | hamburguesa protagonista en Pellegrini y primer plano en Corrientes |
| C | Recorrido | una luz nace en Corrientes, cruza a Pellegrini y aterriza en la de abajo (default) |
| D | Papas | lluvia de papas doradas en el mismo espacio de las 3 pantallas |
| E | Desayuno | amanecer cálido, café y medialuna |
| F | Lanzamiento | cuenta regresiva 3 → 2 → 1 de pantalla en pantalla, destello y producto |

Ilustraciones genéricas (sin envases ni logos oficiales). La marca va en letras; el logo y los spots oficiales se cargan con «Subir video o imagen».

## Estilo del show (lo elige el pedido escrito)
| Estilo | Takeover (5–10 s) | Cierre (10–13 s) |
|---|---|---|
| rojo (default) | rojo 72 · oro 42 · cálido 22 % | oro 50 · cálido 45 · rojo 30 % |
| dorado | oro 62 · rojo 66 · cálido 24 % | oro 58 · cálido 45 · oro 40 % |
| cálido (sobrio) | cálido 50 · oro 42 · rojo 55 % | cálido 48 · oro 42 · cálido 48 % |

Intensidad: suave ×0,88 · normal ×1 · fuerte ×1,12 (entre 2 y 13 s). Palabras clave: lanzamiento/nuevo → F · desayuno/café → E · papas → D · producto/hamburguesa → B · logo/marca → A · recorrido/onda → C · dorado · elegante/sutil · impacto/fuerte.
