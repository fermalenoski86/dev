"""Ensayo del flujo de demo de punta a punta (#73, encargo «AI Show Director», punto 5), en Chromium SIN red.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/ensayo_demo.py <dir_capturas>
Todo se opera con CLICS reales sobre la interfaz, como lo haría Fer en la reunión; el motor solo se LEE para verificar:
  abrir index.html offline → Comenzar → Generar show (arranca solo) → Play → Pausa a mitad del show →
  ajustar UNA sola luminaria (SUP-05 al 20 %) → Reanudar → fin del show → Restaurar niveles + escena arquitectónica.
Deja ENSAYO_DEMO.txt con la salida real y 4 capturas del recorrido."""
import sys, os, asyncio, time
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
fallas, lineas = [], []
def ok(cond, msg):
    linea = ('OK    ' if cond else 'FALLA ') + msg
    print(linea); lineas.append(linea)
    if not cond: fallas.append(msg)

def cambiadas(a, b):
    return [x['id'] for x, y in zip(a['luces'], b['luces']) if x != y]

async def main(out):
    os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080})
        pg = await ctx.new_page()
        reqs, errs = [], []
        pg.on('request', lambda r: reqs.append(r.url))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(str(e)))
        ev = pg.evaluate
        M = 'TRUST.motor'

        # 1. abrir offline
        await pg.goto('file://' + os.path.join(AQUI, 'index.html'))
        await pg.wait_for_function('window.TRUST && TRUST.info().W > 0')
        base = await ev(f'{M}.salidas()')                     # escena arquitectónica de arranque: referencia de la restauración
        ok(await pg.is_visible('#comenzar'), '1. index.html abre sin red y muestra la portada con «Comenzar»')
        await pg.click('#comenzar'); await pg.wait_for_timeout(700)
        await pg.click('#g-cerrar')
        ok(await ev('document.getElementById("portada").classList.contains("fuera")'), '1. «Comenzar» deja ver la consola')

        # 2. Director: generar minishow (simulado)
        await pg.click('#generar')
        sh = await ev(f'{M}.estado().show')
        ok(sh['cargado'] and sh['t'] < 1.5 and sh['reproduciendo'], '2. «Generar show» arma el show y arranca desde 0')
        ok('no es generación por IA' in await ev('document.getElementById("plan").innerText'), '2. el plan en pantalla se rotula como plantilla, no IA')
        await pg.screenshot(path=os.path.join(out, 'ensayo-1-generado.png'))

        # 3. Play
        await pg.click('#play'); t0 = time.monotonic()
        await pg.wait_for_function(f'{M}.estado().show.t >= 6', timeout=12000)
        await pg.click('#pausa')
        sh = await ev(f'{M}.estado().show')
        ok(not sh['reproduciendo'] and 6 <= sh['t'] < 8.5, f'3. Play avanza y Pausa lo frena a mitad del show (t={sh["t"]:.2f} s, momento «Takeover»)')
        ok('Takeover' in await ev('document.getElementById("tl-bloque").innerText'), '3. el timeline muestra el momento en curso')
        t1 = sh['t']; await pg.wait_for_timeout(600)
        ok(await ev(f'{M}.estado().show.t') == t1, '4. en pausa el tiempo no avanza')

        # 4. ajustar UNA sola luminaria con la grilla y el detalle
        antes = await ev(f'{M}.salidas()')
        await pg.click('.equipos-det summary')   # «46 luminarias · control individual»
        await pg.click('#equipos button[data-id="SUP-05"]')
        ok('SUP-05' in await ev('document.getElementById("detalle").innerText'), '4. clic en la grilla abre el detalle de SUP-05')
        await pg.click('#d-20')
        despues = await ev(f'{M}.salidas()')
        cam = cambiadas(antes, despues)
        ok(cam == ['SUP-05'], f'4. SUP-05 al 20 % en pausa: cambia solo SUP-05, las otras 45 iguales ({cam})')
        ok(despues['pantallas'] == antes['pantallas'] and despues['reloj'] == antes['reloj'], '4. pantallas y reloj no se mueven al tocar la luminaria')
        s5a = next(l for l in antes['luces'] if l['id'] == 'SUP-05'); s5d = next(l for l in despues['luces'] if l['id'] == 'SUP-05')
        ok(abs(s5d['nivel'] - 0.2 * s5a['nivel']) < 1e-9, f'4. salida de SUP-05 = show × 20 % ({s5a["nivel"]:.3f} → {s5d["nivel"]:.3f})')
        await pg.screenshot(path=os.path.join(out, 'ensayo-2-pausa-sup05-20.png'))

        # 5. reanudar hasta el final
        await pg.click('#play')
        await pg.wait_for_function(f'{M}.estado().show.t > {t1} + 0.3', timeout=5000)
        ok(await ev(f'{M}.estado().show.reproduciendo'), '5. Play reanuda desde donde se pausó')
        await pg.wait_for_function(f'!{M}.estado().show.reproduciendo', timeout=20000)
        fin = await ev(f'{M}.estado()'); sf = await ev(f'{M}.salidas()')
        ok(fin['show']['t'] == 15, f'5. el show llega a 15 s y se detiene solo ({time.monotonic() - t0:.1f} s de reloj, incluida la pausa)')
        sup = {l['id']: l for l in sf['luces'] if l['grupo'] == 'superior'}
        ok(abs(sup['SUP-05']['nivel'] - 0.2 * sup['SUP-04']['nivel']) < 1e-9 and sup['SUP-04']['nivel'] > 0,
           f'5. el ajuste de SUP-05 se mantuvo durante el resto del show (cierre: {sup["SUP-05"]["nivel"]:.3f} vs SUP-04 {sup["SUP-04"]["nivel"]:.3f})')
        await pg.screenshot(path=os.path.join(out, 'ensayo-3-cierre.png'))

        # 6. cierre y restauración
        await pg.click('#restaurar')
        await pg.click('#escenas button[data-e="arquitectonica"]')
        e = await ev(f'{M}.estado()'); sr = await ev(f'{M}.salidas()')
        ok(all(f['nivel'] == 100 and f['on'] and f['color'] is None for f in e['luces']['fixtures']), '6. «Restaurar niveles»: las 46 vuelven a 100 %, ON y color de escena')
        ok(not e['show']['cargado'] and e['escena'] == 'arquitectonica', '6. escena arquitectónica: el show queda descargado')
        ok(all(sr[k] == base[k] for k in ('luces', 'zonas', 'pantallas', 'reloj')), '6. salidas idénticas a las del arranque (pantallas, 46 luces, zonas y reloj): sin restos del show')
        await pg.screenshot(path=os.path.join(out, 'ensayo-4-restaurado.png'))

        externos = [u for u in reqs if not u.startswith(('file://', 'blob:', 'data:'))]
        ok(not externos, f'0 pedidos de red fuera de file:// ({len(reqs)} pedidos locales)')
        ok(not errs, f'0 errores de consola ({errs[:3]})')
        await b.close()
    lineas.append(f'Resultado: {"TODO OK" if not fallas else str(len(fallas)) + " FALLA(S)"}')
    open(os.path.join(AQUI, 'ENSAYO_DEMO.txt'), 'w', encoding='utf-8').write(
        'Ensayo real del flujo de demo en Chromium offline, solo con clics (python3 -I kit/mcd-73/control/ensayo_demo.py <dir>).\n'
        + '\n'.join(lineas) + '\n')
    print(lineas[-1])
    return 0 if not fallas else 1

if __name__ == '__main__':
    sys.exit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'capturas-ensayo')))
