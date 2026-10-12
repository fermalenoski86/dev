# AGENTS.md — cómo trabajan Claude y ChatGPT en este repo

Este repo lo trabajan **dos agentes sin intervención humana en el día a día**:

| Rol | Agente | Hace | No hace |
|---|---|---|---|
| **Implementador** | Claude | Código, tests, migraciones, docs, reporte de fase con salida REAL | Mergear sus propios PR sin aprobación del auditor |
| **Auditor** | ChatGPT (Codex) | Revisa cada PR contra el brief de la fase, corre los gates, deja hallazgos, aprueba o pide cambios | Reescribir la fase en paralelo; si propone código, va en su propia rama `audit/<fase>-<tema>` con PR hacia la rama de la fase |

El dueño del producto (Fer) define fases y prioridades. Los agentes **no** cambian
alcance de una fase por su cuenta: si algo está fuera del brief, se abre un issue
con la etiqueta `decisión-producto` y se sigue con lo demás.

## Flujo por fase

1. Claude crea la rama `fase/<id>` (ej. `fase/m3a1-b3`) desde `main`.
2. Claude abre un **PR** con: brief de la fase, `docs/reviews/<FASE>.md`, salida real
   de los gates (`docs/reviews/<FASE>_SALIDA.txt`) y la lista de decisiones tomadas.
3. ChatGPT audita y responde **en el PR** con un comentario que empiece con uno de:
   - `AUDIT: APROBADO` → todos los gates verdes y sin hallazgos bloqueantes.
   - `AUDIT: CAMBIOS` → lista numerada `[P0|P1|P2] archivo:línea — hallazgo — cómo reproducir`.
4. Claude corrige en la misma rama, responde cada hallazgo (`Corregido en <sha>` o
   `No se cambia: <razón con evidencia>`) y vuelve a pedir auditoría.
5. Con `AUDIT: APROBADO` y gates verdes, el PR se mergea a `main` (squash) y se
   etiqueta la versión (`m3a1-b3`).
6. **P0 abierto = no se mergea.** Desacuerdo después de dos rondas → issue
   `decisión-producto` para Fer, y el resto avanza.

Prompt de auditoría y fundamento de los roles: `docs/ai-workflow/CLAUDE_Y_CHATGPT.md`.

Memoria de la colaboración: tres archivos con ciclos de vida distintos (2026-10-11).

| Archivo | Qué guarda | Cómo se escribe | ¿Se lee al arrancar? |
|---|---|---|---|
| `docs/collab/HANDOFF.md` | **Presente:** pelota, fase, PR/HEAD/CI, próximo paso, abiertos | Se **sobrescribe** en cada turno. Máx. 60 líneas (CI falla si se pasa) | Sí, siempre |
| `docs/collab/DECISIONES.md` | **Vigente:** autorizaciones de Fer, decisiones de producto, congelados, pendientes de Fer | Se **edita**: una decisión que cambia reemplaza su línea | Sí, siempre |
| `docs/collab/HISTORIAL.md` | **Pasado:** una línea por evento (`- fecha UTC — agente: qué, PR/SHA`) | Solo se **agrega** al final | No; solo para buscar algo puntual |

El detalle de cada auditoría o entrega va en el comentario del PR/issue, no en estos archivos: ahí se enlaza.

`docs/collab/PROGRESO.md` **no** es un cuarto archivo de memoria: es un reporte **generado** (P-02) desde el manifiesto `scripts/collab/entregables.mjs` con `pnpm progress:generate`; CI corre `pnpm progress:check` y falla si no coincide. Cinco pistas × tres columnas (`código` = PR mergeado + `AUDIT: APROBADO` enlazado; `probado simulado` = tests que CI corre; `probado con equipo real` = evidencia física con referencia, condiciones, fecha y responsable). Solo conteos `n/N`, sin porcentaje global; `0/0` = sin entregables definidos. Cuando un PR se mergea con AUDIT, el implementador agrega su entrada al manifiesto y regenera. La evidencia con equipo real la carga una persona; el validador rechaza tests o corridas de CI rotulados como "real".
La pelota se transfiere **solo** con `scripts/collab/handoff.sh` (P-01):

```bash
scripts/collab/handoff.sh leer                      # muestra HANDOFF de origin/main e imprime HANDOFF_BASE_SHA
export HANDOFF_BASE_SHA=<sha que imprimió>
# ... escribís tu versión nueva del HANDOFF en un archivo aparte ...
scripts/collab/handoff.sh escribir nuevo.md "handoff: <qué>" --historial "- <fecha UTC> — <agente>: <qué>"
```

Si `main` avanzó desde tu lectura, el script **aborta** (exit 3) y muestra lo que no viste: releé, rehacé tu versión y reintentá. Si el push falla por otra causa (autenticación, protección de rama, hook o red), aborta con **exit 4** y muestra el error real de git: eso no se arregla releyendo. El push es solo fast-forward; `--force` está prohibido para `main`. Mientras la pelota es del otro agente, **no se toca `HANDOFF.md`** (ni la tabla "Abierto": el lateral se registra en su PR/issue). CI valida formato y corre la prueba de dos escritores.

## Gates obligatorios (todos con salida real, nada mockeado en el camino feliz)

```bash
pnpm install
pnpm verify                                   # suite default + lint + typecheck
NEXT_PUBLIC_TRUST_API_URL=https://api.trust.test:8443 pnpm build   # BL-30: platform-web exige la API por https
bash scripts/dev/pg-up.sh                     # PostgreSQL 16 local en :5433
npx vitest run -c vitest.platform.config.ts   # PostgreSQL real
bash packages/platform-db/scripts/bootstrap-smoke.sh
npx vitest run -c vitest.media.config.ts      # ffprobe/ffmpeg reales
python3 scripts/mutation-check.py             # todas ATRAPADAS
npx playwright test e2e/experience.spec.ts e2e/builder.spec.ts   # M2C congelado (14)
```

Requisitos de entorno: Node 22, pnpm 12.5.1, PostgreSQL 16, ffmpeg/ffprobe ≥ 6,
Chromium para Playwright.

Preparación probada (Ubuntu 24.04):

```bash
apt-get install -y postgresql-16 ffmpeg          # crea el usuario postgres
npm i -g pnpm@12.5.1 && pnpm install
# Chromium para E2E si `playwright install` no descarga: cualquier Chromium
# ≥ 120 sirve vía TRUST_CHROMIUM_PATH=/ruta/al/chromium (ver e2e/README.md).
```

Si un gate no se puede correr en tu entorno, se reporta "no ejecutado" con el
motivo; el otro agente lo corre en el suyo y deja la salida real en el PR.

## Reglas que no se discuten

- **No fingir ejecución.** Si un gate no se pudo correr (ej. S3 sin MinIO), se dice
  "no ejecutado" y por qué. Nunca "certificado".
- **M2C.2 EXECUTIVE EXPERIENCE está CONGELADO.** No se toca `apps/control` ni la
  experiencia ejecutiva salvo bug demostrado con test.
- **Storage B1/B1.1 aprobado:** no se cambia su arquitectura salvo bug demostrado.
- Procesos externos: `spawn`/`execFile` con argumentos, **nunca** shell.
- No exponer a clientes: stderr crudo, paths internos, stack traces, SQL, secretos.
- **Repo público:** nada de secretos, credenciales, datos comerciales de clientes
  ni contratos. `.env` está ignorado; solo `.env.example` con valores falsos.
- Decisiones de arquitectura → ADR en `docs/architecture/DECISIONS.md`.
- Commits en español, imperativo, con prefijo de fase: `m3a1-b3: migración 0002 …`.
