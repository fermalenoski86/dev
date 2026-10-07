# HANDOFF — estado de la colaboración

**Pelota en:** Claude (implementador) — lo toma el turno programado de las 01:56. Pendientes en el PR #2 (rama `fix/m3a1-b2-audit1`, ya integrada con main): 1) diagnosticar los jobs `mutations` y `e2e-m2c` del CI nuevo (`.github/workflows/gates.yml`; leer anotaciones con `gh api repos/fermalenoski86/dev/check-runs/<job>/annotations`, corrida 37564021984); verify-build, postgres y media ya pasan en CI. 2) Volver a sincronizar el HANDOFF de la rama con este, responder en el PR #2 (conflicto resuelto, CI, `docs/collab/BACKLOG.md` con BL-01 aceptada y la evaluación de las ideas de Fer) y pasar la pelota a ChatGPT acá en main.
**Fase:** M3A.1 Fase B2 — Media inspection + validation
**Estado:** Re-auditoría de PR #2: `AUDIT: CAMBIOS`. Los dos hallazgos originales están corregidos y verificados; queda conflicto de integración en HANDOFF con main y verificación independiente PostgreSQL/bootstrap pendiente. Claude debe resolver contra main vigente, preservar las autorizaciones de Fer y volver a entregar HEAD/gates. **B3 no se inicia hasta `AUDIT: APROBADO` de B2.**

## Objetivo autorizado por Fer — 2026-10-06
Continuar Claude + ChatGPT hasta completar todo el alcance pensado y documentado del proyecto TRUST, fase por fase. Claude implementa y ChatGPT audita. Después de aprobar una fase, continuar con la siguiente ya definida en los briefs/roadmap, sin pedir confirmación rutinaria. No inventar requisitos ausentes; las decisiones de producto pendientes siguen el proceso de AGENTS.md. Mantener los gates y las partes congeladas. Esta autorización no aprueba B2 ni cambia quién tiene la pelota.

Turnos acordados (Buenos Aires): Claude a las :56 de horas impares; ChatGPT a las :56 de horas pares. Cada agente lee el HANDOFF y trabaja solo cuando tiene la pelota.

## Mejora continua autorizada por Fer — 2026-10-07
Claude y ChatGPT deben proponer mejoras de forma activa además de ejecutar el roadmap. En cada entrega, ambos aportan hasta tres propuestas útiles cuando haya oportunidades concretas: problema observado, beneficio, prioridad, esfuerzo aproximado, dependencias y criterio verificable de éxito. Revisar las propuestas del otro agente y responder con aceptar para el backlog, ajustar o descartar con motivo. No repetir propuestas existentes ni crear trabajo para llenar una cuota.

Priorizar estabilidad, seguridad, facilidad de operación, sincronización de pantallas/luces/reloj, previsualización y valor comercial de takeover/momentos. Corregir lo bloqueante y cerrar la fase activa antes de sumar funcionalidades. Las mejoras técnicas dentro del brief pueden avanzar con evidencia; cambios de producto o arquitectura fuera del alcance siguen AGENTS.md y quedan pendientes de decisión de Fer.

Ideas iniciales para evaluar contra el roadmap, sin iniciar implementación ni aprobar alcance nuevo:
1. Un diagnóstico operativo que indique qué funciona, qué está degradado y qué acción concreta necesita el operador, distinguiendo medición real de simulación.
2. Ensayo de escenas antes de publicación: previsualización, validación de medios y comprobación de sincronía según las capacidades reales del hardware.
3. Recuperación segura y trazable ante fallos: evaluar versiones de escenas/configuración, rollback y registro de cambios conforme a la arquitectura existente.

Claude: al devolver la próxima entrega, incluí tus propias ideas y tu evaluación de estas propuestas en el reporte de fase. ChatGPT revisará su utilidad y viabilidad junto con el código.

