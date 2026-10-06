MASTER OF TRUST — M3A.1
FASE B2 — MEDIA INSPECTION + VALIDATION

B1/B1.1 queda APROBADA.

No modificar la arquitectura de storage salvo bug demostrado.
No iniciar todavía B3 DB integration ni B4 API.

OBJETIVO

Dado un archivo temporal REAL almacenado por ObjectStorage:

TEMP OBJECT
→ ffprobe
→ metadata técnica
→ validación contra EL_TRUST
→ decode de frame con ffmpeg
→ resultado técnico determinista

B2 NO crea todavía StoredObject ni mueve Asset a READY.
Eso queda para B3.

==================================================
1. MEDIA INSPECTOR
==================================================

Crear paquete/módulo claramente separado:

packages/platform-media

Interfaces:

MediaInspector
FrameDecoder
MediaValidator

Implementación:

FfprobeMediaInspector
FfmpegFrameDecoder

No mezclar proceso externo con handlers HTTP.

==================================================
2. FFPROBE REAL
==================================================

Usar binario ffprobe real.

Ejecutar con:

spawn o execFile

NUNCA shell interpolation.

NO:
exec(`ffprobe ${path}`)

Sí:
spawn('ffprobe', [args...])

Timeout obligatorio.

Capturar JSON estructurado.

==================================================
3. INPUT

MediaInspector debe poder inspeccionar el archivo temporal real.

Para LocalDiskStorage puede utilizar una ruta interna segura si la
abstracción lo permite.

Para S3 futuro:
NO asumir filesystem local.

Diseñar una estrategia que permita materializar/stream temporalmente
sin romper ObjectStorage.

No agregar una dependencia de paths locales al dominio.

==================================================
4. METADATA A EXTRAER

Extraer al menos:

container
codec
width
height
fps rational original
fps normalizado
durationMs
videoStreamCount
audioStreamCount
pixelFormat cuando esté disponible

No confiar en:
filename
extension
Content-Type del upload

==================================================
5. CONTAINER

Aceptar actualmente:

MP4 real.

Validar por ffprobe:

format_name / formato detectado.

No aceptar un AVI/MKV renombrado .mp4.

Código:

ASSET_BAD_CONTAINER

==================================================
6. VIDEO STREAMS

Debe existir exactamente UN video stream utilizable.

0:
ASSET_NO_VIDEO

>1:
ASSET_MULTIPLE_VIDEO_STREAMS

Audio puede existir.
No afecta B2 salvo que aparezca una razón técnica documentada.

==================================================
7. CODEC

Aceptar:

H.264 / AVC

Normalizar nombres reportados por ffprobe.

Ejemplo:
h264 => H264

Cualquier otro:
ASSET_BAD_CODEC

No aceptar HEVC/H.265 por accidente.

==================================================
8. FPS

Implementar parser racional exacto.

ffprobe puede devolver:

25/1
30/1
30000/1001
0/0
etc.

Política actual:

ACEPTAR:
25/1
30/1

RECHAZAR:
30000/1001 (29.97)
24000/1001
24
50
60
framerate inválido

No comparar float con tolerancia accidental.

Guardar:

fpsNumerator
fpsDenominator
fpsValue

pero la decisión se toma racionalmente.

Error:

ASSET_BAD_FPS

==================================================
9. RESOLUTION / EL_TRUST

NO hardcodear formatos dentro del validator.

Consumir:

deriveSurfaceFormats(EL_TRUST)

Validar surfaceType:

towers_ab
screen_a
screen_b
horizontal

Contra la autoridad existente.

Actualmente esperamos aproximadamente:

towers_ab 2592×576
screen_a 1152×576
screen_b 1440×576
horizontal 1920×412

Pero el test debe demostrar que el validator depende de EL_TRUST,
no de constantes copiadas.

Error:

ASSET_BAD_RESOLUTION

details:

{
  expected: { width, height },
  actual: { width, height },
  surfaceType
}

==================================================
10. DURATION

