# F3(a) UI — Versión vigente en `platform-web`

**Estado:** entregado para auditoría. El brief se aprobó en
[#60](https://github.com/fermalenoski86/dev/pull/60#issuecomment-6115363443)
(`docs/briefs/F3A_UI.md`, `main@1140616`). El auditor escribió: "Claude
continúa desde main en `fase/f3a-ui`, PR separado para #55, implementando
§0–§6".

**Rama:** `fase/f3a-ui` desde `main`. La salida real está en `F3A_UI_SALIDA.txt`.

**No se tocan:**

- la API de F3(a): sin cambios de rutas, permisos ni OpenAPI; `DELIVERY.md`
  solo suma los archivos de test nuevos;
- `apps/control`, M2C (`e2e/`) ni la experiencia ejecutiva;
- storage y `platform-approval`.

No se resuelve #43 y no se adelanta Deploy.

## Qué se entrega

| Archivo | Qué |
|---|---|
| `apps/platform-web/src/components/ActiveVersion.tsx` | Vista pura (`ActiveVersionView`), contenedor y `mensajeError` (§4) |
| `apps/platform-web/src/app/campaigns/[id]/active-version/page.tsx` | Ruta propia (❓1) |
| `apps/platform-web/src/lib/intent.ts` | La "intención" de §5: `Intent`, `isUncertain` y `trasResultado` |
| `apps/platform-web/src/lib/api.ts` | Schemas y métodos de F3(a); las tres mutaciones reciben la key de la intención; `payloadPedido` |
| `apps/platform-web/src/lib/version-history.ts` | `todasLasVersiones`: recorre todas las páginas, sin suponer la primera |
| `Campaigns.tsx`, `VersionReview.tsx`, `CampaignDetail.tsx` | Enlaces de entrada "Versión vigente" |
| `apps/platform-web/src/components/views-f3a.test.ts` | §6.1, 14 tests |
| `apps/platform-web/src/lib/api-f3a.test.ts` | §6.2, 22 tests |
| `apps/platform-api/src/platform-web-f3a.db.test.ts` | §6.3, 14 tests contra la API y PostgreSQL reales |
| `e2e-platform/active-version.spec.ts` | §6.4: `[F3A-UI-1]` y `[F3A-UI-2]` |
| `scripts/acceptance/{points,matrix,cli}.mjs`, `matrix.test.ts` | Ítems de navegador `F3A-UI-1/2`; el escáner de tags acepta `[F3A-UI-N]` |
| `scripts/mutation-check.py` | 11 mutaciones `f3aui:` (§6.5) |
| `docs/platform/ACTIVE_VERSION.md`, `DELIVERY.md`, `M3A1_ACEPTACION.md` | Documentación e inventarios regenerados |

## Decisiones de implementación, declaradas para el auditor

1. **Payload congelado de verdad.** `Intent.start` guarda una copia profunda
   congelada del payload. Si el formulario cambia después, el reintento manda
   lo mismo que la primera vez. Hay test y mutación.
2. **Qué es incierto** (`isUncertain`):
   - status 0 (red, corte o timeout);
   - `UNEXPECTED_RESPONSE`, aunque el status sea 2xx (cuerpo cortado o fuera
     del schema);
   - cualquier 5xx;
   - cualquier excepción que no sea `PlatformApiError`.

   Un 4xx con cuerpo de error válido es definitivo, incluidos los 409 que
   terminalizan el pedido.
3. **Después del resultado** (`trasResultado`): si es incierto, la intención se
   conserva y no se relee el estado. Si es definitivo (ok o error), se descarta
   y la página **siempre** relee.
4. **Una intención por acción** (pedir, confirmar, cancelar). Mientras una está
   viva, en vuelo o incierta:
   - `start` falla;
   - los controles quedan deshabilitados y el formulario congelado.

   "Descartar y volver a leer" es la única salida explícita.
5. **`expectedActiveVersionId`** sale de `payloadPedido(campaign, …)`, con la
   vigente que muestra la página. Nunca de la última aprobada ni de un GET
   nuevo; hay mutación que lo verifica.
6. **Destinos ofrecidos:** solo versiones APPROVED que no son la vigente. El
   servidor igual valida (409/404).
7. **El enlace de cada fila en `/campaigns` dice solo "Versión vigente"** (nombre accesible propio, con la campaña como contexto de la fila; ver ronda 1). Un
   texto accesible con el nombre de la campaña rompía los E2E existentes, que
   buscan el enlace de la campaña por su nombre. El spec nuevo lo busca dentro
   de la fila.
8. **Quién pidió o decidió (❓3):** "Vos" si es la sesión; si no, los primeros
   8 caracteres del id, con el id completo en `title` y en `data-full-id`.
9. **Vencimiento:** se muestra la fecha absoluta del servidor y "vence en ~X"
   calculado con el reloj del navegador, marcado como aproximado. La UI no
   decide nada por ese reloj.
10. **Límite (aclarado por el auditor):** el replay dura lo que la
    Idempotency-Key en el servidor (24 h). La intención vive en memoria, sin
    persistencia entre sesiones.

## Resultados (ejecución real, 2026-10-12, este entorno)

| Gate | Resultado |
|---|---|
| `pnpm verify` | **800 passed + 1 skipped** (+37: 14 de vistas, 22 de cliente e intención y 1 del escáner de tags). Lint: 0 errores, los mismos 12 warnings |
| `pnpm build` (https) | OK |
| PostgreSQL 16 | **342 passed + 6 skipped** (+14: `platform-web-f3a.db.test.ts`) |
| `bootstrap-smoke.sh` | 6/6 |
| media | 63/63 |
| **e2e-platform completo** (local: Playwright 1.56.1 + Chromium 1194, 2 workers, hosts TLS de test) | **9/9 passed**, incluidos `[F3A-UI-1]` y `[F3A-UI-2]`; acceptance con resultados de Playwright: OK |
| mutaciones | **11/11 `f3aui:`** y las 27 `f3a:` (tanda 298:336, 38/38); las 336 corren en el job de CI |
| E2E M2C (14) | **No ejecutado localmente** (sin Chrome con H.264). Evidencia: job `e2e-m2c` |
| manifest de evidencia (BL-29) y contrato S3 | **No ejecutados localmente.** Evidencia: jobs `e2e-platform` y `compose-smoke` |

## Autorrevisión previa

### A. Diff contra el brief

| § | Requisito | Dónde se cumple | Prueba / mutación |
|---|---|---|---|
| 0 | Aviso fijo "no despliega contenido" | `ADMIN_NOTICE`, visible en los tres estados de la vista | views "aviso SIEMPRE"; mutación "esconde el aviso" |
| 1 | Página propia que no carga `/assets`; enlaces desde `/campaigns`, `/versions/:id` y el detalle | ruta nueva; el contenedor solo llama a campaña, historial y versiones | E2E `[F3A-UI-1]`: el aprobador entra por `/campaigns` |
| 2 | Vigente separada de la última aprobada; pendiente con vencimiento; historial paginado | `ActiveVersionView` | views (sin vigente, pendiente ajeno, historial) |
| 3 | Acciones por rol; quien pidió con doble rol no ve "Confirmar"; paso explícito | `puedePedir`, `puedeConfirmar` y `puedeCancelar`; `confirm-step` | views (OPERATOR, INTERNAL_APPROVER, doble rol, ADMIN, archivada); E2E `[F3A-UI-2]`; mutaciones "Confirmar a quien pidió" y "ofrece la vigente o una SUBMITTED" |
| 4 | Mensaje por cada 409 y releer el estado | `mensajeError` y `trasResultado` | views "mensajes"; mutación "no relee tras un error definitivo" |
| 5 | Intención: key y payload ante resultado incierto; descarte definitivo o explícito; sin doble envío; las tres operaciones | `lib/intent.ts` | `api-f3a.test.ts` (tabla de casos, congelado, doble envío); 7 mutaciones |
| 6.3 | Contra la API real: respuesta perdida después del COMMIT (cuerpo cortado, 502, 504) en pedir, confirmar y cancelar → mismo status y body y un solo efecto; intención distinta con otra key; pedido viejo resuelto por páginas | `platform-web-f3a.db.test.ts` | 14 tests |
| 6.4 | E2E con dos sesiones y axe | `active-version.spec.ts` | 9/9 local |
| 6.6 | M2C 14/14, build estricto, OpenAPI/DELIVERY | sin cambios de API | CI |

### B. Revisión adversaria

- **Respuesta perdida:**
  - probada en las tres operaciones;
  - con cuerpo cortado y con 502 y 504 interpuestos después de que la API
    respondió (la operación ya hizo COMMIT);
  - el reintento devuelve el status y el body originales, con un solo evento.
- **Formulario cambiado durante un resultado incierto:**
  - el payload está congelado;
  - los campos quedan deshabilitados;
  - solo "Descartar" habilita una operación nueva.
- **Página vieja:** un pedido con `expected` viejo recibe 409 del servidor (ya
  probado en F3(a)). La UI muestra el mensaje y vuelve a leer.
- **Roles:** lo que la UI esconde lo vuelve a frenar el servidor (403).
- **Reloj del navegador:** solo se usa para el texto aproximado.
- **Paginación:** la versión destino de un pedido viejo puede estar en la
  página 2; se resuelve recorriendo todas las páginas (test con 25 versiones).
- **Regresiones de E2E:**
  - la primera corrida local encontró que el `aria-label` "Versión vigente de
    X" rompía tres specs existentes (`getByRole('link', { name: X })`);
  - se corrigió sin tocar esos specs;
  - la suite completa da 9/9.
- **Decidido no hacer:**
  - nombres de usuario (❓3: sin ruta nueva);
  - persistir intenciones entre sesiones;
  - cambiar la API.

### C. CI

Se cita en el PR el link de la corrida y el SHA exacto del HEAD entregado. No
se pide auditoría sin los 7 jobs en verde.

## Ronda 1 — `AUDIT: CAMBIOS` sobre `ba20f8b` ([#64](https://github.com/fermalenoski86/dev/pull/64#issuecomment-6117503190))

Los cuatro hallazgos P2 se aceptan y se corrigen. No hay cambios de API,
OpenAPI, storage, `apps/control` ni M2C.

| # | Hallazgo | Corrección | Prueba / mutación |
|---|---|---|---|
| 1 | El error de pedir se perdía al releer: con un pendiente nuevo o una campaña archivada, el formulario (y su `ErrorMessage`) se desmontaba | El error de pedir se muestra **fuera** del formulario (`data-testid="request-error"`), así sigue visible aunque el formulario desaparezca | views: pendiente de otro operador y archivada, después de releer; el mensaje aparece una sola vez si el formulario sigue; mutación "el error de pedir se pierde…" |
| 2 | ADMIN podía confirmar con su cancelación en vuelo o incierta | `bloqueada(ops, op)`: confirmar y cancelar deciden sobre el mismo pedido, así que una bloquea a la otra mientras esté viva (en vuelo o incierta). La usan los botones ("Revisar y confirmar", "Confirmar cambio", "Cancelar pedido") **y** los handlers (`onConfirm`, `onCancel`, `onRequest`); `correr` tampoco reintenta contra una decisión opuesta viva | views: las dos direcciones × en vuelo / incierta, y la tabla de `bloqueada`; E2E `[F3A-UI-3]`: cancelación con la red cortada, "Confirmar cambio" deshabilitado, "Reintentar" cancela con la misma key; mutación "la decisión opuesta viva no bloquea" |
| 3 | El atajo 204 del cliente anunciaba éxito y perdía la key en las mutaciones F3(a) | El 204 solo se acepta cuando la llamada no espera cuerpo (`schema === null`, hoy solo logout). En una ruta que promete un recurso, un 204 cae al schema y da `UNEXPECTED_RESPONSE`, que es incierto: la intención conserva la key | api: 204 en pedir, confirmar y cancelar → incierto, conserva la key; logout sigue aceptando 204; mutación "204 sin cuerpo pasa como éxito…" |
| 4a | El E2E "volver a v1" hacía una primera selección | `[F3A-UI-1]` deja v2 vigente por el flujo autorizado de la API (op pide, ap confirma) y recorre en el navegador el cambio **v2 → v1**: el destino no ofrece la vigente; el pendiente y el paso de confirmación muestran origen v2 y destino v1 con sus dos hashes; el historial muestra `v2 → v1` | E2E local 10/10 |
| 4b | El intermediario no guardaba el body original de la respuesta | `posts` guarda la respuesta ORIGINAL de la API (`resBody`, `status`, `idempotent-replayed`) antes de perderla. `mismoReplay` exige, en las 9 combinaciones (corte / 502 / 504 × pedir / confirmar / cancelar), mismo status, `idempotent-replayed` `false` → `true`, el **body completo** igual (`toStrictEqual`) y que el cliente reciba exactamente ese body; además de un solo efecto y un solo evento | PG 14/14 en ese archivo |

**Sobre la decisión 7:** el auditor aclara, con razón, que el enlace **sí**
tiene nombre accesible ("Versión vigente"), con la campaña como contexto de la
misma celda (WCAG 2.4.4 / H79). La redacción de esta revisión decía "sin nombre
accesible"; queda corregida: el enlace no repite el nombre de la campaña.

### Autorrevisión de la ronda

- **A (contra los hallazgos):** cada punto tiene una prueba que falla con el
  código de `ba20f8b`, y las tres correcciones de código tienen mutación. El
  E2E `[F3A-UI-3]` falla con el código anterior: "Confirmar cambio" no quedaba
  deshabilitado.
- **B (adversaria):**
  - el bloqueo es por pedido compartido, no por acción;
  - "Volver" del paso de confirmación sigue dependiendo solo de confirmar,
    porque no decide nada;
  - pedir no se bloquea por confirmar o cancelar, porque es otro pedido y el
    servidor responde 409 PENDING si corresponde;
  - el 204 sigue siendo válido para logout, que es la única llamada sin
    schema: lo cubre un test.
- **Límite:** el bloqueo de los handlers usa la misma función `bloqueada` que
  prueban los tests y la mutación. No hay un test unitario que invoque el
  handler del contenedor, porque `platform-web` no tiene DOM de test. El
  recorrido real lo cubre `[F3A-UI-3]` en Chromium.

### Resultados de la ronda (ejecución real, 2026-10-12, este entorno)

| Gate | Resultado |
|---|---|
| `pnpm verify` | **811 passed + 1 skipped** (+11). Lint: 0 errores, 12 warnings (los mismos) |
| `pnpm build` (con `NEXT_PUBLIC_TRUST_API_URL`) | OK. Una primera corrida sin esa variable falló a propósito por la guarda BL-30; no es un problema del cambio |
| PostgreSQL 16 | **342 passed + 6 skipped** |
| e2e-platform completo (local) | **10/10**, incluidos `[F3A-UI-1]` (v2 → v1), `[F3A-UI-2]` y `[F3A-UI-3]`; acceptance con resultados de Playwright OK (navegador 7 tests) |
| mutaciones (tanda 298:339) | **41/41**: 27 `f3a:` + 14 `f3aui:` (3 nuevas) |
| bootstrap, media, M2C, S3, manifest | **No re-ejecutados localmente.** Esta ronda no toca esas áreas. Evidencia: los jobs de CI sobre el nuevo HEAD |
