"""Respaldo en video del show «McDonald's Takeover 15 s» tal como corre en TRUST Control (#73), en Chromium SIN red.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/grabar_show.py <dir_trabajo> <salida.mp4> [A|B|C] [cliente]
  A/B/C = creatividad de pantallas (default C · Iconic moment). «cliente» = graba en modo Cliente (sin controles técnicos)
  y recorta el video a la foto: es la pieza para mostrar el contenido de las pantallas.
Se opera con CLICS reales (Comenzar → vista Noche → Generar minishow (simulado) → Play). requestAnimationFrame se
reemplaza (solo en esta grabación, por init script) por uno de tiempo virtual: cada cuadro entrega exactamente 40 ms
(25 fps), así que el video es determinista y no depende de la velocidad de la máquina. Al final, «Restaurar niveles» + escena Arquitectónica (2 s). No toca app.js ni motor.js.
Es el respaldo si el navegador falla en la reunión; el rótulo SIMULACIÓN CONCEPTUAL de la interfaz queda en cuadro."""
import sys, os, asyncio, subprocess, shutil
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
FPS, PASO = 25, 40  # ms por cuadro
RAF_VIRTUAL = '''(() => {
  let t = 0, cola = [];
  window.requestAnimationFrame = (f) => { cola.push(f); return cola.length; };
  window.cancelAnimationFrame = () => {};
  window.__paso = (ms) => { t += ms; const c = cola; cola = []; c.forEach((f) => f(t)); };
})();'''

async def main(trabajo, salida, creatividad, cliente):
    cuadros = os.path.join(trabajo, 'cuadros')
    shutil.rmtree(cuadros, ignore_errors=True); os.makedirs(cuadros)
    n = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080})
        pg = await ctx.new_page()
        reqs, errs = [], []
        pg.on('request', lambda r: reqs.append(r.url) if not r.url.startswith('file://') else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script(RAF_VIRTUAL)
        await pg.goto('file://' + os.path.join(AQUI, 'index.html'))
        await pg.wait_for_function('window.__paso(40) || (window.TRUST && TRUST.info().W > 0)', polling=100)
        await pg.click('#comenzar'); await pg.evaluate('window.__paso(800)'); await pg.wait_for_timeout(800)
        await pg.click('#g-cerrar'); await pg.click('#v-noche')

        async def grabar(ms):
            nonlocal n
            for _ in range(ms // PASO):
                await pg.evaluate(f'window.__paso({PASO})')
                await pg.screenshot(path=os.path.join(cuadros, f'{n:05d}.png')); n += 1

        await pg.click(f'#creatividad button[data-v="{creatividad}"]')
        caja = None
        if cliente:
            await pg.click('#m-cliente'); await pg.evaluate('window.__paso(40)'); await pg.wait_for_timeout(300)
            await pg.add_style_tag(content='.etiqueta,.marca-sel{display:none!important}')
            caja = await pg.evaluate('(() => { const r = document.getElementById("lienzo").getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); })()')
            await pg.click('#cliente-bar button[data-c="normal"]'); await grabar(1500)
            await pg.click('#cliente-bar button[data-c="takeover"]'); await grabar(15000 + 600)
            t = await pg.evaluate('TRUST.motor.estado().show.t')
            await grabar(1200)
        else:
            await pg.click('#generar'); await grabar(1500)              # plan cargado, en pausa en t=0
            await pg.click('#play'); await grabar(15000 + 600)          # show completo + fin
            t = await pg.evaluate('TRUST.motor.estado().show.t')
            await pg.click('#restaurar')
            await pg.click('#escenas button[data-e="arquitectonica"]')
            await grabar(2000)
        await b.close()
    filtro = ['-vf', f'crop={caja[2] // 2 * 2}:{caja[3] // 2 * 2}:{caja[0]}:{caja[1]}'] if caja else []
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(cuadros, '%05d.png'), *filtro,
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    salida], check=True)
    print(f'cuadros={n} fps={FPS} t_final_show={t:.2f} red_externa={len(reqs)} errores={len(errs)}')
    if reqs or errs or t < 14.99: sys.exit(1)

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'C', len(sys.argv) > 4 and sys.argv[4] == 'cliente'))
