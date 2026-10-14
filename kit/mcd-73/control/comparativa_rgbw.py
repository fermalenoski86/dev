"""Comparativa del ajuste fino RGBW (Fer, 14/10): mismo encuadre, misma configuración de pantallas.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/comparativa_rgbw.py <dir_salida> <dir_control_antes>
Genera: 1-arquitectonica-actual · 2-arquitectonica-haces-definidos · 3-mcdonalds-rgbw · 4-tres-luminarias-color
(cada una rotulada) + comparativa-rgbw.jpg (grilla 2×2). Chromium offline, 1920×1080, vista Noche, sin red."""
import sys, os, asyncio
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
TRES = "TRUST.motor.setEscena('arquitectonica'); TRUST.motor.setFixtureColor('SUP-04',{r:0,g:.25,b:1,w:0}); TRUST.motor.setFixtureColor('SUP-11',{r:0,g:1,b:.15,w:0}); TRUST.motor.setFixtureColor('MED-08',{r:1,g:0,b:.75,w:0})"
CAJA = (14, 106, 1440, 860)

async def capturar(pg, ctl, accion, destino):
    await pg.goto('file://' + os.path.join(os.path.abspath(ctl), 'index.html'))
    await pg.wait_for_function('window.TRUST && TRUST.info().W > 0')
    await pg.add_style_tag(content='#portada{display:none!important} #marca-sel{display:none!important}')
    await pg.evaluate("TRUST.motor.setVista('noche'); " + accion)
    await pg.wait_for_timeout(500)
    await pg.screenshot(path=destino + '.png')
    im = Image.open(destino + '.png').convert('RGB'); os.remove(destino + '.png')
    return im.crop(CAJA)

async def main(out, antes):
    os.makedirs(out, exist_ok=True)
    tomas = [('1-arquitectonica-actual', '1 · Arquitectónica cálida — ACTUAL', antes, "TRUST.motor.setEscena('arquitectonica')"),
             ('2-arquitectonica-haces-definidos', '2 · Arquitectónica cálida — haces más definidos', AQUI, "TRUST.motor.setEscena('arquitectonica')"),
             ('3-mcdonalds-rgbw', "3 · McDonald's — RGBW mejorado (show 8,3 s)", AQUI, 'TRUST.motor.cargarShow(); TRUST.motor.seek(8.3)'),
             ('4-tres-luminarias-color', '4 · SUP-04 azul · SUP-11 verde · MED-08 magenta — las otras 43 intactas', AQUI, TRES)]
    try: f = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', 28)
    except OSError: f = ImageFont.load_default()
    ims = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080})
        pg = await ctx.new_page()
        for nombre, rot, ctl, acc in tomas:
            im = await capturar(pg, ctl, acc, os.path.join(out, nombre))
            w, h = im.size
            r = Image.new('RGB', (w, h + 52), (11, 18, 32)); r.paste(im, (0, 52))
            ImageDraw.Draw(r).text((16, 10), rot, fill=(232, 182, 91) if ctl == AQUI else (169, 180, 199), font=f)
            r.save(os.path.join(out, nombre + '.jpg'), quality=88); ims.append(r); print('OK', nombre)
        await b.close()
    w, h = ims[0].size
    g = Image.new('RGB', (w * 2 + 10, h * 2 + 10), (11, 18, 32))
    for i, im in enumerate(ims): g.paste(im, ((i % 2) * (w + 10), (i // 2) * (h + 10)))
    g.save(os.path.join(out, 'comparativa-rgbw.jpg'), quality=86); print('OK comparativa-rgbw.jpg')

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2]))
