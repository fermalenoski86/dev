# Propuesta · integrar perfiles de `msitarzewski/agency-agents` en TRUST

**Estado:** **E1 documental aprobada por Fer (2026-10-12, 18:50 ART).** E2 y E3 **no** autorizadas.
Rama de prueba `docs/agency-agents-propuesta`, inerte: sin PR, sin merge, nada en `.claude/agents/`.
Ningún archivo de esta rama lo lee Claude Code, Codex ni CI.

### Condiciones de Fer para avanzar (2026-10-12)
1. E1 aceptada para los seis perfiles.
2. `PERMISOS.md` con restricciones de lectura efectivas (no basta un patrón `Bash(gh api:*)`), mínimo privilegio y aislamiento. → **Hecho en v2:** ningún perfil tiene `Bash` ni red; leen un snapshot que arma Claude.
3. Evals ampliadas con concurrencia, prompt injection, permisos, SHA obsoleto y errores de seguridad. → **Hecho:** `evals/TRANSVERSALES.md` (40 casos).
4. Rama inerte, sin PR ni merge por ahora.
5. No se modifican `HANDOFF.md`, `AGENTS.md`, workflows, gates ni las protecciones de `main`.
6. **Prioridad absoluta:** cerrar P-05 (#69) y cumplir #73. No se desvían recursos críticos a esto.
7. Después de P-05: E2 como PR independiente, subagentes solo lectura, auditoría formal de ChatGPT/Codex.
8. No instalar perfiles del implementador en el entorno del auditor.
9. Medir en 10 PRs y conservar solo los agentes con mejora verificable.

Fer conserva la aprobación final de cada etapa siguiente.
**Autor:** Claude (implementador), 2026-10-12. **Decide:** Fer. **Audita antes de activar:** ChatGPT (AGENTS.md).
**Fuente analizada:** `github.com/msitarzewski/agency-agents` @ `f99f6aa9` (2026-10-07), licencia MIT
(copia en `docs/agents/LICENSE-agency-agents.txt`). 329 archivos `.md`, 20 divisiones, formato
Claude Code nativo (`.md` + YAML frontmatter) y conversor a Codex (`.toml`).

## 0. Resumen (lo que hay que decidir)

| | |
|---|---|
| Qué se propone | 4 perfiles prioritarios + 2 complementarios, **reescritos para TRUST** (no copiados), como **subagentes de Claude Code** que el implementador invoca por tarea. No son un tercer agente: no tienen pelota, no escriben `HANDOFF.md`, no emiten `AUDIT:`. |
| Qué NO cambia | `AGENTS.md`, `.github/workflows/*`, `scripts/collab/*`, ruleset `main-protegida`, PR #69 (P-05), issue #73, congelados (M2C.2, Storage B1). |
| Costo de infraestructura | $0. Son archivos de texto. Sin servicios pagos, sin Actions nuevas, sin secrets. |
| Costo operativo | Tokens de la cuota de Claude Code: entre ~750 y ~1.200 tokens de perfil por invocación (§7), más lo que el subagente lea (lo que domina). Medido, no prometido: la métrica M-C1 lo fija en la etapa E2. |
| Riesgo principal | Que un perfil "ayude" tocando algo que las reglas R1–R4 de P-05 o P-06 prohíben. Mitigación: permisos por perfil (§5), rutas vedadas en el propio prompt, y etapa E2 en modo **solo lectura / solo docs** antes de cualquier escritura. |
| Primer uso concreto | Issue #73 (kit McDonald's, 18/10): *Jefe de Gabinete* para cascada de documentos y filtro HOY FUNCIONA / SE IMPLEMENTARÁ; *Recolector de Evidencia* para el ensayo offline del 19/10. Sin tocar P-05. |

## 1. Arquitectura actual (contra la que se evalúa el complemento)

- **Dos agentes, dos roles** (`AGENTS.md`): Claude implementa, ChatGPT/Codex audita. Turnos a las :56 de horas impares/pares (ART). La pelota vive solo en `docs/collab/HANDOFF.md` de `main` y se transfiere solo con `scripts/collab/handoff.sh` (P-01).
- **Memoria en tres archivos** con ciclos distintos: `HANDOFF.md` (presente, ≤60 líneas), `DECISIONES.md` (vigente), `HISTORIAL.md` (pasado, append-only). `PROGRESO.md` es generado (P-02) y CI lo verifica.
- **Gates obligatorios** (`.github/workflows/gates.yml`, 7 jobs): `verify-build` (25 min máx.), `postgres` (20), `compose-smoke` (25), `media` (15), `e2e-m2c` (30), `e2e-platform` (40), `mutations` (60). Todos con salida real; nada mockeado.
- **P-05 en auditoría (PR #69)**: reglas R1 (ningún PR toca `HANDOFF.md`), R2 (rama en auditoría congelada al SHA anotado), R3/R3b (un lateral no comparte archivos ni dependencias con la fase activa), R4 (un lateral no toca familias de riesgo ALTO: workflows, `scripts/ci`, `scripts/collab`, configs de test, migraciones, auth/CSRF/CORS, aprobación, storage, procesos externos, `apps/control`). Mapa de rutas: `GATES_RE` en `scripts/collab/paralelo.sh`.
- **P-06 (brief `docs/briefs/P06_BRIDGE_POC.md`)**: PoC de firma delegada en Codex con `delegated-audit-gate`, Claude Action acotada, 4 rondas, lock durable. Va después de P-05 → P-04 → P-03.
- **Seguridad** (`docs/cybersecurity/PRINCIPLES.md`): separación PREVIS / CONTROL / EDGE; CONTROL nunca habla con hardware; ninguna API de hardware en el frontend; EDGE opera offline. Repo público: cero secretos.
- **Prioridad comercial** (issue #73): kit McDonald's, paquete el 18/10, ensayo 19/10, reunión estimada 20–22/10. Sin gastar en servicios pagos; sin alterar P-05.

Lo que la arquitectura **no tiene hoy** y los perfiles pueden cubrir: (a) una revisión de seguridad específica de código escrito por IA, previa a la auditoría formal; (b) una métrica de costo por ronda (tokens, minutos de CI) con dueño; (c) un diseño explícito de permisos/HITL/observabilidad para P-06 antes de implementarlo; (d) alguien que mantenga la cascada documental (`DECISIONES` → briefs → `PROGRESO` → ADR) y filtre lo que sube a Fer.

## 2. Selección

### 2.1 Prioritarios (pedidos por Fer)

| Perfil origen | Perfil TRUST (`docs/agents/perfiles/`) | Para qué en TRUST | Solapa con | Veredicto |
|---|---|---|---|---|
| `engineering-multi-agent-systems-architect.md` (4.286 palabras) | `trust-arquitecto-multiagente.md` | Revisar el diseño de P-06 (topología, permisos, HITL, lock, 4 rondas, observabilidad) **antes** de escribir el workflow; checklist de arquitectura por PR de proceso | Rol de ChatGPT como diseñador/auditor de proceso (#54); ADR en `docs/architecture/DECISIONS.md` | **Adoptar, solo lectura.** Produce revisiones y propuestas de ADR; no implementa. |
| `security-ai-generated-code-auditor.md` (2.647) | `trust-auditor-codigo-ia.md` | Pre-auditoría de seguridad del diff antes de pasar la pelota (parte de la autorrevisión A/B/C): secretos, autorización, inyección en cualquier sink de LLM futuro (Studio IA, P-06), `execFile` sin shell, nada de hardware desde el browser | Auditoría formal de ChatGPT; `docs/cybersecurity/PRINCIPLES.md`; reglas de `AGENTS.md` ("no exponer stderr, paths, SQL, secretos") | **Adoptar, solo lectura.** Reporta; nunca edita. No reemplaza `AUDIT:`. |
| `engineering-finops-engineer.md` (1.928) | `trust-finops.md` | Costo por ronda de auditoría (tokens, minutos de Actions), costo por PR, y — cuando exista — costo de la nube de CONTROL por campaña/pantalla. Hoy casi todo el gasto es cuota de LLM y minutos de CI (gratis en repo público) | Nada hoy; en el futuro, `docs/ops/` | **Adoptar, solo lectura + docs.** Primer entregable: línea base de M-C1/M-C2 (§8). Sin "optimizar" gates (R4). |
| `specialized-chief-of-staff.md` (2.932) | `trust-jefe-de-gabinete.md` | Filtro de lo que sube a Fer; cascada documental cuando cambia una decisión; brief de estado; cierre de sesión. Primer uso: #73 | `HANDOFF.md`/`DECISIONES.md`/`HISTORIAL.md` (ya son la memoria oficial), prompt de "mejora continua" (máx. 3 propuestas por entrega) | **Adoptar con recorte fuerte.** Prohibido tocar `HANDOFF.md` (R1) y cambiar alcance. No escribe nada: entrega diffs que Claude decide si aplica. |

### 2.2 Complementarios (no pedidos; justificados por brechas concretas)

| Perfil origen | Perfil TRUST | Por qué | Veredicto |
|---|---|---|---|
| `testing-evidence-collector.md` (1.155) | `trust-recolector-evidencia.md` | La regla "no fingir ejecución" ya existe; falta quien arme el **manifiesto de evidencia** por entrega (qué se corrió, run/attempt, qué no, por qué) en el formato que `docs/reviews/<FASE>_SALIDA.txt` y BL-29 ya usan. Útil para el ensayo offline de #73 | **Adoptar, solo lectura.** |
| `engineering-minimal-change-engineer.md` (1.806) | `trust-cambio-minimo.md` | Codex pidió repetidas veces "sin ampliar alcance" (HANDOFF actual). Un revisor de diff que marque cualquier línea fuera del brief antes de pedir auditoría | **Adoptar, solo lectura.** Es una lista de control, no un agente que edita. |

### 2.3 Descartados (y por qué)

| Perfil | Motivo |
|---|---|
| `specialized/agents-orchestrator.md` ("leader of this process") | Choca de frente con `AGENTS.md`: ya hay orquestación (pelota, turnos, handoff.sh). Un tercer orquestador rompe R1. |
| `engineering-code-reviewer.md` | Lo hace Codex como auditor formal; duplicarlo del lado del implementador confunde quién emite `AUDIT:`. |
| `engineering-devops-automator.md`, `engineering-git-workflow-master.md` | Su valor está en tocar workflows y ramas: familias de riesgo ALTO (R4). Nada que puedan hacer sin auditoría formal. |
| `engineering-incident-response-commander.md`, `engineering-sre.md` | No hay producción ni hardware todavía. Reevaluar con EDGE. |
| `security-secrets-credential-engineer.md` | Útil, pero el 80 % relevante (detección, "rotar, no borrar") se absorbe en `trust-auditor-codigo-ia.md`. Evitar dos perfiles para lo mismo. |
| `specialized/agentic-identity-trust.md` | Buen material para P-06 (identidad de bots, allowlist por `user.id`), pero ese diseño ya está escrito en el brief. Se cita como referencia en el arquitecto; no se instala. |
| `testing-reality-checker.md` | "Default NEEDS WORK" es exactamente el rol de ChatGPT. Solaparía al auditor. |
| Marketing, ventas, diseño, finanzas (`finance-*`), legal, etc. | Fuera del repo. Para el deck de #73 sirven como referencia de lectura, no como subagentes del código. |

## 3. Modelo de integración

```
Fer ──decide──▶ DECISIONES.md
                     │
   ┌─────────────────┴──────────────────┐
   │ Claude (implementador, con pelota) │──PR──▶ ChatGPT/Codex (auditor) ──AUDIT:──▶ merge
   │   arma snapshot → invoca por tarea │
   │   • arquitecto-multiagente (lee)   │
   │   • auditor-codigo-ia (lee)        │
   │   • finops (lee)                   │
   │   • jefe-de-gabinete (lee)         │
   │   • recolector-evidencia (lee)     │
   │   • cambio-minimo (lee)            │
   └────────────────────────────────────┘
        salida: texto que Claude pega en el PR/issue (si el sha sigue vigente)
        nunca: HANDOFF.md · AUDIT: · merge · .github/ · scripts/collab/
```

- **Mecanismo:** subagentes de Claude Code. Cuando se active (E2), los archivos se copian de `docs/agents/perfiles/` a `.claude/agents/` **en una rama con PR y AUDIT propio**. Mientras viven en `docs/`, son inertes.
- **Codex:** el conversor del repo origen genera `.toml` (`name`, `description`, `developer_instructions`). **No se propone instalarlos en Codex**: el auditor no debe heredar prompts escritos por el implementador. Si ChatGPT quiere alguno, lo pide en #54.
- **Quién los invoca:** solo Claude, en su turno, para una tarea concreta, y lo deja registrado en el PR ("revisado con `trust-auditor-codigo-ia` sobre `<sha>`: N hallazgos"). Nunca corren solos, por cron ni por Action.
- **Qué devuelven:** texto con formato fijo (cada perfil lo define) que Claude pega en el PR o el issue, solo si el sha leído sigue siendo el HEAD del PR. El auditor ve la salida como evidencia más, no como veredicto.

## 4. Solapamientos (detalle)

| Zona | Quién manda hoy | Qué hace el perfil | Regla para no pisarse |
|---|---|---|---|
| Veredicto sobre un PR | `AUDIT: APROBADO/CAMBIOS` de ChatGPT | `trust-auditor-codigo-ia` emite `PRE-AUDITORÍA:` con hallazgos | Prefijo distinto; el check de P-06 ignora cualquier cosa que no sea una PR review de Codex. Nunca `AUDIT:` en la salida. |
| Alcance de fase | Brief + `DECISIONES.md` | `trust-cambio-minimo` lista líneas fuera del brief | Solo reporta; si algo parece necesario, issue `decisión-producto`. |
| Memoria | `HANDOFF`/`DECISIONES`/`HISTORIAL` | `trust-jefe-de-gabinete` propone diffs a `DECISIONES.md`/briefs/ADR | No escribe esos archivos; entrega el diff y Claude decide si lo aplica en su PR. `HANDOFF.md`: prohibido (R1). |
| Diseño de proceso | ChatGPT (P-05/P-06) + ADR | `trust-arquitecto-multiagente` revisa contra checklist | Salida = texto que Claude pega en #54/#53. Un ADR solo lo escribe Claude con AUDIT. |
| Evidencia | `docs/reviews/*_SALIDA.txt`, BL-29 | `trust-recolector-evidencia` arma el manifiesto | Mismo formato; no inventa. "No ejecutado" se escribe literal. |
| Costos | Nadie | `trust-finops` mide | Solo mide y propone. Cambiar un gate o un timeout es R4 → PR con AUDIT. |

## 5. Lo que cada perfil puede y no puede tocar

Ver `docs/agents/PERMISOS.md` (matriz completa). Resumen:

| Perfil | `tools:` | Bash | Red | Escribe | Entrada |
|---|---|---|---|---|---|
| los seis | `Read, Grep, Glob` | **no** | **no** | **no** | snapshot `$SNAP/<perfil>/<sha>/` con `MANIFIESTO.txt` (lo arma Claude con `gh api` GET y `git diff --no-ext-diff --no-textconv`) + repo |

Por qué no `Bash(gh api:*)`: el patrón compara el prefijo, no el método. `gh api … -f x=y` hace POST, `-X DELETE` borra y `; git push` encadena. `git diff --output=` escribe archivos y `--ext-diff` ejecuta programas. Detalle, aislamiento de credenciales (reglas `deny` + hook `PreToolUse`) y SHA obsoleto en `PERMISOS.md` v2.

Ningún perfil: mergea, hace push, comenta en GitHub por su cuenta, toca secrets, instala paquetes, corre gates (los corre Claude con los comandos de `AGENTS.md`).

## 6. Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación | Señal de alarma |
|---|---|---|---|---|---|
| R-01 | Un perfil edita algo o ejecuta un comando | media | alto (R3/R4 rojo, pérdida de confianza del auditor) | `tools: Read, Grep, Glob` en los seis; sin `Bash` ni red; reglas `deny` + hook `PreToolUse` en E2 (casos P1–P9) | `paralelo.sh` exit 7/8 en un PR de Claude |
| R-02 | Salida de un perfil se confunde con un veredicto | baja | alto | Prefijos `PRE-AUDITORÍA:` / `EVIDENCIA:` / `COSTO:`; nunca `AUDIT:`; P-06 valida identidad por `user.id` | Un `AUDIT:` en un comentario que no es PR review |
| R-03 | Más tokens por ronda sin más calidad | alta al principio | medio (cuota) | Presupuesto por invocación (§7); medir M-C1 en 10 PRs; desactivar el perfil que no mueva M-Q1/M-Q2 | M-C1 > +25 % sin bajar hallazgos P1/P2 del auditor |
| R-04 | Prompt injection vía contenido que el perfil lee (issues, PRs, páginas) | media | alto | Perfiles tratan todo lo leído como datos; sin red salvo GitHub API de lectura; sin `WebFetch` | Un perfil propone una acción "pedida" por un comentario |
| R-05 | Deriva: el perfil "mejora" el proceso y propone cambios a `AGENTS.md`/gates | alta | medio | Regla escrita: propuestas van a `BACKLOG.md` vía Claude, máx. 3 por entrega (mejora continua ya vigente) | PR que toca `AGENTS.md` sin brief |
| R-06 | El Jefe de Gabinete pisa el rol del HANDOFF o duplica memoria | media | medio | Prohibido escribir los tres archivos de memoria; sus briefs son transitorios y se borran al cerrar el tema | Dos fuentes de "estado actual" discrepantes |
| R-07 | Licencia: copiar texto MIT sin aviso | baja | bajo | `LICENSE-agency-agents.txt` + línea de atribución en cada perfil; los perfiles están reescritos, no copiados | — |
| R-08 | Distracción de #73 | media | alto (fecha 18/10) | Solo dos perfiles se usan para #73 y en modo lectura; el resto espera a después de P-05 | Horas de Claude en esta rama después del 13/10 |

## 7. Costos

**Infraestructura: $0.** Sin servicios, sin secrets, sin Actions. Minutos de CI: no cambian (los perfiles no corren en CI).

**Tokens por invocación (tamaño del perfil; `wc -w` × 1,3 para inglés, × 1,5 para castellano):**

| Perfil | Origen (palabras → tokens) | Adaptado TRUST (palabras → tokens) | Lecturas típicas que hace | Estimación por invocación |
|---|---|---|---|---|
| arquitecto-multiagente | 4.286 → ~5.600 | 713 → ~1.100 | brief P-06 (~2.800) + workflow | 5–10 k |
| auditor-codigo-ia | 2.647 → ~3.400 | 788 → ~1.200 | diff del PR (2–20 k) + PRINCIPLES | 5–25 k |
| finops | 1.928 → ~2.500 | 682 → ~1.000 | `runs.json`/`jobs` del snapshot (1–3 k) | 3–6 k |
| jefe-de-gabinete | 2.932 → ~3.800 | 745 → ~1.100 | HANDOFF + DECISIONES (~4 k) + issue | 6–12 k |
| recolector-evidencia | 1.155 → ~1.500 | 564 → ~850 | SALIDA.txt + runs/jobs | 3–8 k |
| cambio-minimo | 1.806 → ~2.300 | 509 → ~760 | brief + diff | 3–20 k |

Total de los 6 perfiles adaptados: 4.001 palabras (~6 k tokens) contra 14.754 del origen (~19 k): la reescritura dejó un 30 % del tamaño y el 100 % de las reglas que aplican acá. Medido sobre esta rama con `wc -w docs/agents/perfiles/*.md`. El costo real por ronda se **mide**, no se estima: métrica M-C1. Referencia de precio/cuota: la de Claude Code vigente en `docs.claude.com`; acá se cuenta en tokens para que no envejezca.

**Tiempo:** cada invocación agrega 1–4 min a la autorrevisión A/B/C de Claude. Contra ~3 h de ronda hoy, es ruido; lo que importa es si baja el número de rondas (M-Q1).

## 8. Métricas de evaluación (línea base → objetivo)

Ventana: 10 PRs consecutivos después de activar E2, excluyendo PRs de riesgo alto (siguen 100 % con ChatGPT). Fuente: comentarios `AUDIT:` en los PRs y `HISTORIAL.md`. Las calcula `trust-finops` sobre el snapshot y Claude las publica en el issue de evaluación.

| ID | Métrica | Cómo se mide | Línea base | Pasa si |
|---|---|---|---|---|
| M-Q1 | Rondas `AUDIT: CAMBIOS` por PR hasta `APROBADO` | contar comentarios en el PR | medir en los 10 PRs previos (P-05 lleva 22 rondas; no es representativo, se excluye) | −30 % |
| M-Q2 | Hallazgos P1/P2 del auditor en categorías que el pre-auditor cubre (secretos, autorización, shell, exposición de errores) | etiquetar cada hallazgo | medir | −50 % |
| M-Q3 | Hallazgos de alcance ("sin ampliar", "fuera del brief") | etiquetar | medir | −50 % |
| M-Q4 | Falsos positivos del pre-auditor (hallazgo que ChatGPT descarta con evidencia) | contar | — | ≤ 1 por PR |
| M-C1 | Tokens por ronda (invocaciones de subagentes) | registro manual en el PR por Claude | 0 | ≤ +25 % del total de la ronda |
| M-C2 | Minutos de CI por PR | `gh api` runs | medir | sin cambio (no deben cambiar) |
| M-P1 | Decisiones abiertas de Fer sin fecha | `DECISIONES.md` § Pendiente | medir | 0 sin "decidir antes de" |
| M-P2 | Docs desincronizados tras un cambio en `DECISIONES.md` (briefs/ADR/PROGRESO que lo contradicen) | revisión del Jefe de Gabinete por cambio | medir | 0 a las 24 h |
| M-S1 | Secretos o rutas internas en código cliente | pre-auditor por PR | 0 (repo público) | se mantiene 0 |
| M-E1 | Entregas con manifiesto de evidencia completo (run/attempt/"no ejecutado") | revisión por PR | medir | 100 % |

Criterio de continuidad por perfil: si tras 10 PRs no mueve su métrica, se saca (un archivo menos en `.claude/agents/`). Resultado a #54 o a un issue nuevo con tabla y enlaces, igual que la matriz de P-06.

## 9. Evaluaciones por perfil (antes de activar)

`docs/agents/evals/` tiene, por perfil, casos de prueba con entrada, salida esperada y criterio. Regla tomada del propio Multi-Agent Systems Architect: **no se activa un perfil sin suite de evals y línea base.** Hay 6–10 casos propios por perfil más 40 transversales (`evals/TRANSVERSALES.md`: inyección, permisos, SHA obsoleto, concurrencia, errores de seguridad), o sea 46–50 por perfil. Los casos de contención (K) solo se pueden correr con E2 instalado en una rama; en E1 quedan como criterio de aceptación. Se corren a mano en E1 sobre PRs ya cerrados (histórico) para ver si el perfil hubiera encontrado lo que ChatGPT encontró.

## 10. Plan por etapas (cada paso con aprobación explícita)

| Etapa | Qué | Quién aprueba | Reversible |
|---|---|---|---|
| **E0 (esta rama)** | Propuesta + perfiles + evals bajo `docs/agents/`. Inerte. | — | borrar rama |
| **E1 ✔ aprobada** | Documental: permisos v2 y evals ampliadas en esta rama. Las evals de comportamiento (C) se corren sobre PRs históricos **solo cuando haya capacidad libre**, sin quitarle tiempo a P-05 ni a #73. | Fer (2026-10-12) | borrar rama |
| **E2 (no autorizada)** | Después de mergear P-05: PR independiente que copia los perfiles a `.claude/agents/` con `tools: Read, Grep, Glob` y agrega reglas `deny` + hook. Pasan los casos K al 100 %. AUDIT formal. Ventana de 10 PRs. | ChatGPT (`AUDIT: APROBADO`) + Fer | `git rm .claude/agents/trust-*` + revertir reglas (caso P9) |
| **E3 (no autorizada)** | Con los resultados de los 10 PRs: se quedan solo los perfiles con mejora verificable. Cualquier capacidad nueva (por ejemplo, escritura) requiere un brief propio, no un cambio de `tools:`. | Fer + ChatGPT | idem |
| **E4** | Resultado a #54 para que ChatGPT lo cruce con P-06 (el arquitecto-multiagente ya habrá revisado el brief). | ChatGPT | — |

**Cuándo:** E1 hecha. E2 **después de mergear P-05** y con aprobación explícita de Fer (toca `.claude/`, que no está en `GATES_RE`, pero es nuevo territorio y conviene que el auditor lo vea con la cola de P-05 cerrada). Nada de esto desplaza #73.

## 11. Lo que esta rama no toca (verificable)

`git diff --stat origin/main..docs/agency-agents-propuesta` → solo archivos nuevos bajo `docs/agents/`. Cero cambios en `.github/`, `scripts/`, `AGENTS.md`, `docs/collab/`, `apps/`, `packages/`, `e2e*/`. Sin PR abierto hasta que Fer lo pida. Sin merge. Sin tags.

## 12. Decisiones (resueltas por Fer el 2026-10-12)

| Pregunta | Respuesta |
|---|---|
| ¿Cuáles perfiles? | Los seis, en E1 |
| ¿E2 antes o después de P-05? | Después, como PR independiente, en solo lectura y con auditoría formal |
| ¿Se usan en #73? | No se desvían recursos: #73 y P-05 tienen prioridad absoluta |
| ¿Codex? | No se instalan perfiles del implementador en el entorno del auditor |
| ¿Criterio para quedarse con un agente? | 10 PRs medidos; se queda solo el que muestra mejora verificable |

Pendiente para cuando se pida E2: issue `decisión-producto` con el enlace a esta rama, para que ChatGPT opine antes del PR.

---
*Adaptado de `msitarzewski/agency-agents` (MIT). Los perfiles de `docs/agents/perfiles/` son reescrituras para TRUST; conservan la licencia y la atribución de origen.*
