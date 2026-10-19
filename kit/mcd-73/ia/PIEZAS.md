# Piezas IA incluidas en control/piezas_ia.js

SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar.

Los originales (HD, clip de 5 s, plan.json, INFORME.md) están en la rama `ia/73-salida`, una carpeta por corrida.

| pieza | Corrientes | Pellegrini | Media | clip |
|---|---|---|---|---|
| 1 · Verano Celeste | corrida 023d051 | 8af3777 | 8af3777 | — |
| 2 · Lluvia dorada | recorte 2:1 de Pellegrini 8af3777 | 8af3777 | 8af3777 | — |
| 3 · Amanecer porteño | 023d051 | 023d051 | 023d051 | — |
| 4 · Brasa Dorada | 023d051 | 023d051 | 023d051 | Corrientes (Kling 2.5) |

Por qué se mezclan corridas:

- En la corrida 023d051, el control de calidad rechazó el Pellegrini del postre y los envases de papas (cortados abajo), pero esas imágenes pasaron por un error de lectura.
- En 8af3777 el control quedó corregido: falla cerrado y regenera cuando no hay veredicto.
- En esa corrida rechazó, con razón, el Corrientes del postre: tenía galletas parecidas a una marca.

Costo de las dos corridas: USD 1,33 + 0,88.

Regenerar el paquete:

```
python3 -I ia/empaquetar.py <carpeta> control/piezas_ia.js
```
