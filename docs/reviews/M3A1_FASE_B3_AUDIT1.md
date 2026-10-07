# M3A.1 Fase B3 — respuesta a la auditoría #1

Auditoría: https://github.com/fermalenoski86/dev/pull/3#issuecomment-6032007766
(`AUDIT: CAMBIOS` sobre `037bfc4`).

## 1. [P1] Dos uploads demasiado grandes y distintos → mismo fingerprint — **Corregido**

Reproducido tal cual lo describe el auditor: con `maxUploadBytes: 4`, `AAAAA` y
`BBBBB` bajo la misma key daban replay. Causa: al superar el límite se perdía
el hash y el fingerprint era `{ tooLarge: true }`.

Corrección (`packages/platform-assets/src/limited-body.ts`): el corte en el
límite lo hace `limitBody`, un generador que se lee a demanda y hashea
**exactamente los primeros `límite + 1` bytes**. El fingerprint de un cuerpo
grande pasa a ser `{ tooLarge, limitBytes, prefixSha256 }`.

- No carga nada en RAM: el hash es incremental y el corte ocurre en el byte `límite + 1`.
- Deja de consumir: al lanzar `StorageLimitError`, el `for await` cierra y destruye el stream del cliente.
- Determinístico: la misma huella con cualquier troceado (test con 1 chunk, 2 chunks y byte a byte).
- Segunda barrera intacta: el `maxBytes` de `putTemporary` (B1) sigue puesto. Storage sin cambios.
- Límite de la identidad documentado en `docs/platform/ASSETS.md`: dos cuerpos con los mismos `límite + 1` primeros bytes son indistinguibles; ambos reciben el mismo rechazo.

Evidencia:
- `upload.db.test.ts`: el caso del auditor (`AAAAA` → `BBBBB` = 409) más el replay de `AAAAA` mandado en otro troceado.
- `limited-body.test.ts`: 5 tests (troceado, cuerpos distintos, justo en el límite, fuente destruida).
- Mutación nueva `assets: huella de TOO_LARGE ignorada` (sacar `prefixSha256` del fingerprint): **atrapada**.

## 2. [P1] Gate E2E pendiente sobre B3 — **Corregido con evidencia de CI**

Sigo sin poder correr 14/14 en este entorno (no hay Chrome con H.264; ver el
reporte B3). No lo declaro verde con evidencia local. La evidencia es el CI de
GitHub sobre el **HEAD exacto** de esta entrega, con los cinco jobs, incluidos
`e2e-m2c` (Google Chrome del runner) y `mutations` completo. El enlace va en el
comentario del PR y en HANDOFF. Si algún job no termina verde, la pelota no se
devuelve.

## 3. [P2] Base/diff de #3 después del squash de B2 — **Corregido**

`main@5ba9f1a` integrado en `fase/m3a1-b3` con merge (no se reescribió
historia). Conflictos solo en `gates.yml` y `mutation-check.py`: el lado de
main era idéntico al de `a35eb5b` (verificado con `git diff --quiet`), así que se
conservó la versión de la rama, que es B2 + los cambios de B3. HANDOFF queda
como en main (la rama nunca lo tocó). `git diff --name-only origin/main HEAD`:
solo archivos de B3, sin HANDOFF.

## Respuesta a las decisiones y a la mejora continua

- **Asset después del stream:** se agregó a `ASSETS.md` que no hay un Asset
  UPLOADING observable durante la transferencia; el progreso, si hace falta en
  B4, sale de la conexión HTTP.
- **BL-07** queda como reporte operativo, sin código contractual nuevo.
  **BL-08** queda report-only, con período de gracia y sin borrados.
  **BL-09** queda para después de B3 y no dispensa el gate. Registrado en `BACKLOG.md`.

## Extra: carrera en el arnés de PostgreSQL (visto en CI de main@5ba9f1a)

El job `postgres` de main falló con `23505 pg_authid_rolname_index`: los
archivos de test corren en paralelo y todos ejecutan `CREATE ROLE trust_owner`
tras un `IF NOT EXISTS`; dos workers pasan el chequeo a la vez. B3 suma dos
archivos `.db.test.ts`, así que la carrera se vuelve más probable en este PR.

Corrección: `pg_advisory_xact_lock` al comienzo del `DO` en
`packages/platform-db/src/testing.ts`. Reproducción determinística (dos `psql`
en paralelo con `pg_sleep(1)` entre el chequeo y el `CREATE ROLE`): sin lock →
`ERROR: duplicate key value violates unique constraint "pg_authid_rolname_index"`;
con lock → sin errores. Suite PG sobre clusters nuevos (sin roles): 4/4 corridas verdes.

## Extra: `e2e-m2c` rojo sobre 3629c5c

Falló `Client Mode › sin controles de operador…` (primer test de la corrida,
`ready-state` en LOADING durante 40 s). Ese job pasó 14/14 sobre `037bfc4`, y
entre los dos commits no cambió nada en `apps/`, `e2e/`, `experience-core`,
`trust-3d`, `playwright.config.ts` ni `.github/`. No lo declaro flake: el push
siguiente vuelve a correr el job, y si se repite lo investigo como propio.
