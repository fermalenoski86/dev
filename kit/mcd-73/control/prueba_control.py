"""Prueba de TRUST Control (simulación offline) en Chromium SIN red.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/prueba_control.py <dir_capturas>
Cubre las validaciones obligatorias del pedido de Fer (14/10/2026):
  foto sin deformar · 3 superficies LED en su lugar (geometría = composition.ts aprobada) · ningún halo sobre pantallas ·
  Día/Noche conserva intensidades · dimmers de luces y pantallas independientes · una luminaria al 20 % sin tocar las otras 45 ·
  funciona sin internet · no emite DMX/Art-Net/sACN/NovaStar · rótulo de simulación.
Las pruebas de píxeles usan --allow-file-access-from-files (solo para leer el lienzo en la prueba; la demo no lo necesita).
Las posiciones de luz usadas en la prueba de halos son SINTÉTICAS y no se guardan."""
import sys, os, re, json, asyncio, hashlib
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..', '..'))
fallas, lineas = [], []
def ok(cond, msg):
    linea = ('OK    ' if cond else 'FALLA ') + msg
    print(linea); lineas.append(linea)
    if not cond: fallas.append(msg)

def estatico():
    codigo = ''
    for n in ('index.html', 'app.js', 'motor.js', 'geometria.js', 'luminarias.js', 'estilo.css'):
        codigo += open(os.path.join(AQUI, n), encoding='utf-8').read()
    red = re.findall(r'\b(fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|sendBeacon|importScripts)\s*\(|(?:src|href)\s*=\s*"(?:https?:)?//', codigo)
    ok(not red, f'código sin APIs de red ni recursos externos ({red or "ninguno"})')
    dmx = re.findall(r'(dgram|6454|5568|createSocket|navigator\.serial|navigator\.usb)', codigo)
    ok(not dmx, f'código sin sockets, puertos Art-Net (6454) / sACN (5568), serie ni USB ({dmx or "ninguno"})')
    # la geometría publicada coincide con la aprobada en composition.ts
    src = open(os.path.join(RAIZ, 'packages/experience-core/src/composition.ts')).read()
    blk = src[src.index('HERO_CORNER: {'):src.index('CORRIENTES: {')]
    nums = [float(x) for x in re.findall(r'q\(\[([\d.]+), ([\d.]+)\], \[([\d.]+), ([\d.]+)\], \[([\d.]+), ([\d.]+)\], \[([\d.]+), ([\d.]+)\]\)', blk[:blk.index('lights')] + blk[blk.index('clock'):]) for x in x]
    return nums

