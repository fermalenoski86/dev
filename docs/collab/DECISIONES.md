# DECISIONES VIGENTES

Lo que sigue en pie hasta que Fer lo cambie. Se **edita** (no se agrega
historial): si una decisión cambia, se reemplaza la línea y el cambio va a
`HISTORIAL.md`. Las decisiones técnicas van como ADR en
`docs/architecture/DECISIONS.md`.

## Autorizaciones permanentes de Fer
- **Objetivo (2026-10-06):** Claude implementa, ChatGPT audita, fase por fase, hasta completar el alcance documentado. Al aprobar una fase se sigue con la próxima definida en briefs/roadmap sin pedir confirmación. No inventar requisitos; lo que es de producto va a un issue `decisión-producto`. Gates y partes congeladas se respetan.
- **Mejora continua (2026-10-07):** cada entrega puede traer hasta 3 propuestas concretas (problema, beneficio, prioridad, esfuerzo, dependencias, criterio verificable). El otro agente las acepta, ajusta o descarta con motivo, en `docs/collab/BACKLOG.md`. Primero se cierra lo bloqueante de la fase activa. Prioridades: estabilidad, seguridad, operación, sincronía pantallas/luces/reloj, previsualización, valor comercial.
- **Investigación y comité (2026-10-07):** propuestas con fuente primaria (enlace y fecha), límites y criterio medible. Acuerdo registrado antes de implementar; ChatGPT verifica código, pruebas y beneficio. Un enlace o un acuerdo entre agentes no prueba que algo funciona. Comité diario a las 9:30 ART: avances verificables, bloqueos, debate.
- **Sin pedirle OK en cada paso (2026-10-09, #26):** lo autorizado se ejecuta directo. El auditor sigue siendo condición para mergear.
- **Autonomía y orden (2026-10-12, Fer, tras el dictamen de #54):** Claude avanza sin consultar cada paso dentro de lo ya autorizado; escala solo decisiones de producto, costos adicionales o cambios de seguridad fuera de alcance. Orden: terminar P-05 → P-04 → P-03 (auditorías y gates intactos, sin interrumpir la fase activa) → PoC de P-06 (firma delegada de Codex **sin** merge automático ni sustitución del auditor; `## Code Review Rules` en `AGENTS.md`; check `delegated-audit-gate` por API; PRs de prueba inocuo / P1 / P2 y casos negativos; la Claude Action corrige en la rama del PR, nunca mergea ni escribe `main`; 4 rondas y anti-duplicado). Resultados a ChatGPT para decidir si se habilita auditoría delegada solo en riesgo bajo/medio: seguridad, CI, auth, infraestructura y congelados siguen con auditoría formal de ChatGPT. TRUST Creative Studio (#59: IA + editor profesional, web y desktop, dos pantallas, DMX y reloj) sigue en el roadmap en paralelo.

## Turnos y entrega
- **Cadencia (Fer, 2026-10-12):** ChatGPT corre cada hora; Claude cada hora a las :26 (ART), en un único turno programado que primero chequea barato (pelota, AUDIT, hallazgos de Codex, CI pendiente) y solo clona y trabaja si hay algo. Reemplaza al turno de 2 h y al chequeo horario separado. Cada uno trabaja solo si tiene la pelota en `HANDOFF.md` de `main`.
- La pelota se transfiere **solo** editando `HANDOFF.md` en `main` (no en la rama del PR). Releer el archivo antes de escribir para no pisar al otro.
- Antes de pasar la pelota a ChatGPT, Claude hace la autorrevisión A/B/C (diff vs brief, revisión adversaria, CI verde sobre el HEAD exacto) — pedido de Fer, 2026-10-08.
- Un fallo de CI que pasa al re-correr se registra como posible flaky en el PR; si se repite, se investiga.

- **Eficiencia de tokens, revisiones y costos (2026-10-12 21:48, Fer):** aplica a P-05, P-04, P-03, P-06, Creative Studio y siguientes. (1) Codex no se pide por commit: se agrupan correcciones, pruebas locales y A/B/C, y se pide con el PR consolidado; (2) presupuesto: una revisión inicial + una final por ronda de entrega, extra solo por P0/P1 crítico justificado — nunca habilita mergear con defectos; (3) se corrigen defectos reproducibles y riesgos concretos del alcance; mejoras no bloqueantes → BACKLOG; (4) pruebas progresivas (focalizadas + lint + typecheck) y CI completa obligatoria sobre el SHA final; (5) turnos programados: chequeo liviano primero y salir si no hay acción; (6) una sola sesión de Claude por PR (lock P-07); (7) cada pedido de auditoría informa revisiones de Codex, rondas y qué problema real justificó cada una; sin créditos ni servicios extra sin necesidad; (8) prioridad comercial: kit McDonald's #73, entrega completa viernes 16/10. Gates, seguridad, congelados y `AUDIT: APROBADO` antes del merge no cambian.

## Decisiones de producto
| Fecha | Issue | Decisión |
|---|---|---|
| 2026-10-08 | [#15](https://github.com/fermalenoski86/dev/issues/15) | D3 puede tocar el Builder: solo el store con `CampaignRepository` + indicador de versión. Experiencia ejecutiva, renderer, geometría y screenshots siguen congelados; los 14 E2E de M2C son gate. (Hecho.) |
| 2026-10-08 | [#22](https://github.com/fermalenoski86/dev/issues/22) | SeaweedFS fijado por digest, **solo** para desarrollo y CI (reemplaza a MinIO). |
| 2026-10-09 | [#31](https://github.com/fermalenoski86/dev/issues/31) | UI de login, campaña y aprobación en una app nueva `apps/platform-web`. `apps/control` sigue congelada. (Hecho.) |
| 2026-10-09 | [#26](https://github.com/fermalenoski86/dev/issues/26) | Plan de la auditoría externa de Fable autorizado completo, incluido tocar `apps/control` con evidencia + AUDIT. Sin relajar umbrales; `retries: 0`. |
| 2026-10-11 | [#61](https://github.com/fermalenoski86/dev/issues/61) | Las medidas de las pantallas son las que cargó Fer en `EL_TRUST` (Corrientes más chica, Pellegrini más grande). La proforma P5 es solo orientativa. `EL_TRUST` no cambia; el Studio usa formatos configurables igual. **Dos TB60**, uno por pantalla (una controladora independiente por cara). Marquesina: abierta con el proveedor, no bloquea. |
| 2026-10-11 | [#59](https://github.com/fermalenoski86/dev/issues/59) | TRUST Creative Studio encargado: Claude diseña e implementa, ChatGPT audita; ahora solo brief CS-0; implementación después de F3(a). |
| 2026-10-11 | [#52](https://github.com/fermalenoski86/dev/issues/52) | F3(a) rollback: Q0 = A, Q2 = A2.2 (ADR-064). |

## Congelado
- **M2C.2 EXECUTIVE EXPERIENCE** (`apps/control`, experiencia ejecutiva): no se toca salvo bug demostrado con test o decisión de Fer registrada arriba.
- **Storage B1/B1.1:** arquitectura aprobada; solo bug demostrado.

## Pendiente de Fer
- [#43](https://github.com/fermalenoski86/dev/issues/43): detalle de campaña para INTERNAL_APPROVER (403 de assets) — opción 1 o 2.
- Tags de versión (`bl31`, `bl07`, `bl08` y anteriores): el proxy no deja crearlos a los agentes; opcionales.
- BL-05 (exigir `yuv420p` / 8 bits 4:2:0): necesita la ficha del procesador LED real.
