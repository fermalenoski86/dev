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

**Propuesto por Claude el 2026-10-11.** Es solo documentación: no se codifica
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

## 5. Idempotencia en la UI (❓2)

Hoy el cliente usa una key nueva por llamada.

**Propuesta:** **una key por intención del usuario**. Se genera al abrir el
paso de "Confirmar" o al enviar el formulario de "Pedir".

- **Reintento por red:** si la respuesta no llegó y el usuario aprieta
  "Reintentar", se reusa la misma key. Así un 201/200 perdido vuelve como replay
  y no como un 409.
- **Datos cambiados:** si el usuario cambia algo (otra versión, otro motivo),
  la key es nueva.
- **Respuesta recibida:** cuando llegó una respuesta (éxito o error), la key se
  descarta.

Esto usa lo que la API ya garantiza: mismo status y mismo body en el replay.

## 6. Pruebas (criterios verificables)

1. **Unidad de vistas** (`views-f3a.test.ts`, como `views-bl31.test.ts`):
   - render por rol y estado: sin vigente, con vigente, con pendiente propio,
     pendiente ajeno, vencido y archivada;
   - botones visibles solo donde corresponde;
   - quien pidió con doble rol no ve "Confirmar";
   - el texto "no despliega contenido" siempre está;
   - estado en texto.
2. **Unidad del cliente** (`api-f3a.test.ts`):
   - los tres POST mandan CSRF y `Idempotency-Key`;
   - el reintento reusa la key y un cambio de datos la renueva (❓2);
   - los schemas Zod de respuesta.
3. **Cliente contra la API real** (`platform-web-f3a.db.test.ts`, como
   `platform-web-bl31.db.test.ts`), con HTTP, CORS, cookie y PostgreSQL:
   - OPERATOR pide, INTERNAL_APPROVER confirma y la vigente cambia;
   - el mismo usuario no confirma;
   - el conflicto termina en 409 y el pedido queda cancelado;
   - un reintento con la misma key devuelve el mismo 200;
   - el historial se pagina.
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
   - no recargar tras un 409;
   - esconder el texto "no despliega".
6. **Gates de siempre:** M2C 14/14, `next build` estricto (BL-30), y
   OpenAPI/DELIVERY sin cambios de la API.

## 7. Preguntas a acordar

| # | Pregunta | Propuesta |
|---|---|---|
| ❓1 | ¿Página propia o sección del detalle de campaña? | Página propia `/campaigns/[id]/active-version`, independiente de #43 |
| ❓2 | ¿Key por intención, con reuso en el reintento? | Sí (§5) |
| ❓3 | ¿Cómo se muestra quién pidió o confirmó? La API devuelve solo ids y no hay ruta de usuarios | "Vos" si es la sesión; si no, un id corto. Mostrar nombres pide una ruta nueva de lectura de usuarios: va aparte, como propuesta, si se quiere |
| ❓4 | ¿El paso "Confirmar" pide reescribir algo (por ejemplo, el número de versión)? | No. Alcanza con un paso explícito que muestre origen, destino y hashes. El servidor exige el hash exacto |

Con `AUDIT: APROBADO` de este brief, la implementación va en `fase/f3a-ui` como
PR aparte, con reporte `docs/reviews/F3A_UI.md`, salida real y autorrevisión
A/B/C.