async def main(out):
    os.makedirs(out, exist_ok=True)
    nums_aprobados = estatico()
    sha_foto = hashlib.sha256(open(os.path.join(AQUI, 'fotos/trust-noche.jpg'), 'rb').read()).hexdigest()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--allow-file-access-from-files'])
        ctx = await b.new_context(offline=True, viewport={'width': 1920, 'height': 1080})
        pg = await ctx.new_page()
        reqs, errs = [], []
        pg.on('request', lambda r: reqs.append(r.url))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + os.path.join(AQUI, 'index.html'))
        await pg.wait_for_function('window.TRUST && TRUST.info().W > 0')
        ev = pg.evaluate

        # --- rótulo y estado honesto
        ok(await ev('document.querySelector(".rotulo").textContent.includes("SIMULACIÓN CONCEPTUAL — NO CONECTADA A EQUIPOS REALES")'), 'rótulo «SIMULACIÓN CONCEPTUAL — NO CONECTADA A EQUIPOS REALES» visible')
        txt = await ev('document.body.innerText')
        ok('Sistema Online' not in txt and 'Enviar show' not in txt and 'control.trust.local' not in txt, 'no dice «Sistema Online», «Enviar show» ni control.trust.local')
        ok('Simulación offline' in txt, 'estado del header: «Simulación offline»')

        # --- foto sin deformar
        g = await ev('GEOMETRIA')
        ok(g['foto']['noche']['sha256'] == sha_foto, f'geometría atada a la foto exacta (sha256 {sha_foto[:12]}…)')
        inf = await ev('TRUST.info()')
        ar = inf['cssW'] / inf['cssH']
        ok(abs(inf['cssH'] - inf['cssW'] * 1733 / 2560) <= 0.5, f'foto sin deformar: proporción en pantalla {ar:.4f} vs original {2560/1733:.4f}')
        await ev('document.getElementById("portada").classList.add("fuera")')

        # --- superficies LED
        q = g['superficies']; nums_pub = []
        for s in ('corrientes', 'pellegrini'): nums_pub += [v for pt in q[s]['quads'][0] for v in pt]
        for qd in q['media']['quads']: nums_pub += [v for pt in qd for v in pt]
        nums_pub += [v for pt in g['reloj']['quad'] for v in pt]
        ok(nums_pub == nums_aprobados, f'pantallas y reloj = geometría aprobada en composition.ts ({len(nums_pub)} coordenadas idénticas)')
        cx = lambda qd: sum(p[0] for p in qd) / 4
        ok(cx(q['corrientes']['quads'][0]) < cx(q['pellegrini']['quads'][0]), 'Corrientes a la izquierda, Pellegrini a la derecha')
        ok(len(q['media']['quads']) == 24, 'pantalla media: 24 tramos de la curva de la ochava')

        # --- independencia y niveles (motor)
        M = 'TRUST.motor'
        await ev(f'{M}.reiniciarTodo()')
        base = await ev(f'{M}.salidas()')
        await ev(f'{M}.setPantalla("master", 20)')
        s = await ev(f'{M}.salidas()')
        ok(s['luces'] == base['luces'] and s['reloj'] == base['reloj'], 'pantallas al 20 %: luminarias y reloj sin cambios')
        ok(abs(s['pantallas']['corrientes'] - 0.2) < 1e-9, 'pantallas al 20 %: salida de Corrientes 0,20')
        await ev(f'{M}.setPantalla("master", 100); {M}.setLucesMaster(0)')
        s = await ev(f'{M}.salidas()')
        ok(s['pantallas'] == base['pantallas'], 'luces al 0 %: pantallas sin cambios')
        ok(all(l['nivel'] == 0 for l in s['luces']), 'luces al 0 %: las 46 salidas en 0')
        await ev(f'{M}.setFixture("MED-07", 35)')
        await ev(f'{M}.setLucesMaster(100)')
        s = await ev(f'{M}.salidas()')
        med7 = next(l for l in s['luces'] if l['id'] == 'MED-07')
        ok(abs(med7['nivel'] - 0.85 * 0.35) < 1e-9, 'master 0 → 100 restaura el ajuste individual (MED-07 35 %)')
        await ev(f'{M}.reiniciarTodo()')
        antes = await ev(f'{M}.salidas()')
        await ev(f'{M}.setFixture("SUP-01", 20)')
        despues = await ev(f'{M}.salidas()')
        cambiadas = [a['id'] for a, d in zip(antes['luces'], despues['luces']) if a != d]
        ok(cambiadas == ['SUP-01'], f'SUP-01 al 20 %: cambia solo SUP-01, las otras 45 iguales ({cambiadas})')
        sup1 = next(l for l in despues['luces'] if l['id'] == 'SUP-01')
        ok(abs(sup1['nivel'] - 0.85 * 0.2) < 1e-9, 'SUP-01 al 20 %: salida = escena 85 % × 20 %')
        await ev(f'{M}.setGrupo("medio", 50)')
        d2 = await ev(f'{M}.salidas()')
        cambiadas = sorted({l['grupo'] for a, l in zip(despues['luces'], d2['luces']) if a != l})
        ok(cambiadas == ['medio'] and sum(1 for a, l in zip(despues['luces'], d2['luces']) if a != l) == 16, 'nivel medio al 50 %: cambian solo sus 16')
        n = await ev(f'{M}.estado().luces.fixtures.reduce((a,f)=>(a[f.grupo]=(a[f.grupo]||0)+1,a),{{}})')
        ok(n == {'superior': 16, 'medio': 16, 'inferior': 14}, f'46 luminarias 16/16/14 → {n}')
        # Día/Noche conserva todo
        await ev(f'{M}.setPantalla("pellegrini", 63); {M}.setReloj(41); {M}.setFixtureColor("INF-03", {{r:0,g:.5,b:1,w:0}})')
        e1 = await ev(f'{M}.estado()'); s1 = await ev(f'{M}.salidas()')
        await ev(f'{M}.setVista("dia")'); e2 = await ev(f'{M}.estado()'); s2 = await ev(f'{M}.salidas()')
        await ev(f'{M}.setVista("noche")'); e3 = await ev(f'{M}.estado()')
        e1.pop('vista'); e2.pop('vista'); e3.pop('vista')
        ok(e1 == e2 == e3 and s1 == s2, 'Día ↔ Noche: niveles, colores y salidas idénticos')
        # escenas y show no pisan ajustes individuales
        await ev(f'{M}.setEscena("mcd"); {M}.cargarShow(); {M}.seek(9); {M}.setEscena("cierre")')
        f1 = await ev(f'{M}.estado().luces.fixtures.find(f=>f.id==="SUP-01").nivel')
        ok(f1 == 20, 'preset → show → cierre: el ajuste individual de SUP-01 (20 %) se conserva')
        await ev(f'{M}.restaurarNiveles()')
        e = await ev(f'{M}.estado()')
        ok(all(f['nivel'] == 100 and f['on'] and f['color'] is None for f in e['luces']['fixtures']) and e['pantallas']['master'] == 100, '«Restaurar niveles» deja todo en 100 % y color de escena')
        # blackout
        await ev(f'{M}.setBlackout(true)'); s = await ev(f'{M}.salidas()')
        ok(all(l['nivel'] == 0 for l in s['luces']) and all(v == 0 for v in s['pantallas'].values()) and s['reloj']['nivel'] == 0, 'blackout: pantallas, luces y reloj en 0')
        await ev(f'{M}.setBlackout(false)'); s = await ev(f'{M}.salidas()')
        ok(s['pantallas']['corrientes'] == 1 and all(l['nivel'] > 0 for l in s['luces']), 'soltar blackout recupera los niveles')
        # show determinista
        await ev(f'{M}.cargarShow(); {M}.seek(5.5)'); a = await ev(f'{M}.salidas()')
        await ev(f'{M}.seek(12); {M}.seek(5.5)'); b2 = await ev(f'{M}.salidas()')
        ok(a == b2, 'show determinista: el mismo t da exactamente la misma salida')
        await ev(f'{M}.seek(0); {M}.play()'); await pg.wait_for_timeout(1200)
        t = await ev(f'{M}.estado().show.t')
        ok(0.8 < t < 1.8, f'Play avanza el reloj del show (t={t:.2f} s tras 1,2 s)')
        await ev(f'{M}.pausa()'); t1 = await ev(f'{M}.estado().show.t'); await pg.wait_for_timeout(500); t2 = await ev(f'{M}.estado().show.t')
        ok(t1 == t2, 'Pausa congela el show')
        await ev(f'{M}.seek(14.9); {M}.play()'); await pg.wait_for_timeout(600)
        e = await ev(f'{M}.estado().show')
        ok(e['t'] == 15 and not e['reproduciendo'], 'el show termina en 15 s y se detiene')
        s = await ev(f'{M}.seek(4); {M}.salidas().luces')
        sup = [l['nivel'] for l in s if l['grupo'] == 'superior']
        ok(sup[0] > sup[-1], 'a los 4 s la ola roja avanzó desde Corrientes (izquierda) hacia Pellegrini')

        # --- píxeles: ningún halo sobre pantallas
        await ev(f'{M}.reiniciarTodo(); {M}.setEscena("blanco")')
        sint = {}
        for sid in ('corrientes', 'pellegrini'):
            qd = q[sid]['quads'][0]
            for k, (x, y) in enumerate(qd + [[sum(p[0] for p in qd) / 4, sum(p[1] for p in qd) / 4]]):
                sint[f'SUP-{len(sint)+1:02d}'] = [x, y + 0.01]
        for k, qd in enumerate(q['media']['quads'][::3]):
            sint[f'INF-{k+1:02d}'] = [qd[0][0], qd[0][1] - 0.005]
        await ev(f'TRUST.usarPuntosDePrueba({json.dumps(sint)})')
        muestras = []
        for sid in ('corrientes', 'pellegrini', 'media'):
            for qd in q[sid]['quads'][:: (1 if sid != 'media' else 4)]:
                for u in (0.15, 0.5, 0.85):
                    for v in (0.2, 0.5, 0.8):
                        top = [qd[0][0] + (qd[1][0] - qd[0][0]) * u, qd[0][1] + (qd[1][1] - qd[0][1]) * u]
                        bot = [qd[3][0] + (qd[2][0] - qd[3][0]) * u, qd[3][1] + (qd[2][1] - qd[3][1]) * u]
                        muestras.append([top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v])
        prender = f'{M}.setLucesMaster(100)'; apagar = f'{M}.setLucesMaster(0)'
        await ev(prender); con = await ev(f'{json.dumps(muestras)}.map(([x,y])=>TRUST.pixel(x,y))')
        await ev(apagar); sin = await ev(f'{json.dumps(muestras)}.map(([x,y])=>TRUST.pixel(x,y))')
        dif = sum(1 for a, c in zip(con, sin) if a != c)
        ok(dif == 0, f'ningún halo sobre el contenido LED: {len(muestras)} píxeles dentro de las 3 pantallas idénticos con luces 100 % y 0 % (difieren {dif})')
        afuera = [[x, y + 0.03] for x, y in list(sint.values())[:5]]
        await ev(prender); con = await ev(f'{json.dumps(afuera)}.map(([x,y])=>TRUST.pixel(x,y))')
        await ev(apagar); sin = await ev(f'{json.dumps(afuera)}.map(([x,y])=>TRUST.pixel(x,y))')
        ok(any(a != c for a, c in zip(con, sin)), 'control: fuera de las pantallas la luz sí aclara la fachada')
        oscurece = any(any(cc < ss for cc, ss in zip(a[:3], c[:3])) for a, c in zip(con, sin))
        ok(not oscurece, 'la luz solo aclara la foto (ningún canal se oscurece)')
        # pantallas al 0 %: el contenido queda negro sin tocar la foto de alrededor
        await ev(f'{M}.setPantalla("corrientes", 0)')
        cen = [sum(p[0] for p in q['corrientes']['quads'][0]) / 4, sum(p[1] for p in q['corrientes']['quads'][0]) / 4]
        px = await ev(f'TRUST.pixel({cen[0]},{cen[1]})')
        ok(max(px[:3]) <= 3, f'Corrientes al 0 %: panel en negro ({px[:3]})')
        await ev(f'{M}.reiniciarTodo()')
        await pg.reload(); await pg.wait_for_function('window.TRUST && TRUST.info().W > 0')

        # --- capturas de validación (posiciones reales, sin las sintéticas)
        await ev('document.getElementById("portada").classList.add("fuera")'); await pg.wait_for_timeout(700)
        await ev(f'{M}.setVista("dia")'); await pg.wait_for_timeout(200); await pg.screenshot(path=os.path.join(out, '01-dia.png'))
        await ev(f'{M}.setVista("noche")'); await pg.wait_for_timeout(200); await pg.screenshot(path=os.path.join(out, '02-noche.png'))
        await ev(f'{M}.cargarShow(); {M}.seek(8.2)'); await pg.wait_for_timeout(200); await pg.screenshot(path=os.path.join(out, '03-takeover.png'))
        await ev(f'{M}.pausa(); {M}.setFixture("SUP-01", 20); TRUST.seleccionar("SUP-01")'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(out, '04-luminaria-20.png'))
        await ev(f'{M}.setEscena("arquitectonica"); {M}.restaurarNiveles()')
        await pg.goto('file://' + os.path.join(AQUI, 'index.html')); await pg.wait_for_timeout(500)
        await pg.screenshot(path=os.path.join(out, '00-portada.png'))

        externos = [u for u in reqs if not u.startswith('file://') and not u.startswith('blob:') and not u.startswith('data:')]
        ok(not externos, f'0 pedidos de red fuera de file:// ({len(reqs)} pedidos locales)')
        ok(not errs, f'0 errores de consola ({errs[:3]})')
        await b.close()
    lineas.append(f'Resultado: {"TODO OK" if not fallas else str(len(fallas)) + " FALLA(S)"}')
    open(os.path.join(AQUI, 'PRUEBA_CONTROL.txt'), 'w', encoding='utf-8').write(
        'Prueba real de TRUST Control en Chromium offline (python3 -I kit/mcd-73/control/prueba_control.py <dir>).\n' + '\n'.join(lineas) + '\n')
    print(lineas[-1])
    return 0 if not fallas else 1

if __name__ == '__main__':
    sys.exit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else 'capturas-control')))
