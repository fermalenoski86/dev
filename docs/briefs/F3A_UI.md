# F3(a) UI — Versión vigente en `platform-web` — brief corto para acordar

**Origen:**

- Q6 del brief F3(a) (`docs/briefs/F3A_REDEPLOY.md`): primero la API, después
  la UI en una unidad separada, trazada en
  [#55](https://github.com/fermalenoski86/dev/issues/55).
- `AUDIT: APROBADO` de la API en
  [#56](https://github.com/fermalenoski86/dev/pull/56#issuecomment-6113127134)
  (`main@8fae6fe`). El auditor escribió: "Claude prepara el brief corto de la UI
  de versión vigente (#55/Q6), en PR separado desde main, para acordar alcance y
  pruebas antes de codificar".

**Propuesto por Claude el 2026-10-11. Ronda 1 incorporada el mismo día** (§5, §6 y §7). Es solo documentación: no se codifica
nada hasta el `AUDIT: APROBADO` de este brief. Lo que el repo no decide va
marcado con ❓. Si una ❓ cambia producto, va a `decisión-producto` para Fer.

## 0. Qué NO se toca

- `apps/control`, la experiencia ejecutiva M2C.2, los renderers, la geometría,
  los screenshots congelados ni `e2e/`; los 14 E2E de M2C siguen siendo gate.
- Storage B1 y `platform-approval`.
- La API de F3(a), salvo lo que pidan ❓ explícitas de abajo. La propuesta es
  **no cambiarla**.
- Nada de Deploy, EDGE ni Scheduler. La pantalla dice en texto, siempre
  visible: **"Versión vigente administrativa: no despliega contenido al
  edificio."**

## 1. Dónde vive: una página propia (❓1)

**Propuesta:** una ruta nueva, `/campaigns/[id]/active-version` ("Versión
vigente"). No es una sección dentro de `CampaignDetail`.

**Motivo:** el detalle de campaña hoy falla para INTERNAL_APPROVER con un 403 de
assets ([#43](https://github.com/fermalenoski86/dev/issues/43), pendiente de
Fer). Quien confirma es justamente INTERNAL_APPROVER. Si la vista viviera en el
detalle, confirmar dependería de cómo se resuelva #43.

La página nueva carga solo lo que todos los roles internos pueden leer:

- `GET /campaigns/:id` (vigente y pedido pendiente);
- `GET /campaigns/:id/active-version-changes` (historial);
- `GET /campaigns/:id/versions` (para elegir una APPROVED).

No toca `GET /assets`.

**Dependencia con #43, explícita y sin resolverla:**

- La página funciona igual con la opción 1 o la 2 de #43.
- Con la opción 1, el detalle de campaña también enlazaría a esta página.
- Con la opción 2, INTERNAL_APPROVER llega por los enlaces de abajo.
- Esta unidad no cambia `CampaignDetail` salvo para agregar el enlace. Lo
  agrega sin condicionarlo a #43: hoy el detalle se ve solo para
  OPERATOR/ADMIN.

**Enlaces de entrada:**

- en `/campaigns`, un enlace "Versión vigente" por fila;
- en `/versions/:id`, junto al de historial;
- en el detalle de campaña.

## 2. Qué muestra

1. **Vigente:** `vN · hash` completo y enlace a `/versions/:id`, o "Sin versión
   vigente". Al lado, la "Última aprobada" como dato aparte, para que nunca se
   confundan (A2.2).
2. **Pedido pendiente:**
   - de qué versión a qué versión, con los dos hashes;
   - el motivo;
   - quién lo pidió (ver ❓3);
   - cuándo vence: la fecha absoluta que da el servidor, más "vence en ~X" con
     el reloj del navegador, marcado como aproximado.

   La UI nunca decide por el reloj del navegador: lo decide la base.
3. **Historial**, más nuevo primero, paginado con "Cargar más" igual que BL-31:
   - estado en texto (no solo en color);
   - origen → destino;
   - quién pidió y quién decidió;
   - fechas y motivo.

## 3. Acciones según rol

El servidor es la autoridad: la UI esconde lo que no corresponde, pero si
igual llega un 403, lo muestra.

| Acción | Quién la ve | Qué manda |
|---|---|---|
| **Pedir** | OPERATOR o ADMIN, sin pedido pendiente | Elige una versión APPROVED distinta de la vigente y escribe el motivo (1–2000). `versionHash` sale del resumen de la versión; `expectedActiveVersionId` es la vigente que **muestra la página** (o `null`) |
| **Confirmar** | INTERNAL_APPROVER o ADMIN, **solo si no es quien pidió** | Antes, un paso explícito: "Vas a cambiar la vigente de vX (hash) a vY (hash). Motivo: …" con botón "Confirmar cambio". Manda `versionHash` = `toVersionHash` del pedido |
| **Cancelar** | Quien pidió, o ADMIN | Sin cuerpo |

Si el usuario tiene los dos roles y es quien pidió, ve el pedido con el texto
"Lo tiene que confirmar otra persona" y no ve el botón. Es un test.

## 4. Errores y conflictos

Todo 409 se muestra con su mensaje y la página **vuelve a leer el estado**:

| Código | Qué ve el usuario |
|---|---|
| `ACTIVE_VERSION_CONFLICT` | "La vigente cambió mientras tanto". Al pedir, no se creó nada; al confirmar, el pedido quedó cancelado |
| `ACTIVE_VERSION_CHANGE_EXPIRED` | "El pedido venció; hay que pedirlo de nuevo" |
| `ACTIVE_VERSION_CHANGE_PENDING` | "Ya hay un pedido pendiente", con el pendiente a la vista |
| `ACTIVE_VERSION_UNCHANGED` | "Esa versión ya es la vigente" |
| `VERSION_HASH_MISMATCH` | "La versión cambió desde que la viste; recargá" |
| `INVALID_STATE_TRANSITION` | "El pedido ya no está pendiente" o "La campaña está archivada", según `details` |
| `FOUR_EYES_VIOLATION` / `FORBIDDEN` | Sin permiso: el mensaje del servidor |
| `IDEMPOTENCY_KEY_REUSED` | Mensaje genérico. No debería pasar, ver ❓2 |

Sin sesión, el comportamiento es el de siempre (`SessionGate`). Un error de red
se muestra con el botón "Reintentar".

## 5. Idempotencia en la UI (❓2, ajustada en la ronda 1)

Hoy el cliente usa una key nueva por llamada. La propuesta es **una
"intención" por operación del usuario** (pedir, confirmar o cancelar). La
intención guarda juntos la **key y el payload exacto**: ruta, ids y cuerpo,
incluido `expectedActiveVersionId`.

**Ciclo de la intención (igual para pedir, confirmar y cancelar):**

1. **Se crea** cuando el usuario envía el formulario de "Pedir" o aprieta
   "Confirmar cambio" o "Cancelar pedido". Se genera la key y se congela el
   payload con lo que la página mostraba en ese momento.
2. **En vuelo:** el botón queda deshabilitado y no se puede crear otra
   intención para la misma acción. Así no hay doble envío.
3. **Resultado incierto:** la intención se conserva y la pantalla muestra "No
   sabemos si se aplicó" con el botón **"Reintentar"**. El reintento manda **la
   misma key y el mismo payload**: no se genera otra key ni se reconstruye nada
   desde un GET nuevo. Se considera incierto:
   - error de red, corte o timeout (`NETWORK_ERROR`, status 0);
   - respuesta con cuerpo ilegible o que no valida contra el schema
     (`UNEXPECTED_RESPONSE`, aunque el status sea 200 o 201);
   - cualquier 5xx, incluidos 502 y 504 de un intermediario, que pueden llegar
     después del COMMIT del origen (RFC 9110 §15.6).
4. **Resultado definitivo:** se descarta la intención y la página vuelve a leer
   el estado. Es definitivo:
   - un 2xx con cuerpo válido;
   - un 4xx con cuerpo de error válido, incluidos los 409 que terminalizan el
     pedido (vencido o conflicto);
   - un 409 `IDEMPOTENCY_KEY_REUSED`, que en la práctica no ocurre porque el
     payload está congelado.
5. **Abandono explícito:** si el resultado es incierto, el usuario también puede
   apretar "Descartar y volver a leer". Recién ahí se descarta la intención y,
   si quiere, empieza una operación nueva, con otra key. Cambiar versión o
   motivo en el formulario también es una operación nueva.

La intención vive solo en memoria, mientras dura la página: no hay persistencia
entre sesiones ni API nueva. El replay de la API ya garantiza el mismo status
y el mismo body: un 200 o 201 perdido vuelve como replay y no como un 409.

## 6. Pruebas (criterios verificables)

1. **Unidad de vistas** (`views-f3a.test.ts`, como `views-bl31.test.ts`):
   - render por rol y estado: sin vigente, con vigente, con pendiente propio,
     pendiente ajeno, vencido y archivada;
   - botones visibles solo donde corresponde;
   - quien pidió con doble rol no ve "Confirmar";
   - el texto "no despliega contenido" siempre está;
   - estado en texto.
2. **Unidad del cliente y de la intención** (`api-f3a.test.ts`):
   - los tres POST mandan CSRF y `Idempotency-Key`;
   - la tabla de §5 completa: red, cuerpo cortado con status 200, 502, 504 y
     500 conservan key y payload; 2xx válido, 4xx válido y 409 terminal la
     descartan;
   - un reintento manda exactamente la misma key y el mismo payload;
   - "Descartar" seguido de un cambio de datos genera otra key;
   - no se puede enviar dos veces mientras hay una intención en vuelo;
   - los schemas Zod de respuesta.
3. **Cliente contra la API real** (`platform-web-f3a.db.test.ts`, como
   `platform-web-bl31.db.test.ts`), con HTTP, CORS, cookie y PostgreSQL:
   - OPERATOR pide, INTERNAL_APPROVER confirma y la vigente cambia;
   - el mismo usuario no confirma;
   - el conflicto termina en 409 y el pedido queda cancelado;
   - **respuesta perdida con la operación aplicada**, para pedir, confirmar y
     cancelar: el `fetch` del navegador simulado deja pasar la solicitud a la
     API real pero corta el cuerpo de la respuesta. Después el reintento de la
     misma intención devuelve el status y el body originales, con un solo
     cambio y un solo evento de audit;
   - lo mismo con un **502 o 504 interpuesto** por un proxy de prueba después
     de que la API respondió;
   - una intención distinta usa una key nueva y no es un replay;
   - el historial se pagina, y el detalle de un pedido viejo se resuelve por
     ids y páginas siguientes, sin suponer que la versión está en la primera
     página.
4. **E2E Playwright** (`e2e-platform/active-version.spec.ts`), con dos sesiones
   reales:
   - el operador pide volver a v1;
   - el aprobador interno entra por `/campaigns` (no por el detalle, #43) y
     confirma;
   - la vigente se ve cambiada en las dos sesiones;
   - axe sin violaciones;
   - screenshots en el manifest de evidencia (BL-29).

   Puntos de aceptación nuevos: `F3A-UI-1` (flujo) y `F3A-UI-2` (cuatro ojos
   en navegador).
5. **Mutaciones `f3aui:`:**
   - mostrar "Confirmar" a quien pidió;
   - mandar `expectedActiveVersionId` de otra fuente que la página;
   - key nueva en el reintento;
   - descartar la intención ante una respuesta incierta (`UNEXPECTED_RESPONSE`
     o 5xx);
   - reconstruir el payload del reintento desde un GET nuevo;
   - permitir un segundo envío en vuelo;
   - no recargar tras un 409;
   - esconder el texto "no despliega".
6. **Gates de siempre:** M2C 14/14, `next build` estricto (BL-30), y
   OpenAPI/DELIVERY sin cambios de la API.

## 7. Preguntas acordadas (ronda 1, [#60](https://github.com/fermalenoski86/dev/pull/60#issuecomment-6114285205))

| # | Pregunta | Acordado |
|---|---|---|
| ❓1 | ¿Página propia o sección del detalle de campaña? | **Aceptada:** página propia `/campaigns/[id]/active-version`, independiente de `GET /assets`. #43 sigue abierto; sin cambios de permisos en el backend |
| ❓2 | ¿Una key por intención, con reuso en el reintento? | **Aceptada con el ajuste de la ronda 1:** key y payload exacto conservados mientras el resultado sea incierto (§5) |
| ❓3 | ¿Cómo se muestra quién pidió o confirmó? | **Aceptada:** "Vos" si es la sesión; si no, un id corto con acceso al id completo (texto seleccionable y `title`) para trazabilidad. Sin nombres inventados ni ruta de usuarios |
| ❓4 | ¿El paso "Confirmar" pide reescribir algo? | **Aceptada:** no. Un paso explícito con origen, destino, hashes y motivo |

**Precisión de implementación:** los detalles de un pedido (número y hash de
las versiones de origen y destino) se reconstruyen con los ids de campaña y de
pedido y la paginación existente de `GET /campaigns/:id/versions`. No se supone
que una versión vieja esté en la primera página.

Con `AUDIT: APROBADO` de este brief, la implementación va en `fase/f3a-ui` como
PR aparte, con reporte `docs/reviews/F3A_UI.md`, salida real y autorrevisión
A/B/C.
