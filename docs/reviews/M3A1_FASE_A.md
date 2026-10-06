# M3A.1 — Fase A · entrega para auditoría

Fecha: 2026-10-06T18:56Z · node v22.22.2 · PostgreSQL 16.15

## Alcance entregado

- Esquema relacional + migración 0001 (reversible en CI).
- Roles trust_owner / trust_app con permisos mínimos.
- ShowVersion absolutamente inmutable (sin estado; resultado en Approval).
- stored_objects content-addressed; Asset y ApprovalEvidence lo referencian.
- Cuatro ojos por contrato (trigger).
- Auditoría serializada (lock + trigger + UNIQUE de predecesor) y verifyChain().
- Hash de versión: envelope v1, JCS RFC 8785, constantes explícitas.
- Formatos derivados de EL_TRUST.
- Idempotencia con fingerprint.
- apps/api retirado (huérfano, ADR-051).

Fase B NO iniciada (storage, validación de assets, API).

## pnpm verify

```
✖ 11 problems (0 errors, 11 warnings)
      Tests  545 passed (545)
exit 0
```

## Tests de plataforma contra PostgreSQL real (vitest.platform.config.ts)

```
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion absolutamente inmutable > runtime (trust_app): UPDATE y DELETE rechazados por permisos
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion absolutamente inmutable > aun el dueño del esquema: UPDATE, DELETE y TRUNCATE frenados por trigger
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion absolutamente inmutable > no existe columna de estado: el resultado vive solo en Approval
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: ShowVersion absolutamente inmutable > versionHash único
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: aprobaciones — una decisión por versión, con evidencia o motivo > APPROVED exige evidencia; REJECTED exige motivo
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: aprobaciones — una decisión por versión, con evidencia o motivo > una sola decisión final por versión
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: aprobaciones — una decisión por versión, con evidencia o motivo > aprobación y evidencia son inmutables
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: cuatro ojos POR CONTRATO > contrato con cuatro ojos: quien envió no aprueba, otra persona sí
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: cuatro ojos POR CONTRATO > la política afecta solo a su contrato
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: cuatro ojos POR CONTRATO > cuatro ojos viene activado por defecto
 ✓ packages/platform-db/src/schema.db.test.ts > assets en versiones y objetos físicos > un asset REJECTED no entra a una versión
 ✓ packages/platform-db/src/schema.db.test.ts > assets en versiones y objetos físicos > el sha256 declarado tiene que ser el del objeto físico
 ✓ packages/platform-db/src/schema.db.test.ts > assets en versiones y objetos físicos > stored_objects: content-addressed e inmutable
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: drafts con revisión monotónica > cada UPDATE avanza exactamente 1
 ✓ packages/platform-db/src/schema.db.test.ts > identidad y roles > password tiene que ser Argon2id; email normalizado y único
 ✓ packages/platform-db/src/schema.db.test.ts > identidad y roles > el aprobador externo existe solo atado a un contrato; los internos, nunca
 ✓ packages/platform-db/src/schema.db.test.ts > identidad y roles > el usuario de runtime no hace DDL ni TRUNCATE
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: migraciones > up sobre base vacía, down y up de nuevo (smoke test reversible)
 ✓ packages/platform-db/src/schema.db.test.ts > CRITERIO: migraciones > con datos: volver a migrar no toca nada
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > append encadena desde el génesis y verifyChain la valida
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > append fuera de una transacción se rechaza: el lock no serializaría nada
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > CRITERIO: concurrencia real — dos conexiones a la vez, nunca el mismo predecesor
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > la base rechaza un fork aunque el código lo intente
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > runtime no puede UPDATE ni DELETE sobre audit_events (permisos)
 ✓ packages/platform-audit/src/audit.db.test.ts > CRITERIO: cadena de auditoría > CRITERIO: una alteración directa (con control total de la base) se DETECTA
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > misma key + mismo fingerprint: replay seguro, la operación corre UNA vez
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > misma key + distinto fingerprint: 409 IDEMPOTENCY_KEY_REUSED
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > la misma key para otra operación también es reuso
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > si la operación falla, la key NO queda tomada: el reintento corre
 ✓ packages/platform-db/src/idempotency.db.test.ts > CRITERIO: idempotencia con fingerprint > dos reintentos simultáneos: uno ejecuta, el otro hace replay
      Tests  30 passed (30)
```

