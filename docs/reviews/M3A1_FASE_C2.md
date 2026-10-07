# M3A.1 — Fase C2: evidencia y approve/reject con cuatro ojos

**Estado:** entregado para auditoría. C3 (submit) **no iniciado**. B1–B4 y C1
sin cambios de arquitectura; M2C.2 sin tocar.

**Rama:** `fase/m3a1-c2` desde `main@4d9292d` (C1 aprobada y mergeada).
Brief: `docs/briefs/M3A1_FASE_C.md` §C2 + decisiones 2 y 4. ADR-058.
Detalle técnico: `docs/platform/APPROVAL.md`.

**CI independiente:** el link del run sobre el HEAD exacto va en el comentario
de entrega del PR.

## Resultados (ejecución real, 2026-10-07, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16 · ffmpeg 6.1.1. Salida completa en
`M3A1_FASE_C2_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK (sin dependencias externas nuevas; paquete nuevo `@trust/platform-approval`) |
| `pnpm verify` | **636 passed + 1 skipped**, lint 0 errores (11 warnings preexistentes) |
| `pnpm build` | OK |
| PostgreSQL 16 (`vitest.platform.config.ts`) | **173 passed + 6 skipped** (nuevos: 27 de approval por HTTP, 5 de 0003) |
| `bootstrap-smoke.sh` | 6 passed (con 0003 en la lista de migraciones) |
| media (`vitest.media.config.ts`) | 63 passed |
| mutaciones (176 reglas) | corrida completa: **176/176 atrapadas** (23 nuevas de C2) |
| E2E M2C (14) | **no corrido localmente** (sin Chrome con H.264, igual que C1); evidencia: job `e2e-m2c` del CI |

## Qué se entrega

1. **Migración 0003** (reversible): `approval_evidence.show_version_id` NOT
   NULL + `UNIQUE (id, show_version_id)`; `approvals.version_hash` NOT NULL;
   FK compuesta `approvals(evidence_id, show_version_id)`; triggers
   `evidence_insert` (tipo↔MIME en la allowlist, nada después de la decisión)
   y `approvals_exact_hash` (la decisión cita el hash de su versión).
2. **`@trust/platform-approval`**: `detect.ts` (clasificación por bytes, en
   stream), `service.ts` (lectura, evidencia, approve/reject, cuatro ojos por
   contrato), `errors.ts` (códigos estables + traducción de los RAISE de la base).
3. **Rutas** (`approval-routes.ts`): `GET /show-versions/:id`,
   `POST …/evidence`, `GET …/evidence/:evidenceId`, `POST …/approve`,
   `POST …/reject`, `PUT /contracts/:id/four-eyes`.
4. **Audit:** `VERSION_APPROVED` / `VERSION_REJECTED` (misma transacción,
   `afterHash` = hash de la versión), `EVIDENCE_UPLOADED`,
   `FOUR_EYES_DISABLED` / `CONTRACT_UPDATED`.
5. **Config:** `MAX_EVIDENCE_BYTES` (default 25 MiB) en `.env.example`.
6. **Docs:** `APPROVAL.md`, rutas en `API.md`, `ERD.md`, ADR-058.

## Criterio de cierre C2, punto por punto

| Brief / decisión | Dónde | Test |
|---|---|---|
| Evidencia por el storage content-addressed, hash por stream, límite configurable | `service.uploadEvidence` + `limitBody` | "PDF real: 201 …", "tamaño: un byte más …" |
| Detección por bytes, allowlist cerrada, OTHER solo inertes | `detect.ts`, trigger `evidence_insert` | `detect.test.ts` (6), "MIME declarado falso …", "ZIP/Office y ejecutable …", "tipo declarado distinto …", `approval-schema.db.test.ts` |
| Descarga como attachment + nosniff | ruta de descarga | "descarga: attachment, nosniff, CSP sandbox …" |
| Approve exige INTERNAL_APPROVER o EXTERNAL del contrato habilitado | ruta (rol) + `exigirDecisor` (scope) | sección "scope de contrato y EXTERNAL_APPROVER" (4 tests) |
| Siempre sobre la versión exacta y su hash | `versionHash` obligatorio, trigger `approvals_exact_hash` | "sin evidencia → 400; … hash distinto → 409", schema 0003 |
| Transición inválida → 409 `INVALID_STATE_TRANSITION` | `estadoInvalido` + UNIQUE traducido | "retry duplicado …" (approve/reject/evidencia después de APPROVED), "motivo obligatorio …" (approve después de REJECTED) |
| Idempotency-Key: un retry no duplica | `withIdempotency` | "retry duplicado …", "carrera: el mismo retry en paralelo …", evidencia "retry con la misma key …" |
| Cuatro ojos aunque tenga los dos roles → 403 | app + trigger 0001 | "cuatro ojos: quien envió (con los dos roles) …" |
| Desactivar exige ADMIN + `FOUR_EYES_DISABLED` | `setFourEyesRequired` | "INTERNAL_APPROVER no puede desactivarlo …" |
| Audit en la misma transacción | `decidir` | "otra persona aprueba …", "verifyChain OK …" |
| `GET /show-versions/:id` con estado derivado | `vista` | "SUBMITTED con hash exacto …" |
| Decisión 4: INTERNAL fuera de scope, EXTERNAL deshabilitado, acceso cruzado | ver abajo | 4 tests de scope |

**Mutaciones C2 (23, todas atrapadas):** las 5 de §46 pedidas (cuatro ojos —
trigger y app ignorando el contrato—, approve sin evidencia —API y base—,
reject sin motivo —API y base—, transición inválida, retry duplicado) y 14
más: evidencia después de decidir, hash exacto (app y trigger), scope de
lectura ignorado, ver alcanza para decidir, tipo declarado no comparado,
allowlist sin trigger, HTML pasa como texto, controles en texto, descarga
inline, parser trunca antes que `limitBody`, aprobación sin audit, desactivar
cuatro ojos sin evento explícito, última aprobada retrocede, evidencia de otra
versión (FK).

Defensa en profundidad que hace sobrevivir a una mutación "de un solo lado"
(por eso no está listada): sacar el chequeo de cuatro ojos de la app lo sigue
frenando el trigger con el mismo 403; sacar el filtro de evidencia por versión
lo frena la FK compuesta con el mismo 422. En esos casos se muta la barrera de
la base (atrapada por los tests de esquema).

## Decisiones (para validar)

1. **Interpretación de "INTERNAL_APPROVER fuera de scope" (decisión 4).** La
   decisión 4 de C1 (aprobada) dice que los roles internos alcanzan a todos los
   contratos, así que un INTERNAL_APPROVER no tiene "fuera de scope" por
   contrato. Lo que se testea: (a) el cliente no puede elegir contrato
   (`contractId` en el cuerpo → 400), (b) ver no es decidir — un OPERATOR que
   además es EXTERNAL_APPROVER de A ve una versión de B pero no sube evidencia
   ni decide (403), (c) EXTERNAL deshabilitado sin ningún permiso y (d) acceso
   cruzado de un EXTERNAL habilitado (404). Si el auditor quiere aprobadores
   internos por contrato, es cambio de modelo → `decisión-producto`.
2. **La evidencia pertenece a una versión** (`show_version_id` NOT NULL). El
   brief pone la ruta bajo `/show-versions/:id`; el esquema de Fase A no lo
   tenía. Una evidencia no se reutiliza entre versiones.
3. **Quién sube evidencia:** los mismos roles que deciden (el aprobador junta
   la prueba del cliente). OPERATOR no.
4. **Clasificación solo por bytes:** un email pegado como MESSAGE es EMAIL
   (422 con `detected: EMAIL`). Así los mismos bytes siempre tienen el mismo
   MIME en `stored_objects` (único por sha256).
5. **OTHER = PNG/JPEG** (capturas). No se acepta SVG, HTML, Office, ZIP ni
   ejecutables.
6. **Códigos HTTP:** contenido fuera de la allowlist 415; tipo que no coincide,
   vacío, evidencia inexistente para la versión 422; demasiado grande 413;
   hash distinto 409 `VERSION_HASH_MISMATCH`.
7. **Rechazar no está alcanzado por cuatro ojos** (§18 habla de aprobar): quien
   envió puede rechazar su propia versión.
8. **Cuatro ojos por API** (`PUT /contracts/:id/four-eyes`) y no por CLI: el
   ADMIN queda como actor del audit. Reactivar se audita como `CONTRACT_UPDATED`.
9. **`latest_approved_version_id`** avanza solo hacia un `version_number` mayor.
10. **Serialización por campaña** (`FOR UPDATE` en `campaigns`):
    `trust_app` no tiene UPDATE sobre `show_versions`, que es lo que pide
    PostgreSQL para bloquear esa fila.

## No hecho a propósito

C3 (submit). UI de aprobación. Portal externo. BL-10/BL-11 (siguen en su PR
aparte). Antivirus/CDR de PDF (ver BL-14).

## Propuestas de mejora (≤ 3) e investigación

- **BL-14 · PDF sin contenido activo.** Hoy se acepta cualquier archivo que
  empiece con `%PDF-`. Un PDF puede llevar `/JavaScript`, `/Launch`,
  `/OpenAction` o archivos embebidos que se ejecutan en el lector del
  aprobador al abrir la descarga. OWASP File Upload Cheat Sheet recomienda
  validar el contenido además del tipo y, para documentos, CDR (Content Disarm
  & Reconstruct). Propuesta mínima, sin dependencias: rechazar
  (`EVIDENCE_UNSUPPORTED_CONTENT`) PDFs cuyos bytes contengan esos nombres de
  objeto, también en forma hex-escapada (`/J#61vaScript`). Límite: un PDF con
  streams comprimidos puede esconder nombres dentro de object streams; la
  defensa completa es CDR o rasterizar, que es infraestructura (decisión de
  Fer). ~0,5 día. Criterio: fixture con `/OpenAction << /S /JavaScript >>` →
  415, PDF común → 201, y una mutación que lo atrape.
  Fuente: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html (consultada 2026-10-07).
