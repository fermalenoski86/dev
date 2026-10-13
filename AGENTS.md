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

## Paralelo (P-05)

Mientras la pelota es de ChatGPT, Claude puede trabajar en un **lateral**: un PR propio, en rama nueva desde `main`, solo de un ítem de `BACKLOG.md` ya `aceptada` y de riesgo bajo/medio. Reglas (acordadas en #53):

- **El HANDOFF dice cuál es la fase activa.** Al pasar la pelota a ChatGPT, Claude escribe `**En auditoría:** #<PR> @ <sha completo>` (obligatoria con la pelota en ChatGPT; `handoff.sh validar` la exige). **La línea queda hasta que ese PR está en `main`**, aunque la pelota vuelva a Claude por `AUDIT: CAMBIOS`: con la pelota en Claude deja de congelar el HEAD, pero los laterales siguen sin poder tocar sus archivos ni los gates. El turno que mergea la pone en `ninguno`; `handoff.sh escribir` lo hace cumplir: quitar la línea, ponerla en `ninguno` o cambiarla por otro PR exige que el PR anterior esté mergeado **en `main`** según GitHub (merged, base `main` y merge commit ancestro de `origin/main`; exit 5 si no, o si no se puede verificar); cambiar solo el sha del mismo PR es libre.
- **No se toca la rama en auditoría** (ni merge de `main` en ella) hasta `AUDIT: CAMBIOS` o `AUDIT: APROBADO`.
- **No se toca `HANDOFF.md`** en ningún PR: la pelota solo se mueve en `main` con `handoff.sh`. El lateral se registra en su PR/issue; el titular de la pelota lo refleja en el próximo HANDOFF.
- **Se pospone** el lateral que comparta archivos o dependencias con el PR en auditoría (dependencias = paquetes del workspace: el mismo paquete, o uno que depende del otro en forma transitiva, según los `package.json` de `main`, la fase y el lateral), y el que toque una familia de **riesgo alto** acordada en #53 (P-03 "alto" + ajuste del auditor): gates y scripts de proceso (`.github/workflows/`, `scripts/ci/`, `scripts/collab/`, `scripts/mutation-check.py`, configs de vite/vitest/playwright y `vitest.workspace.*`/`vitest.projects.*` a cualquier profundidad, y lo que CI ejecuta o lo que define un gate: `scripts/{dev,acceptance,e2e-platform}/`, las pruebas E2E que `gates.yml` ejecuta directamente (`e2e/`, M2C congelado, y `e2e-platform/`), el `scripts/` de cada paquete del workspace (raíces según `pnpm-workspace.yaml` de `main`: `apps/*`, `packages/*`, `edge/*`…; docs-contract, db-migrate, bootstrap-smoke, make-fixtures…), el bloque `"scripts"` de cualquier `package.json` bajo esas raíces (lo que `pnpm -r` y `pnpm --filter` ejecutan; las dependencias siguen siendo producto), y en la raíz `package.json`, `.eslintrc*`, `tsconfig.base.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.env.example`, `docker-compose*.yml`, `docker/`), migraciones (`packages/platform-db/src/migrations/`, `migrator.ts`, `bootstrap.sql`), auth/CSRF/CORS (`packages/platform-auth/`, `apps/platform-api/src/auth*`, `actor.ts`, `cors.ts`), aprobación (`packages/platform-approval/`, `apps/platform-api/src/approval*`), storage (`packages/platform-storage/`), procesos externos (`packages/platform-media/src/process.ts`, `apps/platform-api/src/server.ts`) y `apps/control` congelado; la transferencia de pelota (`HANDOFF.md`) la cubre la regla anterior. El mapa de rutas vive en `GATES_RE` de `paralelo.sh`, en un solo lugar, para que P-03 lo reutilice.
- **Nunca se mergea un lateral sin su propio `AUDIT: APROBADO`**, ni antes que el PR de la fase si comparten archivos. Antes de mergearlo, `scripts/collab/paralelo.sh <PR> <HEAD> main` tiene que dar OK contra el `main` del momento.

CI corre `scripts/collab/paralelo.sh` en cada PR (workflow `paralelo.yml`, evento `pull_request_target`) **con la revisión actual de `main`, nunca la del PR, la de su base ni la del evento** (la rama de una fase no está auditada: un PR `audit/*` hacia ella no puede hacer correr un script de esa rama; un re-run de un job viejo no puede aplicar una política ya superada; y como un re-run carga el YAML del workflow de la revisión del evento, el workflow cargado se compara con el de `main` actual y, si difiere, el veredicto directo queda anulado —hace falta un evento nuevo o traer `main` a la base— pero la re-evaluación global corre igual con los scripts de `main`; el checkout no persiste credenciales y `GH_TOKEN` solo llega a los pasos que publican checks o consultan la API): un PR que edite el script o el workflow no puede neutralizar el chequeo que lo evalúa; el PR aporta solo su número y su sha. Lee el HANDOFF de `origin/main` y rechaza: PR que modifica `HANDOFF.md` (exit 5); PR en auditoría cuyo HEAD cambió con la pelota en ChatGPT (exit 6); lateral que comparte archivos o dependencias del workspace con la fase activa, comparando contra el HEAD actual del PR de fase y contando origen y destino de los renames (exit 7); lateral que toca una familia de riesgo alto mientras hay fase activa (exit 8). **El veredicto de un lateral caduca cuando cambia lo que se compara:** cada evento `pull_request_target` (de cualquier PR y hacia cualquier base: GitHub descarta los runs pendientes del carril salvo el último, así que el que corre cubre a todos, con los scripts de `main` en un worktree aparte) y cada push a `main` (HANDOFF, merge) re-evalúan **todos** los PR abiertos hacia `main` con `scripts/collab/paralelo-reevaluar.sh` y publican el resultado como check `paralelo` sobre el HEAD de cada uno por la API de Checks —también el chequeo del propio PR, porque en `pull_request_target` el check del job cuelga del sha de la base— (el último publicado es el que vale; todo corre en un solo carril serial y, si `main` o el HEAD de la fase activa avanzaron mientras se evaluaba, o no se puede listar o publicar, no hay veredicto nuevo y se avisa; apenas se listan los PR, antes de evaluar, cada HEAD recibe un check "pendiente" y la publicación final se reintenta, así ni la ventana de evaluación ni un fallo de la API dejan vivo un verde viejo; si avanzaron mientras se publicaba, lo publicado se invalida al instante con un check `failure` "caducado" hasta la corrida siguiente; al terminar se vuelve a listar y todo PR hacia `main` que no estaba en la foto inicial (retarget o apertura durante la corrida) recibe `failure` "sin veredicto" hasta la corrida siguiente, y la revalidación de `main` y de la fase es lo último que corre, después de esa conciliación; la re-evaluación solo corre si los scripts en ejecución son exactamente la revisión de `main` que compara, si el checkout quedó atrás no evalúa; y para un PR hacia `main` el check de su HEAD es el que publica esa re-evaluación global: el chequeo directo del evento solo agrega rojos, se publica después y nunca pisa con un verde lo publicado por la re-evaluación; si ésta no completó o no incluyó ese HEAD queda `failure` "sin veredicto"; antes de publicar, el workflow consulta el PR por la API y falla cerrado si su HEAD o su base ya no son los del evento (retarget o push durante el run), decidiendo el camino por la base actual; un PR hacia otra base, que no entra en la re-evaluación, recibe su directo tras revalidar que la base no avanzó, con el mismo protocolo pendiente→final y una revalidación del PR después de publicar que pisa el verde con `failure` "caducado" si base, HEAD o el SHA de la base cambiaron mientras tanto (un push a una base ≠ `main` no dispara otra corrida); y la re-evaluación global corre en todo evento aunque la base del PR haya avanzado o no se pueda traer durante el job, porque ese run pudo desplazar al único pendiente del carril). Antes de mergear un lateral, además, se corre a mano contra el `main` del momento. El control entra en vigor al estar en `main`; en el PR que lo introduce no corre, a propósito. Es un chequeo, no un candado: la **protección de rama `main`** (CI requerido, rama al día) sigue pendiente de Fer.

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

## Fallas de CI (P-04)

Los agentes no siempre pueden bajar logs ni artifacts (proxy): lo que hace falta para diagnosticar tiene que estar en las **anotaciones** del run, legibles por API. Acordado en #53 (P-04 con ajustes del auditor).

- **Todo gate corre con `scripts/ci/run.sh "<título>" <comando>`.** En verde publica un `::notice` y en rojo un `::error`, los dos con la **línea de entorno** primero (`scripts/ci/entorno.sh`: `sha` del checkout, `head` auditado, run/attempt/job, `ImageOS`/`ImageVersion`, Node, pnpm, Chrome, ffmpeg, PostgreSQL, `nproc`, `loadavg`) y después el resumen o la **cola del error** (últimas 60 líneas). La salida completa queda en `test-results/ci/<título>.log`. Si un job falla **fuera de un gate** (setup: apt, `pnpm install`, build), el paso final `Entorno (falla fuera de un gate)` publica igual la línea de entorno y la deja en `test-results/ci/entorno.txt`, así el artifact existe aunque ningún gate haya corrido. Al fallar, **todo job sube `test-results/`** como artifact (`<job>-<sha>-<attempt>`, 14 días; e2e-m2c 30; la evidencia BL-29 de e2e-platform, 90).
- **Sanitización:** anotaciones y `test-results/ci/*.log` pasan por `scripts/ci/sanitizar.sh` (cabeceras de autenticación y cookies, `*token*`/`*secret*`/`*password*`/`*key*`, tokens de GitHub/AWS/JWT, credenciales en URL, claves privadas; un valor entre comillas se tapa entero, con espacios, comas o `;`; prefiere tapar de más). Las trazas de Playwright no se reescriben: solo contienen sesiones de la instancia de test que muere con el runner. `gates.yml` no usa `secrets.*` (CI lo verifica), así que ningún artifact puede contener un secreto real; datos comerciales no entran a CI (fixtures sintéticos, repo público). Quien agregue un log o artifact nuevo lo pasa por el filtro o justifica por qué no hace falta.
- **Clasificación obligatoria.** Todo comentario de falla en un PR (del implementador al entregar, del auditor al pedir cambios) la clasifica con su prueba, citando la anotación (run, job, línea de entorno):
  - **regresión reproducible** — falla 2/2 en el mismo SHA (o en local). `2/2` prueba reproducibilidad, **no** causa raíz: la causa se escribe aparte cuando se tiene.
  - **intermitente** — pasa y falla en el mismo SHA. Se abre o actualiza un issue `flaky` con la tabla run / SHA / `ImageVersion` / resultado (como #26) y se sigue ahí.
  - **infraestructura** — el error es del runner, la red o un paquete, con la línea que lo prueba (apt, descarga, `ECONNRESET`, runner perdido…).
  - **causa no determinada (en investigación)** — todavía no hay evidencia para ninguna de las tres. Es provisional y se dice así: está prohibido inventar una clasificación categórica.
  Sin clasificación no se pide re-auditoría; un comentario de falla sin clasificación es hallazgo **P2** del auditor. Un re-run sirve para comprobar reproducibilidad, no para "ver si pasa": si pasó al re-correr, es `intermitente` con su issue, no verde.
- **Prohibido para que algo pase:** `retries > 0` en Playwright, subir timeouts (`timeout`, `expect.timeout`, `timeout-minutes`), bajar umbrales, `skip`/`fixme`/`only` en los E2E que `gates.yml` corre directamente, o quitar un test. Ya era la práctica (DECISIONES 2026-10-09, #26); `scripts/ci/politica-fallas.sh check` lo hace cumplir en CI: `retries: 0`, timeouts (de las configs y por test/aserción en `e2e/` y `e2e-platform/`: `test.setTimeout`, `{ timeout: N }`, `setDefault*Timeout`) y `timeout-minutes` iguales a la foto `scripts/ci/umbrales.txt`, sin `.only(` en tests (incluidos los de `scripts/`) ni `.skip(`/`.fixme(` en `e2e/` y `e2e-platform/`. Un `it.skip` con motivo en un test unitario es un "no ejecutado" declarado, no un pase.
- **Ajustar un timeout o umbral no está prohibido en absoluto, pero no es un fix:** solo por decisión explícita (línea en `DECISIONES.md` con la causa demostrada) y auditoría del PR que lo cambia, con prueba de que sigue detectando el fallo real (el test que antes fallaba por la causa, provocado, sigue fallando). Ese PR regenera la foto (`scripts/ci/politica-fallas.sh generar`) y cita la decisión; `scripts/ci/` es familia de riesgo alto (auditoría formal).

## Reglas que no se discuten

- **No fingir ejecución.** Si un gate no se pudo correr (ej. S3 sin MinIO), se dice
  "no ejecutado" y por qué. Nunca "certificado".
- **No maquillar CI.** Nada de `retries`, timeouts más largos, umbrales más bajos ni
  `skip` para que algo pase; una falla se clasifica con prueba (§Fallas de CI).
- **M2C.2 EXECUTIVE EXPERIENCE está CONGELADO.** No se toca `apps/control` ni la
  experiencia ejecutiva salvo bug demostrado con test.
- **Storage B1/B1.1 aprobado:** no se cambia su arquitectura salvo bug demostrado.
- Procesos externos: `spawn`/`execFile` con argumentos, **nunca** shell.
- No exponer a clientes: stderr crudo, paths internos, stack traces, SQL, secretos.
- **Repo público:** nada de secretos, credenciales, datos comerciales de clientes
  ni contratos. `.env` está ignorado; solo `.env.example` con valores falsos.
- Decisiones de arquitectura → ADR en `docs/architecture/DECISIONS.md`.
- Commits en español, imperativo, con prefijo de fase: `m3a1-b3: migración 0002 …`.
