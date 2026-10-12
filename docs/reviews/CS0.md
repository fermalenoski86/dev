# CS-0 — Brief de TRUST Creative Studio

**Estado:** entregado para auditoría (lateral documental, PR #74; no interrumpe P-05).

- **Origen:** encargo de Fer en [#59](https://github.com/fermalenoski86/dev/issues/59); medidas en [#61](https://github.com/fermalenoski86/dev/issues/61); decisión registrada en `DECISIONES.md` (2026-10-11, "ahora solo brief CS-0").
- **Rama:** `docs/cs0-brief`.
- **Salida real:** `CS0_SALIDA.txt`.

## Qué se entrega

| Archivo | Qué |
|---|---|
| `docs/briefs/CS0_CREATIVE_STUDIO.md` | El brief: qué no se toca (§0), qué se reusa (§1), MVP sin contrato nuevo (§2), identidad de versión (§2.1), arquitectura (§3), dos modos (§4), desktop (§5), geometría preliminar (§6), unidades CS-1/1a/1b/2/3/4 y CS-5 posterior (§7), criterios medibles (§8), costos (§9), seis ❓ (§10), orden (§11) |
| `docs/collab/BACKLOG.md` | Una línea (sección AUD) alineada con §2.1 |
| `docs/reviews/CS0.md`, `CS0_SALIDA.txt` | Este reporte y la salida real de los gates |

No hay código, tests, rutas, variables de entorno, CI, `HANDOFF.md` ni partes congeladas en el diff.

## Rondas de Codex (feedback preliminar, no es AUDIT)

| Ronda | Hallazgo | Respuesta |
|---|---|---|
| `3187fe2` | [P1] El draft no expresa RGBW por zona | Corregido en `986867f`: unidad CS-1a (directiva aditiva `zones` → `lighting.zone.set`); hasta entonces el editor se limita a escenas del catálogo y `toTakeoverDraft()` rechaza cues por zona |
| `3187fe2` | [P2] Identidad campaña/versión para Audience/PoP | Corregido en `986867f`: sobre de entrega armado por el servidor desde la `ShowVersion` (§2.1) + BACKLOG AUD |
| `3187fe2` | [P2] Reintento ≠ subida reanudable | Corregido en `986867f`: §8.6 promete reintento sin duplicado; reanudable queda como ❓6 |
| `986867f` | [P1] Faltan `docs/reviews/CS0.md` y `_SALIDA.txt` | Corregido en `7fd9de0`: este archivo y la salida real |
| `986867f` | [P2] El sobre no permite recalcular `versionHash` | Corregido en `7fd9de0`: el sobre lleva el manifiesto sellado `assets: [{logicalRef, sha256}]` y los metadatos del hash; verificación en destino en dos pasos (§2.1) |
| `7fd9de0` | [P2] La garantía de reintento idempotente no tiene límites | Corregido en `5a00ed5`: §8.6 enumera lo que el servidor garantiza (replay dentro de 24 h; operación interrumpida ⇒ otro Asset con el mismo blob; >24 h ⇒ posible segundo Asset) y fija el criterio medible: un blob por `sha256`, draft al último Asset, pendientes >24 h con confirmación manual; dedup de Asset en servidor a ❓6 |
| `5a00ed5` | [P1] Cue `zones` después de la escena de cierre queda activo tras `durationMs` | Corregido en esta ronda: CS-1a exige seguir las zonas sobrescritas, re-emitir el cierre con overrides pendientes y tests de regresión sobre el estado resuelto (§2) |
| `5a00ed5` | [P2] Colaboración sin persistencia del proyecto | Corregido en esta ronda: el MVP no promete colaboración; `CreativeProject` como archivo versionado con round-trip probado; almacén en servidor = CS-5 (§4, §7) |
| `5a00ed5` | [P1] CS-3 aprobable solo con fixtures | Corregido en esta ronda: CS-3 y el hito demo exigen una generación real registrada (proveedor pago autorizado o modelo local sin costo, ❓2); fixtures solo complementarios (§7, §9) |

## Decisiones tomadas en el brief

- SHOW PACKAGE v1, `show-engine`, `shared-types` y `platform-api` sin cambios en CS-1 a CS-3; CS-1a toca solo `show-authoring`.
- Un solo motor TypeScript (`creative-core`) para web y desktop; desktop Electron + Three.js, Blender headless opcional como proceso externo; Unreal descartado en esta etapa.
- IA del lado del servidor, salida tipada (`CreativePlan`), sin proveedor pago hasta autorización de Fer con costo y tope.
- Geometría rotulada "preliminar" hasta CS-1b (calibración).

## Autorrevisión previa

**A. Diff contra el brief y los hallazgos.** `git diff origin/main...HEAD` = brief nuevo + una línea de BACKLOG + este reporte y su salida. Cada hallazgo de Codex tiene su sección (tabla de arriba) y respuesta en su hilo. El encargo de #59 (dos modos, web y desktop, dos pantallas, DMX, reloj, calidad profesional) está en §3, §4, §7. No se tocaron tests, rutas, env ni entregables: `progress:check` y `acceptance:check` corren igual y dan OK (salida).

**B. Revisión adversaria.**
- Builder congelado (`apps/control/.../TakeoverBuilder.tsx`) lee `LightingDirective`: una directiva `zones` podría romperlo. Declarado en §2 y derivado a CS-1a con test obligatorio; si hay que tocar `apps/control`, va a `decisión-producto`.
- Sobre de entrega: un manifiesto ausente o recompuesto desde el ShowPackage no reproduce el hash (ranuras inactivas). Por eso se exige el manifiesto sellado tal cual y la verificación en dos pasos.
- Identidad declarada por el cliente: el sobre lo arma solo el servidor.
- `BACKLOG.md` también lo escriben directo en `main` otros turnos: puede haber conflicto de merge en esa línea; se resuelve con merge de `main` sin reescribir historia.
- Compilador y cierre: la guarda final del compilador actual no ve overrides por zona; CS-1a lo exige con regresión.
- Promesas sin soporte: colaboración (sin almacén) y AI Director (sin modelo real) quedaron acotadas o condicionadas.
- Reintento de upload: la idempotencia vence a las 24 h y una operación interrumpida deja otro Asset; el brief ya no promete "sin duplicar" sin condiciones (§8.6).
- No corregido, con motivo: subida reanudable y dedup de Asset en servidor (❓6; tocan Storage B1 aprobado, se abren solo con medición).

**C. CI.** `5a00ed5` → [38316835119](https://github.com/fermalenoski86/dev/actions/runs/38316835119) 7/7 verde; `986867f` → [38307776606](https://github.com/fermalenoski86/dev/actions/runs/38307776606) 7/7 verde; `7fd9de0` → [38312602839](https://github.com/fermalenoski86/dev/actions/runs/38312602839) 7/7 verde. La corrida del HEAD final se cita en el pedido de auditoría del PR.