Extraer duración de forma robusta.

Preferir duración del stream/formato según regla explícita documentada.

Normalizar a integer durationMs.

B2 ofrece:

validateMedia(media, capability, options?)

con:

requiredDurationMs opcional.

Si se proporciona y:

durationMs < requiredDurationMs

→ ASSET_TOO_SHORT

Si no se proporciona:
la duración positiva válida es suficiente.

La validación exacta de offsets del ShowPackage vuelve a ocurrir en Submit.

==================================================
11. FRAME DECODE REAL
==================================================

FfmpegFrameDecoder:

usar ffmpeg real.

Decodificar al menos UN frame.

No basta con ffprobe.

Elegir timestamp seguro:
preferentemente cerca del comienzo pero no depender exclusivamente de
frame exactamente 0 si eso genera falsos negativos.

Salida puede ser:
pipe:1
image2pipe
un frame JPEG/PNG

No hace falta conservarlo todavía.

Criterio:
proceso exit 0
+
bytes > 0

Si falla:
ASSET_CORRUPT

==================================================
12. TIMEOUTS

Config:

MEDIA_PROBE_TIMEOUT_MS
MEDIA_DECODE_TIMEOUT_MS

Timeout real:
matar proceso.

Asegurar que no quedan procesos zombie.

Código:

ASSET_INSPECTION_TIMEOUT

distinguir:
probe timeout
decode timeout en details si conviene.

==================================================
13. PROCESS OUTPUT LIMITS

No permitir stdout/stderr ilimitado.

ffprobe JSON:
límite razonable.

stderr:
truncar/capar para logs.

No devolver stderr crudo completo a clientes.

==================================================
14. ERROR CODES

En platform-contracts:

ASSET_BAD_CONTAINER
ASSET_BAD_CODEC
ASSET_BAD_RESOLUTION
ASSET_BAD_FPS
ASSET_TOO_SHORT
ASSET_NO_VIDEO
ASSET_MULTIPLE_VIDEO_STREAMS
ASSET_CORRUPT
ASSET_INSPECTION_TIMEOUT

Si ya existe el enum general de B1/B2:
extenderlo, no duplicarlo.

Errores estructurados:

{
  code,
  message,
  details
}

==================================================
15. VALIDATION RESULT

Preferencia:

type MediaValidationResult =
  | {
      ok: true;
      media: NormalizedMediaInfo;
    }
  | {
      ok: false;
      error: AssetRejection;
    }

No usar exceptions para una resolución incorrecta esperable.

Exceptions:
fallos de infraestructura/proceso inesperados.

==================================================
16. FILE CORRUPTION

Probar distintos niveles:

- archivo vacío
- bytes aleatorios
- header MP4 truncado
- MP4 con metadata legible pero frames corruptos

Queremos demostrar por qué existen DOS gates:

ffprobe
+
frame decode

Un archivo que pase probe pero no pueda decodificar frame:
ASSET_CORRUPT.

==================================================
17. FIXTURES REALES

Crear fixtures pequeños y deterministas.

Generarlos con ffmpeg durante test setup cuando sea posible.

Mínimo:

valid_towers_ab_25.mp4
valid_horizontal_30.mp4

bad_resolution.mp4
bad_codec.mp4
bad_fps_2997.mp4
too_short.mp4
multiple_video_streams.mp4 si ffmpeg lo permite
corrupt/truncated

Mantenerlos mínimos para no engordar el repo.

Preferir generación reproducible sobre binarios grandes commiteados.

==================================================
18. FIXTURE COMMANDS

Documentar comandos ffmpeg exactos.

Ejemplo conceptual:

ffmpeg -f lavfi -i color=...
...

Sin contenido comercial.
Solo patrones/colores de test.

==================================================
19. TESTS REALES

Los tests principales NO mockean ffprobe ni ffmpeg.

Ejecutar contra binarios reales.

Test:

valid towers 25
→ OK

valid horizontal 30
→ OK

wrong resolution
→ ASSET_BAD_RESOLUTION

