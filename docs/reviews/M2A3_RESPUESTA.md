# M2A.3 — micro-fix final

**Los 2 puntos cerrados. 321 → 338 tests. Mutation check 49/49.
`verify` y `build` con exit 0.**

Salida en `M2A3_SALIDA.txt`, diff en `M2A3.patch`.

---

## 1. ACK integration

El diagnóstico es correcto y el modo de falla era el peor posible: **el ACK
funcionaba en los tests y no en la aplicación**. El store escribía el evento
inline sin `metadata.key`; los tests lo construían a mano y sí lo ponían. Verde
sobre un camino que en producción no existía.

**La corrección no es agregar `key: tr.key` en el store.** Eso arregla el
síntoma y deja la causa: dos formas distintas de construir el mismo artefacto.
Extraje `logAlarmTransitions(log, transitions, opts)` en `control-core`, que es
ahora **el único lugar** donde una transición se vuelve evento. El store lo
importa; el test lo importa. No hay forma de que diverjan.

```ts
logAlarmTransitions(s.log, s.registry.update(evaluadas, now));
```

El metadata lleva `transition`, `key`, `code`, `metric`, `phase`, `value`,
`threshold` y `simulated`.

**Test de integración** (`m2a3.test.ts`): replica el ciclo del store
—provider → `evaluateAlarms` → `registry.update` → `logAlarmTransitions`— sin
reescribir una línea del logger. Si el evento saliera sin `key`, estos tests
fallarían igual que la aplicación.

Verificado:

| | |
|---|---|
| la alarma queda `acknowledged` | ✅ |
| el evento original queda `acknowledged` | ✅ |
| `unacknowledged` del header baja | ✅ |
| la alarma sigue ACTIVE hasta RESOLVED | ✅ (varios ticks, y recién se resuelve al volver a NORMAL) |
| `ALARM_ACKNOWLEDGED` registrado | ✅ con actor y ya reconocido |

Más: que reconocer una condición no reconozca las otras, y que una escalada
vuelva a dejar pendientes ambos lados.

## 2. Series window

Correcto, y la formulación del pedido es la clave: **la tolerancia define el
estado de frescura, no autoriza a inventar mediciones**. Con 5 s de tolerancia
y una lectura de hace 4 s el dato es LIVE, y aun así no hay nada medido en esos
4 s.

Desapareció la rama especial de LIVE: ahora hay un solo camino,
`toMs = min(measuredAt, now)`, y el hueco es `null` solo si la medición es de
este mismo instante.

Caso obligatorio, testeado:

```
now = T0 + 4000 · measuredAt = T0 · staleAfterMs = 5000
quality → LIVE
toMs    → T0   (no now)
gap     → { fromMs: T0, toMs: T0 + 4000 }
```

Un test extra que vale la pena: el `gapFraction` crece de forma monótona
cruzando el umbral (4999 → 5000 → 5001 ms). Antes, pasar de LIVE a STALE
producía un salto visible en el gráfico, porque cambiaba el criterio de corte,
no solo la etiqueta.

---

## Resultados

```
pnpm verify                        [exit 0]   338 passed · lint limpio · 8 typechecks
pnpm build                         [exit 0]   previs ✓ · control ✓
python3 scripts/mutation-check.py  49/49 atrapados
```

Las dos reglas nuevas del mutation check cubren exactamente estos arreglos:
`logger guarda la key` (poner `key: undefined`) y `serie corta en measuredAt`
(volver a cortar en `now` cuando la calidad es LIVE). Ambas quedan atrapadas.

## Sin cambios

Arquitectura, stack, semántica de PREVIS/show-engine, y nada de hardware real.
