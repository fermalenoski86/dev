"""Visual polish (brief MASTER OF TRUST, 14/10): capturas comparativas ANTES | DESPUÉS con el mismo encuadre + vistas Operador y Cliente.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/comparativa_polish.py <dir_salida> <dir_control_antes>
Genera: par-1-arquitectonica · par-2-takeover · par-3-firma · par-4-noche-idle (ANTES | DESPUÉS, rotulados),
5-vista-operador · 6-vista-cliente · 7-diagnostico, y comparativa-polish.jpg (los 4 pares). Chromium offline 1920×1080."""
import sys, os, asyncio
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
SIN_T = 'TRUST.motor.setTransicion && TRUST.motor.setTransicion(0); '
PARES = [
    ('par-1-arquitectonica', 'Arquitectónica cálida', "TRUST.motor.setEscena('arquitectonica')", "TRUST.motor.setEscena('arquitectonica')"),
    ('par-2-takeover', "McDonald's · takeover", 'TRUST.motor.cargarShow(); TRUST.motor.seek(8.3)', 'TRUST.motor.cargarShow(); TRUST.motor.seek(7.6)'),
    ('par-3-firma', "McDonald's · cierre de marca", 'TRUST.motor.cargarShow(); TRUST.motor.seek(12.4)', 'TRUST.motor.cargarShow(); TRUST.motor.seek(11.6)'),
    ('par-4-noche-idle', 'Noche sin campaña', "TRUST.motor.setEscena('arquitectonica')", "TRUST.motor.setEscena('nocheIdle')"),
]
try: F = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', 28)
except OSError: F = ImageFont.load_default()

async def tomar(pg, ctl, accion, recorte=True, previo=''):
    await pg.goto('file://' + os.path.join(os.path.abspath(ctl), 'index.html'))
    await pg.wait_for_function('window.TRUST && TRUST.info().W > 0')
    await pg.add_style_tag(content='#portada{display:none!important} #marca-sel{display:none!important}')
    if previo: await pg.evaluate(previo); await pg.wait_for_timeout(200)
    await pg.evaluate(SIN_T + "TRUST.motor.setVista('noche'); " + accion)
    await pg.wait_for_timeout(500)
    await pg.screenshot(path='/tmp/_toma.png')
    im = Image.open('/tmp/_toma.png').convert('RGB')
    if not recorte: return im
    # mismo encuadre en ambas versiones: se recorta a la FOTO (el lienzo), sin interfaz, y se lleva a un tamaño común
    r = await pg.evaluate('(() => { const b = document.getElementById("lienzo").getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); })()')
    c = im.crop(tuple(r)); h = 866; w = round(c.width * h / c.height)   # mismo alto, sin deformar (los encuadres tienen proporciones distintas)
    c = c.resize((w, h), Image.LANCZOS); lienzo_ = Image.new('RGB', (1280, h), (5, 9, 19)); lienzo_.paste(c, ((1280 - w) // 2, 0)); return lienzo_

async def main(out, antes):
    os.makedirs(out, exist_ok=True)
    pares = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080})
        pg = await ctx.new_page()
        for nombre, rot, acc_a, acc_d in PARES:
            a_ = await tomar(pg, antes, acc_a); d_ = await tomar(pg, AQUI, acc_d)
            w, h = a_.size
            par = Image.new('RGB', (w * 2 + 10, h + 56), (11, 18, 32)); par.paste(a_, (0, 56)); par.paste(d_, (w + 10, 56))
            dr = ImageDraw.Draw(par); dr.text((16, 12), 'ANTES · ' + rot, fill=(169, 180, 199), font=F); dr.text((w + 26, 12), 'DESPUÉS · ' + rot, fill=(232, 182, 91), font=F)
            par.save(os.path.join(out, nombre + '.jpg'), quality=86); pares.append(par); print('OK', nombre)
        op = await tomar(pg, AQUI, "TRUST.motor.cargarShow(); TRUST.motor.seek(7.6); document.querySelector('.zsel[data-z=ochava]').click(); document.getElementById('panel').scrollTop = 560", False)
        op.save(os.path.join(out, '5-vista-operador.jpg'), quality=88); print('OK operador')
        cl = await tomar(pg, AQUI, 'TRUST.motor.cargarShow(); TRUST.motor.seek(7.6)', False, "document.getElementById('m-cliente').click()")
        cl.save(os.path.join(out, '6-vista-cliente.jpg'), quality=88); print('OK cliente')
        dg = await tomar(pg, AQUI, "TRUST.motor.setEscena('diagnostico')", False)
        dg.save(os.path.join(out, '7-diagnostico.jpg'), quality=88); print('OK diagnóstico')
        await b.close()
    w, h = pares[0].size
    g = Image.new('RGB', (w, h * 4 + 30), (11, 18, 32))
    for i, im in enumerate(pares): g.paste(im, (0, i * (h + 10)))
    g = g.resize((w // 2, (h * 4 + 30) // 2))
    g.save(os.path.join(out, 'comparativa-polish.jpg'), quality=86); print('OK comparativa-polish.jpg')

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2]))
