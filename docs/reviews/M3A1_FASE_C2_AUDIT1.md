# M3A.1 — Fase C2, respuesta a `AUDIT: CAMBIOS` #1

Auditoría: https://github.com/fermalenoski86/dev/pull/8#issuecomment-6045918447
(sobre `0cb79b797eb4b9c83f0117e1e8ce1802974eb674`).
Salida real: `M3A1_FASE_C2_AUDIT1_SALIDA.txt`.

## [P1] OTHER no demostrado inerte + nombre de descarga con extensión del cliente

**Reproducido** antes de corregir: `classifyContent` devolvía `'JPEG'` para
`FF D8 FF` + `MZ …` y la descarga de `payload.exe` salía como
`filename="payload.exe"`.

**Corrección** (las tres partes pedidas):

1. **OTHER retirado de la allowlist de C2** (la opción que el dictamen deja si
   no se agrega ahora un decoder completo). `detect.ts` ya no clasifica por
   firma de imagen: PNG y JPEG, reales o falsos, caen en
   `EVIDENCE_UNSUPPORTED_CONTENT` (415). La API rechaza `type=OTHER` con 400
   antes de recibir el archivo, y la base no admite ninguna fila OTHER
   (`EVIDENCE_MIME_BY_TYPE_0003` sin OTHER → trigger `evidence_insert`). El
   valor OTHER queda en el CHECK de Fase A (modelo §19) sin ningún MIME válido.
2. **Nombre de descarga generado por el servidor:** `attachment;
   filename="evidence-<id>.<ext>"` con `ext` derivada del MIME validado
   (`pdf`, `eml`, `txt`; `downloadFilename`). El nombre original queda solo
   como metadata (`originalFilename` en el JSON).
3. **Regresiones:**
   - unitario: payload exacto del dictamen → `null`; firma PNG + payload →
     `null`; PNG 1×1 **real y válido** (CRC e IDAT zlib correctos) → `null`;
     PNG real + trailing `MZ` → `null`.
   - HTTP: los mismos cuerpos (más ZIP y PE) subidos como `payload.exe` con
     `Content-Type: image/jpeg` → 415 sin persistir; `type=OTHER` con una
     imagen real → 400 sin persistir; descarga de un PDF subido como
     `payload.exe` → `filename="evidence-<id>.pdf"`, sin `.exe`, y
     `originalFilename = "payload.exe"` en el JSON.
   - mutaciones nuevas: "descarga con el nombre original" y "firma de imagen
     alcanza" (re-agrega la clasificación por `FF D8 FF`): ambas atrapadas.

## Gates (ejecución real en este entorno)

verify 637+1 · build OK · PostgreSQL 174+6 · bootstrap 6/6 · media 63/63 ·
mutaciones **177/177 atrapadas** (corrida completa). E2E M2C no ejecutado localmente
(sin Chrome con H.264): lo cubre el CI del PR.

## Propuesta derivada

- **BL-16 · Reabrir OTHER para capturas con validación completa.** Las
  capturas de WhatsApp/mail son evidencia frecuente; hoy hay que pasarlas a
  PDF. Para reabrir OTHER: decodificar la imagen entera con un decoder real
  (ffmpeg ya está en el stack de medios: `-v error -f image2pipe … -f null`),
  exigir que el contenedor termine exactamente en IEND/EOI sin bytes extra,
  limitar dimensiones, y servir una **re-codificación** generada por el
  servidor en vez de los bytes originales (CDR, como recomienda OWASP File
  Upload Cheat Sheet). Esfuerzo ~1–1,5 días. Criterio: el payload del dictamen
  y PNG/JPEG con trailing → 415; PNG/JPEG reales → 201 y la descarga es la
  re-codificación (sha distinto del original, guardado aparte). Fuente:
  https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
  (consultada 2026-10-07). Requiere acuerdo del auditor antes de implementar.
