# Aprobación — M3A.1 Fase C2

`@trust/platform-approval` (servicio + detección de evidencia) · rutas en
`apps/platform-api/src/approval-routes.ts` · migración `0003_approval` · ADR-058.
Brief: `docs/briefs/M3A1_FASE_C.md` §C2 (decisiones 2 y 4 del auditor).

## Rutas (bajo `/api/v1`)

| Método | Ruta | Roles | Respuestas |
|---|---|---|---|
| GET | `/show-versions/:id` | OPERATOR · INTERNAL_APPROVER · ADMIN · EXTERNAL_APPROVER (su contrato) | 200 · 401 · 403 · 404 |
| POST | `/show-versions/:id/evidence` | INTERNAL_APPROVER · EXTERNAL_APPROVER (su contrato) | 201 · 200 replay · 400 · 403 · 404 · 409 · 413 · 415 · 422 |
| GET | `/show-versions/:id/evidence/:evidenceId` | como la lectura | 200 (descarga) · 404 |
| POST | `/show-versions/:id/approve` | INTERNAL_APPROVER · EXTERNAL_APPROVER (su contrato) | 201 · 200 replay · 400 · 403 · 404 · 409 · 422 |
| POST | `/show-versions/:id/reject` | ídem | 201 · 200 replay · 400 · 403 · 404 · 409 |
| PUT | `/contracts/:id/four-eyes` | ADMIN | 200 · 403 · 404 |

Toda mutación exige sesión + `X-CSRF-Token` (C1). Evidencia, approve y reject
exigen `Idempotency-Key` (§28): la misma key con el mismo pedido devuelve la
respuesta guardada (200, `idempotent-replayed: true`) y nunca crea una segunda
evidencia ni una segunda Approval; con otro pedido → 409 `IDEMPOTENCY_KEY_REUSED`.

## Estado

No hay columna de estado (Fase A): `SUBMITTED` = sin Approval; `APPROVED` /
`REJECTED` = la decisión de su única Approval (`UNIQUE show_version_id`).
Ambas son terminales. Desde un terminal, approve/reject/evidencia → 409
`INVALID_STATE_TRANSITION` con `details.status`.

## Autorización (decisión 4)

- El rol se chequea en la ruta (antes de leer el cuerpo); el scope de contrato
  en el servicio, con el contrato derivado de la versión en la base. El cuerpo
  es `.strict()`: un `contractId` del cliente es 400.
- Roles internos alcanzan a todos los contratos (decisión 4 de C1).
  EXTERNAL_APPROVER solo con `EXTERNAL_APPROVAL_ENABLED=true` **y** el contrato
  habilitado, y solo sobre ese contrato.
- Versión fuera de scope = 404 (no se revela que existe). Visible pero sin rol
  de decisión sobre ese contrato = 403 (ej. OPERATOR + EXTERNAL_APPROVER de A
  sobre una versión de B).

## Evidencia (decisión 2, §19)

Multipart en una solicitud: campo `type` (EMAIL, PDF, MESSAGE, OTHER) y
después `file`. Stream al temporal con sha256 y tamaño durante el stream; corte
en `MAX_EVIDENCE_BYTES` + 1 (default 25 MiB) con `limitBody` (el parser tiene
límite propio de ruta y nunca trunca en silencio). Después, storage
content-addressed (B1) y `stored_objects` por sha256.

Detección por **bytes reales** (`detect.ts`), allowlist cerrada:

| Tipo | Contenido aceptado | MIME guardado |
|---|---|---|
| PDF | `%PDF-` en el byte 0 | application/pdf |
| EMAIL | texto UTF-8 con encabezados RFC 5322 (From + Date/Subject, bloque terminado en línea vacía) | message/rfc822 |
| MESSAGE | texto UTF-8 sin encabezados de email (ej. export de un chat) | text/plain |
| OTHER | PNG o JPEG por firma (capturas de pantalla: inertes) | image/png · image/jpeg |

"Texto" = UTF-8 válido en todo el archivo, sin NUL ni controles C0 salvo
TAB/LF/CR/FF, y que no empiece como HTML/XML/SVG según el sniffing de WHATWG.
El `Content-Type` declarado en la parte y la extensión no deciden nada.

- Contenido fuera de la allowlist → 415 `EVIDENCE_UNSUPPORTED_CONTENT`.
- Tipo declarado ≠ detectado → 422 `EVIDENCE_TYPE_MISMATCH` (`details.declared`, `details.detected`).
- Vacío → 422 `EVIDENCE_EMPTY`; más grande que el límite → 413 `EVIDENCE_TOO_LARGE`.
- En todos esos casos no se persiste nada (ni fila ni blob final; el temporal se borra).
- La base repite tipo↔MIME y "nada después de la decisión" (trigger `evidence_insert`).

Descarga: siempre `Content-Disposition: attachment` (RFC 6266/5987, nombre
saneado), `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
default-src 'none'; sandbox`, `Cache-Control: no-store`, MIME detectado y
`X-Evidence-SHA256`.

Audit `EVIDENCE_UPLOADED` (no está en la lista mínima de §27; §27 dice "al
menos") con sha256, tipo, MIME, tamaño y nombre saneado.

## Aprobar / rechazar (§17, §18, §20)

`approve { evidenceId, versionHash }` · `reject { reason, versionHash }`
(motivo 1–2000 caracteres, se recorta). El cliente cita el hash que vio: si no
es el de la versión → 409 `VERSION_HASH_MISMATCH` (la base lo repite: trigger
`approvals_exact_hash`). La Approval guarda ese `version_hash`.

Una transacción con la **campaña bloqueada** (`FOR UPDATE`; `trust_app` no
tiene UPDATE sobre `show_versions`, así que la fila de la versión no se puede
bloquear): relee la versión, scope, hash, estado, cuatro ojos, evidencia de
ESA versión (FK compuesta en la base), inserta la Approval, avanza
`campaigns.latest_approved_version_id` solo hacia una versión más nueva y
escribe `VERSION_APPROVED` / `VERSION_REJECTED` (con `afterHash` = hash de la
versión). Dos decisiones simultáneas: una gana, la otra 409 (y si algo se
escapara, el `UNIQUE` se traduce al mismo 409).

Cuatro ojos: quien envió no aprueba aunque tenga los dos roles → 403
`FOUR_EYES_VIOLATION` (app primero, trigger de 0001 como segunda barrera).
Rechazar no está alcanzado por cuatro ojos (§18 habla de aprobar).

## Cuatro ojos por contrato (§18)

`PUT /contracts/:id/four-eyes { fourEyesRequired }`, solo ADMIN, contrato
bloqueado. Desactivar → `FOUR_EYES_DISABLED`; reactivar → `CONTRACT_UPDATED`
con `{ fourEyesRequired, previous }`. Sin cambio → `changed: false` y sin
evento. La política vale en el momento de aprobar (el trigger lee el contrato).
