# Kit TRUST × McDonald's (#73) — material comercial, NO va a `main`

Rama `kit/73-mcd`. Todo rotulado **SIMULACIÓN CONCEPTUAL — gemelo preliminar · mockup ilustrativo, no publicar**.

| Archivo | Qué es | Estado |
|---|---|---|
| `trust-mcd-kit-corte1.mp4` | Video 37 s, 1920×1080, H.264 yuv420p, 25 fps, sin sonido: apertura Obelisco (8 s) → takeover 15 s existente → "un show, tres sistemas" (8 s) → cierre (6 s) | corte 1 (mar 13) |
| `visuales/01..04-*.png` | 4 visuales 1920×1080 con rótulo | v1 (mar 13) |
| `trust-mcd-deck-v0.pdf` | (c) Deck ejecutivo v0, 8 diapositivas 1920×1080: portada · oportunidad · takeover 15 s · un show, tres sistemas · experiencia McDonald's · HOY FUNCIONA / SE IMPLEMENTARÁ · opciones comerciales (sin precios) · próximos pasos | estructura + v0 (mar 13) |
| `trust-mcd-propuesta-v0.pdf` | (d) Propuesta de una página (A4): narrativa, contenido, activos de la marca, beneficios, entregables, hoy/roadmap, esquemas, condiciones a definir | v0 (mar 13) |
| `trust-control-demo.mp4` | (e) Grabación REAL de TRUST CONTROL, 58 s, 1920×1080 H.264, sin sonido: operador sube y envía → otra persona aprueba el hash exacto → la versión aprobada no cambia. Es `e2e-platform/flow-41.spec.ts` corrido contra el stack local (PostgreSQL 16 + API + platform-web + Builder), con slowMo; rótulo fijo "entorno de prueba local · datos de prueba · sin pantallas ni equipos conectados" | v1 (mar 13) |
| `trust-mcd-guion-v0.pdf` | Guion de reunión (A4, 1 página): agenda de 30 min, preguntas probables con respuesta honesta, qué no decir, material offline | v0 (mar 13) |
| `demo/` | `playwright.demo.config.ts` (importa la config de plataforma, solo agrega slowMo) + `armar.py` (placas y montaje con ffmpeg). Regenerar: builds de platform-web/control como en el job `e2e-platform`, luego `playwright test -c kit/mcd-73/demo/playwright.demo.config.ts` y `python3 -I kit/mcd-73/demo/armar.py test-results/kit73-demo kit/mcd-73/trust-control-demo.mp4` | — |
| `deck/` | Fuentes HTML del deck y la propuesta + `render.py` (Chromium local): `python3 -I kit/mcd-73/deck/render.py kit/mcd-73` | — |
| `paquete.py` + `verificar_paquete.sh` + `prueba_navegador.py` | (f) Paquete offline: `python3 -I kit/mcd-73/paquete.py <dir>` arma `TRUST-McDonalds-kit-offline.zip` (~37 MB: video principal 1080p + alternativo 720p H.264 Main + respaldos WebM/VP9, grabación de TRUST CONTROL, 3 PDF, 4 visuales, `index.html` sin red, `LEEME.txt`, `SHA256SUMS.txt`). El ZIP no se versiona (se regenera). Verificación real en `PAQUETE_VERIFICACION.txt`: SHA256 14/14, decodificación completa de los 5 videos, PDFs 8/1/1 pág., 0 pedidos de red, los 3 reproductores avanzan en Chromium offline | v1 (mar 13) |
| `consola/` | Consola DMX virtual **offline** (abrir `consola.html`, sin red): presets Arquitectónica cálida / McDonald's / Takeover 15 s / Cierre, Play/Pausa/Reset (espacio, 1–4, R), master y zonas 0–100 %, timeline determinista de 15 s con pistas Luz/Corrientes/Pellegrini/Reloj y reloj virtual de espectáculo, estado de los 46 equipos RGBW (14/16/16). Rótulo fijo "SIMULACIÓN / CONTROL DMX VIRTUAL — NO CONECTADO A EQUIPOS REALES"; no emite Art-Net/sACN/DMX. La luz es una capa aditiva sobre `base-trust-noche.jpg` (sale de `hero-corner-169.jpg`, sin tocar): solo aclara. Posiciones en `luminarias.js` **vacías** hasta la imagen anotada de Fer: sin ellas no se dibuja luz sobre la foto; el editor integrado permite marcarlas y exportarlas. Prueba real: `python3 -I kit/mcd-73/consola/prueba_consola.py <dir>` → `consola/PRUEBA_CONSOLA.txt` | esqueleto v0 (mar 13) |
| `build.py` | Regenera todo con ffmpeg local: `python3 -I kit/mcd-73/build.py <dir_salida>` (desde la raíz del repo) | — |

Fuentes: `apps/control/public/experience/obelisco-wide.jpg`, `docs/screenshots/master-of-trust-mcd-demo-15s.mp4`, `hero-16x9-takeover/-signature.png`, `03-brand-reveal.png`. Sin servicios pagos ni IA generativa.

Claims: HOY FUNCIONA sale de `docs/collab/PROGRESO.md` (software 21/24 con PR+AUDIT, 0/24 con equipo real); pantallas = flujo de aprobación que funciona hoy; fachada RGBW y reloj = simulación / se implementará; sincronía = simulada, no medida.

Pendiente: posiciones de las 46 luminarias (14 roja / 16 amarilla / 16 verde) **bloqueadas hasta tener la imagen anotada de Fer**; no se inventan coordenadas. La consola ya opera sin ellas; con la imagen, cargar posiciones (editor → `luminarias.js`) y sacar los 3 stills de validación. Fotos: falta confirmar que son propias o de uso autorizado.

Pendiente de Fer para el deck: confirmar los dos esquemas comerciales (exclusivo / compartido). Guion de reunión: v0 (mar 13).
