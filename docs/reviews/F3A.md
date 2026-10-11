# F3(a) — Versión vigente administrativa con cuatro ojos

**Estado:** entregado para auditoría. Brief aprobado en
[#50](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6110866495)
(`docs/briefs/F3A_REDEPLOY.md`, `main@0742479`). El auditor escribió: "Se
autoriza iniciar `fase/f3a` en PR separado, con revisión A/B/C, gates
completos y nueva auditoría obligatoria. No tocar M2C/Storage congelados ni
adelantar Deploy físico".

**Rama:** `fase/f3a` desde `main@8043b99`. Salida real: `F3A_SALIDA.txt`.
Referencia de uso: `docs/platform/ACTIVE_VERSION.md`.

No toca:

- `apps/control`, M2C (`e2e/`) ni la experiencia ejecutiva;
- `platform-storage` (B1);
- `platform-approval`: approve y reject quedan iguales.

Nada en esta fase despliega, programa ni envía contenido.

## Qué se entrega

| Archivo | Qué |
|---|---|
| `packages/platform-db/src/migrations/0004_active_version.ts` | Columna `active_version_id` (sin backfill), FK compuesta, trigger `ACTIVE_NOT_APPROVED`, tabla `active_version_changes` con sus triggers, función `trust_confirm_active_version_change` y permisos |
| `packages/platform-db/src/{schema,migrator}.ts` | Tipos y registro de la migración |
| `packages/platform-campaigns/src/active-version.ts` | `ActiveVersionService`: request, confirm, cancel y list; lectura en `service.ts` |
| `packages/platform-audit/src/index.ts` | Las 4 acciones nuevas |
| `apps/platform-api/src/{active-version-routes,contracts,openapi,app,server}.ts` | Rutas, schemas, OpenAPI y `ACTIVE_VERSION_CHANGE_TTL_MINUTES` |
| `apps/platform-api/src/active-version.db.test.ts` | 19 tests HTTP: Fastify, PostgreSQL y sesiones reales |
| `packages/platform-db/src/active-version-schema.db.test.ts` | 8 tests de la base sin la app (segunda barrera, función, migración con datos) |
| `packages/platform-db/src/{schema,bootstrap.smoke}.db.test.ts` | Lista de migraciones con 0004; 0004 baja sola |
| `scripts/mutation-check.py` | 24 mutaciones `f3a:` |
| `docs/platform/{ACTIVE_VERSION,ERD,CAMPAIGNS,DELIVERY}.md`, `openapi.json`, `.env.example` | Documentación e inventario regenerado |
| `docs/architecture/DECISIONS.md` (ADR-064), `docs/collab/BACKLOG.md` | Estado |

Issue de UI (Q6), abierto antes de declarar la operación usable por personas:
[#55](https://github.com/fermalenoski86/dev/issues/55).

## Decisiones de implementación, declaradas para el auditor

1. **El servicio vive en `platform-campaigns`.** Ahí está el puntero y así
   `platform-approval` no cambia (brief §2). Los códigos de error nuevos son
   `CampaignError` y la API los traduce igual que los existentes.
2. **La función devuelve un resultado en vez de fallar cuando terminaliza el
   pedido.** Devuelve `CONFIRMED`, `EXPIRED` o `CONFLICT`. Lo demás
   (PENDING, cuatro ojos, hash, destino APPROVED, inexistente) es `RAISE` y no
   cambia nada.
   - En `EXPIRED` y `CONFLICT` la función escribe el estado terminal.
   - La app registra el audit y devuelve el 409 desde `withIdempotency`, que
     hace COMMIT (§3.7).
3. **Orden de chequeos al confirmar:** existencia/scope → PENDING → cuatro ojos
   → hash → campaña archivada → función (vencimiento → conflicto → APPROVED).
   La app frena al que pidió **antes** de mirar el hash; un test lo exige y la
   mutación "cuatro ojos en la app" queda atrapada aunque la base también lo
   frene.
4. **Tres capas de cuatro ojos:** la app, la función y el trigger con CHECK de
   la tabla. Cada capa tiene su propia mutación atrapada:
   - la función se prueba llamándola directo y exigiendo que el error salga de
     su `RAISE`, por el campo `where` del error de PostgreSQL;
   - el trigger, con un UPDATE directo del dueño.
5. **CONFIRMED solo desde la función.** El trigger exige que `current_user` sea
   el dueño de la tabla, que es con quien corre la función SECURITY DEFINER.
   `trust_app` puede pasar un pedido a CANCELLED o EXPIRED (el trigger exige
   que haya vencido de verdad), pero no a CONFIRMED.
6. **Permisos de `campaigns`.** `trust_app` pierde el UPDATE de tabla y lo
   recupera por columna, sin `active_version_id`. Se verificó que nadie en el
   repo actualiza otras columnas. El down devuelve el UPDATE de tabla de 0001.
7. **`expires_at` se guarda en el pedido**, calculado con `now()` de la base al
   insertar. El trigger fuerza `requested_at := now()`. Cambiar
   `ACTIVE_VERSION_CHANGE_TTL_MINUTES` afecta solo a los pedidos nuevos.
8. **Replay de un 409 con efecto.** El body guardado es el original completo,
   incluido el `requestId` de la solicitud que produjo el efecto (§3.6, "mismo
   body"). El header `x-request-id` del retry es el del retry.
9. **Actor del vencimiento:** el evento `EXPIRED` lleva actor `null`, porque lo
   decide el reloj de la base, y en metadata `observedBy`, que es quien lo
   detectó.
10. **Pendiente vencido sin marcar.** `GET /campaigns/:id` no lo muestra en
    `pendingActiveVersionChange`, porque la lectura no escribe.
11. **Pedir otro con un pedido vencido.** El vencido pasa a EXPIRED con audit y
    el nuevo entra con 201. Si el nuevo falla por otra causa (por ejemplo, hash
    equivocado), el rollback deshace también ese vencimiento y se repite en el
    próximo intento.
12. **Cancelar no lleva cuerpo.** Si viene uno, tiene que ser `{}`. El
    fingerprint es `{ changeId }`, como dice el brief.

## Resultados (ejecución real, 2026-10-11, este entorno)

| Gate | Resultado |
|---|---|
| `pnpm verify` | 763 passed + 1 skipped (sin cambios: los tests nuevos son de PostgreSQL). Lint: 0 errores, los mismos 12 warnings |
| `pnpm build` (https) | OK |
| PostgreSQL 16 | **326 passed + 6 skipped** (+27: 19 HTTP y 8 de base) |
| `bootstrap-smoke.sh` | 6 passed, con 0004 en la lista |
| media | 63 passed |
| mutaciones | **24/24 nuevas `f3a:` atrapadas** (tanda 298:322); las 322 en el job de CI |
| `e2e-platform` y E2E M2C (14) | **No ejecutados localmente** (sin Chrome con H.264). Evidencia: jobs de CI |
| contrato S3 | **No ejecutado localmente** (sin cambios de storage). Evidencia: `compose-smoke` de CI |

## Autorrevisión previa

### A. Diff contra el brief, criterio por criterio (§6)

| § | Criterio | Dónde se prueba | Mutación |
|---|---|---|---|
| 6.1 | Rollback completo, audit con hashes, `verifyChain` | HTTP "rollback completo" (también historial paginado y `GET /campaigns/:id`) | "el cambio no se audita…" |
| 6.2 | Cuatro ojos, también con `four_eyes_required = false`; la base frena sin la app | HTTP "cuatro ojos siempre" (los dos contratos); base "la función, llamada directo…" y "CONFIRMED solo por la función…" | app, función y trigger |
| 6.3 | SUBMITTED/REJECTED 409, otra campaña o inexistente 404 (mismo mensaje), hash 409, ya vigente 409, archivada 409 | HTTP "destino inválido" | "hash al pedir", "versión de otra campaña", "destino no APPROVED (app)" |
| 6.4 | Dos pedidos → 201 + 409 PENDING; dos confirmaciones → una gana; vigente cambiada → 409 y CANCELLED | HTTP "concurrencia" y "409 con efecto persistido" | "concurrencia optimista al pedir" |
| 6.5 | Vencido → 409, EXPIRED con audit | HTTP "§6.5" y "§3.4" (al cancelar y al pedir otro) | "vencimiento ignorado…", "vencimiento perezoso…", "TTL en horas" |
| 6.6 | UPDATE directo a no aprobada o a otra campaña → error | Base "ni el dueño fija…" y "trust_app no puede escribir…" | "destino no APPROVED (base)", "trust_app conserva UPDATE…" |
| 6.7 | A2.2: aprobar v3 con vigente NULL, v2 o v1 → no cambia, sin evento; primera selección auditada | HTTP "A2.2" (aprobación real por HTTP con evidencia) | "aprobar mueve la vigente" |
| 6.8 | Idempotencia por operación: 201→201, 200→200, 200→200; respuesta perdida; key reusada | HTTP "idempotencia" (3 operaciones más el 409 sin efecto) | "replay del pedido responde 200" |
| 6.9 | Inmutabilidad: versiones, manifiestos, Approvals, evidencia, objetos y blobs idénticos | HTTP "nada se reescribe" (foto completa, con blobs del storage real) | — (no hay escritura que mutar: la función no toca esas tablas) |
| 6.10 | Mutaciones `f3a:` por regla | 24, todas atrapadas | — |
| 6.11 | 0004 up/down/up; bootstrap; sin regresión | `schema.db.test` (0004 baja sola), bootstrap-smoke, suites completas; M2C en CI | — |
| 6.12 | Migración con datos: todo NULL, down con datos, up de nuevo igual | Base "migración 0004 con datos poblados" (3 campañas del brief) | "backfill…" |
| 6.13 | 409 con efecto: COMMIT, un evento, `verifyChain`, retry = mismo 409 | HTTP "vigente cambiada…" (leído por otra conexión) y "§6.5" | "409 … con throw" (2) |
| 6.14 | SECURITY DEFINER: PUBLIC sin EXECUTE, `trust_app` con EXECUTE, `search_path` con `pg_temp` al final, sin UPDATE de la columna | Base "función SECURITY DEFINER endurecida" | "search_path sin pg_temp", "EXECUTE para PUBLIC" |
| 6.15 | NULL en la concurrencia optimista, en los dos sentidos | HTTP "§6.15" y base "§6.15 en la función"; además el pedido con `expected: null` sobre una vigente fijada | "IS NOT DISTINCT FROM reemplazado por <>" |

Hallazgos pendientes de rondas anteriores: ninguno. Es una entrega nueva y el
brief se aprobó sin hallazgos bloqueantes.

### B. Revisión adversaria

- **Saltear la app:**
  - `trust_app` no puede escribir el puntero (42501);
  - no puede confirmar con un UPDATE directo (`CONFIRM_ONLY_VIA_FUNCTION`);
  - no puede borrar pedidos;
  - la función repite todo con la campaña bloqueada;
  - ni el dueño fija una vigente no aprobada o de otra campaña.
- **Auto-confirmación con dos roles:** un usuario con OPERATOR e
  INTERNAL_APPROVER pide y no puede confirmar, también con
  `four_eyes_required = false` (probado).
- **NULL:** el chequeo optimista de la app es igualdad estricta con `null` y el
  de la función es `IS DISTINCT FROM`. Hay tests en los dos sentidos y una
  mutación a `<>`.
- **Carreras:**
  - pedir, confirmar y cancelar bloquean la campaña y después el pedido, el
    mismo orden que la función y que approve/submit;
  - el índice único parcial frena un segundo PENDING aunque la app se
    equivoque (mapeado a 409);
  - dos confirmaciones simultáneas: una gana y la otra recibe 409.
- **Reloj:** el vencimiento es siempre `now()` de la base. Para el test, el
  dueño mueve las fechas con el trigger deshabilitado; en runtime no existe
  ese camino.
- **Respuesta perdida:** el retry de una confirmación aplicada devuelve el
  mismo 200 y no hay un segundo `ACTIVE_VERSION_CHANGED` (probado).
- **Datos:** el audit lleva ids, hashes y el motivo (el brief lo pide en
  `ACTIVE_VERSION_CHANGED`), sin datos de cliente. Los errores no exponen SQL:
  los `RAISE` se traducen a códigos fijos.
- **Archivar con un pedido pendiente:** confirmar responde 409
  `INVALID_STATE_TRANSITION` sin terminalizar el pedido, que vence solo.
  El brief no dice qué hacer en este caso; se declara.
- **Decidido no hacer:**
  - **Job de vencimiento:** el brief pide vencimiento perezoso.
  - **Evento de vigente al aprobar:** A2.2 lo prohíbe.
  - **Vista en `platform-web`:** va en #55.
  - **Deploy:** queda para M3B/M3C.

### C. CI

Se cita en el PR el link de la corrida y el SHA exacto del HEAD entregado. No
se pide auditoría sin los 7 jobs en verde.