## Investigación aplicada y comité — autorización de Fer, 2026-10-07
Investigar estudios, documentación oficial y casos técnicos relevantes en la web. Cada propuesta debe tener fuente primaria con enlace/fecha, evidencia, límites, aplicabilidad a TRUST, esfuerzo y criterio medible. ChatGPT la presenta a Claude por GitHub; Claude responde con evaluación técnica y sus alternativas. Registrar acuerdo o desacuerdo antes de implementar. Fer autoriza incorporar las mejoras fundamentadas tras ese debate: Claude implementa en un PR y ChatGPT verifica código, pruebas y beneficio antes de aceptarlo. Actualizar brief/backlog y ADR cuando corresponda; mantener partes congeladas y cerrar primero los bloqueos de la fase activa. No considerar un enlace ni el acuerdo entre agentes como prueba de que una mejora funciona.

Si falta evidencia, información de hardware o hay desacuerdo sin resolver, dejar la decisión para Fer y continuar lo independiente. El comité diario a las 9:30 de Buenos Aires informa avances verificables, bloqueos, sugerencias, estudios evaluados, debate y mejoras implementadas/probadas; el reporte no modifica turnos ni certifica tests ajenos como propios.

Claude: incorporá esta investigación y tu evaluación de las propuestas al reporte de cada entrega para que ChatGPT pueda debatirlas y revisarlas.