## Tests unitarios de platform-contracts

```
 ✓ packages/platform-contracts/src/canonical.test.ts > RFC 8785 — vectores del propio RFC > CRITERIO: §3.2.4 — números, strings y literales dan la salida canónica exacta
 ✓ packages/platform-contracts/src/canonical.test.ts > RFC 8785 — vectores del propio RFC > §3.2.3 — las claves se ordenan por unidades UTF-16
 ✓ packages/platform-contracts/src/canonical.test.ts > RFC 8785 — vectores del propio RFC > la versión de canonicalización queda identificada
 ✓ packages/platform-contracts/src/canonical.test.ts > RFC 8785 — vectores del propio RFC > rechaza lo que JSON no representa: un hash no puede depender de eso
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > mismo contenido y mismos assets = mismo hash
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > el orden de las claves del paquete no cambia el hash
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > el orden de los assets no cambia el hash
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > cambiar UN byte de un asset cambia el hash
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > cambiar el ShowPackage cambia el hash
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > mover un asset de ranura cambia el hash (la ranura es parte del contenido)
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > el hash es SHA-256 (UTF-8) de la forma canónica JCS del envelope versionado
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > CRITERIO: compilerVersion NO entra en el hash
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > cambiar la versión del envelope cambia el hash (cambio de formato deliberado)
 ✓ packages/platform-contracts/src/canonical.test.ts > CRITERIO: hash de versión determinista > rechaza sha256 inválidos y ranuras duplicadas
 ✓ packages/platform-contracts/src/versions.test.ts > CRITERIO: constantes de versión atadas a su fuente > SHOW_AUTHORING_VERSION coincide con el package.json del compiler
 ✓ packages/platform-contracts/src/versions.test.ts > CRITERIO: constantes de versión atadas a su fuente > SHOW_PACKAGE_SCHEMA_VERSION es la versión que acepta ShowPackageSchema
 ✓ packages/platform-contracts/src/versions.test.ts > CRITERIO: constantes de versión atadas a su fuente > versiones del hash fijas y explícitas
 ✓ packages/platform-contracts/src/building-capabilities.test.ts > CRITERIO: formatos derivados del modelo del edificio, no reescritos > los cuatro formatos salen de EL_TRUST
 ✓ packages/platform-contracts/src/building-capabilities.test.ts > CRITERIO: formatos derivados del modelo del edificio, no reescritos > si el modelo cambia, el formato exigido cambia con él
 ✓ packages/platform-contracts/src/building-capabilities.test.ts > CRITERIO: formatos derivados del modelo del edificio, no reescritos > A y B con alturas distintas: no hay lienzo A+B, y se dice
 ✓ packages/platform-contracts/src/building-capabilities.test.ts > CRITERIO: formatos derivados del modelo del edificio, no reescritos > las superficies contratables son las pantallas del modelo
      Tests  21 passed (21)
```

## Prueba de que el test concurrente no es trivial

Mutación: se quitó el lock de appendAuditEvent. Resultado: el test concurrente FALLA y
la base frena la escritura con AUDIT_SEQ (defensa en profundidad). Código restaurado.

## Límites honestos de esta fase

- Docker no está disponible en este entorno: docker-compose llega en Fase B/E y se valida en CI.
- Las mutaciones específicas del gate (hash, inmutabilidad, cuatro ojos, cadena, revisión) se suman al mutation-check en el gate final.
- trust_app tiene INSERT en approvals: la regla de quién puede aprobar por ROL se aplica en la API (Fase C); la base garantiza cuatro ojos, evidencia, motivo y unicidad.
