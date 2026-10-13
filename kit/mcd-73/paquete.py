"""(f) Paquete offline del kit #73.

Uso (desde la raíz del repo):  python3 -I kit/mcd-73/paquete.py <dir_salida>
Genera <dir_salida>/TRUST-McDonalds-kit-offline/ y el ZIP al lado. Sin red, sin servicios pagos.
Después correr verificar_paquete.sh sobre el ZIP (descomprime en un directorio nuevo y prueba todo).
"""
import hashlib, html, os, shutil, subprocess, sys, zipfile

K = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1])
NAME = 'TRUST-McDonalds-kit-offline'
P = os.path.join(OUT, NAME)
if os.path.exists(P):
    shutil.rmtree(P)
for d in ('video', 'pdf', 'imagenes'):
    os.makedirs(os.path.join(P, d))

LABEL = 'SIMULACIÓN CONCEPTUAL — gemelo preliminar · mockup ilustrativo, no publicar'

# (archivo destino, origen, descripción)
FILES = [
    ('video/01-trust-mcd-video-principal-1080p.mp4', 'trust-mcd-kit-corte1.mp4',
     'Video principal 37 s (1920×1080): apertura → takeover 15 s → un show, tres sistemas → cierre. Simulación conceptual.'),
    ('video/03-trust-control-grabacion-real-1080p.mp4', 'trust-control-demo.mp4',
     'Grabación real de TRUST CONTROL (58 s): entorno de prueba local, datos de prueba, sin pantallas ni equipos conectados.'),
    ('pdf/01-deck-ejecutivo.pdf', 'trust-mcd-deck-v0.pdf', 'Deck ejecutivo, 8 diapositivas: HOY FUNCIONA / SE IMPLEMENTARÁ.'),
    ('pdf/02-propuesta-una-pagina.pdf', 'trust-mcd-propuesta-v0.pdf', 'Propuesta comercial de una página (sin precios).'),
    ('pdf/03-guion-reunion.pdf', 'trust-mcd-guion-v0.pdf', 'Guion de reunión de 30 min (uso interno, no entregar a la marca).'),
]
for img in sorted(os.listdir(os.path.join(K, 'visuales'))):
    if img.endswith('.png'):
        FILES.append((f'imagenes/{img}', f'visuales/{img}', 'Visual 1920×1080 rotulado SIMULACIÓN CONCEPTUAL.'))

for dst, src, _ in FILES:
    s = os.path.join(K, src)
    assert os.path.isfile(s), f'falta {s}'
    shutil.copy2(s, os.path.join(P, dst))

# Alternativo de compatibilidad: 1280×720, H.264 Main 3.1, faststart (proyectores/TV/players viejos).
ALT = 'video/02-trust-mcd-video-alternativo-720p.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(K, 'trust-mcd-kit-corte1.mp4'),
                '-vf', 'scale=1280:720', '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1',
                '-pix_fmt', 'yuv420p', '-r', '25', '-crf', '20', '-preset', 'medium',
                '-movflags', '+faststart', '-an', os.path.join(P, ALT)], check=True)
FILES.insert(1, (ALT, None, 'Mismo video en 720p, perfil Main (compatibilidad con proyectores/TV/reproductores viejos).'))
# Respaldos sin códecs propietarios (VP9/WebM 720p) para navegadores sin H.264 (p. ej. Chromium/Firefox en Linux).
def webm(src, dst):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(K, src),
                    '-vf', 'scale=1280:720', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1',
                    '-deadline', 'good', '-cpu-used', '4', '-an', os.path.join(P, dst)], check=True)
WEBM = 'video/02b-trust-mcd-video-alternativo-720p.webm'
WEBM_DEMO = 'video/03b-trust-control-grabacion-real-720p.webm'
webm('trust-mcd-kit-corte1.mp4', WEBM)
webm('trust-control-demo.mp4', WEBM_DEMO)
FILES.insert(2, (WEBM, None, 'Video principal en 720p VP9/WebM, para navegadores sin H.264.'))
FILES.insert(4, (WEBM_DEMO, None, 'Grabación de TRUST CONTROL en 720p VP9/WebM, para navegadores sin H.264.'))