## Entrega activa para auditar
- PR: [#2](https://github.com/fermalenoski86/dev/pull/2)
- Rama: `fix/m3a1-b2-audit1`
- Commit entregado: `91956d538322fa40ae94663593e7725924e89345` (comprobar el HEAD actual antes de auditar).
- Reporte de correcciones: `docs/reviews/M3A1_FASE_B2_AUDIT1.md`, en la rama del PR.
- Salida reportada por Claude: `docs/reviews/M3A1_FASE_B2_AUDIT1_SALIDA.txt`, en la rama del PR. No equivale a aprobación del auditor.

## Regla de entrega para evitar turnos perdidos
`docs/collab/HANDOFF.md` en `main` es la autoridad para asignar el turno. Al terminar una entrega, Claude debe actualizarlo en `main` con **Pelota en: ChatGPT**, el PR, su rama y el commit a revisar; actualizar solo la copia en la rama del PR no transfiere el turno. ChatGPT audita el código de esa rama, publica el resultado y devuelve la pelota en `main` a Claude. Releer el archivo y usar su SHA vigente para no sobrescribir actualizaciones concurrentes. No hay aprobación automática por cambio de turno.

## Hallazgos originales cerrados en el PR #2
1. [P1] `scripts/mutation-check.py:222–225`: devolver salida no cero si sobrevive un mutante; distinguir errores de infraestructura de mutaciones atrapadas.
2. [P2] `packages/platform-media/src/ffmpeg.ts:19,26–29,45–46`: evitar falso ASSET_CORRUPT en MP4 válido de un frame, sin requiredDurationMs; agregar regresión real 25/30 fps.

ChatGPT verificó ambos hallazgos corregidos en `91956d538322fa40ae94663593e7725924e89345`. No equivale a aprobación global B2.

## Gates verificados por ChatGPT — re-auditoría de PR #2
- Commit: `91956d538322fa40ae94663593e7725924e89345`; main al auditar: `4940358cfce98386a88a66db105140dd1593b361`.
- Node 22.23.3 / pnpm 12.5.1 / ffmpeg 6.1.1: install, verify (596 passed + 1 skipped; lint sin errores), build OK.
- Media real Node22: 53/53. Mutaciones completas Node22: 109/109 atrapadas, exit 0; 0 sobreviven / 0 sin salida. Autoprueba y overrides passed/sin salida fallan correctamente. Working tree restaurado y limpio.
- M2C E2E Chromium 153 real / Node22: 14/14 passed (1.4 min), sobre el build verificado.
- PostgreSQL real/bootstrap: pendientes de ejecución independiente. Instalación de PG16.15 no pudo crear usuarios/cambiar UID; pg-up y bootstrap fallaron por postgres ausente. Suite platform no ejecutada. Claude reporta PG48+6 skipped/bootstrap6; sus salidas no son ejecuciones del auditor. Sin aprobación con controles pendientes.
- S3/MinIO opcional no ejecutado aquí.
- Primera corrida mutaciones bajo npm exec: SIN SALIDA por EUSAGE de npm; descartada. Árbol restaurado y corrida limpia completa mediante PATH Node22: 109/109.

## Bloqueo activo y acciones de Claude
- [P2] PR #2 tiene conflicto de contenido en `docs/collab/HANDOFF.md`. Repro: `git fetch origin main`, luego `git merge-tree --write-tree origin/main HEAD` → exit 1 y CONFLICT. GitHub mergeable=false.
- Resolver con el main vigente **después de esta actualización**, conservando objetivo de Fer, mejora continua, investigación/comité, regla de turno y roadmap. No reemplazar main por la copia vieja de la rama.
- Devolver HEAD actual y gates/evidencia actualizados, transferir turno en main a ChatGPT. No iniciar B3 todavía.
- Auditoría publicada: https://github.com/fermalenoski86/dev/pull/2#issuecomment-6029432498

## Debate pendiente — propuesta técnica del auditor, 2026-10-07
- Runner de mutaciones: timeout configurable, limpieza de procesos/restauración y diagnóstico de infraestructura. Problema observado: subprocess sin timeout y grep descarta errores; EUSAGE quedó oculto como SIN SALIDA. Beneficio: gate acotado y reproducible. P2, esfuerzo estimado 0.5–1 día.
- Fuente primaria consultada 2026-10-07: https://docs.python.org/3/library/subprocess.html#subprocess.run y https://docs.python.org/3/library/subprocess.html#subprocess.Popen.communicate. Timeout de run mata/espera el hijo; Popen requiere limpieza explícita. Límite: descendientes del shell requieren tratamiento y pruebas; documentación no demuestra beneficio implementado.
- Criterio: runner colgado termina en presupuesto, exit no cero, sin hijos vivos ni diff/journal pendiente; error de arranque deja diagnóstico útil y mutaciones109/109 siguen atrapadas.
- Estado: propuesta enviada en PR #2; respuesta/acuerdo/objeciones de Claude pendientes. NO implementada ni encargada. Claude debe evaluar aceptar/ajustar/descartar y responder también a las ideas de Fer. Registrar decisión en backlog/brief; ADR si corresponde, antes de implementación.

## Qué auditar
- Brief: `docs/briefs/M3A1_FASE_B2.md`
- Reporte: `docs/reviews/M3A1_FASE_B2.md` (criterio de cierre §30 punto por punto)
- Salida real: `docs/reviews/M3A1_FASE_B2_SALIDA.txt`
- Diseño: `docs/platform/MEDIA.md`, ADR-054
- Código: `packages/platform-media/`, `packages/platform-contracts/src/asset-rejection.ts`

## Decisiones de Claude a validar
1. Archivo vacío → `ASSET_EMPTY` (no NO_VIDEO/CORRUPT).
2. MP4 = demuxer mp4 + `major_brand` ISO BMFF (MOV comparte demuxer).
3. Carátulas `attached_pic` no cuentan como pista de video.
4. fps decide `r_frame_rate`; `avg_frame_rate` solo se guarda.
5. Decode sin `-err_detect explode`.

## Pregunta abierta (decisión de producto)
H.264 10 bits / 4:4:4 pasa la política actual. ¿Exigir `yuv420p`?

## Siguiente (después de aprobar B2)
B3 — DB integration: migración 0002 (`rejection_detail jsonb`, `container`,
consistencia READY ↔ StoredObject), AssetUploadService, idempotencia, audit.

## Historial
- 2026-10-07 — ChatGPT: PR #2 CAMBIOS; cierra hallazgos originales, verifica Node22 verify/build/media53/mutaciones109/E2E14; conflicto HANDOFF y PG/bootstrap independiente pendientes. Devuelve pelota a Claude y propone runner acotado para debate.
- 2026-10-07 — ChatGPT: alinea el HANDOFF de main con el pedido de re-auditoría de Claude en el PR #2; pelota en ChatGPT, sin aprobación de B2.
- 2026-10-06 — ChatGPT: auditoría de f3b55461600246f324c427edef091967e74e4944 publicada: CAMBIOS, 2 hallazgos reproducidos. B3 pendiente.
- 2026-10-06 — Claude: B2 entregada (48/48 reales, 9/9 mutaciones, M2C 14/14).
- 2026-10-07 — Claude (sesión interactiva): conflicto de HANDOFF resuelto en el PR #2, pg-up sin root, CI con los gates (verify/build, PG + bootstrap y media en verde; mutaciones y E2E fallan en CI, a diagnosticar), BACKLOG.md con el debate. Turno liberado para el programado de las 01:56.
