# CS-0 · TRUST CREATIVE STUDIO — brief para acordar

**Origen:** encargo de Fer en [#59](https://github.com/fermalenoski86/dev/issues/59) (2026-10-11): IA y editor profesional, web y desktop, dos pantallas, DMX y reloj. Decisión de medidas en [#61](https://github.com/fermalenoski86/dev/issues/61). Registrado en `BACKLOG.md` (sección CS) y `DECISIONES.md`.

**Propuesto por Claude el 2026-10-12.** Es solo documentación: no se codifica nada hasta el `AUDIT: APROBADO` de este brief. Lo que el repo no decide va marcado con ❓; si una ❓ cambia producto o costo, va a `decisión-producto` para Fer.

**Meta:** un editor de takeovers de calidad profesional con dos modos (AI Director y Pro Studio) sobre **un solo modelo y un solo motor**. Su salida entra al circuito que ya existe: upload de assets → draft → submit con preflight server-side → versión con hash → aprobación por cuatro ojos. El Studio **nunca** comanda hardware ni publica por su cuenta.

## 0. Qué NO se toca

- `apps/control` y la experiencia ejecutiva M2C.2 (congelada), renderers, geometría y screenshots congelados; los 14 E2E de M2C siguen siendo gate.
- Storage B1/B1.1, `platform-approval`, `platform-auth` y los permisos del servidor.
- **SHOW PACKAGE v1** (`packages/shared-types`) y `show-engine`: el MVP no los cambia (ver §2). Una v2 solo se discute si una ❓ lo exige, con bump de versión y ADR. La identidad de campaña/versión no viaja dentro del ShowPackage sino en la `ShowVersion` que lo envuelve (ver §2.1).
- `HANDOFF.md` fuera del protocolo; gates de CI.
- Nada de Deploy, EDGE, Scheduler, TB60, Art-Net ni sensores: todo eso es posterior y depende de equipos reales.

## 1. Lo que ya existe y se reusa (relevado en el repo)

| Pieza | Dónde | Qué aporta al Studio |
|---|---|---|
| Superficies físicas | `packages/show-engine/src/building.ts` | `screen_a` Corrientes **1152×576**, `screen_b` Pellegrini **1440×576**, `horizontal` **1920×412**, con `syncCapableWith`. Son las medidas de `EL_TRUST` que Fer confirmó en #61. |
| Zonas DMX y reloj | `packages/shared-types` | 12 `LightingZoneId` (dome, clock, torres, Corrientes, ochava, Pellegrini, arcos, base), `RgbwSchema`, `LightingScene` con fades, `ClockState` (normal/off/accent/countdown). |
| Modelo de autoría | `packages/show-authoring` (`TakeoverDraft`) | moments con directivas por superficie (hold/black/play desde), iluminación y reloj; `compileTakeoverDraft()` → ShowPackage; presets y validación. |
| Motor y preflight | `packages/show-engine` | `resolve`/`compile`/`preflightShow` deterministas: el mismo cálculo en preview, servidor y, mañana, EDGE. |
| Transporte | `packages/timeline` | reloj inyectable (preparado para PTP/NTP en EDGE). |
| 3D | `packages/trust-3d` + `apps/previs` | `TrustBuilding`, `CameraRig`, `MediaTextureManager` (Three.js / R3F). |
| Ingesta y aprobación | `apps/platform-api`, `platform-assets`, `platform-media`, `platform-web` | upload MP4 con validación de códec/resolución/duración, draft con `expectedRevision`, submit → preflight server-side → `ShowVersion` con hash → cuatro ojos; versión vigente F3(a). |
| IA sin actuación | `packages/control-core/src/ai.ts` | el patrón ya probado: la IA recibe datos serializados y devuelve texto o datos; no existe un tipo por el cual pueda accionar. |

## 2. Hallazgo que acorta el camino: el MVP no necesita contrato nuevo

SHOW PACKAGE v1 admite **una fuente por superficie para todo el show** (`media: Record<ScreenId, string>`, ADR-030) y eventos de iluminación, reloj y cámara en la timeline. Es exactamente la forma de un takeover producido profesionalmente: **un master renderizado por superficie** (o un master único para las torres, recortado por `mediaGroups`) **más los cues de luces y reloj**.

Por lo tanto el Studio **renderiza** su proyecto (capas, keyframes, 3D, partículas) a:

1. un MP4 por superficie (o el master de torres), con las resoluciones de `building.ts`;
2. un `TakeoverDraft` con los moments, las directivas de iluminación y reloj, y los assets asignados;

y los entrega por la **API que ya existe** (`POST /assets`, `PUT /campaigns/:id/draft`, `POST /campaigns/:id/submit`). El servidor revalida todo: no confía en el cliente. Consecuencia: **CS-1 a CS-3 no tocan `platform-api`, `shared-types` ni `show-engine`.** El proyecto creativo vive en un modelo propio y versionado (`CreativeProject`), del mismo modo que el draft vive separado del ShowPackage.

**Límite del draft actual (hallazgo de Codex en #74):** `TakeoverDraft` solo expresa iluminación como `inherit` o una escena del catálogo (`LightingDirectiveSchema`, `packages/show-authoring/src/draft-schema.ts`); no tiene cómo pedir RGBW por zona, aunque el contrato ya tiene el evento `lighting.zone.set` (`shared-types`). Para que lo que se edita en Pro Studio sea lo que se aprueba, se agrega la unidad **CS-1a** (§7): una directiva aditiva `zones` en el draft (por zona: `color` RGBW, `intensity`, `fadeMs`) que `compileTakeoverDraft()` traduce a `lighting.zone.set`, con ADR, tests del compilador, mutaciones y bump de `compilerVersion` (metadata; el hash no cambia de formato). Toca `show-authoring`, no `shared-types` ni `show-engine`. **Hasta que CS-1a esté mergeada, la pista de luces del editor queda restringida a escenas del catálogo** y `toTakeoverDraft()` rechaza (error tipado, test) cualquier cue por zona en vez de descartarlo en silencio. El Builder de `apps/control` (congelado) lee `LightingDirective`: el brief de CS-1a debe probar con test que abrir un draft con `zones` no lo rompe; si para eso hay que tocar `apps/control`, va a `decisión-producto` para Fer antes de mergear.

### 2.1 Identidad de campaña y versión (Audience y Proof of Play)

`BACKLOG.md` (sección AUD) pide que lo entregado lleve `campaignId`/`versionId` para que AUDIENCE y Proof of Play reporten contra la versión aprobada. `ShowPackageSchema` v1 no tiene esos campos y este brief **no** los agrega: la identidad ya existe del lado del servidor, en la `ShowVersion` que se crea en el submit (`packages/platform-approval/src/submit.ts`: `campaignId`, id de la versión, `versionNumber`, `versionHash` sobre el sobre de `packages/platform-contracts/src/version-hash.ts`). El mecanismo de correlación acordado es un **sobre de entrega** que envuelve al ShowPackage sin modificarlo:

```
{ deliveryEnvelopeVersion: 1, campaignId, showVersionId, versionNumber, versionHash, showPackage }
```

- Lo arma el servidor a partir de la `ShowVersion` aprobada, nunca el Studio (el cliente no puede declarar identidad).
- EDGE/Proof of Play y AUDIENCE reportan contra `showVersionId` + `versionHash`; el `versionHash` permite comprobar que lo reproducido es byte a byte lo aprobado.
- Se implementa en la fase de Deploy/EDGE (fuera de CS, §0); CS-1 a CS-4 no lo necesitan porque terminan en la aprobación. Si al llegar ahí se prefiere llevar la identidad dentro del paquete, es una SHOW PACKAGE v2 con ADR. La línea correspondiente de `BACKLOG.md` (AUD) queda alineada con este sobre.

## 3. Arquitectura

```
                       ┌──────────────── @trust/creative-core (nuevo, puro, sin DOM) ────────────────┐
 AI Director ──plan──▶ │ CreativeProject (zod, versionado) · capas · keyframes/curvas · cámaras       │
 (servidor, tipado)    │ evaluate(project, tMs) → frame lógico · validate() · toTakeoverDraft()       │
                       └──────────────▲──────────────────────────────────▲──────────────────────────┘
                                      │                                  │
                        Creative Web (apps/creative-web)       Creative Desktop (Electron)
                        storyboard, plantillas, timeline       Pro Studio: timeline por frame,
                        simple, preview WebGL, colaboración    3D/GLB, partículas, render local,
                                      │                        Blender headless opcional
                                      └──────────── render → MP4 por superficie + TakeoverDraft
                                                                 │
                                                  API TRUST (existente): assets → draft → submit
                                                  → preflight server-side → ShowVersion + hash
                                                  → aprobación cuatro ojos (platform-web)
```

- **Un solo motor:** `creative-core` es TypeScript puro y determinista (mismo proyecto + mismo `t` ⇒ mismo frame lógico). Web y desktop lo importan; ninguno reimplementa semántica. El preview final por superficie pasa siempre por `show-engine` (`compileTakeoverDraft` + `resolve`), así lo que se aprueba es lo que se ve.
- **Render:** el MVP renderiza en el cliente (WebGL → frames → `ffmpeg` en desktop / WebCodecs en web) y valida con el pipeline de `platform-media` (códec, resolución, fps, duración) antes de subir. Blender headless queda como proceso externo opcional para escenas pesadas (CS-3), nunca enlazado como biblioteca.
- **IA:** corre del lado del servidor, con la clave fuera del cliente. Devuelve un `CreativePlan` tipado (zod) que el motor convierte en `CreativeProject`. **Nunca se ejecuta texto libre.** Cada propuesta muestra modelo, versión, costo estimado y real, y procedencia. La IA no sube assets, no hace submit y no aprueba.

## 4. Los dos modos (el mismo proyecto)

| | **AI Director** (asistido) | **Pro Studio** (manual) |
|---|---|---|
| Entrada | prompt + marca/assets + duración + restricciones | proyecto vacío, plantilla o lo que dejó el AI Director |
| Edición | iterar en lenguaje natural ("más intensidad", "sincronizá con el reloj") → nuevo plan tipado con diff visible | timeline multipista por frame/timecode, capas, keyframes y curvas, cámaras y anamorfosis, GLB, partículas y transiciones, RGBW por zona, reloj como pista |
| Dónde | web (y desktop) | desktop (web con edición simple) |
| Depende de IA o servicios pagos | sí, con tope de costo | **no** |

Se pasa de un modo a otro sin pérdida: el AI Director solo produce `CreativeProject` y Pro Studio lo abre tal cual.

## 5. Desktop: comparación y recomendación

| Criterio | (A) Electron + Three.js + `creative-core` | (B) Unreal Engine | (C) Tauri + WebView | (D) Híbrido A + Blender headless |
|---|---|---|---|---|
| Reuso del stack actual (TS, R3F, `trust-3d`, zod) | total | nulo (C++/Blueprints) | alto (WebView del sistema) | total |
| Un motor compartido con la web | sí | no: segundo motor divergente | sí | sí |
| Render de calidad | WebGL/WebGPU; suficiente para 15 s a la resolución de las pantallas | máximo | igual que A, con WebView variable | A + Cycles/Eevee para lo pesado |
| GPU / tamaño | moderado / ~150 MB | alta / varios GB | baja / chico | moderado + Blender aparte |
| Licencias (❓ verificar textos vigentes en ronda 1) | MIT | EULA de Epic con regalías/seat según uso | MIT/Apache | Blender GPL como proceso externo, sin enlazar |
| Offline, firma y actualizaciones | maduros | propios | maduros | maduros |

**Recomendación: (D), con (A) como base del MVP.** Un solo motor en TypeScript para web y desktop, y Blender como herramienta externa para lo que WebGL no alcanza. Unreal queda descartado para esta etapa porque obliga a un segundo motor y rompe la regla de "escena y sincronía definidas una sola vez". Tauri es buena alternativa de empaquetado, pero su WebView varía según el sistema y eso complica la consistencia de render; se revisa si el tamaño de Electron pesa.

## 6. Geometría: preliminar hasta calibrar

El gemelo actual es **preliminar e impreciso**. Todo preview lleva la etiqueta **SIMULADO · GEOMETRÍA PRELIMINAR**, y solo cambia a **CALIBRADO** o **VALIDADO EN SITIO** con evidencia. Las superficies y cámaras son configurables (no cableadas al GLB). **CS-1b, la calibración, es una unidad propia y temprana:** fotos desde el Obelisco con posición conocida, al menos una cota real por cara, solución de cámara y error de reproyección reportado. Sin CS-1b, la anamorfosis no se declara válida. No se asume continuidad 3D perfecta entre fachadas.

## 7. Unidades (cada una con brief corto y PR + AUDIT propios)

| Unidad | Qué | Toca | Estimado* |
|---|---|---|---|
| **CS-1** motor | `packages/creative-core`: `CreativeProject` v1, `evaluate`, `validate`, `toTakeoverDraft` con tests y mutaciones | paquete nuevo | ~1 sem |
| **CS-1a** cues RGBW por zona | directiva aditiva `zones` en `TakeoverDraft` → `lighting.zone.set`; ADR; prueba de que el Builder congelado no se rompe (§2) | `show-authoring` | ~3 días |
| **CS-1b** calibración | modelo de cámara/superficie calibrable + plan de toma de fotos y medidas (necesita a Fer en sitio) | `creative-core` | en paralelo, depende de datos |
| **CS-2** Creative Web MVP | `apps/creative-web`: timeline, preview de 2 superficies + DMX + reloj simulados, render MP4, entrega por la API existente | app nueva | ~1,5 sem |
| **CS-3** AI Director | `CreativePlan` tipado, endpoint servidor, tope de costo, procedencia; sin proveedor pago hasta que Fer lo autorice | `creative-core` + endpoint | ~1 sem |
| **CS-4** Creative Desktop MVP | Electron + `creative-core` + GLB + render local + Blender opcional; firmado | app nueva | ~1,5 sem; necesita la PC con RTX |

\*Estimados con el circuito actual (Codex automático, ChatGPT cada hora). Se miden y se informan; no son compromiso.

**Hito demo (fin de CS-3, ~3 semanas desde este AUDIT):** prompt → storyboard → timeline editable → preview web de las 2 pantallas + luces y reloj simulados → 2 MP4 + cues → draft enviado a TRUST → aprobación por dos personas. Rotulado **geometría preliminar**, sin hardware.

## 8. Criterios de aceptación medibles (para los briefs de cada unidad)

1. **Determinismo:** mismo proyecto y `t` ⇒ mismo frame lógico, probado con property tests; el hash del MP4 renderizado es reproducible en la misma máquina y versión.
2. **Exactitud de timeline:** duraciones y cues al ms; los cortes de moment caen en frame exacto a 30 fps (±0 frames en los tests).
3. **Cumplimiento de formato:** el render pasa la validación de `platform-media` a la primera (resolución exacta por superficie, H.264, fps y duración); el submit pasa el preflight server-side sin warnings de aspecto.
4. **Rendimiento:** preview ≥ 30 fps con la escena de referencia en la máquina objetivo (se fija en CS-2); render de 15 s en ≤ 3 min en la PC con RTX (se mide, no se promete).
5. **Seguridad:** ningún tipo del Studio puede emitir un comando a hardware; la IA solo devuelve `CreativePlan`; ningún secreto en el cliente; el servidor revalida todo.
6. **Offline (desktop):** se edita y se renderiza sin red; las entregas quedan en una cola local. Al volver la red, cada upload se **reintenta sin duplicar**: misma `Idempotency-Key` ⇒ un solo Asset (ya probado en `apps/platform-api/src/api.db.test.ts`). **No es una subida reanudable:** `POST /api/v1/assets` recibe un único multipart y `AssetUploadService.upload()` lee el archivo completo antes de calcular la huella y borra el temporal en `finally`, así que un corte obliga a retransmitir desde el byte 0. Para el MVP se acepta: un master de 15 s a estas resoluciones pesa decenas de MB. El criterio medible es "reintento sin duplicado, con la cola persistida entre reinicios de la app". Una subida reanudable (por partes) es una unidad aparte que toca `platform-api` y Storage B1 (aprobado), así que solo se abre con una medición que la justifique (❓6).
7. **Etiquetado:** todo preview muestra su estado de geometría; un test falla si falta.

## 9. Costos

- **Sin costo nuevo:** CS-1, CS-1b, CS-2 y CS-4 (Electron, Three.js y Blender son gratuitos).
- **Con costo, a decisión de Fer:** el modelo de IA de CS-3. Antes de activar cualquier proveedor pago, Claude presenta el costo estimado por propuesta y un tope mensual. Hasta entonces, CS-3 se prueba con un plan simulado (fixture) y con un proveedor solo si Fer lo autoriza.
- **Hardware:** la PC con RTX para CS-4 y como runner propio de render.

## 10. Preguntas abiertas

- ❓1 **Pantalla horizontal:** la oferta P5 no la incluye (#61), pero `EL_TRUST` sí la modela. Propuesta: el Studio la soporta como superficie opcional y el MVP renderiza solo `screen_a` y `screen_b`, salvo que Fer diga otra cosa.
- ❓2 **Proveedor y tope de IA** (decisión de Fer, con costo).
- ❓3 **Desktop:** ¿MVP solo Windows? La propuesta es que sí, porque es la PC con RTX que se va a armar.
- ❓4 **Ubicación:** `packages/creative-core`, `apps/creative-web` y `apps/creative-desktop`. ¿Alguna objeción del auditor?
- ❓5 **Render en web:** ¿WebCodecs en el navegador, o render siempre en desktop/servidor y la web solo previsualiza? La propuesta es WebCodecs con fallback a desktop.
- ❓6 **Subida reanudable:** ¿hace falta para el desktop? La propuesta es que no en el MVP (§8.6); se reabre si se mide un caso real (masters largos o enlace inestable en sitio).

## 11. Orden y dependencias

1. AUDIT de este brief, sin interrumpir la fase activa (P-05) ni las de proceso que siguen.
2. CS-1, CS-1a y CS-1b → CS-2 → CS-3 → CS-4. Paralelo solo cuando los contratos estén cerrados (regla P-05).
3. Cada unidad: brief corto → PR → CI completa → `AUDIT: APROBADO` → merge. Sin relajar gates.
