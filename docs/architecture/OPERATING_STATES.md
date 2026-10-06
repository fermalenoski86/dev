# Estados de operación del edificio

**Documento canónico.** Si otro archivo del repo dice algo distinto sobre
SAFE MODE o DEGRADED_OFFLINE, este gana y el otro está mal.

## Los tres estados

| Estado | Qué significa | Qué se ve en el edificio |
|---|---|---|
| `NORMAL` | CONTROL alcanzable, programación al día | la programación |
| `DEGRADED_OFFLINE` | se perdió internet o CONTROL | **la programación local cacheada, sin cambios** |
| `SAFE_MODE` | falla o riesgo **local** | pantallas en negro, iluminación cálida segura, reloj normal |

## DEGRADED_OFFLINE — perder la nube no apaga el edificio

**Disparador:** pérdida de conectividad con internet o con CONTROL (a futuro:
heartbeat sin respuesta).

**Comportamiento:**

- La programación local cacheada **continúa**. Los shows que estaban agendados
  salen al aire igual.
- No entran campañas nuevas ni cambios de programación.
- Se alerta al operador.
- **NO** dispara SAFE MODE automático.

Por qué: si perder internet apagara el edificio, el enlace de fibra pasaría a ser
un punto único de falla de la operación comercial, y cualquier corte de un
proveedor sería una pauta caída en la esquina más visible del país.

## SAFE_MODE — reservado para fallo local

**Disparadores, todos locales:**

| Categoría | Ejemplos |
|---|---|
| Fallo local | watchdog de EDGE, fallo de comunicación con procesadores LED o nodos DMX |
| Contenido inválido | clip que no decodifica, paquete que no pasa validación o firma |
| Seguridad | detección de manipulación, vencimiento del lease de operación (ver abajo) |
| Intervención manual | botón físico en sala de control, comando del operador |
| Normativa | restricción horaria / municipal |

**Comportamiento** (implementado en `resolveStateAt` con `safeMode: true`):

- Las tres pantallas en `black`. Sin excepción, incluso si estaban en `hold`.
- Iluminación en la escena `safe_mode`, **sin fade**: el estado seguro no se
  negocia con lo que el show venía haciendo.
- Reloj en `normal`.
- **Nunca apagón total.** Un edificio a oscuras en esa esquina también es noticia.
- `play()` queda bloqueado hasta salida explícita. El show nunca puede volver
  solo a SAFE MODE.

## El lease de operación — el único caso limítrofe

CONTROL otorga a EDGE permiso de operar autónomo por N horas (propuesta: 72).
Si EDGE no lo renueva, al vencer entra en SAFE MODE.

Esto **no** es "perder internet dispara SAFE MODE". Durante las primeras 72 h de
corte el edificio sigue en DEGRADED_OFFLINE con su programación. El lease existe
para acotar cuánto puede emitir sin supervisión un EDGE comprometido o
abandonado, y por eso está en la categoría *seguridad*.

**Decisión abierta, no técnica:** un corte de conectividad de más de 72 h termina
en SAFE MODE. Si comercialmente eso es inaceptable, el número se sube; lo que no
conviene es sacar el lease, porque entonces un EDGE comprometido emite para
siempre.

## Estado de implementación

| | PREVIS (hoy) | EDGE (futuro) |
|---|---|---|
| SAFE MODE en el motor | ✅ `ShowEngine.enterSafeMode()` | reutiliza el mismo motor |
| SAFE MODE → pantallas negras | ✅ testeado | — |
| Botón manual | ✅ en la barra de transporte | botón físico |
| Clip caído | ⚠️ PREVIS pausa y avisa; no entra en SAFE MODE | debe entrar en SAFE MODE |
| DEGRADED_OFFLINE | no aplica: PREVIS corre 100 % local | por implementar |
| Watchdog, lease, firma | no aplica | por implementar |

La diferencia de la fila "clip caído" es deliberada: en PREVIS el operador está
mirando y necesita poder reintentar; en el edificio nadie está mirando.
