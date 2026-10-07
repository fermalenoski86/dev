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
