# M3A.1 — FASE E: E2E, hardening y docs — brief derivado

**Origen:** `M3A1_MASTER.md` §44 (FASE E = E2E · hardening · docs), con
§33–§43, §46 (gate final), §47 (entrega) y §48 (criterio de aceptación).
Como en las fases C y D, **no hay un brief escrito por Fer**. Este documento
no agrega requisitos: ordena los del master en checkpoints, cita cada sección
y marca con ❓ lo que el master no decide o lo que choca con una regla vigente.

**Propuesto por Claude el 2026-10-08 para acordar antes de codificar**, con
el mismo procedimiento que los briefs C (#7) y D (#13). D2 quedó cerrada y
mergeada en #18. D3 sigue bloqueada por el issue #15.

**Ya existe y NO se rehace:**
- `/health` y `/ready` (§34);
- `docker-compose.yml` con postgres, minio y platform-api (§35);
- migraciones con prueba down/up sobre base vacía y con datos (§36, `schema.db.test.ts`);
- constraints y triggers (§37);
- submit y approve transaccionales (§38);
- límites de body/upload, sanitización y ffprobe sin shell (§39);
- ADR-042 a ADR-061, que ya cubren todos los temas de §43;
- `docs/platform/*.md` (API, ERD, AUTH, APPROVAL, CAMPAIGNS, ASSETS, MEDIA, STORAGE, BUILDER_REPOSITORY).

---

## Qué falta del master, y qué depende de D3

| § | Requisito | Estado | ¿Depende de D3 / #15? |
|---|---|---|---|
| 41 | E2E Playwright: login → campaña → Builder guarda → assets → enviar → hash → aprobar → aprobada intacta | sin UI de login, aprobación ni campaña | **Sí.** Necesita UI que hoy no existe y tocar `apps/control`. |
| 41 | el mismo flujo, sin navegador | no hay un test que lo recorra entero | No |
| 33 | backups: PITR, retención, versioning del object storage, blobs aprobados no borrables | sin documento operativo | No |
| 35 | `docker compose up` reproducible | MinIO en `latest` sin digest | No |
| 39 | límites por actor en upload (BL-10, aceptada) | solo hay límite de login | No |
| 46 | gate final con `pnpm e2e` | los 14 E2E de M2C corren en CI; no hay E2E de plataforma | E2E de UI: sí |
| 47 | entregables: OpenAPI o equivalente (BL-11, aceptada con spike), migration list, route list, test list, ERD, `.env.example` | dispersos | No (salvo screenshots/video del Builder) |
| 48 | criterio de aceptación, 19 puntos | sin matriz punto → test | El punto 2 ("Builder guarda un Draft en PostgreSQL") sí |

## E1 — Hardening y entregables (independiente de D3)

1. **BL-10, límite por actor en upload** (§39; aceptada con ajustes del
   auditor):
   - requests por minuto **y** uploads/inspecciones concurrentes por actor
     autenticado;
   - `429` con `Retry-After`;
   - sin temporal, sin Asset y sin Idempotency-Key reservada;
   - si se usa `@fastify/rate-limit`, versión fijada y corregida contra
     GHSA-grpc-p53c-r64v.
2. **BL-11, OpenAPI** (§47; aceptada con spike): primero el spike. Si
   `zod-to-openapi` 7.x no cubre multipart, el contrato de error y los
   headers, se escribe `openapi.json` a mano y un test verifica que cada
   schema Zod lo valide. En los dos casos, CI regenera y exige diff vacío.
3. **§35**: fijar MinIO por digest. Verificar `docker compose up` con un
   smoke test documentado (salida real).
4. **§33, documento operativo de backups** (`docs/ops/BACKUPS.md`):
   - PostgreSQL: backup diario, PITR y retención;
   - object storage: versioning, protección contra borrado y blobs de
     versiones aprobadas no borrables desde la UI;
   - interfaces y requisitos, sin infraestructura atada a un proveedor;
   - un procedimiento de restore probado contra el PostgreSQL local, con
     salida real.
5. **§34**: test que demuestre que ningún log contiene password, token de
   sesión, cookie ni CSRF, recorriendo login, upload, submit y approve con
   un stream de log capturado.
6. **§47, inventario de entrega** (`docs/platform/DELIVERY.md`): migration
   list, route list (derivada del registro de Fastify y no escrita a mano),
   test list, ERD y `.env.example`, con un check en CI que falle si la route
   list queda desactualizada.

## E2 — E2E de plataforma sin navegador (independiente de D3)

Un test (`apps/platform-api/src/e2e-flow.db.test.ts`) recorre **por HTTP
real** (Fastify en un puerto, PostgreSQL real, ffprobe real, sesiones y CSRF
reales) el flujo de §41 y los 19 puntos de §48 que no dependen de la UI:

Cada paso lo ejecuta el rol que el backend exige (AUDIT del brief: Advertiser
y Contract son solo ADMIN, `exigir(actor, ADMIN_ROLES)`):

1. **ADMIN**: login; crea Advertiser y Contract; logout;
2. **OPERATOR**: login; crea la Campaign; guarda el draft por
   `@trust/builder-repository` (el mismo código que va a usar el Builder en D3);
3. **OPERATOR**: sube assets válidos (fixtures reales de B2), que ffprobe
   valida, y verifica el SHA-256;
4. **OPERATOR**: submit, que recompila y corre el preflight; verifica el hash;
   logout;
5. **INTERNAL_APPROVER** (otro usuario, cuatro ojos): login; ve la versión,
   adjunta evidencia y aprueba; logout;
6. **OPERATOR**: login; la campaña muestra la versión APROBADA con el hash
   exacto y el draft de trabajo aparte;
7. **OPERATOR**: edita el draft; la versión aprobada no cambia (ni la fila ni
   el hash);
8. `verifyChain` OK, y cada audit event esperado presente con el actor del
   rol que corresponde.

Además: `docs/reviews/M3A1_ACEPTACION.md`, una matriz de los 19 puntos de
§48, cada uno con el test que lo prueba **y el rol real que ejecuta el paso**.
Cada punto queda en uno de tres estados: **cubierto**, **pendiente por #15**
o **no aplicable**. Un pendiente nunca se cuenta como cubierto.

**Estado E2:** implementado en `fase/m3a1-e2`; matriz en `docs/reviews/M3A1_ACEPTACION.md`, reporte en `docs/reviews/M3A1_FASE_E2.md`.

## E3 — E2E Playwright de §41 (bloqueado)

Requiere:
- D3 (Builder con el repositorio; issue #15);
- una UI de login, de campaña y de aprobación que hoy no existe en ningún app;
- los screenshots/video de §47.

**No se inicia** hasta que Fer decida #15 y el ❓ 2.

## Decisiones validadas (AUDIT del brief sobre `6aed221`)

1. E1 y E2 avanzan con #15 abierto: **aceptado** (no tocan `apps/control`).
2. E3 sigue bloqueado: **correcto**. La ubicación de la UI y el permiso para
   tocar el Builder son la decisión de producto #15.
3. BL-21 como PR independiente: **aceptado**, sin mezclarlo con el hardening.
4. OpenAPI según el spike: **aceptado**. El resultado tiene que cubrir
   multipart, errores y headers, y mantenerse con un diff vacío en CI.

Diferido: IndexedDB transaccional para el repositorio del Builder. No hace
falta para cerrar E, y migrarlo ahora tocaría el formato y la arquitectura
congelados; el protocolo recuperable de D2 ya está probado.

## Pendiente de decisión de producto (única)

- **Dónde vive la UI de login, campaña y aprobación que §41 exige, y si se
  puede tocar el Builder.** Opciones: (a) una app nueva `apps/platform-web`,
  (b) pantallas mínimas en `apps/control`, o (c) pasar la UI a M3A.2 y cerrar
  M3A.1 con E2E de API más D3. Es la decisión de producto #15 de Fer; **E3 no
  se inicia sin ella**.

Todo lo demás de este brief está decidido en la sección anterior, que es la
única lista autoritativa.

## Fuera de alcance

Scheduler, EDGE, Deploy, portal externo, infraestructura de un proveedor
cloud concreto (§33: "NO implementar infraestructura específica a proveedor")
y BL-14/15/16/18/19/20/22.

## Propuestas de mejora (≤ 3)

- **BL-23 · Matriz de aceptación ejecutable** (aceptada con ajuste). Que
  `M3A1_ACEPTACION.md` se genere desde tags en los nombres de los tests
  (`[§48.7]`). CI distingue tres estados, **cubierto**, **pendiente por #15**
  y **no aplicable**, y falla si un punto queda sin test y sin estado
  declarado. Un pendiente reconocido nunca se muestra como verde. Solo usa
  vitest, sin dependencias nuevas, ~0,5 día.
- **BL-24 · Restore probado en CI, no solo documentado** (aceptada para
  backlog). Un job semanal (o manual) que haga `pg_dump` y un restore en una
  **base nueva**, corra `verifyChain` y el smoke de migraciones sobre lo
  restaurado, y registre la duración y el tamaño. Fuente: la
  documentación de PostgreSQL 16 sobre backup y restore
  (https://www.postgresql.org/docs/16/backup.html), que recomienda probar los
  restores periódicamente. ~0,5 día.
