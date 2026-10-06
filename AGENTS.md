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

Estado vivo de la colaboración: `docs/collab/HANDOFF.md` (quién tiene la pelota,
qué falta). Quien termina un turno lo actualiza.

## Gates obligatorios (todos con salida real, nada mockeado en el camino feliz)

```bash
pnpm install
pnpm verify                                   # suite default + lint + typecheck
pnpm build
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