HEVC
→ ASSET_BAD_CODEC

29.97
→ ASSET_BAD_FPS

too short
→ ASSET_TOO_SHORT

empty
→ ASSET_NO_VIDEO o CORRUPT según contrato documentado

random bytes
→ ASSET_CORRUPT

truncated video
→ ASSET_CORRUPT

multiple video streams
→ ASSET_MULTIPLE_VIDEO_STREAMS

==================================================
20. TEST DE AUTORIDAD DEL EDIFICIO

Mutar en test una capability derivada de EL_TRUST o usar un modelo
fixture alternativo.

Demostrar:

si el modelo dice otra resolución,
el validator espera esa nueva resolución.

No debe existir:

if surface === 'horizontal' width=1920

hardcodeado en validator.

==================================================
21. SECURITY TESTS

Filename tipo:

"; rm -rf /"
$(...)
`...`
espacios
unicode
comillas

NO debe afectar invocación del proceso.

Idealmente MediaInspector ni siquiera recibe originalFilename:
recibe una fuente/path interno controlado.

==================================================
22. CONCURRENCY LIMIT

Agregar limitador para inspecciones externas.

Configurable:

MEDIA_INSPECTION_CONCURRENCY

Ejemplo default desarrollo:
2 o 4.

No permitir que 100 uploads lancen 200 procesos ffmpeg simultáneamente.

Testear queueing.

==================================================
23. CANCELLATION

Si caller aborta:
terminar ffprobe/ffmpeg asociado.

Si timeout:
terminar proceso.

No dejar child process vivo.

Test cuando sea viable.

==================================================
24. MIME

Determinar tipo técnico basado en inspección.

B2 debe producir metadata que B3 pueda guardar coherentemente:

container
codec
width
height
fps
durationMs

Definir cuál será el mime_type canónico para MP4 validado:

video/mp4

NO copiar ciegamente MIME enviado por cliente.

==================================================
25. NO STORAGE FINAL TODAVÍA

B2 lee temporales.

NO hacer:

commitContentAddressed
StoredObject
Asset READY
audit final

Eso pertenece a B3.

Podemos probar MediaInspector contra temporales creados por
LocalDiskStorage real.

==================================================
26. B1 REGRESSION

Mantener todos los tests B1/B1.1.

No debilitar:

canonical key
final hash verification
atomic temp reservation
permissions
dedup
cleanup

==================================================
27. S3

B2 NO queda bloqueada por no disponer de MinIO.

No declarar S3 certificado.

Media inspection debe quedar preparada para una fuente que no sea
filesystem local.

Si hace falta materialización:
crear una abstracción explícita y documentarla.

==================================================
28. MUTATION CHECK

Agregar mutaciones:

- codec HEVC aceptado
- 29.97 aceptado
- resolución incorrecta aceptada
- multiple stream aceptado
- frame decode omitido
- timeout omitido
- surface format hardcodeado

Todas deben ser atrapadas.

==================================================
29. CHECKPOINT DE B2

Antes de B3 entregar:

ZIP
patch
M3A1_FASE_B2.md
matriz de validación
comandos de fixtures
salida REAL de ffprobe/ffmpeg tests
mutation results

pnpm verify
pnpm build
tests B1
tests B2
PostgreSQL regression
M2C regression según gate disponible

==================================================
30. CRITERIO DE CIERRE

B2 se cierra si:

1. ffprobe REAL inspecciona MP4 real;
2. metadata se normaliza;
3. H.264 se acepta;
4. codec incorrecto se rechaza;
5. 25/30 exactos se aceptan;
6. 29.97 se rechaza;
7. resolución viene de EL_TRUST;
8. duración se valida;
9. ffmpeg REAL decodifica un frame;
10. corrupto se rechaza;
11. timeout mata proceso;
12. filenames hostiles no llegan al shell;
13. concurrency está limitada;
14. B1 sigue intacta.

NO iniciar B3 hasta auditoría de este checkpoint.