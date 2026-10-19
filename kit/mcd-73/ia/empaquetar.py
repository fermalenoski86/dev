"""Empaqueta piezas generadas (ia/73-salida/<corrida>/) para TRUST Control offline.
Escribe control/piezas_ia.js con las imágenes (y el clip, si hay) embebidos como data: URI: abriendo el kit con
doble clic (file://) una imagen suelta «ensucia» el lienzo y el navegador bloquea leer sus colores; embebidas no.
Uso: python3 -I empaquetar.py <carpeta_corrida> <control/piezas_ia.js> [pieza1,pieza2,…]"""
import base64, json, os, subprocess, sys, tempfile

ent, sal = sys.argv[1], sys.argv[2]
elegidas = sys.argv[3].split(',') if len(sys.argv) > 3 else None
piezas = []
for pid in sorted(os.listdir(ent)):
    d = os.path.join(ent, pid)
    if not os.path.isdir(d) or (elegidas and pid not in elegidas): continue
    plan = json.load(open(os.path.join(d, 'plan.json')))
    p = {'id': pid, 'titulo': plan.get('titulo', pid), 'concepto': plan.get('concepto', ''), 'ficha': plan.get('ficha', {}), 'pantallas': {}}
    for pan in ('corrientes', 'pellegrini', 'media'):
        f = os.path.join(d, f'{pan}.jpg')
        if os.path.exists(f): p['pantallas'][pan] = 'data:image/jpeg;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
        v = os.path.join(d, f'{pan}-video.mp4')
        if os.path.exists(v):   # el clip original pesa ~20 MB: se recodifica a 2× la pantalla en VP9 (Chrome/Edge lo leen; ~1–2 MB)
            ancho = {'corrientes': 1152, 'pellegrini': 1440, 'media': 1920}[pan]
            with tempfile.TemporaryDirectory() as tmp:
                o = os.path.join(tmp, 'v.mp4')
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', v, '-vf', f'scale={ancho}:-2', '-an', '-c:v', 'libvpx-vp9',
                                '-b:v', '0', '-crf', '36', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', o], check=True)
                p['pantallas'][pan + '_video'] = 'data:video/mp4;base64,' + base64.b64encode(open(o, 'rb').read()).decode()
    piezas.append(p)
with open(sal, 'w') as fo:
    fo.write('// Generado por ia/empaquetar.py — piezas creadas con IA (Claude director + fal). SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar.\n')
    fo.write('window.PIEZAS_IA = ' + json.dumps(piezas, ensure_ascii=False) + ';\n')
print(f'{len(piezas)} piezas → {sal} ({os.path.getsize(sal) / 1e6:.1f} MB)')
