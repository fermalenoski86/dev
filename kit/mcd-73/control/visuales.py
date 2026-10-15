"""Visuales estáticos del kit (#73) sacados de TRUST Control tal como corre hoy, en Chromium SIN red.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/visuales.py <dir_trabajo> [A|B|C|D|E|F]
Reemplaza visuales/02-takeover.png, 03-firma-sincronizada.png y 04-brand-reveal.png (los del 13/10 usaban la
geometría vieja y no tenían iluminación arquitectónica). 01-obelisco-noche.png (foto real desde el Obelisco) no se toca.
Modo Cliente, vista Noche, encuadre «Edificio completo», creatividad C por defecto. Tiempo virtual (40 ms por cuadro,
igual que grabar_show.py): cada toma cae siempre en el mismo segundo del show. Cada PNG es 1920×1080: la toma
(foto real + simulación) pegada a la derecha, a altura completa, sin deformar, y el rótulo SIMULACIÓN CONCEPTUAL.
No toca app.js ni motor.js. Escribe control/VISUALES.txt con la salida real."""
import sys, os, asyncio, base64
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(AQUI)
PASO = 40
RAF_VIRTUAL = '''(() => {
  let t = 0, cola = [];
  window.requestAnimationFrame = (f) => { cola.push(f); return cola.length; };
  window.cancelAnimationFrame = () => {};
  window.__paso = (ms) => { for (let i = 0; i < ms / 40; i++) { t += 40; const c = cola; cola = []; c.forEach((f) => f(t)); } };
})();'''
ROTULO = 'SIMULACIÓN CONCEPTUAL — gemelo preliminar · mockup ilustrativo, no publicar'
# (archivo, botón del modo Cliente, ms a avanzar después del clic, epígrafe)
TOMAS = [
    ('04-brand-reveal.png', 'takeover', 4000, 'Brand reveal · segundo 4 del takeover'),
    ('02-takeover.png', 'takeover', 8000, 'Takeover 15 s · pantallas, luminarias y reloj'),
    ('03-firma-sincronizada.png', 'firma', 3000, 'Firma de marca · cierre sincronizado'),
]


def componer(png, epigrafe):
    b64 = base64.b64encode(png).decode()
    return f'''<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://{AQUI}/fuentes.css">
<style>html,body{{margin:0;width:1920px;height:1080px;background:#0b0b0c;overflow:hidden;font-family:Inter,sans-serif}}
img{{position:absolute;top:0;right:0;height:1080px}}
.e{{position:absolute;right:24px;bottom:58px;color:#e9e9ea;font-size:20px;background:rgba(0,0,0,.6);padding:6px 12px;border-radius:4px}}
.r{{position:absolute;right:24px;bottom:18px;color:#fff;font-size:18px;background:rgba(0,0,0,.72);padding:6px 12px;border-radius:4px}}</style>
<img src="data:image/png;base64,{b64}"><div class="e">{epigrafe}</div><div class="r">{ROTULO}</div>'''


async def main(trabajo, creatividad):
    os.makedirs(trabajo, exist_ok=True)
    log = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080}, device_scale_factor=3)
        pg = await ctx.new_page()
        reqs, errs = [], []
        pg.on('request', lambda r: reqs.append(r.url) if not r.url.startswith(('file://', 'data:')) else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script(RAF_VIRTUAL)
        await pg.goto('file://' + os.path.join(AQUI, 'index.html'))
        await pg.wait_for_function('window.__paso(40) || (window.TRUST && TRUST.info().W > 0)', polling=100)
        await pg.click('#comenzar'); await pg.evaluate('window.__paso(800)'); await pg.wait_for_timeout(800)
        await pg.click('#g-cerrar'); await pg.click('#v-noche')
        await pg.click(f'#creatividad button[data-v="{creatividad}"]')
        await pg.click('#m-cliente'); await pg.evaluate('window.__paso(400)'); await pg.wait_for_timeout(300)
        await pg.add_style_tag(content='.etiqueta,.marca-sel{display:none!important}')
        lienzo = pg.locator('#lienzo')
        comp = await (await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)).new_page()
        for nombre, boton, ms, epigrafe in TOMAS:
            await pg.click('#cliente-bar button[data-c="normal"]'); await pg.evaluate('window.__paso(2400)')
            await pg.click(f'#cliente-bar button[data-c="{boton}"]'); await pg.evaluate(f'window.__paso({ms})')
            await pg.wait_for_timeout(200)
            est = await pg.evaluate('(() => { const s = TRUST.motor.estado(); return {t: s.show.t, cargado: s.show.cargado}; })()')
            png = await lienzo.screenshot()
            await comp.set_content(componer(png, epigrafe)); await comp.wait_for_timeout(300)
            dest = os.path.join(KIT, 'visuales', nombre)
            await comp.screenshot(path=dest)
            dim = await comp.evaluate('(() => { const i = document.querySelector("img"); return [i.naturalWidth, i.naturalHeight, Math.round(i.getBoundingClientRect().width)]; })()')
            log.append(f'{nombre}: boton={boton} +{ms} ms show.t={est["t"]} cargado={est["cargado"]} toma={dim[0]}x{dim[1]} px -> {dim[2]}x1080 en el visual')
        await b.close()
    log.append(f'pedidos de red no-file: {len(reqs)} · errores de página: {len(errs)} {errs[:3]}')
    txt = 'Salida real de visuales.py (creatividad ' + creatividad + ')\n' + '\n'.join(log) + '\n'
    open(os.path.join(AQUI, 'VISUALES.txt'), 'w').write(txt)
    print(txt, end='')
    return 0 if not reqs and not errs else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main(sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'C').upper())))
