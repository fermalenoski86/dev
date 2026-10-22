# CS-0A · TRUST CREATIVE STUDIO — addendum de producto

**Origen:** decisión de producto de Fer (2026-10-22), ampliación formal de [#59](https://github.com/fermalenoski86/dev/issues/59) y de `CS0_CREATIVE_STUDIO.md` (mergeado en `main@3b59b10`, PR #74). **Propuesto por Claude el 2026-10-22.**

**Qué es:** diseño y roadmap, **solo documentación**. No abre implementación, no desplaza P-06/#98, no toca interfaces congeladas ni SHOW PACKAGE v1. Lo que el repo no decide va marcado con ❓; lo que cambia producto o costo va a `decisión-producto` para Fer. Circuito: este brief → revisión de ChatGPT → decisión de Fer → implementación incremental por unidades con brief corto, PR y `AUDIT` propios.

**Qué cambia respecto de CS-0 (resumen ejecutivo):**

| Tema | CS-0 (vigente) | Este addendum |
|---|---|---|
| Producto | editor de takeovers para EL TRUST | plataforma premium: EL TRUST es la **primera instalación**; el modelo es multi-sitio desde el día uno (§2) |
| Experiencias | AI Director + Pro Studio | **Marketing Studio**, **Pro Studio Desktop**, **Mobile/Tablet companion**, sobre el **mismo** `creative-core` (§1, §3) |
| Usuario | equipo propio → marketing del cliente | marketing del cliente (McDonald's) como usuario **prioritario** sin capacitación, además de Affinitas y agencias (§4) |
| Edición | timeline y plan tipado | **Command System**: toda acción importante es un `Command` tipado; undo/redo, macros, atajos, paleta, y la IA emite exactamente esos comandos (§5) |
| Modelo | `CreativeProject` | + `Campaign` → `Variant`, **Brand Space**, comentarios anclados, versiones V1…Vn (§6) |
| Duración | 15 s como caso principal | **duración variable**; 15 s es una plantilla (§7) |
| Aprobación | cuatro ojos de TRUST | flujo enterprise DRAFT → MARKETING → BRAND → TECH CHECK → APPROVED → SCHEDULED, **que termina en el cuatro ojos actual sin reemplazarlo** (§3.6, §4) |
| Roadmap | CS-1…CS-5 | CS-1…CS-9 revisado, con lo que puede empezar ya (§8, §10) |

Lo que CS-0 fijó y **no cambia:** un solo motor (`creative-core`, TypeScript puro y determinista); el Studio nunca comanda hardware ni publica; la IA devuelve datos tipados, nunca ejecuta texto libre; la geometría es preliminar hasta CS-1b; SHOW PACKAGE v1 sin cambios salvo ADR; `apps/control`, M2C.2, storage y `platform-approval` congelados; sin servicios pagos nuevos sin autorización de Fer; Electron + TS + Three.js para desktop, Blender headless opcional como proceso externo.

---

## 1. Addendum de producto a CS-0 / #59

### 1.1 Visión

Creative Studio es la plataforma de Affinitas para que **marcas y agencias diseñen, revisen y operen experiencias sobre espacios físicos digitales**. EL TRUST es el flagship: la instalación que prueba el producto y lo exhibe. El diseño asume desde el inicio otros sitios (fachadas, DOOH, estadios, retail flagship, centros comerciales) sin que ninguno de ellos esté en el roadmap de implementación hasta que Fer lo decida.

### 1.2 Tres experiencias, un motor

| Experiencia | Para quién | Promesa | Plataforma |
|---|---|---|---|
| **Marketing Studio** | Marketing del cliente (McDonald's Argentina), agencias, Affinitas comercial | una propuesta válida en **< 5 min sin capacitación**; cambios en lenguaje natural con diff y undo | web (y dentro del desktop) |
| **Pro Studio** | diseñadores, motion, Affinitas producción | control hasta frame, layer, cámara, superficie y luminaria | desktop (Electron) |
| **Companion** | ejecutivos, Marketing, aprobadores | ver, comentar, comparar, aprobar, pedir cambios rápidos | teléfono; tablet como "Studio Touch" |

Las tres leen y escriben **el mismo `CreativeProject`** por medio de **los mismos `Command`s**. Ninguna tiene semántica propia: lo que Marketing Studio produce, Pro Studio lo abre sin pérdida, y lo que Pro Studio edita, el teléfono lo muestra tal cual.

### 1.3 Criterios de aceptación de producto (los dos de Fer, medibles)

1. **Marketing < 5 min:** prueba con 5 personas sin contacto previo con el producto, tarea "armá una propuesta de 20 s para el lanzamiento de X con estos 3 assets"; se mide tiempo hasta un proyecto que **pasa `validate()` y el preflight de TRUST**. Meta: 5/5 en menos de 5 min, sin ayuda. Se registra en el reporte de la unidad (CS-6).
2. **Pro Studio sin pérdida:** ese mismo proyecto abierto en Pro Studio permite editar a nivel de frame, layer, cámara, superficie y luminaria; test automático: `evaluate(project, t)` idéntico en web, desktop y móvil para todo `t` del proyecto de referencia (property test del core, ya exigido en CS-0 §8.1).

### 1.4 Lo que este addendum **no** promete

- Validación jurídica o automática de guidelines de marca (Brand Space guarda reglas **declaradas por el cliente**; no inventa ninguna).
- Anamorfosis validada antes de CS-1b (calibración física).
- Publicación directa en TB60/DMX/hardware: **nunca**. TRUST CONTROL sigue siendo validación, aprobación, programación y deploy.
- Colaboración concurrente antes de CS-5 (almacén de proyectos en servidor).
- Otros sitios además de EL TRUST: el modelo los admite; implementarlos es decisión de producto aparte.

---

## 2. Arquitectura actualizada

```
                        ┌──────────────── @trust/creative-core (puro, determinista, sin DOM) ────────────────┐
                        │  Modelo:   Site · Surface · Campaign → Variant · CreativeProject · BrandSpace       │
                        │  Comandos: Command (tipado, zod) · CommandBus · History (undo/redo) · Macro         │
                        │  Motor:    evaluate(project, tMs) → frame lógico · validate() · diff(a, b)           │
                        │  Salida:   toTakeoverDraft() · renderPlan()                                           │
                        └───────▲──────────────▲──────────────▲──────────────▲──────────────▲───────────────┘
                                │              │              │              │              │
                     Marketing Studio    Pro Studio      Companion      AI Director      Creative Web
                     (apps/creative-web  (apps/creative- (apps/creative- (servidor:       (= Marketing Studio
                      modo guiado)        desktop)        mobile, PWA)    Plan → Commands)  + edición simple)
                                │              │              │
                                └──────────────┴──────────────┘
                                         render → MP4 por superficie + TakeoverDraft (+ zones, CS-1a)
                                                           │
                                    API TRUST existente: assets → draft → submit → preflight → ShowVersion + hash
                                                           │
                                    TRUST CONTROL: cuatro ojos → aprobación → programación → Deploy/EDGE (fuera de CS)
```

**Reglas de arquitectura (vigentes de CS-0 + nuevas):**

- **Un solo motor.** `creative-core` no sabe de UI, red ni disco. Web, desktop y móvil lo importan tal cual; prohibido reimplementar semántica en una app. Test de gate: el paquete no depende de `react`, `three`, `electron` ni de `node:*`.
- **Todo pasa por `Command`.** Las apps no mutan el proyecto: despachan comandos al `CommandBus`, que valida, aplica, registra en `History` y emite el diff. La IA hace lo mismo (§5.6). Mutar el proyecto fuera del bus no compila (tipo `Readonly<CreativeProject>` hacia afuera).
- **Determinismo intacto.** Un comando es una función pura `(project, payload) → project'`. Mismo proyecto + misma lista de comandos ⇒ mismo proyecto final (property test). `evaluate` no cambia.
- **Sitio configurable.** `Site` describe superficies (pantallas con resolución y proporción, zonas de luz con esquema RGBW, elementos como reloj/cúpula) y relaciones (`syncCapableWith`, grupos). `EL_TRUST` de `building.ts` es la primera instancia; el core no tiene nada cableado a EL TRUST.
- **La salida sigue siendo ShowPackage v1** vía `TakeoverDraft`. Nada de este addendum pide v2. Lo que el draft no expresa (RGBW por zona) ya está resuelto por CS-1a; lo que ShowPackage v1 no admite (ver §7, "qué queda fuera") se posterga o se resuelve con ADR, no con un contrato paralelo.
- **Servidor y datos.** Almacén de proyectos, Brand Space, comentarios, versiones y flujo de revisión viven en `platform-api` como **unidades aditivas con brief propio** (CS-5 y CS-7), con los permisos del servidor como única autoridad. Hasta entonces: archivo versionado (CS-0 §4).
- **IA.** Servidor, clave fuera del cliente, salida `CreativePlan` tipada que el core convierte en `Command[]`. Nunca texto libre ejecutado. Sin proveedor pago sin autorización (❓2 de CS-0 sigue abierta).
- **Empaquetado.** Desktop: Electron + TS + `creative-core` + Three.js (WebGL; WebGPU cuando esté disponible en el runtime, detrás de bandera) + Blender headless opcional como proceso externo. Móvil/tablet: ver §13; la consistencia del core manda sobre compartir UI.

---

## 3. Mapa de pantallas UX

Las pantallas se describen por su propósito y contenido; el diseño visual se define con el design system (§14). Nada de esto copia interfaces propietarias.

### 3.1 Marketing Studio (web)

| Pantalla | Qué muestra | Acciones principales |
|---|---|---|
| **Home** | Nueva campaña · Campañas activas (con estado del flujo) · Plantillas · Brand Space · Esperando aprobación (mías y de mi equipo) · Programación (solo lectura de lo que TRUST CONTROL programó) · Biblioteca de assets | crear, abrir, filtrar por estado/sitio/marca |
| **Nueva campaña · "¿Qué querés comunicar?"** | un solo formulario guiado: prompt, assets (arrastrar o elegir del Brand Space), producto, objetivo, duración (con sugerencia por tipo de campaña), restricciones (checkbox de guidelines del Brand Space + texto) | "Proponer direcciones" |
| **Direcciones creativas** | 2–3 direcciones del AI Director, cada una con miniatura por superficie, una línea de concepto, duración, costo de IA estimado/real y procedencia (modelo, versión) | elegir una → se aplica al edificio |
| **Propuesta sobre el edificio** | preview 3D del sitio (rotulado SIMULADO/PRELIMINAR/CALIBRADO), timeline simple (bloques, no keyframes), panel de "Cambiar" en lenguaje natural con historial | pedir cambio → ver **diff** (qué comandos se aplicarían, antes/después por superficie) → aplicar o descartar; deshacer; "otra versión para…" (crea Variant) |
| **Variantes** | la campaña madre y sus variantes (día/noche/Navidad…) con qué comparten y qué difiere | crear, comparar lado a lado, enviar a revisión |
| **Enviar a revisión** | checklist: validación del core, preflight de TRUST (simulado en cliente, real en servidor), guidelines marcadas, duración, superficies | enviar → estado MARKETING REVIEW |
| **Brand Space (vista Marketing)** | assets aprobados, colores, tipografías, claims, campañas vigentes, templates, presets; indicador bloqueado/editable | usar en una campaña; proponer un asset nuevo (queda "pendiente de aprobación de marca") |

Flujo mínimo: Home → Nueva campaña → Direcciones → Propuesta → Enviar. Cuatro pantallas. Ese es el camino de los 5 minutos.

### 3.2 Pro Studio (desktop)

| Zona | Contenido |
|---|---|
| **Viewport 3D** | sitio con superficies, luminarias y reloj; cámaras (vista Obelisco, vista calle, libre, ortográfica por superficie); rótulo de geometría permanente; play/scrub |
| **Asset browser** | proyecto, Brand Space, biblioteca; búsqueda; arrastrar a timeline o a superficie |
| **Inspector** | propiedades del objeto seleccionado (layer, keyframe, cámara, luminaria, zona, clip); cada cambio es un `Command` |
| **Timeline multipista** | pistas por superficie (`screen_a`, `screen_b`, `horizontal`…), por zona de luz (12 zonas RGBW, agrupables), reloj como pista, cámara como pista, audio de preview opcional; frame/timecode; keyframes, curvas, snapping, markers, máscaras, transiciones; zoom y navegación por teclado |
| **Escenas** | el proyecto se organiza en escenas (secuencias reutilizables); duplicar, reordenar, A/B |
| **Render queue** | cola local: por superficie o todas, con perfil (preview / entrega), estado, tiempo, hash del resultado; Blender headless como paso opcional |
| **Command Palette** (Ctrl/Cmd+K) | busca comandos, macros, presets, objetos; muestra atajo; ejecuta |
| **Historial** | lista de comandos con diff; undo/redo total; ramificar desde un punto (crea Variant) |
| **Entrega** | validación → preflight → subir a TRUST (cola offline, §CS-0 8.6) |

### 3.3 Companion · teléfono

| Pantalla | Contenido |
|---|---|
| Proyectos | mis campañas con estado y qué espera de mí |
| Preview | render de la versión (video por superficie o vista compuesta), con rótulo de geometría |
| Timeline simple | bloques y markers; tocar para ir a un momento |
| Comentarios | anclados a timestamp + objeto lógico (§6.4); hilo; resolver |
| Comparar | V12 vs V13: lado a lado o alternado; lista de comandos que cambiaron |
| Aprobar / rechazar | solo la etapa que el rol permite (§4); pide motivo en rechazo |
| Cambios rápidos | un set acotado de comandos (duración, intensidad de luces, intercambiar asset del Brand Space, "producto 20 % más grande") con diff y undo |
| Prompt AI | los mismos cambios en lenguaje natural que Marketing Studio |
| Programación | lectura de lo programado por TRUST CONTROL |
| Notificaciones | cambio de etapa, comentario nuevo, render listo |

### 3.4 Companion · tablet ("Studio Touch")

Lo del teléfono más: timeline táctil con pinch-to-zoom, preview 3D con órbita táctil, sliders grandes (intensidad, color RGBW por zona, velocidad), selección de cámaras y escenas, FX con presets, stylus para máscaras y curvas. **No** incluye edición por frame, curvas numéricas, render queue ni plugins: eso es desktop.

### 3.5 Brand Space (vista administración)

| Sección | Contenido | Bloqueable |
|---|---|---|
| Identidad | logos aprobados y variantes, safe areas, colores, tipografías | sí |
| Producto | packshots, productos, claims vigentes | sí |
| Campañas | campañas vigentes y sus assets, templates | por campaña |
| Reglas | restricciones declaradas (p. ej. "el logo nunca en la marquesina", "mínimo 2 s de logo al cierre"), presets visuales, presets RGBW, guidelines (documentos adjuntos) | sí |
| Historial | quién aprobó qué asset y cuándo | — |

### 3.6 Review / Approval

| Pantalla | Contenido |
|---|---|
| Tablero | campañas por etapa (DRAFT · MARKETING REVIEW · BRAND REVIEW · AFFINITAS TECH CHECK · APPROVED · SCHEDULED) |
| Detalle de versión | preview, lista de comandos desde la versión anterior, comentarios abiertos, checks (validate, preflight, guidelines marcadas), quién debe actuar |
| Comparar versiones | V12 / V13 / V14: visual (lado a lado, alternado, diferencia por superficie) y de cambios (comandos) |
| Decisión | aprobar, pedir cambios (con comentarios anclados), rechazar; cada decisión queda firmada por rol |

La etapa **AFFINITAS TECH CHECK → APPROVED** es exactamente el **submit + cuatro ojos de TRUST** que ya existe (`platform-approval`): no se reemplaza, se envuelve. Las etapas anteriores (MARKETING REVIEW, BRAND REVIEW) viven en el Studio (CS-7) y no tocan `platform-approval`.

---

## 4. Modelo de roles y permisos

**Principio:** los permisos del servidor de TRUST (`platform-auth`: `OPERATOR`, `INTERNAL_APPROVER`, `EXTERNAL_APPROVER`, `ADMIN`, con alcance por contrato) **no cambian** y siguen siendo la única autoridad sobre assets, draft, submit y aprobación. Los roles del Studio son **adicionales** y se mapean a esos permisos cuando el flujo llega al servidor.

| Rol del Studio | Quién | Puede | No puede |
|---|---|---|---|
| **Brand Owner** | marca (p. ej. dirección de Marketing McDonald's) | administrar Brand Space (bloquear/desbloquear), aprobar BRAND REVIEW, crear campañas, comentar | enviar a TECH CHECK, programar |
| **Marketing Creator** | área de Marketing de la marca, agencia | crear campañas y variantes, usar AI Director, editar en Marketing Studio y Companion, comentar, enviar a MARKETING REVIEW | aprobar su propia etapa, modificar elementos bloqueados del Brand Space |
| **Marketing Approver** | jefe de Marketing | aprobar/rechazar MARKETING REVIEW | aprobar BRAND REVIEW de la misma versión |
| **Designer / Pro** | diseñador de la marca, agencia o Affinitas | todo lo de Creator + Pro Studio completo, render, macros | aprobar etapas; modificar elementos bloqueados salvo que también sea Brand Owner |
| **Affinitas Producer** | Affinitas | todo lo de Pro + enviar a TECH CHECK (= submit a TRUST con un principal `OPERATOR`) + administrar sitios | aprobar en TRUST (lo hace el cuatro ojos) |
| **Affinitas Approver** | Affinitas | TECH CHECK = primer ojo de TRUST (`INTERNAL_APPROVER`) | ser el segundo ojo de la misma versión |
| **Client Approver** | marca, contrato | segundo ojo de TRUST (`EXTERNAL_APPROVER`, alcance por contrato) | nada fuera de su contrato |
| **Viewer** | ejecutivos | ver, comentar, recibir notificaciones | editar, aprobar |

Reglas:

- **Separación de deberes:** nadie aprueba una etapa de una versión en la que ejecutó comandos de edición; nadie ocupa dos etapas consecutivas de la misma versión. Se verifica con test de permisos cruzados (eje "permisos cruzados" de los PR de riesgo alto).
- **Alcance:** por marca y por sitio. Un Brand Owner de McDonald's no ve campañas de otra marca aunque compartan EL TRUST. Affinitas ve todo lo de sus sitios.
- **Mapeo a TRUST:** al llegar a TECH CHECK, el Studio no inventa identidad: usa la sesión TRUST del usuario (`platform-auth`), y si su principal no tiene el rol requerido, el servidor rechaza. El Studio solo refleja.
- **Dónde viven los roles del Studio:** hasta CS-5/CS-7 no existen en el servidor (archivo local, un solo usuario). CS-7 los agrega como tabla aditiva en `platform-api` (roles de Studio por usuario, marca y sitio), sin tocar los roles existentes ni `access.ts`. ❓A: si Fer prefiere que los roles del Studio sean roles nuevos de `platform-auth` (toca una familia congelada), va a `decisión-producto`.

---

## 5. Diseño del Command System

### 5.1 Qué es un Command

```ts
// creative-core/src/commands/types.ts (diseño; no implementado)
type Command<K extends CommandKind = CommandKind> = {
  id: CommandId;            // ulid, único por despacho
  kind: K;                  // 'SetSurfaceMedia' | 'SetLightIntensity' | ...
  payload: PayloadOf<K>;    // zod por kind
  target: Selector;         // a qué objeto(s): superficie, zona(s), layer, keyframe, escena, cámara, variante
  origin: { actor: ActorRef; via: 'ui' | 'palette' | 'shortcut' | 'macro' | 'ai' | 'companion'; parent?: CommandId };
  at: number;               // reloj lógico del proyecto (orden), no tiempo real
};
```

- **Pureza:** cada `kind` tiene `apply(project, cmd) → project'` y `invert(project, cmd) → Command` (o se guarda el estado previo del target cuando la inversa no es cerrada, p. ej. `ApplyEffect` con parámetros derivados). Ambas sin efectos.
- **Validación en dos capas:** zod del payload (forma) + `validate(project')` (semántica: duración ≤ límite del sitio, superficie existe, zona existe en el esquema RGBW del sitio, keyframe dentro del clip, elemento del Brand Space bloqueado no modificado). Un comando que no valida **no se aplica** y devuelve un error tipado; nunca aplica a medias.
- **Granularidad:** un comando = una intención del usuario ("mover keyframe"), no un evento de puntero. El arrastre emite un solo `MoveKeyframe` al soltar; el preview intermedio se calcula sobre un proyecto transitorio que no entra al historial.

### 5.2 Catálogo inicial (el de Fer, tipado)

| Kind | Target | Payload (resumen) |
|---|---|---|
| `SetSurfaceMedia` | surface | assetRef, fit (`cover`/`contain`/`master`), focus, trim |
| `SetLightIntensity` | zone[] | intensity 0–1, fadeMs |
| `SetLightColor` | zone[] | rgbw, fadeMs |
| `AddKeyframe` / `MoveKeyframe` / `RemoveKeyframe` | track | tMs, value, easing |
| `CreateScene` / `DuplicateScene` / `ReorderScene` | project | name, from |
| `ChangeCamera` | project / scene | cameraId o definición |
| `TrimClip` / `SplitClip` | clip | inMs, outMs |
| `ApplyEffect` | layer | effectId, params |
| `SetDuration` | project / variant | durationMs (variable, §7) |
| `RenderSurface` | surface[] | perfil; **no muta el proyecto**: encola un job (§5.5) |
| `CreateVariant` | campaign | fromVersion, name, overrides |
| `SetClockState` | clock track | state (normal/off/accent/countdown), tMs |
| `AddComment` / `ResolveComment` | anchor (§6.4) | texto |
| `Transaction` | — | lista de comandos que se aplican todos o ninguno (una macro, un plan de IA) |

El catálogo crece por unidad; cada `kind` nuevo trae su schema, `apply`, `invert`, tests y entrada en la paleta.

### 5.3 CommandBus e History

```
dispatch(cmd) → validate payload → apply → validate(project') → History.push({cmd, inverse, diff}) → emit(diff)
undo() → History.pop() → dispatch(inverse) sin registrar como nuevo
redo() → re-aplica el comando guardado
```

- **History** es una lista lineal con puntero (modelo clásico) **más** ramificación explícita: "ramificar desde aquí" crea una `Variant` (§6.2), no una rama oculta del historial. Simple y auditable.
- **Transaction** se registra como un único ítem (un undo deshace la macro o el plan completo).
- **Serialización:** el historial se guarda con el proyecto (opcional, truncable). Un `CreativeProject` + su lista de comandos permite **reproducir** la edición (base para "qué cambió" entre versiones, §6.3).
- **Concurrencia:** fuera de alcance hasta CS-5. El diseño del bus no lo impide (comandos con `at` lógico y `parent` admiten reordenamiento tipo OT/CRDT después), pero no se promete.

### 5.4 Macros, atajos y Command Palette

- **Macro** = `Transaction` con parámetros nombrados, guardada en el proyecto o en el Brand Space ("Aplicar rojo McDonald's" = `SetLightColor` en zonas X con el RGBW del preset + `SetSurfaceMedia` del logo en el cierre).
- **Atajos:** tabla `kind → tecla` editable, con un set por defecto; keyboard-first en Pro Studio.
- **Command Palette (Ctrl/Cmd+K):** índice de comandos, macros, presets, objetos del proyecto y del Brand Space; búsqueda difusa en español e inglés; cada entrada muestra atajo y descripción; ejecuta un `dispatch`. Ejemplos del pedido: "Crear cámara Obelisco" (`ChangeCamera` con preset), "Duplicar escena", "Aplicar rojo McDonald's" (macro del Brand Space), "Fade 2 segundos" (`SetLightIntensity`/`ApplyEffect` con fadeMs 2000 sobre la selección), "Seleccionar luminarias nivel 2" (selector), "Render todas las superficies" (`RenderSurface`).

### 5.5 Comandos que no mutan el proyecto

`RenderSurface`, `ExportProject`, `SubmitToTrust` son **comandos de efecto**: pasan por el bus (para la paleta, los atajos y la auditoría) pero no entran al historial de undo; producen un `Job` con estado y resultado (hash del MP4, respuesta de la API). Ningún comando del Studio tiene como destino hardware: no existe el `kind`. Test de gate: el enum de `CommandKind` no contiene nada que nombre TB60, DMX, Art-Net ni EDGE.

### 5.6 La IA usa los mismos comandos

```
prompt + contexto (proyecto serializado, Brand Space, sitio)
  → servidor → CreativePlan (zod)          # intención tipada, con explicación por cambio
  → core: planToCommands(plan) → Command[] # misma función para humano y para IA
  → Transaction con origin.via = 'ai'
  → diff visible → el usuario aplica, edita o descarta
```

- `CreativePlan` **no contiene comandos crudos**: contiene intenciones de un vocabulario cerrado (p. ej. `{ op: 'scaleProduct', factor: 1.2 }`, `{ op: 'delayLights', ms: 2000 }`, `{ op: 'tone', value: 'institutional' }`), que `planToCommands` traduce con reglas deterministas y testeables. Así una respuesta inesperada del modelo no puede producir un comando fuera del catálogo ni fuera de validación.
- "Producto 20 % más grande", "menos movimiento", "más institucional", "luces dos segundos después", "otra versión para Navidad" son los cinco casos de prueba obligatorios de CS-3 (cada uno con su plan esperado y sus comandos resultantes).
- Cada cambio de IA es visible (diff), editable (son comandos normales), reversible (undo de la transacción), muestra qué cambió y se abre en Pro Studio sin pérdida.

### 5.7 Integración con creative-core sin romper el determinismo de CS-0

- `evaluate(project, tMs)` no cambia: los comandos producen proyectos; el motor sigue siendo una función del proyecto.
- Property tests nuevos: (a) `apply` ∘ `invert` = identidad; (b) orden de una `Transaction` reproducible; (c) `replay(base, commands)` = proyecto guardado; (d) ningún comando produce un proyecto que no pase `validate()`.
- Costo: el `CreativeProject` v1 de CS-1 se diseña ya con `Readonly` hacia afuera y helpers inmutables (estructuras persistentes simples: copia por camino), para que el bus no cargue el modelo entero por comando en proyectos grandes. Se mide en CS-1 (meta: `dispatch` < 5 ms p95 en el proyecto de referencia).

---

## 6. Modelo Campaign / Variant / Brand Space

### 6.1 Entidades

```
Site ──< Surface | LightZone | Element(clock, dome)
Brand ──< BrandSpace ──< BrandAsset | Palette | Typeface | Claim | Rule | Preset(visual, rgbw) | Template | Guideline
Brand ──< Campaign ──< Version (V1…Vn) ──── CreativeProject (snapshot inmutable + comandos desde la anterior)
                 └──< Variant (día, noche, premium, finde, lanzamiento, evento, temporada, fecha) ──< Version
Campaign/Variant ──< Comment (anclado) · ReviewState · TrustLink { campaignId, showVersionId, versionHash }
```

### 6.2 Parent Campaign → Variants

- Una `Variant` **no es una copia desconectada**: guarda `parentVersion` + una lista de `overrides` (comandos) sobre la madre. Se materializa a un `CreativeProject` completo con `replay(parent, overrides)`.
- **Propagación controlada:** cuando la madre avanza de versión, cada variante marca "madre actualizada" y ofrece **rebase** (re-aplicar sus overrides sobre la nueva madre, mostrando conflictos comando a comando) o **congelar** (desprender la variante como campaña propia). Nunca se propaga en silencio.
- Las variantes comparten Brand Space, assets y sitio; pueden diferir en duración, assets, luces, horario sugerido.
- Hacia TRUST, **cada variante es una campaña/versión propia** (`campaignId` distinto o versión distinta según decida Affinitas al enviar): ShowPackage v1 no conoce variantes y no hace falta que las conozca. ❓B: si conviene que TRUST registre la relación madre–variante (para programación "día/noche"), es un campo aditivo en `platform-campaigns`, con brief.

### 6.3 Versiones

- `Version` = snapshot inmutable del proyecto + hash + autor + comandos desde la versión anterior + resultado de `validate()`. Numeración simple y visible (V12, V13, V14).
- **Comparación de cambios** = lista de comandos entre versiones (gracias al bus) agrupada por superficie/zona/escena. **Comparación visual** = render de preview de ambas, lado a lado, alternado y diferencia por superficie (en CS-6 con preview WebGL; render completo en desktop).
- La versión que entra a TECH CHECK queda vinculada a la `ShowVersion` de TRUST (`TrustLink`), y a partir de ahí la identidad que vale es la de TRUST (`showVersionId` + `versionHash`, CS-0 §2.1).

### 6.4 Comentarios anclados

```
Comment { id, author, text, createdAt, resolved,
          anchor: { tMs: 13620, surface?: 'screen_a', layer?: 'Producto', zones?: ['L2'], command?: CommandId },
          versionId }
```

Ejemplo del pedido: `00:13.620 → screen_a → layer Producto → luminarias L2`. El anclaje al objeto lógico es **cuando sea posible**: si el objeto desaparece en una versión posterior, el comentario conserva `tMs` y muestra "el objeto ya no existe".

### 6.5 Brand Space

- Cada elemento tiene `lock: 'locked' | 'editable'` y `approvedBy`. Un comando que modifique un elemento `locked` (o un proyecto que lo use alterado: logo deformado, color fuera de paleta, claim editado) **no pasa `validate()`** salvo que el actor sea Brand Owner. Esto es **validación de reglas declaradas**, no validación jurídica ni de guidelines inferidas.
- `Rule` es un predicado declarativo de un vocabulario cerrado (p. ej. `minLogoDurationMs`, `forbiddenSurfacesFor(asset)`, `safeArea(asset, surface)`, `allowedPalette`), nunca código.
- Guidelines son documentos adjuntos para leer; el Studio no las interpreta.

### 6.6 Adaptar campaña (futuro, CS-8)

El cliente sube material existente (spot, key visual, social, packshot, logo, guideline). El AI Director propone un mapeo por rol de superficie del sitio (EL TRUST: Corrientes → producto/hero, Pellegrini → narrativa/movimiento, media → continuidad, fachada → color/iluminación, reloj/cúpula → accent/evento) como `CreativePlan` → comandos → proyecto **completamente editable**. El análisis del material (colores dominantes, logo detectado, duración del spot) corre en servidor con `platform-media`/ffmpeg y, si Fer autoriza, un modelo de visión (costo). Sin autorización, el mapeo se propone sin análisis automático (el usuario etiqueta el material).

---

## 7. Qué se incorpora a creative-core y qué queda fuera

| Entra en `creative-core` (puro, determinista) | Queda fuera (y dónde va) |
|---|---|
| Modelo: `Site`, `Surface`, `LightZone`, `Element`, `CreativeProject`, `Scene`, `Layer`, `Track`, `Keyframe`, `Curve`, `Camera`, `Mask`, `Transition`, `ParticleSystem` (parámetros), `Variant`, `Version` (forma), `Comment` (forma), `BrandSpace` (forma y reglas) | Persistencia (archivo: apps; servidor: CS-5/CS-7 en `platform-api`) |
| `Command`, `CommandBus`, `History`, `Transaction`, `Macro`, `Selector`, `planToCommands` | UI, paleta (índice y búsqueda), atajos (apps; el core expone el catálogo) |
| `evaluate`, `validate`, `diff`, `replay`, `rebase` de variantes | Render de píxeles (Three.js en apps; Blender como proceso externo; `renderPlan()` del core dice qué renderizar, no cómo) |
| `toTakeoverDraft` (+ `zones` de CS-1a), `renderPlan` | Red: API de TRUST (cliente en apps), IA (servidor), notificaciones (CS-7) |
| Duración variable: `durationMs` del proyecto/variante sin tope fijo; el tope lo pone el `Site` (y el preflight de TRUST) | Programación: solo lectura de lo que TRUST CONTROL decida (CS-7 la muestra; no la edita) |
| Reglas de marca declarativas (vocabulario cerrado) | Interpretación de guidelines, validación jurídica |
| Audio de preview como pista de referencia (tiempo y markers); no se entrega a TRUST | Audio en la salida: ShowPackage v1 no lo contempla; si un día hace falta es v2 con ADR |
| Reloj como pista (`ClockState` existente) | Hardware, DMX, Art-Net, TB60, EDGE: inexistentes en el core |

**Lo que ShowPackage v1 no admite y se posterga sin contrato paralelo:** más de una fuente por superficie en el tiempo (hoy un master por superficie: el Studio **renderiza** el multipista a un master, como ya fija CS-0 §2); audio; cámaras y anamorfosis como datos de entrega (se hornean en el render). Ninguno bloquea el MVP.

---

## 8. Roadmap CS-1…CS-n revisado

| Unidad | Qué | Toca | Depende de | Estimado* |
|---|---|---|---|---|
| **CS-1** core | `creative-core` v1: modelo (con `Site` configurable y duración variable), `evaluate`, `validate`, `toTakeoverDraft`, **Command System** (bus, history, transaction, catálogo inicial, `planToCommands` con fixtures), property tests, mutaciones | paquete nuevo | — | ~2 sem (antes ~1; suma comandos) |
| **CS-1a** cues RGBW por zona | sin cambios respecto de CS-0 | `show-authoring` | — | ~3 días |
| **CS-1b** calibración | sin cambios | `creative-core` + datos de sitio | Fer en sitio | paralelo |
| **CS-2** Pro Studio Desktop MVP | Electron + core + viewport 3D + timeline multipista + inspector + paleta + render local + entrega (**§11**) | app nueva | CS-1, PC con RTX | ~3 sem |
| **CS-3** AI Director | `CreativePlan` → comandos, endpoint servidor, tope de costo, procedencia, los 5 casos de §5.6; corrida real obligatoria (CS-0 §9) | core + endpoint aditivo | CS-1, ❓2 | ~1 sem + proveedor |
| **CS-6** Marketing Studio MVP | web guiada: Home, Nueva campaña, Direcciones, Propuesta con cambios en lenguaje natural + diff, Variantes, Enviar (**§12**); prueba de < 5 min | app nueva | CS-1, CS-3 | ~2 sem |
| **CS-5** almacén de proyectos | `CreativeProject`/`Version` en servidor, `expectedRevision`, permisos por marca/sitio; habilita colaboración y Companion | `platform-api` + migración | CS-1 | ~1,5 sem |
| **CS-7** Review, Brand Space y roles | etapas MARKETING/BRAND REVIEW, comentarios anclados, comparación de versiones, Brand Space en servidor, roles del Studio, notificaciones; TECH CHECK = submit existente | `platform-api` aditivo + apps | CS-5 | ~2 sem |
| **CS-4** Desktop completo | GLB, partículas, máscaras, curvas avanzadas, Blender headless, A/B, render queue completa, firma e instalador | desktop | CS-2 | ~2 sem |
| **CS-9** Companion | teléfono (PWA primero) y tablet Studio Touch (**§13**) | app nueva | CS-5, CS-7 | ~2 sem |
| **CS-8** Adaptar campaña | análisis de material + mapeo por rol de superficie como plan editable | servidor + core | CS-3, CS-6 | ~1,5 sem (+ modelo de visión si Fer autoriza) |
| **CS-10** Plugins / SDK | solo diseño (ADR): familias, sandbox, permisos, versionado; sin código externo hasta decisión | docs | CS-4 | diseño ~3 días |

\*Estimados con el circuito actual; se miden y se informan, no son compromiso. Orden propuesto: **CS-1 → CS-1a → CS-2 (desktop primero, porque es el producto profesional principal y no depende de IA) → CS-3 → CS-6 → CS-5 → CS-7 → CS-4 → CS-9 → CS-8 → CS-10**, con CS-1b en paralelo cuando haya datos. Hito demo de CS-0 (fin de CS-3) se mantiene; se agrega **hito Marketing** al cierre de CS-6 (prueba de los 5 minutos) y **hito enterprise** al cierre de CS-7 (flujo completo DRAFT → SCHEDULED con cuatro ojos real).

---

## 9. Dependencias y riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Command System encarece CS-1 y el modelo (inmutabilidad, inversas) | +1 sem; proyectos grandes lentos | diseño `Readonly` + copia por camino desde el día uno; meta `dispatch` < 5 ms p95; catálogo inicial corto |
| La IA produce planes fuera de vocabulario | cambios inesperados | `CreativePlan` cerrado + `planToCommands` determinista + diff obligatorio antes de aplicar; nunca texto libre |
| Sin modelo real, CS-3 y CS-6 no se cierran | hito Marketing bloqueado | ❓2 de CS-0 (proveedor con tope o modelo local en la RTX); fixtures solo para tests |
| ShowPackage v1 no expresa multipista ni audio | expectativa de "lo que edito es lo que se entrega" | el Studio renderiza masters; se comunica en la UI ("se entrega como video por superficie"); v2 solo con ADR |
| Geometría preliminar | anamorfosis inválida, previews engañosos | rótulo permanente (gate), CS-1b temprana, nunca prometer anamorfosis validada |
| Roles del Studio vs roles de TRUST | permisos divergentes o escalamiento | servidor de TRUST como única autoridad; roles del Studio solo adicionales y aditivos; tests de permisos cruzados |
| Multi-sitio prematuro | sobre-ingeniería | `Site` configurable en el modelo, **una sola instancia** (EL TRUST) hasta decisión de Fer |
| Desktop en Windows con RTX no disponible aún | CS-2 sin máquina de referencia | preview y tests en CI sin GPU; rendimiento se mide cuando exista la PC; ❓3 de CS-0 |
| Electron ~150 MB y actualizaciones | distribución a clientes | firma + auto-update (CS-4); Tauri como alternativa documentada |
| Brand Space interpretado como validación legal | expectativa falsa | reglas declaradas por el cliente, vocabulario cerrado, rótulo "reglas declaradas por la marca" |
| Dos capas de revisión (Studio y TRUST) desincronizadas | versión aprobada ≠ enviada | `TrustLink` por versión; el Studio bloquea edición de una versión en TECH CHECK; la `ShowVersion` con hash manda |
| Carga de trabajo sobre P-06/#98 | desplazamiento | este addendum es lateral documental; CS-1 recién después de la decisión de Fer y cerrada la fase activa |
| Costos nuevos (modelo de visión en CS-8, notificaciones push en CS-9, firma de código en CS-4) | gasto no autorizado | cada uno con costo estimado y tope antes de activar; sin autorización, la unidad entrega la parte sin costo |

Dependencias externas: PC con RTX (CS-2/CS-4), modelo de IA (CS-3), Fer en sitio (CS-1b), cuenta de firma de código (CS-4), proveedor de push (CS-9).

---

## 10. Qué se puede comenzar ya sin tocar interfaces congeladas

Todo lo siguiente es **nuevo y aditivo**, no toca `apps/control`, M2C.2, storage, `platform-approval`, `platform-auth`, `shared-types`, `show-engine` ni gates, y cabe como lateral de riesgo medio (paquete nuevo) con brief corto:

1. **CS-1 `creative-core`** completo (modelo + Command System + `toTakeoverDraft` + tests): paquete nuevo en `packages/creative-core`.
2. **CS-1a** (`show-authoring`, ya aprobado en CS-0).
3. **Design system de Creative Studio** como paquete nuevo (`packages/creative-ui`): tokens, iconografía, paneles, docking, paleta; sin consumidores hasta CS-2/CS-6.
4. **ADR de Command System** y **ADR de plugins** (docs).
5. **Fixtures de `CreativePlan`** para los 5 casos de §5.6 y el proyecto de referencia para rendimiento.
6. **CS-1b** plan de toma de fotos (docs) a la espera de Fer en sitio.

Lo que **no** se puede empezar sin decisión: cualquier unidad que toque `platform-api` (CS-5, CS-7, endpoint de CS-3), proveedor pago (CS-3), roles nuevos en `platform-auth` (❓A), firma de código (costo).

Orden respecto de la fase activa: **después** de que #98 esté en `main` y P-06 cierre su matriz (DECISIONES: P-05 → P-04 → P-03 → PoC P-06), y con la decisión de Fer sobre este addendum. Hasta entonces, nada de código.

---

## 11. Propuesta de MVP Desktop profesional (CS-2)

**Objetivo:** que un diseñador abra un proyecto (vacío, plantilla, o salido del AI Director) y lo lleve a nivel de frame, layer, cámara, superficie y luminaria, lo renderice y lo entregue a TRUST, sin red.

**Incluye:** Electron + TS + `creative-core`; viewport 3D del sitio con `trust-3d` (rótulo de geometría); cámaras preset (Obelisco, calle, libre, ortográfica por superficie); asset browser (proyecto + archivo local); inspector; timeline multipista por superficie, zona de luz (escenas del catálogo hasta CS-1a, luego RGBW por zona), reloj y cámara, con frame/timecode, keyframes, curvas lineal/ease/bezier, snapping, markers; layers con transformaciones, opacidad, máscaras rectangulares/elípticas, transiciones básicas (corte, fundido, barrido); duración variable; escenas; Command Palette, atajos, undo/redo completo, historial con diff; render local por superficie a MP4 (WebGL → frames → ffmpeg) validado con `platform-media`; entrega con cola offline (CS-0 §8.6); guardado como archivo versionado.

**No incluye (CS-4):** GLB importado, partículas, máscaras libres/stylus, A/B, render queue con Blender, instalador firmado, auto-update, plugins.

**Criterios de aceptación medibles:** los de CS-0 §8 (determinismo, timeline al ms, formato a la primera, ≥ 30 fps preview en la máquina objetivo, seguridad, offline, rótulo) más: `dispatch` < 5 ms p95; undo/redo de 1.000 comandos sin divergencia (`replay` = estado); paleta responde en < 100 ms; proyecto de referencia (3 superficies, 12 zonas, 6 escenas, 200 keyframes, 30 s) abre en < 2 s.

**Plataforma:** Windows primero (la PC con RTX, ❓3 de CS-0); macOS cuando haya máquina de prueba.

---

## 12. Propuesta de MVP Marketing (CS-6)

**Objetivo:** el camino de 5 minutos, de punta a punta, sobre el mismo core.

**Incluye:** Home (Nueva campaña, Campañas activas, Plantillas, Brand Space en lectura, Esperando aprobación, Programación en lectura, Biblioteca); "¿Qué querés comunicar?" (prompt + assets + producto + objetivo + duración + restricciones); 2–3 direcciones del AI Director con costo y procedencia; propuesta sobre el edificio (preview WebGL con rótulo) y timeline simple; cambios en lenguaje natural → `CreativePlan` → comandos → **diff visible** → aplicar/descartar/deshacer; "otra versión para…" (Variant); enviar a revisión (hasta CS-7: exporta el proyecto y, con sesión de Affinitas, submit a TRUST); plantillas (15 s takeover, 30 s lanzamiento, 20 s institucional) como proyectos de partida.

**Depende de IA:** sí (CS-3). Sin modelo real, CS-6 se entrega como "Marketing Studio con direcciones de plantilla" (sin IA) y la unidad queda abierta, igual que CS-3 en CS-0 §9.

**Criterios:** prueba de los 5 minutos (§1.3, 5/5); todo cambio de IA deja diff y undo (test E2E); el proyecto generado abre en Pro Studio con `evaluate` idéntico (property test); ningún secreto en el cliente; accesibilidad AA en el camino de 5 minutos (axe en E2E).

---

## 13. Propuesta Mobile/Tablet posterior (CS-9)

- **Teléfono primero como PWA** (misma base web, `creative-core` sin cambios, preview como video renderizado + vista compuesta ligera): proyectos, preview, timeline simple, comentarios anclados, comparar versiones, aprobar/rechazar según rol, cambios rápidos (set acotado de comandos con diff), prompt AI, programación en lectura, notificaciones (push: costo/proveedor a autorizar; sin él, notificaciones en la app y por correo existente).
- **Tablet "Studio Touch"**: la PWA con layout táctil + timeline táctil, preview 3D WebGL, sliders grandes, luces por zona, cámaras, escenas, FX con presets, stylus para máscaras y curvas (Pointer Events con presión).
- **Empaquetado nativo** (Capacitor o similar) solo si la PWA no alcanza (push en iOS, archivos, rendimiento 3D): se investiga en la unidad con medición, sin crear un segundo motor ni una UI que obligue a divergir el core.
- **No** es Pro Studio: sin edición por frame, curvas numéricas, render queue ni plugins.

---

## 14. Criterios medibles de calidad y performance

| Área | Métrica | Meta | Cómo se mide |
|---|---|---|---|
| Core | determinismo `evaluate` | 100 % property tests | CI |
| Core | `apply∘invert` = id; `replay` = estado | 100 % property tests | CI |
| Core | `dispatch` | < 5 ms p95 (proyecto de referencia) | bench en CI (sin GPU) |
| Core | validación | ningún comando deja un proyecto inválido | property test |
| Timeline | exactitud | cues al ms; cortes en frame exacto a 30 fps (±0) | tests (CS-0 §8.2) |
| Render | formato | pasa `platform-media` y preflight a la primera | tests + E2E |
| Render | tiempo | 15 s ≤ 3 min en la RTX (se mide, no se promete); 30 s ≤ 6 min | reporte de fase |
| Desktop | preview | ≥ 30 fps en la máquina objetivo con el proyecto de referencia | reporte de fase |
| Desktop | apertura de proyecto | < 2 s (referencia) | bench |
| Desktop | paleta | < 100 ms de tecla a resultado | bench |
| Desktop | undo/redo | 1.000 comandos sin divergencia | test |
| Marketing | 5 minutos | 5/5 usuarios sin capacitación | prueba registrada |
| Marketing | diff y undo de IA | 100 % de los cambios | E2E |
| IA | vocabulario cerrado | 0 comandos fuera de catálogo en 100 planes (fixtures + reales) | test |
| IA | costo | ≤ tope por propuesta y mensual, visible | reporte |
| Seguridad | hardware | 0 `CommandKind` hacia hardware; 0 secretos en cliente | test de gate + revisión |
| Permisos | separación de deberes | 0 aprobaciones propias; 0 cruces de contrato | tests de permisos cruzados |
| Accesibilidad | camino de 5 minutos y Companion | WCAG AA sin violaciones de axe | E2E |
| Geometría | rótulo | presente en todo preview | test (CS-0 §8.7) |
| UX | design system | tokens únicos; dark/light; keyboard-first (todo comando accesible sin mouse); estados vacíos y onboarding definidos por pantalla; tooltips con atajo | revisión de diseño + E2E de teclado |
| Proceso | cada unidad | brief corto → PR → CI → `AUDIT: APROBADO` → merge; sin relajar gates | AGENTS.md |

**Design system (requisito de CS-2 y CS-6, paquete `creative-ui`):** jerarquía tipográfica de 5 niveles; iconografía propia y consistente (sin copiar sets propietarios); paneles acoplables con layouts guardados; tema oscuro por defecto en Pro Studio (ambiente de edición de video) y claro/oscuro en Marketing y Companion; accesibilidad AA; keyboard-first; rendimiento (listas virtualizadas, timeline en canvas); estados vacíos con una acción clara; onboarding de 3 pasos en Marketing y tour de paneles en Pro; tooltips profesionales (qué hace, atajo, enlace a doc); Command Palette como primer ciudadano.

---

## 15. Plugins / SDK (diseño conceptual, sin implementar)

- **Familias:** FX, Particles, Anamorphic, DMX (solo *preview* y traducción a cues del draft; nunca salida física), Live Data, Sports, Weather, Brand Templates, AI Providers, Blender, otros renderers.
- **Modelo:** un plugin aporta (a) `CommandKind`s nuevos con schema, `apply`, `invert` y tests; (b) evaluadores de layer/efecto para `evaluate`; (c) entradas de paleta; (d) adaptadores externos (renderer, proveedor de IA). Todo declarado en un manifiesto con versión, permisos pedidos y hash.
- **Seguridad antes de código externo:** sandbox (worker aislado para evaluadores; proceso aparte para adaptadores), permisos explícitos (red, disco, assets del Brand Space), firma del plugin, versionado semántico con compatibilidad declarada contra `creative-core`, lista de plugins permitidos por Affinitas. **Ningún plugin puede agregar un destino de hardware** (el bus lo rechaza por construcción).
- **Decisión pendiente:** CS-10 entrega el ADR; implementar el host de plugins es decisión de Fer posterior.

---

## 16. Preguntas abiertas (nuevas; las de CS-0 siguen vigentes)

- ❓A **Roles del Studio:** tabla aditiva en `platform-api` (propuesta) o roles nuevos en `platform-auth` (toca familia congelada; `decisión-producto`).
- ❓B **Relación madre–variante en TRUST:** campo aditivo en `platform-campaigns` o solo en el Studio (propuesta: solo en el Studio hasta que programación lo necesite).
- ❓C **Orden CS-2 (desktop) antes que CS-6 (marketing):** propuesta desktop primero porque no depende de IA y es el producto principal; si Fer prioriza la demo a McDonald's, CS-6 primero con direcciones de plantilla.
- ❓D **Companion como PWA** (propuesta) o nativo desde el inicio.
- ❓E **Audio de preview:** solo referencia (propuesta); nunca en la entrega salvo ShowPackage v2.
- ❓F **Multi-sitio:** el modelo lo admite; ¿se documenta públicamente como capacidad o se reserva hasta el primer sitio nuevo?

## 17. Orden y próximos pasos

1. Revisión de ChatGPT de este addendum (lateral documental, riesgo medio por ser brief; no toca HANDOFF ni la fase activa).
2. Decisión de Fer sobre ❓A–❓F y las de CS-0 que siguen abiertas (❓1–❓6).
3. Al cerrar la fase activa: brief corto de CS-1 (core + Command System) → PR → CI → `AUDIT` → merge. Recién ahí, código.
