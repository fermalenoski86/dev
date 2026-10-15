"""Exporta el contenido de las pantallas como VIDEOS REALES por superficie, a la resolución de cada LED (building.ts):
  screen_a (Corrientes) 1152×576 · screen_b (Pellegrini) 1440×576 · master A+B 2592×576 · horizontal 3840×194 (proporción de la banda real; resolución a confirmar)
  + un mosaico de revisión (A | B arriba, horizontal abajo) para ver la pieza completa.
H.264, 25 fps, 15 s, yuv420p. Es el mismo contenido que se ve en la simulación (contenido.js), dibujado cuadro a cuadro a
resolución nativa: no se escala desde la vista previa. SIMULACIÓN: material conceptual, no es un asset aprobado (falta M3A).
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/exportar_pantallas.py <dir_salida> [A B C D E F]"""
import os, sys, asyncio, base64, subprocess, shutil
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
FPS, DUR = 25, 15
SUP = {'screen_a': ('corrientes', 1152, 576), 'screen_b': ('pellegrini', 1440, 576), 'horizontal': ('media', 3840, 194)}
# horizontal: building.ts SUPONE 1920×412, pero la banda real (foto) es ≈ 20:1. Se exporta con esa proporción (3840×194, píxel
# cuadrado) hasta tener la resolución real del controlador de la pantalla existente.
JS = '''async ([sup, cr, n, fps]) => {
  const res = {};
  for (const [k, [id, w, h]] of Object.entries(sup)) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const fr = [];
    for (let i = 0; i < n; i++) {
      CONTENIDO.dibujar(cv, id, { modo: 'show', t: i / fps, creatividad: cr });
      fr.push(cv.toDataURL('image/jpeg', 0.96).split(',')[1]);
    }
    res[k] = fr;
  }
  return res;
}'''

def ffmpeg(patron, salida, extra=()):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', patron, *extra, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', salida], check=True)

async def main(out, creatividades):
    os.makedirs(out, exist_ok=True)
    n = FPS * DUR
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context(offline=True)).new_page()
        await pg.goto('file://' + os.path.join(AQUI, 'index.html'))
        await pg.wait_for_function('window.CONTENIDO && window.TRUST')
        for cr in creatividades:
            tmp = os.path.join(out, f'_cuadros_{cr}'); shutil.rmtree(tmp, ignore_errors=True)
            for k in SUP: os.makedirs(os.path.join(tmp, k))
            for ini in range(0, n, 75):   # de a 3 s para no saturar la memoria
                parte = await pg.evaluate(JS.replace('i < n', 'i < Math.min(n, ' + str(ini + 75) + ')').replace('let i = 0', 'let i = ' + str(ini)), [SUP, cr, n, FPS])
                for k, fr in parte.items():
                    for j, d in enumerate(fr): open(os.path.join(tmp, k, f'{ini + j:04d}.jpg'), 'wb').write(base64.b64decode(d))
            dst = os.path.join(out, cr); os.makedirs(dst, exist_ok=True)
            for k in SUP: ffmpeg(os.path.join(tmp, k, '%04d.jpg'), os.path.join(dst, f'{k}.mp4'))
            # master A+B (2592×576): A a la izquierda, B a la derecha, sincronizados por construcción
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(tmp, 'screen_a', '%04d.jpg'), '-framerate', str(FPS), '-i', os.path.join(tmp, 'screen_b', '%04d.jpg'),
                            '-filter_complex', 'hstack=inputs=2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', os.path.join(dst, 'master_AB.mp4')], check=True)
            # mosaico de revisión 1920 de ancho: A | B arriba (escalados a 1920 de ancho total), horizontal abajo
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(tmp, 'screen_a', '%04d.jpg'), '-framerate', str(FPS), '-i', os.path.join(tmp, 'screen_b', '%04d.jpg'),
                            '-framerate', str(FPS), '-i', os.path.join(tmp, 'horizontal', '%04d.jpg'),
                            '-filter_complex', '[0][1]hstack=inputs=2,scale=1920:-2,pad=1920:ih+24:0:0:color=0x0B1220[arriba];[2]scale=1920:-2[abajo];[arriba][abajo]vstack=inputs=2,pad=1920:ih+48:0:24:color=0x0B1220',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', os.path.join(out, f'mosaico-{cr}.mp4')], check=True)
            shutil.rmtree(tmp)
            print('OK', cr)
        await b.close()

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2:] or ['A', 'B', 'C', 'D', 'E', 'F']))
