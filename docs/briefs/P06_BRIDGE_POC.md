# P-06 · PoC de firma delegada en Codex — brief

**Estado:** diseño acordado (ChatGPT, [#54 · 6129563858](https://github.com/fermalenoski86/dev/issues/54#issuecomment-6129563858), AJUSTAR; Fer, 2026-10-12).
**Cuándo:** después de P-05 → P-04 → P-03. No interrumpe la fase activa.
**Qué NO es:** no habilita merge automático, no reemplaza al auditor, no cambia el contrato formal de `AGENTS.md` hasta volver a #54 con evidencia.
**Meta:** ronda de auditoría de ~3 h a ~15 min en PRs de riesgo bajo/medio, sin aprobaciones ficticias ni controles debilitados. La latencia se mide, no se promete.

## 1. Piezas

| Pieza | Qué | Dónde | Permisos |
|---|---|---|---|
| `## Code Review Rules — TRUST` | Instrucciones que Codex lee de `AGENTS.md`: qué revisar, qué demostrar y qué veredicto emitir | `AGENTS.md` (texto propuesto por ChatGPT, abajo) | — |
| `delegated-audit-gate` | Check de CI que valida por **API de GitHub** una review de Codex sobre el HEAD exacto y decide `pass / fail / report-only` | `.github/workflows/delegated-audit-gate.yml` + `scripts/collab/delegated-audit.mjs` (código y política **de `main`**, `pull_request_target` con checkout de la base; el PR aporta número y sha como datos, igual que `paralelo.yml`) | `contents: read`, `pull-requests: read`, `checks: read` |
| Política de elegibilidad | Clasificación de riesgo conservadora sobre el diff real contra merge-base; **alto si hay duda** | reutiliza `GATES_RE`/familias de P-05 y lo que defina P-03 (`scripts/collab/risk.mjs`); hasta que P-03 exista, lista explícita en el validador | — |
| Claude Action (PoC-1) | Corrige hallazgos en la rama del PR y pide re-review; **nunca** merge ni `main` | `.github/workflows/bridge-claude.yml` (`anthropics/claude-code-action@v1`), token en Secret `CLAUDE_CODE_OAUTH_TOKEN` | `contents: write` solo sobre ramas `fase/*`, `proc/*`; `pull-requests: write` para comentar |
| Contador de rondas + lock | 4 rondas por PR/HEAD/actor/evento; 5.ª → etiqueta `bridge-paused` y silencio; lock anti-duplicado con operación condicional durable (P-07) y prueba de dos escritores | `scripts/collab/bridge-state.mjs` sobre un check-run o un comentario con `If-Match`/ETag; **no** una etiqueta sola | — |

## 2. `## Code Review Rules — TRUST` (texto de ChatGPT, se incorpora tal cual en la PoC)

```md
## Code Review Rules — TRUST
Revisá el brief vigente, DECISIONES, diff completo y riesgos del PR.
Informá P0, P1 y P2 con archivo:línea, reproducción y corrección; incluí
pruebas adversariales y evidencias reales. No confundas tests verdes con
ausencia de bugs ni ejecuciones no realizadas con éxito.
Solo si verificaste el HEAD exacto, TODOS los gates obligatorios verdes,
la cobertura A/B/C, tests negativos aplicables, todas las invariantes y
ningún P0/P1/P2 abierto, podés emitir como PR review:
AUDIT: APROBADO
En cualquier otro caso emití:
AUDIT: CAMBIOS
o AUDIT: INSUFICIENTE_EVIDENCIA (sin facultad de merge).
Incluí repo, PR, SHA exacto, fuentes CI/run/attempt, alcance, riesgo,
lista de hallazgos y limitaciones. No uses AUDIT: APROBADO por silencio,
por baja severidad aparente ni como simple resumen de una review.
La política de elegibilidad y el check independiente del servidor prevalecen
sobre estas instrucciones; nunca autodeclares un PR elegible.
```

Salida estructurada que el check parsea (bloque al final de la review, parser estricto, un solo bloque):

```
AUDIT: APROBADO | CAMBIOS | INSUFICIENTE_EVIDENCIA
repo: fermalenoski86/dev · pr: #N · head: <sha 40>
brief: <ruta/issue> · criterios: <n/N revisados>
gates: run <id> attempt <k> · <jobs verdes>/<total> sobre <sha>
abc: A <sí/no> · B <sí/no> · C <sí/no>
hallazgos: P0 <n> · P1 <n> · P2 <n>
negativos: <lista o "ninguno aplicable">
no-ejecutado: <lista o "nada">
```

Lo que la PoC debe **demostrar**, no suponer: que Codex emite el marcador, que revisa P2 y que vuelve a revisar tras un push. Si no, no hay delegación.

## 3. `delegated-audit-gate` — contrato

Entrada: `pull_request_target` (`opened`, `synchronize`, `reopened`, `edited`) y `pull_request_review` (`submitted`, `dismissed`, `edited`). Fuente de autoridad: API de GitHub + `git diff` contra merge-base. **Nunca** el cuerpo del PR, un `issue_comment` ni archivos del PR.

Falla cerrado (exit ≠ 0) si falta cualquiera de:

1. **Identidad:** `review.user.type == "Bot"` y `review.user.id` ∈ allowlist inmutable en el código de `main` (ID numérico de `chatgpt-codex-connector[bot]`, verificado por API antes de fijarlo; no el login).
2. **Review real:** objeto `pull_request_review` con `state != DISMISSED`, no editada después de emitida (`submitted_at` vs. `updated_at`), `commit_id == pull_request.head.sha`. Reviews sobre un sha anterior → inválidas. Un `issue_comment` con `AUDIT:` no cuenta.
3. **Marcador:** parser estricto del bloque de §2; `AUDIT: APROBADO` exacto, con `head` igual al sha actual y `hallazgos: P0 0 · P1 0 · P2 0`. `CAMBIOS`/`INSUFICIENTE_EVIDENCIA`/sin bloque → fail.
4. **Elegibilidad:** riesgo **bajo/medio** por la política de `main` sobre el diff real (renames y borrados incluidos). Cualquier ruta de riesgo alto (familias de P-05/P-03 + `AGENTS.md`, `.github/`, `scripts/collab/`, el propio validador, secrets, infra, congelados) → fail con motivo "requiere auditoría formal".
5. **Gates:** todos los jobs requeridos de `gates.yml` verdes **sobre el mismo sha**, con `run id` y `attempt` registrados; pendiente o rojo → fail. Re-run se acepta solo si el attempt final es verde y queda trazado.
6. **Sin push posterior:** `review.commit_id == head.sha` ya lo cubre; además, `synchronize` posterior invalida.
7. **Rondas:** contador ≤ 4; en 5 → fail + `bridge-paused`.

Salida: anotación con `review_id`, `author_id`, `sha`, riesgo, `run/attempt` y la razón exacta. Modo **report-only** (el check nunca es required) hasta que la matriz de §5 pase y Fer active ruleset/branch protection; aun entonces, en piloto ChatGPT revisa antes del merge.

## 4. Claude Action (PoC-1) — límites

- Eventos: `pull_request_review` (submitted, autor allowlisted) con `AUDIT: CAMBIOS`; `issue_comment` con `@claude` de Fer. Nunca `pull_request_target` con checkout del PR y secrets.
- Acciones permitidas: commit + push a la rama del PR, comentario con respuesta por punto, pedir re-review. Prohibido: merge, push a `main`, editar `HANDOFF.md`, tocar `.github/`, `scripts/collab/`, `AGENTS.md` (si el hallazgo lo requiere → comentar y parar).
- Concurrency por PR, timeout 20 min, 4 rondas, lock durable (P-07). Forks y comentarios de cuentas no allowlisted → ignorados.
- Secret: `CLAUDE_CODE_OAUTH_TOKEN` (lo carga Fer; nunca se imprime). La PoC prueba que la Action corre de verdad (un run con salida), no solo que el secret existe.

## 5. Matriz de pruebas (PRs aislados, rama `poc/bridge-*`, cambios inocuos y reversibles)

| # | Caso | Esperado |
|---|---|---|
| 1 | PR inocuo (docs) | Codex revisa; si emite `AUDIT: APROBADO` con bloque, gate `pass` (report-only) |
| 2 | P1 sembrado (bug reproducible con test) | Codex `AUDIT: CAMBIOS` con P1; gate `fail`; Action corrige en la rama; re-review |
| 3 | P2 sembrado | Codex **debe** reportar el P2; si no lo ve, se documenta: sin P2 no hay delegación |
| 4 | Push después de la review | gate `fail` (sha viejo) |
| 5 | Otro bot/usuario escribe `AUDIT: APROBADO` | gate `fail` (identidad) |
| 6 | `AUDIT: APROBADO` en `issue_comment` | gate `fail` (no es review) |
| 7 | PR toca workflow / validador / clasificador / `AGENTS.md` | gate `fail` (riesgo alto, auditoría formal) |
| 8 | Rename que esconde un archivo de riesgo alto | gate `fail` |
| 9 | Review dismissed / editada | gate `fail` |
| 10 | CI rojo o pendiente en el sha | gate `fail` |
| 11 | Doble trigger / dos Actions a la vez | una sola corre (lock); la otra sale sin escribir |
| 12 | 4 rondas → 5.ª | `bridge-paused`, sin escrituras |
| 13 | Rollback: desactivar el workflow y borrar el secret | el flujo actual sigue intacto |

Métricas por caso: latencia abrir→review, push→re-review, cuota consumida, tiempo total de ronda. Resultado a #54 con tabla y enlaces a cada PR/run.

## 6. Humano, una sola vez (Fer)
- Environment de Codex para el repo y *Automatic review* (ya pedido en #54).
- `claude setup-token` → Secret `CLAUDE_CODE_OAUTH_TOKEN` (solo para PoC-1).
- Ruleset/branch protection de `main` con required checks (también pendiente de P-01/P-05).

## 7. Qué decide ChatGPT al final
Con la matriz completa: si se habilita auditoría delegada **solo** en PRs de riesgo bajo/medio. Seguridad, CI, auth, infraestructura y componentes congelados siguen con auditoría formal de ChatGPT, siempre.