rows = ''.join(
    f'<tr><td><a href="{html.escape(d)}">{html.escape(d)}</a></td><td>{html.escape(t)}</td></tr>' for d, _, t in FILES)
def player(d):
    srcs = f'<source src="{html.escape(d)}" type="video/mp4">'
    fb = WEBM_DEMO if 'trust-control' in d else WEBM  # respaldo WebM si el navegador no tiene H.264
    srcs += f'<source src="{html.escape(fb)}" type="video/webm">'
    return f'<h3>{html.escape(d)}</h3><video controls preload="metadata">{srcs}</video>'
videos = ''.join(player(d) for d, _, _ in FILES if d.endswith('.mp4'))
imgs = ''.join(f'<img src="{html.escape(d)}" alt="{html.escape(d)}">' for d, _, _ in FILES if d.endswith('.png'))
INDEX = f'''<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>TRUST × McDonald's — kit offline</title>
<style>body{{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0 auto;max-width:1100px;padding:24px}}
a{{color:#FFC72C}}table{{border-collapse:collapse;width:100%}}td{{border-bottom:1px solid #333;padding:6px;vertical-align:top}}
video,img{{width:100%;margin:8px 0 20px}}.r{{background:#5a1010;padding:10px;border-radius:6px}}</style></head><body>
<h1>TRUST × McDonald's — kit offline</h1>
<p class="r"><b>{html.escape(LABEL)}.</b> Fachada RGBW, reloj y sincronía entre sistemas son <b>simulación</b>: no están integrados ni medidos.
La grabación de TRUST CONTROL es software real en entorno de prueba local, sin pantallas ni equipos conectados.</p>
<p>Abrí este archivo con doble clic; todo funciona sin internet. Si un video no reproduce en el navegador, abrilo con VLC o el reproductor del sistema; el alternativo 720p es el más compatible.</p>
<table>{rows}</table><h2>Videos</h2>{videos}<h2>Imágenes</h2>{imgs}</body></html>'''
open(os.path.join(P, 'index.html'), 'w', encoding='utf-8').write(INDEX)

LEEME = f'''TRUST × McDonald's — kit offline (#73)

{LABEL}.
Fachada RGBW, reloj y sincronía: SIMULACIÓN, no integrados ni medidos.
TRUST CONTROL: software real grabado en entorno de prueba local; sin pantallas ni equipos conectados.
Sin precios ni datos de audiencia. El guion (pdf/03) es de uso interno.

Cómo usar sin internet: abrir index.html, o los archivos directo (VLC recomendado para video).
Integridad: SHA256SUMS.txt  →  sha256sum -c SHA256SUMS.txt   (macOS: shasum -a 256 -c SHA256SUMS.txt)

Contenido:
''' + ''.join(f'- {d}: {t}\n' for d, _, t in FILES) + '''
Regenerar desde el repo (rama kit/73-mcd): python3 -I kit/mcd-73/paquete.py <dir_salida>
'''
open(os.path.join(P, 'LEEME.txt'), 'w', encoding='utf-8').write(LEEME)

sums = []
for root, _, fs in os.walk(P):
    for f in sorted(fs):
        fp = os.path.join(root, f)
        rel = os.path.relpath(fp, P)
        sums.append(f'{hashlib.sha256(open(fp, "rb").read()).hexdigest()}  {rel}')
open(os.path.join(P, 'SHA256SUMS.txt'), 'w').write('\n'.join(sorted(sums, key=lambda l: l[66:])) + '\n')

Z = os.path.join(OUT, NAME + '.zip')
if os.path.exists(Z):
    os.remove(Z)
with zipfile.ZipFile(Z, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, fs in os.walk(P):
        for f in sorted(fs):
            fp = os.path.join(root, f)
            z.write(fp, os.path.join(NAME, os.path.relpath(fp, P)))
print(Z)
