# TRUST PLATFORM — Principios de seguridad

Este edificio está frente al Obelisco. Una pantalla de 9.6 m tomada por un tercero
no es un incidente informático: es una foto en todos los diarios del país. La
superficie de ataque acá es reputacional antes que técnica, y el diseño arranca
desde ese supuesto.

PREVIS todavía no controla hardware. Estos principios se escriben ahora igual,
porque la arquitectura que se elige hoy es la que después no se puede cambiar.

## 1. Separación de planos

| Plano | Qué hace | Dónde vive |
|---|---|---|
| **PREVIS** | Previsualiza. Nunca toca hardware. | Cualquier lado |
| **CONTROL** | Programa campañas, aprueba, audita. | Cloud |
| **EDGE** | Ejecuta shows contra hardware real. | Red local del edificio |

Regla dura: **CONTROL nunca habla directo con un controlador LED ni con un nodo
DMX.** CONTROL publica un SHOW PACKAGE firmado; EDGE lo valida y lo ejecuta.
Un compromiso del cloud no debe poder encender una luz.

## 2. Ninguna API de hardware en el frontend

No hay, ni va a haber, un `fetch()` desde el navegador a un procesador NovaStar,
Brompton o Colorlight. Cualquier credencial que llegue al browser se considera
pública desde el momento en que llega.

## 3. EDGE opera offline por diseño

El edificio debe poder correr su programación completa con el enlace a internet
caído. EDGE guarda localmente:

- el calendario de las próximas 72 h,
- los show packages con su media,
- las escenas de iluminación,
- SAFE MODE.

Perder la nube degrada la operación (no entran campañas nuevas), no la interrumpe.

## 4. SAFE MODE es una primitiva, no una escena

SAFE MODE es un estado del sistema, no un ítem más del catálogo de escenas.

> **Definición canónica:** `docs/architecture/OPERATING_STATES.md`. Esta sección
> resume; si hay diferencia, gana ese documento.

### Dos estados degradados, no uno

REVIEW-001 marcó una contradicción real entre este principio y el §3: si perder
el enlace con la nube disparara SAFE MODE, el edificio no operaría offline —
sería justo lo contrario de lo que dice §3. Se separan:

| Estado | Se dispara por | Qué hace |
|---|---|---|
| `DEGRADED_OFFLINE` | pérdida de heartbeat con CONTROL | **Sigue el calendario cacheado.** No entran campañas nuevas. Alerta al operador. |
| `SAFE_MODE` | fallo local | Estado seguro. Requiere salida explícita. |

Perder internet no puede apagar un edificio. Si lo hiciera, el enlace de fibra
pasaría a ser un punto único de falla de la operación comercial.

### Disparadores de SAFE MODE (todos locales)

- watchdog local de EDGE,
- botón físico en sala de control,
- fallo de reproducción de media o contenido inválido,
- fallo de comunicación con procesadores LED o nodos DMX,
- expiración del **lease de operación**: CONTROL otorga permiso de operar
  autónoma por N horas (por defecto 72). Si EDGE no lo renueva, cae a SAFE MODE
  al vencer. Esto acota el tiempo que un EDGE comprometido o abandonado puede
  seguir emitiendo sin supervisión, sin volver la nube un punto único de falla.
- horario (madrugada / restricciones municipales).

Comportamiento: pantallas en estado neutro, iluminación cálida segura, reloj normal.
Nunca apagón total — un edificio a oscuras en esa esquina también es una noticia.

En el código, `ShowEngine.enterSafeMode()` ignora cualquier `play()` posterior.
Eso es deliberado: el show nunca puede volver solo.

## 5. Acceso remoto

- Sin puertos expuestos a internet en la red del edificio. Cero.
- Acceso técnico únicamente por VPN o ZTNA, con MFA obligatorio.
- Red de hardware audiovisual en VLAN separada de la red administrativa del edificio.
- Nada de RDP/VNC abierto "para el proveedor". El proveedor entra por el mismo
  camino que todos, con cuenta nominal.

## 6. Cadena de aprobación del contenido

Ningún contenido de marca llega a la pantalla sin:

1. carga en CONTROL con usuario nominal,
2. previsualización obligatoria en PREVIS,
3. aprobación explícita de un segundo usuario (cuatro ojos),
4. publicación firmada a EDGE.

El registro de quién aprobó qué y cuándo es tan importante como el sistema técnico.
Es lo que te cubre ante el cliente, ante el municipio y ante el seguro.

## 6-bis. La firma no basta por sí sola

Ver ADR-012. Resumen: clave en KMS/HSM (no en el proceso de CONTROL), firma que
requiere aprobación humana, y **EDGE imponiendo límites físicos incluso a
paquetes válidamente firmados**. Una firma prueba origen, no que el contenido
sea seguro.

## 6-ter. La IA no entra en el lazo de seguridad

> **LLM output is advisory only and cannot directly actuate building hardware.**

El asistente lee telemetría, estado y eventos. No puede encender ni apagar
pantallas, accionar relés, cambiar SAFE MODE, ejecutar shows ni enviar DMX o
Modbus.

Esto no se sostiene con un comentario: se sostiene con los tipos. El asistente
recibe `AiContext` —datos serializables, sin funciones ni handles— y devuelve
texto. No existe el tipo por el cual una respuesta pueda convertirse en acción.
Ver ADR-018.

Lo mismo vale para la telemetría: `ModbusTelemetryProvider` lanza error en vez
de devolver ceros plausibles, porque un dato eléctrico falso presentado como
real es peor que la ausencia de dato (ADR-019).

## 7. Integridad del show package

Los SHOW PACKAGE se validan con Zod en **toda** frontera de entrada (archivo,
API, disco de EDGE). En fase CONTROL se agrega firma criptográfica: EDGE ejecuta
solo paquetes firmados por CONTROL.

Un JSON sin validar es código ajeno corriendo en tu edificio.

## 8. Secretos

Nada de credenciales, endpoints ni tokens en el repositorio. Ni en comentarios,
ni en archivos de ejemplo, ni "temporalmente". Variables de entorno en desarrollo,
gestor de secretos en producción.

## 9. Auditoría

Todo cambio de estado del edificio real queda registrado con timestamp, usuario
y origen (programado / manual / automático). Retención mínima 180 días.
Cuando algo salga mal a las 3 de la mañana, el log es lo único que vas a tener.

## 10. Límites físicos en el nivel más bajo posible

Máximos de brillo, restricciones horarias municipales y límites de parpadeo deben
estar impuestos en EDGE, no en la UI. Una interfaz mal usada no puede poder
violar una norma de contaminación lumínica.

---

## Estado actual (PREVIS MVP)

Implementado hoy:
- [x] Validación Zod de todo JSON externo
- [x] SAFE MODE como primitiva del motor, con test
- [x] Cero APIs de hardware en el código
- [x] Funciona 100 % offline
- [x] Sin secretos en el repo

Pendiente para CONTROL / EDGE:
- [ ] Firma de show packages
- [ ] Autenticación y flujo de cuatro ojos
- [ ] Log de auditoría
- [ ] Watchdog de EDGE
- [ ] Segmentación de red y VPN/ZTNA
- [ ] Límites físicos en EDGE