- **BL-15 · Sello de tiempo RFC 3161 de la aprobación.** Valor comercial: un
  comprobante verificable por terceros de que la versión con hash X se aprobó
  antes de la fecha T, independiente de nuestra base y de nuestra cadena de
  audit. RFC 3161 define la solicitud a una TSA con el hash y la respuesta
  firmada (TimeStampToken). Aplicabilidad: se sella
  `sha256(JCS({approvalId, versionHash, decision, createdAt}))`. Límites: exige
  elegir una TSA (costo, disponibilidad, confianza) y red saliente desde el
  servidor; no debe bloquear la aprobación (sellar después, reintentar).
  **Decisión de producto** (proveedor y costo). ~2 días. Criterio: token
  guardado y verificado con `openssl ts -verify` en CI contra una TSA de prueba.
  Fuente: https://www.rfc-editor.org/rfc/rfc3161 (consultada 2026-10-07).

**Evaluación de las ideas iniciales del HANDOFF:**
1. *Diagnóstico operativo real vs simulado:* útil y alineado con
   `control-core` (ya distingue `provenance` REAL/SIMULATED). Aceptar para el
   backlog después de Fase D; depende de telemetría real (hardware, BL-05/06).
2. *Ensayo de escenas antes de publicar:* la parte de validación de medios ya
   existe (B2 `checkMedia`, BL-04 kit). La comprobación de sincronía real
   depende del hardware: ajustar a "preflight + preview" en Fase D y dejar la
   medición de sincronía para cuando haya EDGE.
3. *Recuperación y rollback:* C2 ya deja la base: versiones inmutables,
   `latest_approved_version_id` que no retrocede y audit encadenado. El
   rollback de despliegue es de Deploy (fuera de M3A.1). Aceptar como requisito
   de diseño para Deploy: "volver a la última aprobada" = desplegar
   `latest_approved_version_id` anterior, sin estado nuevo.
