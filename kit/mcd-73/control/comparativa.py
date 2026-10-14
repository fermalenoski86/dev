"""Comparativa de iluminación de TRUST Control: mismas capturas, MISMO encuadre, para elegir el look (auditoría Fer + ChatGPT, 14/10).
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/comparativa.py <dir_salida> [<dir_control_antes>]
Genera en <dir_salida>:
  1-arquitectonica-calida.jpg · 2-takeover-mcdonalds.jpg (show a los 8,3 s) · 3-blanco-arquitectonico.jpg ·
  4-luces-apagadas-pantallas-encendidas.jpg · y, con <dir_control_antes>, las mismas 4 escenas de esa versión (antes-*.jpg)
  y un par ACTUAL | MEJORADA por escena (par-*.jpg)
  + comparativa.jpg (las 4 en una grilla 2×2, recorte del escenario).
Chromium offline, 1920×1080, sin red. Solo cambia la escena: vista Noche, mismas dimensiones, mismo encuadre."""
import sys, os, asyncio
from playwright.async_api import async_playwright
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
ESCENAS = [
    ('1-arquitectonica-calida', "TRUST.motor.setEscena('arquitectonica')"),
    ('2-takeover-mcdonalds', 'TRUST.motor.cargarShow(); TRUST.motor.seek(8.3)'),
    ('3-blanco-arquitectonico', "TRUST.motor.setEscena('blanco')"),
    ('4-luces-apagadas-pantallas-encendidas', "TRUST.motor.setEscena('apagado')"),
]

async def capturar(pg, url, accion, destino):
    await pg.goto(url)
    await pg.wait_for_function('window.TRUST && TRUST.info().W > 0')
    await pg.add_style_tag(content='#portada{display:none!important} #marca-sel{display:none!important}')
    await pg.evaluate("TRUST.motor.setVista('noche'); " + accion)
    await pg.wait_for_timeout(500)
    await pg.screenshot(path=destino + '.png')
    Image.open(destino + '.png').convert('RGB').save(destino + '.jpg', quality=88)
    os.remove(destino + '.png')

async def main(out, antes):
    os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080})
        pg = await ctx.new_page()
        url = 'file://' + os.path.join(AQUI, 'index.html')
        for nombre, accion in ESCENAS:
            await capturar(pg, url, accion, os.path.join(out, nombre))
            print('OK', nombre)
        if antes:   # MISMAS escenas, mismo encuadre, con la versión anterior de control/
            for nombre, accion in ESCENAS:
                await capturar(pg, 'file://' + os.path.join(os.path.abspath(antes), 'index.html'), accion, os.path.join(out, 'antes-' + nombre))
                print('OK antes-' + nombre)
        await b.close()
    # grilla 2×2 con el recorte del escenario (misma caja en las 4)
    caja = (14, 106, 1440, 860)
    ims = [Image.open(os.path.join(out, n + '.jpg')).crop(caja) for n, _ in ESCENAS]
    w, h = ims[0].size
    g = Image.new('RGB', (w * 2 + 10, h * 2 + 10), (11, 18, 32))
    for i, im in enumerate(ims):
        g.paste(im, ((i % 2) * (w + 10), (i // 2) * (h + 10)))
    g.save(os.path.join(out, 'comparativa.jpg'), quality=86)
    print('OK comparativa.jpg')
    if antes:   # pares ANTES | DESPUÉS por escena, con rótulo
        from PIL import ImageDraw, ImageFont
        try: f = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', 30)
        except OSError: f = ImageFont.load_default()
        for n, _ in ESCENAS:
            a_, d_ = Image.open(os.path.join(out, 'antes-' + n + '.jpg')).crop(caja), Image.open(os.path.join(out, n + '.jpg')).crop(caja)
            par = Image.new('RGB', (w * 2 + 10, h + 56), (11, 18, 32)); par.paste(a_, (0, 56)); par.paste(d_, (w + 10, 56))
            dr = ImageDraw.Draw(par); dr.text((16, 12), 'ACTUAL', fill=(169, 180, 199), font=f); dr.text((w + 26, 12), 'MEJORADA', fill=(232, 182, 91), font=f)
            par.save(os.path.join(out, 'par-' + n + '.jpg'), quality=86)
            print('OK par-' + n)

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
