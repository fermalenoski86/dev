"""Prueba de la consola DMX virtual en Chromium SIN red.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/consola/prueba_consola.py <dir_capturas>
Verifica: 0 pedidos fuera de file://, 0 errores de consola, aviso de posiciones pendientes y capa de luz vacía sin las 46 marcas,
presets/master/zonas cambian el estado y son reversibles, timeline determinista, play avanza el reloj virtual, teclado,
y —con posiciones SINTÉTICAS de prueba que no se guardan— que la luz solo aclara la foto (ningún píxel se oscurece)."""
import sys, os, asyncio, json
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
fallas = []
def ok(cond, msg):
    print(('OK   ' if cond else 'FALLA'), msg)
    if not cond: fallas.append(msg)

async def main(out):
    os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True, viewport={'width': 1600, 'height': 1000})
        pg = await ctx.new_page()
        reqs, errs = [], []
        pg.on('request', lambda r: reqs.append(r.url))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + os.path.join(AQUI, 'consola.html'))
        await pg.wait_for_function('document.getElementById("base").complete && window.consola')
        ev = pg.evaluate

        ok(await ev('document.querySelector(".rotulo").textContent.includes("NO CONECTADO A EQUIPOS REALES")'), 'rótulo SIMULACIÓN / NO CONECTADO visible')
        ok(await ev('!consola.posicionesCompletas()'), 'luminarias.js sin posiciones (no se inventan coordenadas)')
        ok(await ev('!document.getElementById("aviso").classList.contains("oculto")'), 'aviso de posiciones pendientes visible')
        alfa = await ev('(()=>{const c=document.getElementById("luz");const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let s=0;for(let i=3;i<d.length;i+=4)s+=d[i];return s})()')
        ok(alfa == 0, f'sin posiciones la capa de luz queda vacía (suma alfa={alfa})')
        n = await ev('Object.values(consola.snapshot().equipos).map(a=>a.length)')
        ok(n == [16, 16, 14], f'46 equipos virtuales 16/16/14 (leyenda de la imagen anotada) → {n}')
        await pg.screenshot(path=os.path.join(out, '00-sin-posiciones.png'))

        ini = await ev('consola.reset()')
        mcd = await ev('consola.setPreset("mcd")')
        ok(mcd['equipos'] != ini['equipos'], 'preset McDonald\'s cambia los equipos')
        ok(mcd['pantallas']['corrientes'] == 'Marca (mockup)', 'preset McDonald\'s cambia pantallas')
        half = await ev('consola.setMaster(0.5)')
        okhalf = all(abs(h - m * 0.5) < 1e-3 for l in mcd['equipos'] for a, c in zip(mcd['equipos'][l], half['equipos'][l]) for m, h in zip(a, c))
        ok(okhalf, 'master 50% escala exactamente a la mitad')
        cero = await ev('consola.setMaster(0)')
        ok(all(v == 0 for l in cero['equipos'] for a in cero['equipos'][l] for v in a), 'master 0% apaga todo')
        await ev('consola.setMaster(1)')
        z = await ev('consola.setZona("verde",0)')
        ok(all(v == 0 for a in z['equipos']['verde'] for v in a) and any(v > 0 for a in z['equipos']['roja'] for v in a), 'zona inferior a 0% no afecta la superior')
        back = await ev('consola.reset()')
        ok(back == ini, 'reset vuelve exactamente al estado inicial (reversible)')

        await ev('consola.setPreset("takeover")')
        a1 = await ev('consola.seek(7.3)'); a2 = await ev('(consola.seek(2), consola.seek(7.3))')
        ok(a1 == a2, 'timeline determinista: mismo t → mismo estado')
        tr = []
        for t in (1, 4.5, 8, 11.5, 14.9):
            s = await ev(f'consola.seek({t})'); tr.append((t, s['pantallas']['corrientes'], s['reloj']))
        print('     tramos', tr)
        ok([x[1] for x in tr] == ['Negro', 'Cuenta 3·2·1', 'Takeover →', 'Marca (mockup)', 'Contenido habitual'], 'pistas de pantallas siguen los tramos del takeover')
        await ev('consola.seek(0)'); await ev('consola.play()'); await pg.wait_for_timeout(1200); s = await ev('consola.pause()')
        ok(0.8 < s['t'] < 2.0, f'play avanza el reloj virtual (t={s["t"]})')
        await pg.keyboard.press('2'); ok((await ev('consola.snapshot().preset')) == 'mcd', 'tecla 2 → McDonald\'s')
        await pg.keyboard.press('r'); ok((await ev('consola.snapshot()')) == ini, 'tecla R → reset')
        await pg.click('#presets button[data-p="cierre"]'); ok((await ev('consola.snapshot().preset')) == 'cierre', 'botón Cierre')

        # Posiciones SINTÉTICAS solo para probar el render (no se guardan ni representan la fachada).
        sint = {'fuente': 'PRUEBA SINTÉTICA', 'lineas': {
            'roja': {'puntos': [[0.2 + i * 0.04, 0.30] for i in range(16)]},
            'amarilla': {'puntos': [[0.2 + i * 0.04, 0.55] for i in range(16)]},
            'verde': {'puntos': [[0.2 + i * 0.045, 0.80] for i in range(14)]}}}
        await ev(f'consola.setPosiciones({json.dumps(sint)})')
        ok(await ev('consola.posicionesCompletas() && document.getElementById("aviso").classList.contains("oculto")'), 'con 46 marcas se oculta el aviso')
        esc = pg.locator('#escena')
        await ev('consola.setMaster(0)'); apagado = await esc.screenshot()
        await ev('(consola.setMaster(1), consola.setPreset("mcd"))'); prendido = await esc.screenshot()
        from PIL import Image, ImageChops
        import io
        A = Image.open(io.BytesIO(apagado)).convert('RGB'); B = Image.open(io.BytesIO(prendido)).convert('RGB')
        dif_osc = ImageChops.subtract(A, B)  # >0 donde B es más oscuro que A
        mx = max(v for band in dif_osc.getextrema() for v in band)
        dif_cla = ImageChops.subtract(B, A); cambio = max(v for band in dif_cla.getextrema() for v in band)
        ok(mx <= 1, f'la luz nunca oscurece la foto base (máx. oscurecimiento={mx})')
        ok(cambio > 40, f'la luz se ve sobre la foto (máx. aclarado={cambio})')
        await pg.screenshot(path=os.path.join(out, '01-sintetico-mcd.png'))
        await ev('consola.setPreset("takeover")'); await ev('consola.seek(8)'); await pg.screenshot(path=os.path.join(out, '02-sintetico-takeover-8s.png'))

        ext = [u for u in reqs if not u.startswith('file://')]
        ok(ext == [], f'0 pedidos de red ({ext})')
        ok(errs == [], f'0 errores de consola ({errs})')
        await b.close()
    print('\nRESULTADO:', 'TODO OK' if not fallas else f'{len(fallas)} FALLAS')
    sys.exit(1 if fallas else 0)

asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'capturas-consola'))
