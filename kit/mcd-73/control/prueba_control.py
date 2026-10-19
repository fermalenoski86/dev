"""Prueba de TRUST Control (simulación offline) en Chromium SIN red.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/prueba_control.py <dir_capturas>
Cubre las validaciones obligatorias del pedido de Fer (14/10/2026):
  foto sin deformar · 3 superficies LED en su lugar (geometría = composition.ts aprobada) · ningún halo sobre pantallas ·
  Día/Noche conserva intensidades · dimmers de luces y pantallas independientes · una luminaria al 20 % sin tocar las otras 45 ·
  funciona sin internet · no emite DMX/Art-Net/sACN/NovaStar · rótulo de simulación.
Las pruebas de píxeles usan --allow-file-access-from-files (solo para leer el lienzo en la prueba; la demo no lo necesita).
Las posiciones de luz usadas en la prueba de halos son SINTÉTICAS y no se guardan."""
import subprocess, sys, os, re, json, asyncio, hashlib
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
        await pg.wait_for_function('window.TRUST && TRUST.info().W > 0'); await pg.evaluate('TRUST.motor.setTransicion(0)')
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
        ar = inf['cssW'] / inf['cssH']; enc = await ev('ENCUADRES[TRUST.encuadre()]')
        ok(inf['encuadre'] == 'completo' and abs(inf['cssH'] - inf['cssW'] * enc['alto'] / enc['ancho']) <= 0.5, f'abre con el edificio completo y la foto sin deformar: {ar:.4f} vs {enc["ancho"] / enc["alto"]:.4f}')
        sha_c = hashlib.sha256(open(os.path.join(AQUI, 'fotos/trust-noche-completa.jpg'), 'rb').read()).hexdigest()
        cal = enc['calibracion']
        ok(enc['sha256'] == sha_c and cal['puntos'] >= 150 and cal['error_px_mediana'] <= 2 and abs(cal['rotacion_corregida_grados']) < 0.5,
           f'encuadre completo = misma toma que la foto base: {cal["puntos"]} puntos en común, error mediano {cal["error_px_mediana"]} px (la calibración aprobada vale tal cual)')
        await ev('TRUST.setEncuadre("cerca")'); await pg.wait_for_timeout(300); inf2 = await ev('TRUST.info()')
        ok(inf2['encuadre'] == 'cerca' and abs(inf2['cssH'] - inf2['cssW'] * 1733 / 2560) <= 0.5, 'encuadre «Fachada»: la foto base original, sin deformar')
        await ev('TRUST.setEncuadre("completo")'); await pg.wait_for_timeout(300)
        await ev('document.getElementById("portada").classList.add("fuera")')

        # --- Director de show (simulado): prompt precargado, carga la plantilla, sin red, rotulado
        ok(await ev('document.getElementById("prompt").value.includes("McDonald")'), 'Director: prompt de ejemplo «McDonald\'s 15 s» precargado')
        await ev('TRUST.motor.setEscena("arquitectonica")')
        await ev('document.getElementById("prompt").value = "otro texto cualquiera"')
        await pg.click('#generar')
        est_g = await ev('TRUST.motor.estado().show')
        plan = await ev('document.getElementById("plan").innerText')
        ok(est_g['cargado'] and est_g['t'] < 1 and est_g['reproduciendo'], 'Generar show: arma el show y arranca desde 0 (se ve que pasa algo)')
        ok('preprogramada' in plan and 'no es generación por IA' in plan and plan.count(' s · ') == 5, 'Generar show: el plan muestra 5 momentos (Normal → Entrada de marca → Takeover → Cierre de marca → Salida) y se rotula como base preprogramada, no IA')
        # --- P · la idea del prompt: colores, texto y producto pedidos cambian el contenido y la luz
        await ev('document.getElementById("prompt").value = \'Nueva McFlurry, azul y blanco, texto "NUEVA McFLURRY", ritmo rápido\'')
        await pg.click('#generar')
        per = await ev('CONTENIDO.personal()'); plan = await ev('document.getElementById("plan").innerText')
        ok(await ev('TRUST.motor.estado().creatividad') == 'P' and per['titular'] == 'NUEVA McFLURRY' and per['producto'] == 'helado' and per['colores'][:2] == ['#1E5BFF', '#F4F4F4'] and per['energia'] > 1,
           f'prompt con colores, texto y producto → creatividad P ({per["colores"]}, «{per["titular"]}», {per["producto"]})')
        ok('NUEVA MCFLURRY' in plan and 'azul' in plan and 'sin IA' in plan, 'el plan muestra lo entendido (colores, texto, producto) y se rotula sin IA')
        await ev('TRUST.motor.pausa(); TRUST.motor.seek(7.5); TRUST.dibujarYa()')
        px = await ev('TRUST.motor.estado().showPaleta')
        ok(px[:2] == ['#1E5BFF', '#F4F4F4'], f'la fachada usa la paleta pedida ({px})')
        await ev('document.getElementById("prompt").value = "otro texto cualquiera"')
        await pg.click('#generar')
        ok(await ev('TRUST.motor.estado().creatividad') != 'P', 'sin colores ni texto entre comillas no se inventa una creatividad P')
        ok('No hay IA conectada' in await ev('document.getElementById("director-nota").innerText'), 'la nota aclara cómo funciona hoy: palabras clave, sin IA conectada')
        # --- ficha del show (19/10): efectos, zonas, «solo luces/pantallas», «sin X», y la ficha validada a la vista
        fc = []
        for txt in ['Ola celeste y blanco que suba por la fachada, texto: VAMOS ARGENTINA', 'McFlurry, violeta y crema, destellos en la cúpula y arriba, ritmo rápido',
                    'Barrido rojo y dorado de Corrientes a Pellegrini', 'Latido rojo en toda la fachada, solo luces', 'verde y blanco sin rojo, solo pantallas', 'algo lindo']:
            await pg.fill('#prompt', txt); await pg.click('#generar'); await ev('TRUST.motor.pausa()')
            fc.append(json.loads(await ev('document.getElementById("plan-ficha").textContent')))
        ok(fc[0]['efecto'] == 'ola' and fc[0]['paleta'] == ['#6CACE4', '#F4F4F4'] and fc[0]['titular'] == 'VAMOS ARGENTINA', f'ficha: ola celeste y blanco con texto ({fc[0]["efecto"]}, {fc[0]["paleta"]})')
        ok(fc[1]['efecto'] == 'destello' and fc[1]['zonas'] == ['superior', 'cupula'] and fc[1]['energia'] > 1, f'ficha: destellos en la cúpula y arriba, rápido ({fc[1]["zonas"]})')
        ok(fc[2]['efecto'] == 'barrido' and fc[2]['estilo'] == 'rojo', f'ficha: «rojo y dorado» manda el primero → estilo rojo, barrido ({fc[2]["estilo"]})')
        ok(fc[3]['efecto'] == 'latido' and fc[3]['pantallas'] is False and fc[3]['luces'] is True, 'ficha: «solo luces» deja las pantallas en institucional')
        ok(fc[4]['luces'] is False and '#DA291C' not in fc[4]['paleta'], f'ficha: «solo pantallas» y «sin rojo» ({fc[4]["paleta"]})')
        ok(fc[5]['efecto'] is None and 'no encontré' in await ev('document.getElementById("plan-entendi").innerText'), 'pedido sin nada reconocible: lo dice y sugiere ejemplos (no falla en silencio)')
        await pg.fill('#prompt', 'Latido rojo en toda la fachada, solo luces'); await pg.click('#generar'); await ev('TRUST.motor.pausa(); TRUST.motor.seek(7.2)')
        lat = await ev('(()=>{const v=[];for(const t of [5.05,5.3,5.6]){TRUST.motor.seek(t);v.push(TRUST.motor.salidas().luces[20].nivel)}return [v, TRUST.motor.salidas().contenido.modo]})()')
        ok(max(lat[0]) - min(lat[0]) > 0.2 and lat[1] == 'institucional', f'el latido se ve en las luminarias (niveles {[round(x,2) for x in lat[0]]}) y las pantallas quedan institucionales')
        await ev('document.querySelector("#ejemplos button").click()'); await ev('TRUST.motor.pausa()')
        ok(json.loads(await ev('document.getElementById("plan-ficha").textContent'))['efecto'] == 'ola', 'los ejemplos de un clic generan el show')
        await ev('TRUST.motor.setFicha(null)')
        await ev('TRUST.motor.pausa()')
        casos = [('Lanzamiento del nuevo producto, todo dorado y con mucho impacto', 'F', 'dorado', 1.12), ('Un desayuno sutil, café y medialunas', 'E', 'calido', 0.88), ('Lluvia de papas fritas', 'D', 'rojo', 1), ('Que la hamburguesa sea la protagonista', 'B', 'rojo', 1), ('El logo bien grande', 'A', 'rojo', 1)]
        res = []
        for txt, cre, est, it in casos:
            await pg.fill('#prompt', txt); await pg.click('#generar'); e_ = await ev('TRUST.motor.estado()'); await ev('TRUST.motor.pausa()')
            res.append((e_['creatividad'], e_['showEstilo'], round(e_['showIntensidad'], 2)) == (cre, est, it))
        ent = await ev('document.getElementById("plan-entendi").innerText')
        ok(all(res) and 'logo' in ent.lower() or 'marca' in ent.lower(), f'el pedido cambia el show: lanzamiento→F dorado fuerte · desayuno→E cálido suave · papas→D · producto→B · logo→A ({res})')
        await pg.fill('#prompt', ''); await pg.click('#prompt'); await pg.keyboard.type('papas r d n b con espacios')
        tecl = await ev('[document.getElementById("prompt").value, TRUST.motor.estado().vista, TRUST.motor.estado().blackout]')
        ok(tecl == ['papas r d n b con espacios', 'noche', False], f'escribir en el pedido no dispara atajos (espacio, R, D, N, B se escriben normal): {tecl}')
        await ev('document.activeElement.blur()'); await pg.keyboard.press('Space'); await pg.wait_for_timeout(100)
        ok(await ev('TRUST.motor.estado().show.reproduciendo'), 'barra espaciadora fuera del texto: Play/Pausa')
        await ev('TRUST.motor.pausa(); TRUST.motor.setCreatividad("C"); TRUST.motor.setEstiloShow("rojo", 1)')
        await ev('TRUST.motor.setEscena("arquitectonica")')

        # --- superficies LED
        q = g['superficies']; nums_pub = []
        for s in ('corrientes', 'pellegrini'): nums_pub += [v for pt in q[s]['quads'][0] for v in pt]
        for qd in q['media']['quads']: nums_pub += [v for pt in qd for v in pt]
        nums_pub += [v for pt in g['reloj']['quad'] for v in pt]
        ok(nums_pub == nums_aprobados, f'pantallas y reloj = geometría aprobada en composition.ts ({len(nums_pub)} coordenadas idénticas)')
        cx = lambda qd: sum(p[0] for p in qd) / 4
        ok(cx(q['corrientes']['quads'][0]) < cx(q['pellegrini']['quads'][0]), 'Corrientes a la izquierda, Pellegrini a la derecha')
        ok(len(q['media']['quads']) == 24, 'pantalla media: 24 tramos de la curva de la ochava')

        # --- posiciones reales de luminarias (transferidas desde la imagen anotada de Fer)
        lum = await ev('LUMINARIAS')
        pts = lum['puntos']
        ok(lum['foto_sha256'] == sha_foto, 'luminarias.js calibrado sobre esta misma foto (sha256)')
        infs = [v for k, v in pts.items() if k.startswith('INF')]
        ok(sum(k.startswith('SUP') for k in pts) == 16 and sum(k.startswith('MED') for k in pts) == 16 and len(infs) == 14 and all(1.1 < y < 1.25 for _, y in infs) and 'inferior' in lum['calibracion'].get('preliminar', []),
           'posiciones: 16 superior + 16 medio + 14 inferior sobre los locales de planta baja (preliminar, visibles en «Edificio completo»)')
        def dentro(pt, qd):
            s = 0
            for i in range(4):
                (x1, y1), (x2, y2) = qd[i], qd[(i + 1) % 4]
                c = (x2 - x1) * (pt[1] - y1) - (y2 - y1) * (pt[0] - x1)
                s += 1 if c > 0 else -1 if c < 0 else 0
            return abs(s) == 4
        pisa = [k for k, pt in pts.items() for sid in ('corrientes', 'pellegrini', 'media') for qd in q[sid]['quads'] if dentro(pt, qd)]
        ok(all(0 < v < 1.35 for pt in pts.values() for v in pt) and not pisa, f'ninguna luminaria cae sobre una pantalla ({pisa or "ninguna"})')
        sx = [pts[f'SUP-{i:02d}'][0] for i in range(1, 17)]; mx = [pts[f'MED-{i:02d}'][0] for i in range(1, 17)]
        ok(sx == sorted(sx) and mx == sorted(mx), 'numeración de izquierda (Corrientes) a derecha (Pellegrini), como en la imagen anotada')
        inf2 = await ev('TRUST.info()')
        ok(inf2['lucesDibujadas'] == 46, f'escena arquitectónica: se dibujan las 46 luminarias, planta baja incluida ({inf2["lucesDibujadas"]})')

        # --- independencia y niveles (motor)
        M = 'TRUST.motor'
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0)')
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
        base_med = next(l for l in base['luces'] if l['id'] == 'MED-07')['nivel']
        ok(abs(med7['nivel'] - base_med * 0.35) < 1e-9, 'master 0 → 100 restaura el ajuste individual (MED-07 35 %)')
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0)')
        antes = await ev(f'{M}.salidas()')
        await ev(f'{M}.setFixture("SUP-01", 20)')
        despues = await ev(f'{M}.salidas()')
        cambiadas = [a['id'] for a, d in zip(antes['luces'], despues['luces']) if a != d]
        ok(cambiadas == ['SUP-01'], f'SUP-01 al 20 %: cambia solo SUP-01, las otras 45 iguales ({cambiadas})')
        sup1 = next(l for l in despues['luces'] if l['id'] == 'SUP-01')
        sup1_0 = next(l for l in antes['luces'] if l['id'] == 'SUP-01')['nivel']
        ok(abs(sup1['nivel'] - sup1_0 * 0.2) < 1e-9, f'SUP-01 al 20 %: salida = escena ({sup1_0:.0%}) × 20 %')
        await ev(f'{M}.setGrupo("medio", 50)')
        d2 = await ev(f'{M}.salidas()')
        cambiadas = sorted({l['grupo'] for a, l in zip(despues['luces'], d2['luces']) if a != l})
        ok(cambiadas == ['medio'] and sum(1 for a, l in zip(despues['luces'], d2['luces']) if a != l) == 16, 'nivel medio al 50 %: cambian solo sus 16')
        niv = await ev(f'(()=>{{{M}.reiniciarTodo(); {M}.setTransicion(0);const r={{}};for(const e of ["arquitectonica","blanco","mcd","apagado"]){{{M}.setEscena(e);r[e]={M}.salidas().luces.map(l=>l.nivel)}}{M}.setEscena("arquitectonica");return r}})()')
        ok(all(0.35 <= v <= 0.5 for v in niv['arquitectonica']) and all(0.35 <= v <= 0.5 for v in niv['blanco']), 'arquitectónica y blanco: base visual moderada (35–50 %)')
        acentos = [v for v in niv['mcd'] if v > 0.5]
        ok(acentos and all(0.6 <= v <= 0.75 for v in acentos) and len(acentos) < len(niv['mcd']) * 0.6, f"McDonald's: acentos 60–75 % por sectores, no toda la fachada ({len(acentos)}/46)")
        ok(all(v == 0 for v in niv['apagado']), 'escena «Luces apagadas»: las 46 en 0')
        cal = await ev(f'(()=>{{{M}.setEscena("arquitectonica");return {M}.salidas().luces[0].rgbw}})()')
        r_, g_, b_ = await ev(f'TRUST.rgbDe({json.dumps(cal)})')   # mezcla RGBW → color de previsualización (W = blanco fijo del equipo)
        ok(b_ / r_ >= 0.55 and g_ / r_ >= 0.72 and b_ < g_ < r_, f'blanco cálido = mezcla RGBW, sin amarillo saturado (≈3000–3500 K: R {r_:.2f} G {g_:.2f} B {b_:.2f})')
        lib = await ev(f'(()=>{{{M}.setEscena("libre");const s={M}.salidas().luces;{M}.setEscena("arquitectonica");return s.map(l=>[l.nivel,l.rgbw])}})()')
        ok(len(lib) == 46 and all(0.35 <= n <= 0.5 for n, _ in lib), 'escena «RGBW libre»: base neutra moderada para colorear por luminaria o grupo')
        await ev(f'{M}.setColorGrupo("medio", {{r:0,g:.2,b:1,w:0}})')
        gc = await ev(f'{M}.estado().luces.fixtures.map(f=>[f.grupo, !!f.color])')
        ok(all(c == (g == 'medio') for g, c in gc), 'color por grupo: «medio» en azul, superior e inferior sin tocar')
        await ev(f'{M}.setColorGrupo("todas", null)')
        await pg.reload(); await pg.wait_for_function('window.TRUST && TRUST.info().W > 0'); await pg.evaluate('TRUST.motor.setTransicion(0)')   # estado de apertura recién abierto
        await ev('document.getElementById("portada").classList.add("fuera")'); await pg.wait_for_timeout(700)
        ple = await ev('[document.getElementById("t-director").classList.contains("plegado"), document.getElementById("director-cuerpo").offsetParent === null, !!document.getElementById("generar").offsetParent]')
        ok(ple == [False, False, True], f'Director de show desplegado al abrir (19/10): el prompt y los ejemplos a la vista, botón Generar visible ({ple})')
        await pg.click('#director-plegar')
        ok(await ev('document.getElementById("director-cuerpo").offsetParent === null && document.getElementById("director-plegar").getAttribute("aria-expanded") === "false"'), 'Director de show: se pliega con su botón')
        await pg.click('#director-plegar')
        ok(await ev('document.getElementById("director-cuerpo").offsetParent !== null'), 'Director de show: se vuelve a desplegar')
        await ev(f'{M}.setFixtureApertura("SUP-03", 25)')
        aps = await ev(f'{M}.salidas().luces.filter(l=>l.apertura!==({M}.APERTURA[l.grupo])).map(l=>l.id)')
        ok(aps == ['SUP-03'], f'apertura del haz configurable por luminaria (solo SUP-03 cambió: {aps})')
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0); {M}.setFixture("SUP-01", 20); {M}.setGrupo("medio", 50)')
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

        # --- visual polish 14/10: zonas, master, presets, transiciones, jerarquía, diagnóstico, modos
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0)')
        och = await ev(f'{M}.OCHAVA')
        a0 = await ev(f'{M}.salidas().luces'); await ev(f'{M}.setZona("ochava", 50)'); a1 = await ev(f'{M}.salidas().luces')
        cambian = sorted(x['id'] for x, y in zip(a0, a1) if x != y)
        ok(cambian == sorted(och) and len(och) == 13, f'zona ochava al 50 %: cambian solo sus {len(och)} equipos (esquina curva de las 3 filas)')
        await ev(f'{M}.setZona("ochava", 100)')
        z0 = await ev(f'{M}.salidas()'); await ev(f'{M}.setZonaColor("cupula", {{r:1,g:.55,b:0,w:.35}})'); z1 = await ev(f'{M}.salidas()')
        ok(z1['zonas']['cupula']['rgbw']['g'] == 0.55 and z1['zonas']['cornisas'] == z0['zonas']['cornisas'] and z1['luces'] == z0['luces'], 'RGBW por zona: la cúpula cambia de color; cornisas y 46 luminarias intactas')
        await ev(f'{M}.setZonaColor("cupula", null)')
        await ev(f'{M}.setEscena("mcd")'); m0 = await ev(f'{M}.salidas()'); await ev(f'{M}.setLucesMaster(50)'); m1 = await ev(f'{M}.salidas()')
        ok(all(abs(b_['nivel'] - a_['nivel'] / 2) < 1e-9 and b_['rgbw'] == a_['rgbw'] for a_, b_ in zip(m0['luces'], m1['luces'])) and abs(m1['zonas']['cupula']['nivel'] - m0['zonas']['cupula']['nivel'] / 2) < 1e-9,
           'Master iluminación al 50 %: escala la intensidad de luces y zonas; la mezcla RGBW no cambia')
        ok(m1['pantallas'] == m0['pantallas'], 'Master de iluminación ≠ dimmer de pantallas (las pantallas no cambian)')
        await ev(f'{M}.setLucesMaster(100); {M}.setPantalla("master", 30)'); m2 = await ev(f'{M}.salidas()')
        ok(m2['luces'] == m0['luces'] and m2['pantallas']['corrientes'] == 0.3, 'dimmer de pantallas al 30 %: las luces no cambian')
        await ev(f'{M}.setPantalla("master", 100); {M}.setZonaColor("superior", {{r:0,g:0,b:0,w:1}}); {M}.setZona("cornisas", 40); {M}.volverAEscena()')
        e_ = await ev(f'{M}.estado().luces')
        ok(all(v is None for v in e_['zonaColor'].values()) and e_['zonas']['cornisas'] == 100 and e_['master'] == 100, '«Volver a escena»: quita overrides de zona y vuelve a la escena programada')
        claves = await ev(f'Object.values({M}.ESCENAS).map(e=>e.clave)')
        ok(all(k in claves for k in ['ARCHITECTURAL_WARM', 'MCD_TAKEOVER', 'MCD_SIGNATURE', 'RGB_DIAGNOSTIC', 'ALL_OFF', 'NIGHT_IDLE']), 'presets mínimos: ARCHITECTURAL_WARM · MCD_TAKEOVER · MCD_SIGNATURE · RGB_DIAGNOSTIC · ALL_OFF · NIGHT_IDLE')
        puros = await ev(f"""(()=>{{const M={M},r=[];const chk=(q,d)=>{{if(q.r>0.001&&q.g>0.001&&q.b>0.001)r.push(d)}};
          for(const [k,e] of Object.entries(M.ESCENAS)){{if(!e.comercial)continue;M.setEscena(k);const s=M.salidas();s.luces.forEach(l=>chk(l.rgbw,k+':'+l.id));Object.entries(s.zonas).forEach(([z,v])=>chk(v.rgbw,k+':'+z))}}
          M.cargarShow();for(let t=0;t<=15;t+=0.25){{M.seek(t);const s=M.salidas();s.luces.forEach(l=>chk(l.rgbw,'show'+t+':'+l.id));Object.entries(s.zonas).forEach(([z,v])=>chk(v.rgbw,'show'+t+':'+z))}}
          M.setEscena('arquitectonica');return r}})()""")
        ok(not puros, f'escenas comerciales y show: nunca R, G y B juntos (2 canales + W) — {len(puros)} casos {puros[:3]}')
        # transición configurable: 2 s por defecto, suave, sin saltos
        await ev(f'{M}.reiniciarTodo()')
        ok(await ev(f'{M}.estado().transicion') == 2 and await ev(f'{M}.TRANSICIONES') == [0.5, 1, 2, 3, 5], 'transiciones 0,5 / 1 / 2 / 3 / 5 s, default comercial 2 s')
        tr = await ev(f"""(()=>{{const M={M};const a=M.salidas().luces.map(l=>l.nivel);M.setEscena('mcd');const r=[M.salidas().luces.map(l=>l.nivel)];
          for(let i=0;i<22;i++){{M.avanzar(0.1);r.push(M.salidas().luces.map(l=>l.nivel))}}M.terminarTransicion();return {{a,r,fin:M.salidas().luces.map(l=>l.nivel),anim:M.animando()}}}})()""")
        salto = max(abs(x - y) for f0, f1 in zip(tr['r'], tr['r'][1:]) for x, y in zip(f0, f1))
        ok(tr['r'][0] == tr['a'] and tr['r'][-1] == tr['fin'] and salto < 0.06 and not tr['anim'], f'preset → preset: transición suave de 2 s (arranca en lo que se ve, termina en el preset; salto máx. {salto:.3f} cada 0,1 s)')
        await ev(f'{M}.setTransicion(0)')
        # show: momentos y valores del brief, sin saltos
        sh = await ev(f"""(()=>{{const M={M};M.reiniciarTodo();M.setTransicion(0);M.cargarShow();const r=[];for(let t=0;t<=15.0001;t+=0.05){{M.seek(t);r.push(M.salidas().luces.map(l=>[l.nivel,l.rgbw.r,l.rgbw.g,l.rgbw.w]))}}return r}})()""")
        salto = max(abs(a_[0] - b_[0]) for f0, f1 in zip(sh, sh[1:]) for a_, b_ in zip(f0, f1))
        ok(salto < 0.08, f'show 15 s sin saltos: cambio máximo por luminaria {salto:.3f} cada 0,05 s')
        t75 = sh[150]
        rojos = [n for n, r, g, w in t75 if r > 0.9 and g < 0.1]; oros = [n for n, r, g, w in t75 if r > 0.9 and 0.45 < g < 0.65]; cal = [n for n, r, g, w in t75 if r < 0.5 and w > 0.6]
        ok(rojos and oros and cal and all(0.6 <= n <= 0.75 for n in rojos) and all(0.35 <= n <= 0.45 for n in oros) and all(0.15 <= n <= 0.25 for n in cal),
           f'FULL TAKEOVER (7,5 s): rojo {min(rojos):.2f}–{max(rojos):.2f} · oro {min(oros):.2f}–{max(oros):.2f} · cálido {min(cal):.2f}–{max(cal):.2f} (65–75 / 35–45 / 15–25 % con −8 % de jerarquía)')
        ochv = set(await ev(f'{M}.OCHAVA')); ids_ = await ev(f'{M}.estado().luces.fixtures.map(f=>f.id)')
        ok(all(abs(n - (0.42 if ids_[i] in ochv else 0.38)) < 1e-6 for i, (n, *_r) in enumerate(sh[20])), 'NORMAL (1 s): fachada cálida 38 % (ochava 42 %)')
        fin = await ev(f'(()=>{{const M={M};M.seek(15);const a=M.salidas().luces;M.setEscena("arquitectonica");const b=M.salidas().luces;return [a.map(l=>l.nivel),b.map(l=>l.nivel)]}})()')
        ok(all(abs(x - y) < 1e-6 for x, y in zip(*fin)), 'EXIT: el show termina exactamente en ARCHITECTURAL_WARM')
        # diagnóstico separado de lo comercial
        await ev(f'{M}.setEscena("diagnostico")'); await pg.wait_for_timeout(120)
        dg = await ev(f'[!document.getElementById("diag").hidden, document.getElementById("diag").innerText, {M}.salidas().luces.filter(l=>l.rgbw.b>0.5||l.rgbw.g>0.9||(l.rgbw.r>0.9&&l.rgbw.b>0.5)).map(l=>l.id).sort()]')
        ok(dg[0] and 'DIAGNOSTIC MODE' in dg[1] and dg[2] == ['MED-08', 'SUP-04', 'SUP-11'], f'RGB_DIAGNOSTIC: rotulado «DIAGNOSTIC MODE», SUP-04 azul · SUP-11 verde · MED-08 magenta ({dg[2]})')
        await ev(f'{M}.setEscena("mcd")'); await pg.wait_for_timeout(120)
        ok(await ev('document.getElementById("diag").hidden'), 'escena comercial: sin rótulo de diagnóstico')
        # pantallas como una sola pieza: el elemento nace en Corrientes, pasa a Pellegrini y aterriza en la media
        cq = lambda sid: [sum(p[0] for p in q[sid]['quads'][0]) / 4, sum(p[1] for p in q[sid]['quads'][0]) / 4]
        mq = q['media']['quads'][12]; cm_ = [sum(p[0] for p in mq) / 4, sum(p[1] for p in mq) / 4]
        lum3 = lambda c: max(c[:3])
        await ev(f'{M}.cargarShow(); {M}.seek(3.0)'); r1 = [await ev(f'TRUST.pixel({x},{y})') for x, y in (cq('corrientes'), cq('pellegrini'), cm_)]
        await ev(f'{M}.seek(3.9)'); r2 = [await ev(f'TRUST.pixel({x},{y})') for x, y in (cq('corrientes'), cq('pellegrini'), cm_)]
        await ev(f'{M}.seek(7.5)'); r3 = [await ev(f'TRUST.pixel({x},{y})') for x, y in (cq('corrientes'), cq('pellegrini'), cm_)]
        ok(lum3(r1[0]) > 80 and lum3(r1[1]) < 45 and lum3(r1[2]) < 45 and lum3(r2[1]) > 80 and lum3(r2[2]) < 45 and all(lum3(c) > 80 for c in r3),
           f'una sola composición: 3,0 s solo Corrientes · 3,9 s Corrientes + Pellegrini · 7,5 s las tres ({[lum3(c) for c in r1]} → {[lum3(c) for c in r2]} → {[lum3(c) for c in r3]})')
        src = open(os.path.join(AQUI, 'contenido.js'), encoding='utf-8').read() + open(os.path.join(AQUI, 'app.js'), encoding='utf-8').read()
        ok(all(x not in src for x in ['TAKEOVER 15 s', 'UN MOMENTO SINCRONIZADO', 'FRENTE AL OBELISCO']), 'contenido sin textos de demo («TAKEOVER 15 s», «UN MOMENTO SINCRONIZADO»…)')
        vs = []
        for cr in 'ABC':
            await ev(f'{M}.setCreatividad("{cr}"); {M}.seek(7.5)'); vs.append(await ev(f'TRUST.pixel({cq("pellegrini")[0]},{cq("pellegrini")[1]})'))
        ok(len({tuple(v) for v in vs}) == 3, 'creatividades A · B · C: tres variantes visuales distintas')
        await ev(f'{M}.setCreatividad("C")')
        # modo cliente: sin sliders ni detalles técnicos; solo NORMAL / TAKEOVER / SIGNATURE / ANTES-DESPUÉS
        await pg.click('#m-cliente'); await pg.wait_for_timeout(150)
        cli = await ev('[[...document.querySelectorAll("input[type=range]")].filter(e=>e.offsetParent!==null).length, [...document.querySelectorAll("#cliente-bar button")].filter(e=>e.offsetParent!==null).map(b=>b.querySelector("b").innerText)]')
        ok(cli[0] == 0 and cli[1] == ['NORMAL', 'TAKEOVER', 'SIGNATURE', 'ANTES / DESPUÉS'], f'modo cliente: 0 sliders visibles y solo {cli[1]}')
        await pg.click('#cliente-bar button[data-c="antes"]'); a_ = await ev(f'{M}.estado().escena')
        await pg.click('#cliente-bar button[data-c="antes"]'); d_ = await ev(f'{M}.estado().escena')
        ok((a_, d_) == ('apagado', 'arquitectonica'), 'ANTES / DESPUÉS: sin iluminación ↔ arquitectónica cálida')
        await pg.click('#cliente-bar button[data-c="takeover"]'); ok(await ev(f'{M}.estado().show.reproduciendo'), 'modo cliente: TAKEOVER reproduce el show')
        await ev(f'{M}.pausa()'); await pg.click('#m-operador'); await pg.wait_for_timeout(150)
        ok(await ev('document.getElementById("panel").offsetParent !== null && !document.body.classList.contains("cliente")'), 'modo operador: vuelve el panel completo (master, zonas, RGBW, transiciones, escenas)')
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0)')

        # --- píxeles: ningún halo sobre pantallas
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0); {M}.setEscena("blanco")')
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
        # Noche (Fer, 14/10 refinamiento): apagar NUESTRAS 46 luces no apaga la luz urbana: el TRUST sigue visible.
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0)'); await pg.reload(); await pg.wait_for_function('window.TRUST && TRUST.info().W > 0'); await pg.evaluate('TRUST.motor.setTransicion(0)')
        lum_ = lambda px: 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]
        fachada = [[0.30, 0.50], [0.45, 0.70], [0.60, 0.45], [0.25, 0.75], [0.55, 0.62]]   # fachada del TRUST, fuera de pantallas
        externos_ = [[0.05, 0.62], [0.78, 0.55], [0.90, 0.15]]                         # vecino, torre blanca, cielo
        foto = await ev(f'{json.dumps(fachada + externos_)}.map(([x,y])=>TRUST.pixelFoto(x,y))')
        await ev(f'{M}.setVista("noche"); {M}.setLucesMaster(0)'); apag = await ev(f'{json.dumps(fachada + externos_)}.map(([x,y])=>TRUST.pixel(x,y))')
        n_f = len(fachada)
        rel = sum(lum_(a) for a in apag[:n_f]) / max(1, sum(lum_(f) for f in foto[:n_f]))
        ok(0.45 < rel < 0.8, f'luces apagadas: el TRUST sigue visible con la luz urbana ({rel:.0%} del brillo de la foto)')
        cie_a, cie_f = apag[-1], foto[-1]
        ok(apag[n_f:-1] == foto[n_f:-1] and abs(lum_(cie_a) - lum_(cie_f)) < 12 and cie_a[2] > cie_a[0],
           f'vecino y torre blanca no cambian; el cielo es el nocturno parejo (19/10), oscuro y azulado como el de la foto ({cie_a} vs {cie_f})')
        sup5 = (await ev('LUMINARIAS'))['puntos']['SUP-05']
        en_haz = [[sup5[0], sup5[1] - 0.02]]
        await ev(f'{M}.setLucesMaster(100)'); prend = await ev(f'{json.dumps(en_haz)}.map(([x,y])=>TRUST.pixel(x,y))')
        await ev(f'{M}.setLucesMaster(0)'); apg = await ev(f'{json.dumps(en_haz)}.map(([x,y])=>TRUST.pixel(x,y))')
        ok(lum_(prend[0]) > 1.15 * lum_(apg[0]), f'un haz encendido se suma a la luz urbana (brillo ×{lum_(prend[0]) / max(1, lum_(apg[0])):.1f} sobre apagado)')
        # un fixture al 20 % cambia solo SU baño (auditoría 14/10)
        await ev(f'{M}.setLucesMaster(100); {M}.setEscena("arquitectonica")')
        cerca = [[sup5[0], sup5[1] - 0.03]]
        lejos = [[0.62, 0.55], [0.55, 0.75], [0.68, 0.45]]   # mitad derecha: fuera del alcance del baño de SUP-05 (x≈0,28)
        a1 = await ev(f'{json.dumps(cerca + lejos)}.map(([x,y])=>TRUST.pixel(x,y))')
        await ev(f'{M}.setFixture("SUP-05", 20)')
        a2 = await ev(f'{json.dumps(cerca + lejos)}.map(([x,y])=>TRUST.pixel(x,y))')
        ok(lum_(a2[0]) < lum_(a1[0]) - 8 and a2[1:] == a1[1:], 'SUP-05 al 20 %: baja su baño y el resto de la fachada no cambia')
        await ev(f'{M}.setFixture("SUP-05", 100)')
        # RGBW individual (Fer, ajuste fino 14/10): 3 luminarias cambian de color y las otras 43 quedan intactas
        tres = {'SUP-04': {'r': 0, 'g': .25, 'b': 1, 'w': 0}, 'SUP-11': {'r': 0, 'g': 1, 'b': .15, 'w': 0}, 'MED-08': {'r': 1, 'g': 0, 'b': .75, 'w': 0}}
        pts = await ev('LUMINARIAS'); pts = pts['puntos']
        s0 = await ev(f'{M}.salidas().luces')
        cerca3 = [[pts[i][0], pts[i][1] - 0.03] for i in tres]
        lejos3 = [[x, y] for x, y in [[0.02 + 0.70 * i / 34, 0.42 + 0.34 * j / 4] for i in range(35) for j in range(5)]
                  if all(abs(x - pts[i][0]) > 0.14 for i in tres)]   # fuera del halo (≈0,13 de alcance)
        b0 = await ev(f'{json.dumps(cerca3 + lejos3)}.map(([x,y])=>TRUST.pixel(x,y))')
        for i, c in tres.items(): await ev(f'{M}.setFixtureColor("{i}", {json.dumps(c)})')
        s1_ = await ev(f'{M}.salidas().luces')
        b1 = await ev(f'{json.dumps(cerca3 + lejos3)}.map(([x,y])=>TRUST.pixel(x,y))')
        otras = [(a, b) for a, b in zip(s0, s1_) if a['id'] not in tres]
        ok(len(otras) == 43 and all(a == b for a, b in otras), '3 luminarias cambian de color: las otras 43 salidas idénticas')
        ok(b1[0][2] > b0[0][2] + 6 and b1[1][1] > b1[1][0] and b1[2][0] > b1[2][1], f'SUP-04 azul, SUP-11 verde, MED-08 magenta visibles en su baño ({b1[:3]})')
        dif3 = [(p_, a, b) for p_, a, b in zip(lejos3, b0[3:], b1[3:]) if a != b]
        ok(len(lejos3) >= 10 and not dif3, f'fuera de esos 3 baños la fachada no cambia ({len(lejos3)} puntos idénticos)')
        for i in tres: await ev(f'{M}.setFixtureColor("{i}", null)')
        # sin manchas de color uniformes: en el takeover el rojo es acento, no la fachada entera
        grilla = [[0.15 + 0.55 * i / 9, 0.40 + 0.38 * j / 5] for i in range(10) for j in range(6)]
        arq = await ev(f'{json.dumps(grilla)}.map(([x,y])=>TRUST.pixel(x,y))')
        await ev(f'{M}.cargarShow(); {M}.seek(8.3)')
        px = await ev(f'{json.dumps(grilla)}.map(([x,y])=>TRUST.pixel(x,y))')
        rg = lambda c: c[0] / max(1, c[1])
        rojos = sum(1 for c, a in zip(px, arq) if rg(c) > 1.3 * rg(a))   # el punto se volvió claramente más rojo que en la cálida
        ok(rojos < len(px) * 0.5, f'takeover: el rojo cubre {rojos}/{len(px)} puntos de la fachada (acentos, no capa uniforme)')
        ok(rojos > 0, 'takeover: hay acentos rojos visibles')
        # sin parpadeo: el mismo instante se dibuja idéntico (variaciones deterministas)
        d1 = await ev(f'{json.dumps(grilla[:20])}.map(([x,y])=>TRUST.pixel(x,y))'); d2 = await ev(f'{json.dumps(grilla[:20])}.map(([x,y])=>TRUST.pixel(x,y))')
        ok(d1 == d2, 'mismo instante del show → mismos píxeles (sin parpadeo)')
        var = await ev('["SUP-01","SUP-02","SUP-03","MED-07"].map(id=>TRUST.variacion(id))')
        var2 = await ev('["SUP-01","SUP-02","SUP-03","MED-07"].map(id=>TRUST.variacion(id))')
        ok(var == var2 and len({(v['dAp'], round(v['flujo'], 3)) for v in var}) > 1 and all(abs(v['dAp']) <= 6 and 0.85 <= v['flujo'] <= 1.15 for v in var),
           f'variación por equipo determinista y acotada (±6° de apertura, flujo 0,86–1,14): {[(v["dAp"], round(v["flujo"], 2)) for v in var]}')
        await ev(f'{M}.setEscena("arquitectonica")')
        # pantallas al 0 %: el contenido queda negro sin tocar la foto de alrededor
        await ev(f'{M}.setPantalla("corrientes", 0)')
        qc = q['corrientes']['quads'][0]; u_, v_ = 0.15, 0.5   # zona izquierda del panel: fondo rojo del clip (el cuadrado amarillo está al centro)
        top = [qc[0][0] + (qc[1][0] - qc[0][0]) * u_, qc[0][1] + (qc[1][1] - qc[0][1]) * u_]; bot = [qc[3][0] + (qc[2][0] - qc[3][0]) * u_, qc[3][1] + (qc[2][1] - qc[3][1]) * u_]
        px = await ev(f'TRUST.pixel({top[0] + (bot[0] - top[0]) * v_},{top[1] + (bot[1] - top[1]) * v_})')
        ok(max(px[:3]) <= 3, f'Corrientes al 0 %: panel en negro ({px[:3]})')
        await ev(f'{M}.reiniciarTodo(); {M}.setTransicion(0)')
        await pg.reload(); await pg.wait_for_function('window.TRUST && TRUST.info().W > 0'); await pg.evaluate('TRUST.motor.setTransicion(0)')

        # --- AI CONTENT STUDIO (brief §40–59): UPLOAD MEDIA, análisis local, plan por superficie, referencia vs final
        med = os.path.join(out, 'media'); os.makedirs(med, exist_ok=True)
        ff = lambda *a: subprocess.run(['ffmpeg', '-v', 'error', '-y', *a], check=True)
        ff('-f', 'lavfi', '-i', 'color=c=0xDA291C:s=1920x1080:r=25:d=7', '-f', 'lavfi', '-i', 'color=c=0xFFC72C:s=360x360:r=25:d=7', '-filter_complex', "[0][1]overlay=x='100+t*220':y=360", '-pix_fmt', 'yuv420p', '-c:v', 'libx264', os.path.join(med, 'a.mp4'))
        ff('-f', 'lavfi', '-i', 'color=c=0x050505:s=1920x1080:r=25:d=6', '-f', 'lavfi', '-i', 'color=c=0xFFC72C:s=500x200:r=25:d=6', '-filter_complex', '[0][1]overlay=x=710:y=440', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', os.path.join(med, 'c.mp4'))
        open(os.path.join(med, 'l.txt'), 'w').write("file 'a.mp4'\nfile 'c.mp4'\n")
        ff('-f', 'concat', '-safe', '0', '-i', os.path.join(med, 'l.txt'), '-c', 'copy', os.path.join(med, 'spot_h264.mp4'))
        ff('-i', os.path.join(med, 'spot_h264.mp4'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', os.path.join(med, 'spot_vp9.mp4'))
        from PIL import Image as _I, ImageDraw as _D
        lg = _I.new('RGBA', (800, 400), (0, 0, 0, 0)); _D.Draw(lg).rounded_rectangle((150, 100, 650, 300), 60, fill=(255, 199, 44, 255)); lg.save(os.path.join(med, 'logo.png'))
        pk = _I.new('RGB', (1200, 1200), (245, 245, 240)); _D.Draw(pk).ellipse((300, 350, 900, 650), fill=(200, 116, 42)); pk.save(os.path.join(med, 'packshot.jpg'), quality=90)
        open(os.path.join(med, 'notas.txt'), 'w').write('no es media')
        await ev('document.getElementById("portada").classList.add("fuera")'); await pg.wait_for_timeout(300)
        ok(await ev('!!document.getElementById("upload").offsetParent && document.getElementById("t-director").classList.contains("plegado") === false || !!document.getElementById("upload").offsetParent'), 'AI Content Studio: botón «+ UPLOAD MEDIA» visible')
        archivos = ['spot_vp9.mp4', 'logo.png', 'packshot.jpg', 'notas.txt', 'spot_h264.mp4']
        await pg.set_input_files('#adj-archivo', [os.path.join(med, f) for f in archivos])
        await pg.wait_for_function('ESTUDIO.adjuntos().length === 5 && ESTUDIO.adjuntos().every(a => a.status === "READY" || a.status === "REJECTED")', timeout=90000)
        ad = {a['filename']: a for a in await ev('ESTUDIO.adjuntos()')}
        v9, lgA, pkA, tx, h264 = (ad[f] for f in archivos)
        ok(v9['status'] == 'READY' and lgA['status'] == 'READY' and pkA['status'] == 'READY' and tx['status'] == 'REJECTED' and 'tipo no admitido' in tx['motivo'],
           'MediaAttachment: MP4 / PNG / JPG → READY; .txt → REJECTED (tipo no admitido)')
        ok(h264['status'] == 'READY' or ('H.264' in (h264['motivo'] or '') and 'Chrome o Edge' in h264['motivo']), f'MP4 H.264: READY si el navegador trae el códec; si no, REJECTED con motivo claro ({h264["status"]})')
        ok(v9['width'] == 1920 and v9['height'] == 1080 and v9['fps'] == 25 and v9['codec'] == 'vp09' and abs(v9['durationMs'] - 13000) <= 120,
           f'metadata técnica real del MP4 (cajas ISO-BMFF): {v9["width"]}×{v9["height"]} · {v9["fps"]} fps · {v9["codec"]} · {v9["durationMs"]} ms')
        vis = v9['analisis']['visual']; nombres = [c['nombre'] for c in vis['colores']]
        ok(len(v9['keyframes']) == 5 and [round(k['t'] / 13, 2) for k in v9['keyframes']][1:4] == [0.25, 0.5, 0.75] and any(abs(c - 7) < 0.6 for c in vis['cortes']) and 'rojo' in nombres and 'amarillo' in nombres and 'negro' in nombres,
           f'análisis básico: 5 keyframes (0/25/50/75/100 %), corte de escena ≈7 s {vis["cortes"]}, colores {nombres[:4]}')
        ok(lgA['analisis']['tecnico']['transparencia'].startswith('sí') and lgA['width'] == 800, 'imagen: resolución, aspecto y transparencia (candidata a logo)')
        ok(v9['sha256'] == hashlib.sha256(open(os.path.join(med, 'spot_vp9.mp4'), 'rb').read()).hexdigest(), 'huella SHA-256 local = la del archivo original (el original no se toca)')
        ok(all(a['uso']['final'] for a in ad.values() if a['status'] == 'READY'), 'subir = verlo: lo subido va al show por defecto (se puede pasar a solo referencia)')
        ok(await ev('ESTUDIO.aplicado() && CONTENIDO.hayMedia() && TRUST.motor.estado().show.cargado'), 'al terminar el análisis el material entra solo a las pantallas y el show se carga')
        ids = {a['filename']: a['id'] for a in ad.values()}
        await pg.click(f'.adj-ver[data-id="{ids["spot_vp9.mp4"]}"]'); await pg.wait_for_timeout(300)
        vtxt = await ev('document.getElementById("visor").innerText')
        ok(await ev('!!document.getElementById("vis-player") && document.getElementById("u-fin").checked') and 'análisis automático' in vtxt and 'no es IA' in vtxt and 'Se usa:' in vtxt and 'Armar el show de 15 s con este video' in vtxt,
           'preview: player + metadata + AI NOTES rotuladas como análisis generado + source timeline + atajos')
        await pg.click('#build15')
        ok('Show de 15 s con el video' in await ev('document.getElementById("prompt").value'), '«Armar el show de 15 s con este video» completa el pedido')
        await pg.click('#vis-cerrar')
        await ev(f'ESTUDIO.marcar("{ids["spot_vp9.mp4"]}", {{final: false}}); ESTUDIO.marcar("{ids["logo.png"]}", {{final: false}}); ESTUDIO.marcar("{ids["packshot.jpg"]}", {{final: false}})' + (f'; ESTUDIO.marcar("{ids["spot_h264.mp4"]}", {{final: false}})' if h264['status'] == 'READY' else ''))
        await pg.click('#generar'); await pg.wait_for_function('!!ESTUDIO.concepto()')
        c0 = await ev('ESTUDIO.concepto()')
        ok(c0['flujo'] == 'MEDIA + PROMPT' and not any(d['fuente'] == 'spot_vp9.mp4' for d in c0['derivadas']) and any('REFERENCIA' in n for n in c0['notas']),
           'solo referencia: el plan usa paleta y ritmo (USE_AS_REFERENCE), no publica cuadros del video')
        await ev(f'ESTUDIO.marcar("{ids["spot_vp9.mp4"]}", {{final: true, roles: ["clip"]}}); ESTUDIO.marcar("{ids["logo.png"]}", {{final: true, roles: ["logo"]}}); ESTUDIO.marcar("{ids["packshot.jpg"]}", {{final: true, roles: ["producto"]}})')
        await pg.click('#generar'); await pg.wait_for_timeout(200)
        c1 = await ev('ESTUDIO.concepto()')
        segs = [s for p_ in c1['pistas'].values() for s in p_]
        fu = {f['filename'] for f in c1['fuentes']}
        ok(fu == {'spot_vp9.mp4', 'logo.png', 'packshot.jpg'} | ({'spot_h264.mp4'} if h264['status'] == 'READY' else set()), f'solo adjuntos READY entran al concepto ({sorted(fu)})')
        estr = await ev('ESTUDIO.ESTRATEGIAS')
        ok(all(s['modo'] in ('cubrir', 'master', 'contener', 'logo', 'paleta') for s in segs) and all(e in estr for s in segs for e in s['estrategias']),
           'plan por superficie sin estirar: cubrir (crop) · master A+B (split) · contener (reframe + fondo extendido) · logo · paleta')
        lg_seg = [s for s in c1['pistas']['media'] if s['modo'] == 'logo']
        ok(lg_seg and all(s['desde'] >= 10 and s['hasta'] <= 13 for s in lg_seg), 'el logo se usa solo en el cierre de marca (10–13 s)')
        ok({f['fx'] for f in c1['fx']} >= {'LIGHT WAVE', 'PRODUCT GLOW', 'SIGNATURE GLOW'} and len(c1['momentos']) == 5, 'FX LIGHT WAVE · PRODUCT GLOW · SIGNATURE GLOW y storyboard de 5 momentos')
        fmts = await ev('Object.values(ESTUDIO.FORMATOS).map(f => f.w + "×" + f.h)')
        ok(c1['derivadas'] and all(d['derivedFromAssetId'] and d['formatoDestino'].split(' ')[0] in fmts and 'Asset Validation M3A' in d['estado'] for d in c1['derivadas']) and len({d['nombre'] for d in c1['derivadas']}) == len(c1['derivadas']),
           f'{len(c1["derivadas"])} derivadas con derivedFromAssetId, formato real de la superficie y estado «requiere Asset Validation M3A»')
        sups = {d['superficie'] for d in c1['derivadas']}
        ok((c1['upperMode'] == 'master' and sups <= {'master', 'horizontal'}) or (c1['upperMode'] == 'independent' and 'master' not in sups),
           f'rendered campaign assets coherentes con el contrato v1: upperMode {c1["upperMode"]} → {sorted(sups)} (no se mezclan modos)')
        r = await ev('CONTENIDO.recorteCubrir(1920, 1080, 1152 / 576, [0.42, 0.5])')
        ok(abs(r[2] / r[3] - 2) < 1e-9 and r[2] == 1920, f'crop sin deformar: recorte {r[2]:.0f}×{r[3]:.0f} = 2:1 exacto para screen_a')
        await ev(f'ESTUDIO.marcar("{ids["spot_vp9.mp4"]}", {{rango: [2, 9]}})'); await pg.click('#generar'); await pg.wait_for_timeout(200)
        c2 = await ev('ESTUDIO.concepto()')
        sv_ = [s['src'] for p_ in c2['pistas'].values() for s in p_ if s.get('src')]
        ok(sv_ and all(2 - 1e-6 <= x['desde'] and x['hasta'] <= 9 + 1e-6 for x in sv_), 'source timeline: el rango elegido (2,0 → 9,0 s) manda sobre el sugerido')
        await pg.click('#c-aplicar'); await ev(f'{M}.seek(3.4)'); await pg.wait_for_timeout(800)
        qc = q['corrientes']['quads'][0]; u_, v_ = 0.15, 0.5   # zona izquierda del panel: fondo rojo del clip (el cuadrado amarillo está al centro)
        top = [qc[0][0] + (qc[1][0] - qc[0][0]) * u_, qc[0][1] + (qc[1][1] - qc[0][1]) * u_]; bot = [qc[3][0] + (qc[2][0] - qc[3][0]) * u_, qc[3][1] + (qc[2][1] - qc[3][1]) * u_]
        px = await ev(f'TRUST.pixel({top[0] + (bot[0] - top[0]) * v_},{top[1] + (bot[1] - top[1]) * v_})')
        ok(await ev('CONTENIDO.hayMedia()') and px[0] > 150 and px[1] < 90, f'preview aplicado: Corrientes muestra el clip subido a los 3,4 s ({px[:3]})')
        await ev(f'{M}.seek(7)'); await pg.wait_for_timeout(300)
        pe = [sum(p[0] for p in q['pellegrini']['quads'][0]) / 4, sum(p[1] for p in q['pellegrini']['quads'][0]) / 4]
        px2 = await ev(f'TRUST.pixel({pe[0]},{pe[1]})')
        ok(sum(abs(a_ - b_) for a_, b_ in zip(px2[:3], (200, 116, 42))) < 60, f'Product Hero: el producto del packshot (contenido, sin estirar) al centro de Pellegrini a los 7 s ({px2[:3]})')
        await pg.click('#c-quitar')
        ok(not await ev('CONTENIDO.hayMedia()'), '«Quitar media del preview» vuelve al contenido generado')
        await pg.click(f'.adj-quitar[data-id="{ids["notas.txt"]}"]')
        ok('notas.txt' not in [a['filename'] for a in await ev('ESTUDIO.adjuntos()')], '[remove] quita el adjunto')
        await pg.reload(); await pg.wait_for_function('window.TRUST && TRUST.info().W > 0'); await pg.evaluate('TRUST.motor.setTransicion(0)')

        # --- capturas de validación (posiciones reales, sin las sintéticas)
        await ev('document.getElementById("portada").classList.add("fuera")'); await pg.wait_for_timeout(700)
        await ev(f'{M}.setVista("dia")'); await pg.wait_for_timeout(200); await pg.screenshot(path=os.path.join(out, '01-dia.png'))
        await ev(f'{M}.setVista("noche")'); await pg.wait_for_timeout(200); await pg.screenshot(path=os.path.join(out, '02-noche.png'))
        await ev(f'{M}.cargarShow(); {M}.seek(8.2)'); await pg.wait_for_timeout(200); await pg.screenshot(path=os.path.join(out, '03-takeover.png'))
        await ev(f'{M}.pausa(); {M}.setFixture("SUP-01", 20); TRUST.seleccionar("SUP-01")'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(out, '04-luminaria-20.png'))
        await ev(f'{M}.restaurarNiveles()'); await pg.click('#generar'); await ev(f'{M}.seek(5)'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(out, '05-director-simulado.png'))
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
