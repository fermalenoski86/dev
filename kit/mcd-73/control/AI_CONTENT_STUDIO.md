# AI Content Studio (simulado) — UPLOAD MEDIA, análisis y plan por superficie

Prototipo **offline** dentro de TRUST Control (kit #73), según el brief MASTER OF TRUST §40–59. Todo corre en el navegador: los archivos no salen de la máquina, no hay red, no hay modelo de IA ni servicios pagos. **SIMULACIÓN CONCEPTUAL — NO CONECTADA A EQUIPOS REALES.**

## Flujos (§59)
- **IDEA FIRST:** prompt sin adjuntos → «Generar concepto» carga la plantilla preprogramada del show.
- **MEDIA FIRST:** subo material → «Generar concepto» propone qué hacer con él.
- **MEDIA + PROMPT:** material + intención (palabras clave: producto, logo/cierre, onda) → el flujo más completo.

## MediaAttachment (§43)
`id · type (video|image) · filename · mimeType · sizeBytes · durationMs? · width · height · fps? · codec? · thumbnail? · keyframes[] · assetId? · sha256 · status · motivo · uso {referencia, final} · roles[] · derechos {rightsConfirmed, sourceOwner, usageNotes} · rango · rangoSugerido · analisis {tecnico, visual, notasIA}`

Estados: `UPLOADING → ANALYZING → READY | REJECTED`. Solo **READY** entra al concepto. Se acepta MP4, JPG, PNG y WEBP (≤ 500 MB en la simulación). `assetId` es una huella local (`local-` + SHA-256): **no es** un Asset de M3A.

## Análisis (§42, §48)
- **Metadata técnica real:** cajas ISO-BMFF del MP4 (`tkhd`, `mdhd`, `stsd`, `stts`): códec, fps, resolución, duración, audio; imágenes: resolución, aspecto, transparencia.
- **Keyframes:** 0 / 25 / 50 / 75 / 100 % (miniaturas JPEG 240 px).
- **Análisis visual básico:** colores dominantes, cortes de escena (cambio de histograma), ritmo, energía, dirección del movimiento (deriva de la saliencia), composición y área segura.
- **AI NOTES:** se muestran rotuladas como *análisis generado · heurístico local, no IA · no es metadata técnica*. Texto, logo y producto: «no detectable sin proveedor multimodal» (preparado, no conectado).
- **Rango sugerido:** ventana de 15 s con más energía, alineada a cortes; el operador lo cambia en el SOURCE TIMELINE.

Nota de navegador: Chromium sin códecs propietarios (el de las pruebas) no decodifica H.264 y lo marca REJECTED con motivo claro; **Chrome y Edge sí**. Para la demo, usar Chrome o Edge.

## Referencia vs asset final (§46)
Todo entra como **REFERENCE MEDIA**. «Use in final takeover» lo convierte en CAMPAIGN ASSET *pendiente*. Una referencia nunca genera un archivo publicable: aporta paleta, ritmo o estilo (`USE_AS_REFERENCE`).

## Concepto (§44, §45, §47)
`generateConcept({ prompt, attachments, brandContext, campaignContext })` con proveedor intercambiable. Hoy: `planificador-local` (reglas deterministas). La solicitud multimodal (texto + metadata + keyframes) se arma y se exporta en el JSON, pero **no se envía**. Conectar un proveedor real requiere autorización de Fer (costo y tope).

El plan devuelve: storyboard por momento (NORMAL · BRAND REVEAL · FULL TAKEOVER · SIGNATURE · EXIT) y por superficie, estrategias (`USE_AS_IS · TRIM · CROP · REFRAME · LOOP · SPLIT · EXTRACT_SEGMENT · USE_AS_REFERENCE · GENERATE_VARIATION · COMBINE_WITH_GENERATED_CONTENT`), FX (LIGHT WAVE · PRODUCT GLOW · SIGNATURE GLOW), material faltante con prompts generativos y notas.

**Nunca se estira:** cubrir (crop con foco) · master A+B (crop 2592×576 partido en 1152 + 1440) · contener (reencuadre + fondo extendido desenfocado) · logo (contenido) · paleta (fondo en movimiento con los colores del material). El cierre no se parte entre torres (el logo quedaría cortado por la cúpula).

## Original intacto y derivadas (§53, §54)
El archivo subido no se modifica (la prueba verifica su SHA-256). Cada concepto propone **rendered campaign assets** con el formato real de la superficie (`packages/show-engine/src/building.ts`): screen_a 1152×576 · screen_b 1440×576 · master A+B 2592×576 · marquesina 1920×412, con `derivedFromAssetId` (fuente principal) y `derivadoDe` (todas). `upperMode` es de campaña (`draft-schema.ts`): con un tramo master sale **un** lienzo A+B; si no, un archivo por torre; nunca se mezclan. Cada concepto nuevo sube la versión (`_v2`, `_v3`…), no pisa la anterior.

## Lo que NO hace el kit y queda para la plataforma (Creative Studio, #59 / PR #74)
1. Pipeline real de M3A para todo CAMPAIGN ASSET: UPLOAD → SHA-256 → ffprobe → frame decode → Media Manager → Asset Validation.
2. Render/transcodificación de las derivadas al formato de la superficie y nueva validación.
3. Proveedor multimodal real detrás de `generateConcept` (sin acoplar a un proveedor; con costo y tope aprobados).
4. Persistencia de MediaAttachment / SOURCE ASSET → Creative Transform → RENDERED CAMPAIGN ASSET → Validation → ShowPackage con `derivedFromAssetId`.
5. Derechos (`rightsConfirmed`, `sourceOwner`, `usageNotes`) en el modelo de assets, sin bloquear el prototipo.

Esto toca `packages/` y M3A: va por PR + AUDIT, no por el kit.
