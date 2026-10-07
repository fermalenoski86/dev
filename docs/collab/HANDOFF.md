# HANDOFF — estado de la colaboración

**Pelota en:** Claude (implementador) — corregir C1 en el PR [#7](https://github.com/fermalenoski86/dev/pull/7) según [AUDIT: CAMBIOS](https://github.com/fermalenoski86/dev/pull/7#issuecomment-6041680970). No iniciar C2.
**Fase:** M3A.1 Fase C1 — auth y roles (cambios solicitados; C2 bloqueada)
**Estado:** C1 auditada sobre `926b91103db0b1033acc391db819960d747a53e7`. [P1] el `LoginRateLimiter.hits` retiene indefinidamente claves vencidas y permite agotamiento de memoria con emails/IPs variables: reproducción independiente 20.000 → 40.000 entradas después de expirar la primera ventana. Corregir con limpieza/capacidad acotada, validar IP y agregar regresión. CI exacta completa verde; auditor local verify 625+1 skipped y build OK. Tags m3a1-b2/b3/b4 siguen pendientes de autorización explícita de Fer.

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
- PR: [#5](https://github.com/fermalenoski86/dev/pull/5) · issue [#6](https://github.com/fermalenoski86/dev/issues/6) · base `main`
- Rama: `fase/m3a1-b4` · HEAD entregado: `d9eb28ef335aa9bf422811657f2225ca2b08946e` (comprobar antes de auditar).
- Reporte: `docs/reviews/M3A1_FASE_B4.md` · salida: `docs/reviews/M3A1_FASE_B4_SALIDA.txt` (no equivale a aprobación).
- Diseño: `docs/platform/API.md`, ADR-056.
- CI independiente sobre ese HEAD: https://github.com/fermalenoski86/dev/actions/runs/37595789039

## Regla de entrega para evitar turnos perdidos
`docs/collab/HANDOFF.md` en `main` es la autoridad para asignar el turno. Al terminar una entrega, Claude debe actualizarlo en `main` con **Pelota en: ChatGPT**, el PR, su rama y el commit a revisar; actualizar solo la copia en la rama del PR no transfiere el turno. ChatGPT audita el código de esa rama, publica el resultado y devuelve la pelota en `main` a Claude. Releer el archivo y usar su SHA vigente para no sobrescribir actualizaciones concurrentes. No hay aprobación automática por cambio de turno.

## Hallazgos originales cerrados en el PR #2
1. [P1] `scripts/mutation-check.py:222–225`: devolver salida no cero si sobrevive un mutante; distinguir errores de infraestructura de mutaciones atrapadas.
2. [P2] `packages/platform-media/src/ffmpeg.ts:19,26–29,45–46`: evitar falso ASSET_CORRUPT en MP4 válido de un frame, sin requiredDurationMs; agregar regresión real 25/30 fps.

ChatGPT verificó ambos hallazgos corregidos en `91956d538322fa40ae94663593e7725924e89345`. No equivale a aprobación global B2.

## Gates de cierre B2
- Auditor local previo, Node22: verify 596+1 skipped, build, media 53/53, mutaciones 109/109 y E2E 14/14.
- CI independiente: verify 596+1, build OK, PostgreSQL 48+6 skipped, bootstrap 6/6, media 53/53, E2E 14/14, mutaciones 109/109 y árbol limpio.
- S3/MinIO de B1 no se repitió; opcional/no disponible y fuera del cambio B2.
- En la vuelta final el entorno local estaba desconectado; se verificaron código, blobs exactos, mergeability y evidencia del commit equivalente. No quedaron gates obligatorios pendientes.

## Cierre de B2 y acciones de Claude
- PR #2 aprobado sobre HEAD `a35eb5b0a3922cc78cc5a6fe509f23abc91af121`; mergeable=true.
- Los 15 archivos cambiados son idénticos al commit probado `54b0b77604d61e24c2478929e585e44ea1cbb115`; entre ambos solo cambió HANDOFF al sincronizar main.
- CI independiente verde: https://github.com/fermalenoski86/dev/actions/runs/37565432005
- Mergear #2 e iniciar B3. Mantener B4/API para después del gate de B3.

## Debate de mejora continua — decisión 2026-10-07
- BL-01: aceptada con los ajustes de Claude; implementar en PR propio después de mergear #2, sin mezclar con B3.
- BL-03: aceptada con ajuste para B3/B4. Derivar remediación de la autoridad, exponer argumentos estructurados además del texto y no interpolar filenames en shell. Las fixtures corregidas deben pasar `checkMedia`.
- BL-04: aceptada después de B4. El kit debe incluir versión/hash de la autoridad; sus MP4 deben pasar `checkMedia` y regenerarse al cambiar capabilities.
- BL-05/BL-06: Fer decide cuando exista hardware. No bloquean B3.
- Trazabilidad completa: `docs/collab/BACKLOG.md`. Auditoría aprobatoria: https://github.com/fermalenoski86/dev/pull/2#issuecomment-6030654008

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

## Siguiente fase activa
B3 — DB integration: migración 0002 (`rejection_detail jsonb`, `container`, consistencia READY ↔ StoredObject), AssetUploadService, idempotencia y audit. Ejecutar su gate antes de B4.

## Cierre B3 — 2026-10-07
- Aprobación: https://github.com/fermalenoski86/dev/pull/3#issuecomment-6033692739
- Commit auditado: `4e2876883c16a13e4ccd36ea106410a799fb5f5a`; squash en main: `decbb0016d822774b37b828a4cb8c38883c1becf`.
- Idempotencia TOO_LARGE corregida con huella incremental de `límite+1`, corte del stream, regresión AAAAA/BBBBB y mutación.
- Auditor local Node22: verify 616+1 skipped, build y media real 53/53.
- CI exacto verde: PG87+6 skipped, bootstrap6/6, E2E14/14, mutaciones121/121 y árbol limpio: https://github.com/fermalenoski86/dev/actions/runs/37582423246
- No ejecutados localmente en cierre: PG/bootstrap, E2E y mutaciones completas; cubiertos por CI independiente. S3/MinIO no ejecutado y declarado.
- BL-07 reporte operativo aceptado; BL-08 reporte de huérfanos sin borrado aceptado; BL-09 después de B3 con navegador/imagen fijada.

## Siguiente fase activa
B4 — API foundation: Fastify, `/health`, `/ready`, rutas de Asset, actor temporal DEV reemplazable, Zod, contrato de errores, límites de upload y E2E API. Incorporar BL-03 de remediaciones derivadas de la autoridad. Cerrar el gate completo de Fase B antes de Fase C.

## Cierre B4 — 2026-10-07
- Aprobación: https://github.com/fermalenoski86/dev/pull/5#issuecomment-6037450237
- Commit auditado: `33110978dda783e03b0e882b21307cbe6b233905`; squash en main: `0341d1510d8feaf036ae2542de55e58cb9be624a`.
- P1 multipart corregido: se valida cualquier parte posterior a `file` antes de crear Asset/key y se limpia el temporal; cuatro regresiones y dos mutaciones.
- Auditor local: verify 621+1, build y media real 63/63. CI exacto: PostgreSQL/bootstrap, media, mutaciones 131/131, E2E 14/14 y árbol limpio.
- BL-10 aceptada para Fase C con límite por actor y concurrencia, versión segura y 429 verificable. BL-11 aceptada con spike/versionado/CI determinista por la limitación de soporte Zod 3.
- S3/MinIO y Docker Compose no ejecutados, declarados.

## Siguiente fase activa
Fase C — auth, roles y approval. Mantener M2C.2 congelado; no iniciar Fase D, Scheduler, EDGE ni Deploy.

## Decisión del brief C — 2026-10-07
- Aprobación: https://github.com/fermalenoski86/dev/pull/7#issuecomment-6039457437
- C1: auth, sesiones, CSRF, roles y scope por contrato.
- C2: evidencia y approve/reject con cuatro ojos.
- C3: submit server-side sobre Draft persistido; Builder sync permanece en Fase D.
- Fuentes de seguridad: OWASP Password Storage, Session Management y CSRF Prevention Cheat Sheets.
- PR #7 debe sincronizarse con main antes de implementar; la combinación de contenido fue limpia localmente.

## Historial
- 2026-10-07 — ChatGPT: C1 `AUDIT: CAMBIOS` sobre `926b911`; P1 por crecimiento no acotado del mapa del rate limiter (20k→40k tras expiración). CI exacta completa verde; local verify/build OK. Pelota a Claude; C2 bloqueada.
- 2026-10-07 15:15 UTC — Claude: C1 (auth, sesiones, CSRF, roles, scope) entregada en PR #7 @926b911, CI verde; decisiones del auditor incorporadas al brief y ADR-057. Pelota a ChatGPT.
- 2026-10-07 — ChatGPT: aprueba el brief C con decisiones de seguridad/alcance y devuelve pelota a Claude para C1.
- 2026-10-07 12:10 UTC — Claude: B4 mergeada por ChatGPT; brief de Fase C derivado del master en PR #7 para acordar antes de codificar; BL-10/BL-11 registradas. Pelota a ChatGPT.
- 2026-10-07 — ChatGPT: aprueba B4, mergea PR #5 en `0341d15`, habilita Fase C y devuelve pelota a Claude.
- 2026-10-07 10:50 UTC — Claude: respuesta a AUDIT: CAMBIOS #1 de B4 (partes multipart posteriores a `file` → 400), CI verde sobre 3311097; pelota a ChatGPT.
- 2026-10-07 — ChatGPT: B4 `AUDIT: CAMBIOS` sobre `2de5883`; P1 multipart posterior a `file` no validado. Auditor local: verify 621+1, build y media63; CI equivalente cubre PG/bootstrap/mutaciones/E2E. Pelota a Claude; Fase C bloqueada.
- 2026-10-07 09:05 UTC — Claude (turno programado): sin auditoría nueva; el reporte B4 decía "apilado sobre #3" → corregido a base main con link al CI (`2de5883`, solo docs). Pelota sigue en ChatGPT.
- 2026-10-07 09:00 UTC — Claude: B4 entregada en PR #5 (platform-api, BL-03, 23 tests E2E de API, 129/129 mutaciones), CI verde sobre d9eb28e; issue #6. Pelota a ChatGPT.
- 2026-10-07 — ChatGPT: aprueba B3, mergea PR #3 en `decbb001…`, habilita B4 y devuelve pelota a Claude.
- 2026-10-07 06:50 UTC — Claude: respuesta a AUDIT: CAMBIOS #1 de B3 — huella de TOO_LARGE (P1), base sincronizada con main@5ba9f1a (P2), CI completo verde sobre 4e28768 con E2E 14/14 (P1); carrera de CREATE ROLE en el arnés PG corregida. Pelota a ChatGPT.
- 2026-10-07 — ChatGPT: mergea PR #2 con squash (`5ba9f1a…`), reapunta #3 a main y publica B3 CAMBIOS por idempotencia TOO_LARGE, E2E pendiente y sincronización de rama. Devuelve pelota a Claude.
- 2026-10-07 05:55 UTC — Claude: merge de #2 denegado por permisos del entorno (pendiente Fer); issue #1 cerrado; B3 entregada en PR #3 apilado sobre #2 (0002, AssetUploadService, audit, idempotencia; 120/120 mutaciones; E2E 13/14 local, igual que la base B2). Issue #4 de auditoría. Pelota a ChatGPT.
- 2026-10-07 — ChatGPT: `AUDIT: APROBADO` B2 sobre `a35eb5b0a3922cc78cc5a6fe509f23abc91af121`; CI completa PG/bootstrap y todos los gates; habilita B3 y devuelve pelota a Claude.
- 2026-10-07 — ChatGPT: PR #2 CAMBIOS; cierra hallazgos originales, verifica Node22 verify/build/media53/mutaciones109/E2E14; conflicto HANDOFF y PG/bootstrap independiente pendientes. Devuelve pelota a Claude y propone runner acotado para debate.
- 2026-10-07 — ChatGPT: alinea el HANDOFF de main con el pedido de re-auditoría de Claude en el PR #2; pelota en ChatGPT, sin aprobación de B2.
- 2026-10-06 — ChatGPT: auditoría de f3b55461600246f324c427edef091967e74e4944 publicada: CAMBIOS, 2 hallazgos reproducidos. B3 pendiente.
- 2026-10-06 — Claude: B2 entregada (48/48 reales, 9/9 mutaciones, M2C 14/14).
- 2026-10-07 — Claude (sesión interactiva): conflicto de HANDOFF resuelto en el PR #2, pg-up sin root, CI con los gates (verify/build, PG + bootstrap y media en verde; mutaciones y E2E fallan en CI, a diagnosticar), BACKLOG.md con el debate. Turno liberado para el programado de las 01:56.
- 2026-10-07 00:30 — Claude: CI en verde sobre 54b0b77 (fixes: colores ANSI en el clasificador de mutaciones; E2E con Google Chrome por H.264). Pelota a ChatGPT.
