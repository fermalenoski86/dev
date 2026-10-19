"""TRUST Control · kit #73 — generación con IA real (Claude como director + fal como generador).
SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar.

Contrato de salida FIJO (no lo decide ninguna IA):
  Corrientes 576×288 (2:1) · Pellegrini 720×288 (2,5:1) · Media 960×206 (4,66:1) · 46 luminarias RGBW · 15 s.
Flujo por pieza:
  1. Claude (director) lee el brief y devuelve un plan JSON: un prompt visual por pantalla (sin texto ni logos),
     el movimiento opcional y la ficha de luces (efecto, paleta, zonas…) que después valida TRUST Control.
  2. fal genera cada imagen al formato panorámico de su pantalla (Flux 2 Pro).
  3. Control de calidad: Claude mira cada imagen y la rechaza si tiene texto, letras, logos, marcas, rostros
     protagonistas o mala lectura en panorámico; se regenera hasta 2 veces con la corrección que indique.
  4. Opcional: un clip de 5 s (Kling 2.5 Turbo Pro, image-to-video) desde la imagen aprobada.
  5. Recorte exacto al píxel de cada pantalla + informe con costo estimado.
Tope de gasto: se corta antes de pasar el presupuesto del pedido (fal no trae tope por defecto).
Las claves llegan por variables de entorno (GitHub Secrets): nunca se imprimen ni se escriben.
Uso: python3 generar.py pedido.json salida/"""
import base64, io, json, os, sys, time, urllib.request, urllib.error

from PIL import Image

FAL, ANT = os.environ.get('FAL_KEY', ''), os.environ.get('ANTHROPIC_API_KEY', '')
MODELO = os.environ.get('MODELO_CLAUDE', 'claude-sonnet-5-5')
PANTALLAS = {   # px reales del LED · tamaño de generación (múltiplos de 16, ~2–2,6 MP)
    'corrientes': {'px': (576, 288), 'gen': (2048, 1024), 'nombre': 'Corrientes (superior izquierda, 2:1)'},
    'pellegrini': {'px': (720, 288), 'gen': (2560, 1024), 'nombre': 'Pellegrini (superior derecha, 2,5:1)'},
    'media': {'px': (960, 206), 'gen': (2400, 512), 'nombre': 'Media (banda horizontal sobre el primer piso, 4,66:1)'},
}
PRECIO = {'imagen_mp': 0.03, 'imagen_mp_extra': 0.015, 'claude': 0.02, 'video5s': 0.35}
GASTO = {'usd': 0.0, 'detalle': []}


def gastar(concepto, usd, tope):
    if GASTO['usd'] + usd > tope:
        raise SystemExit(f'TOPE: {concepto} llevaría el gasto a USD {GASTO["usd"] + usd:.2f} (tope {tope}). Se corta acá.')
    GASTO['usd'] += usd; GASTO['detalle'].append((concepto, round(usd, 3)))


def http(url, cuerpo=None, cab=None, metodo=None, intentos=3):
    for k in range(intentos):
        try:
            req = urllib.request.Request(url, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                         headers=dict({'Content-Type': 'application/json'}, **(cab or {})), method=metodo)
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            msg = e.read()[:400].decode('utf8', 'replace')
            if e.code in (429, 500, 502, 503, 529) and k < intentos - 1: time.sleep(5 * (k + 1)); continue
            raise SystemExit(f'HTTP {e.code} en {url.split("?")[0]}: {msg}')
        except urllib.error.URLError:
            if k < intentos - 1: time.sleep(5); continue
            raise


def bajar(url):
    with urllib.request.urlopen(url, timeout=600) as r: return r.read()


# ---------- Claude ----------
def claude(sistema, contenido, max_tokens=2000):
    r = http('https://api.anthropic.com/v1/messages', {'model': MODELO, 'max_tokens': max_tokens, 'system': sistema,
             'messages': [{'role': 'user', 'content': contenido}]},
             {'x-api-key': ANT, 'anthropic-version': '2023-06-01'})
    txt = ''.join(b.get('text', '') for b in r.get('content', []))
    i, j = txt.find('{'), txt.rfind('}')
    return json.loads(txt[i:j + 1])


DIRECTOR = """Sos director de arte de un edificio con pantallas LED frente al Obelisco (Buenos Aires): EL TRUST.
Salida FIJA, nunca la cambies: 3 pantallas y 46 luminarias RGBW de fachada, show de 15 s.
- corrientes: panel superior izquierdo, 2:1. pellegrini: panel superior derecho, 2,5:1. Entre los dos está la cúpula
  (un hueco físico): nada importante puede quedar partido entre ambos; cada pantalla tiene que leerse sola.
- media: banda muy panorámica 4,66:1 sobre el primer piso; ideal para texturas, horizontes, movimiento lateral.
Reglas de las imágenes (las genera otro modelo a partir de tus prompts en inglés):
- SIN texto, letras, números, logos, marcas, envases con marca ni rostros protagonistas. Los textos y la marca los pone
  el sistema después, desde el pack oficial del cliente. Pedí envases lisos y genéricos.
- Fotografía publicitaria de producto, iluminación de estudio, alto contraste, fondos limpios y oscuros que se lean de
  noche a 80 m de distancia; el sujeto principal centrado y con aire a los costados (el LED se ve en panorámico).
- Las 3 imágenes forman una campaña coherente (misma luz y paleta), pero cada una con un encuadre propio de su formato.
Devolvé SOLO JSON:
{"titulo": "...", "concepto": "una frase en español",
 "corrientes": {"prompt": "..."}, "pellegrini": {"prompt": "..."}, "media": {"prompt": "..."},
 "video": {"pantalla": "corrientes|pellegrini|null", "movimiento": "prompt en inglés de movimiento de cámara lento"},
 "ficha": {"efecto": "barrido|ola|latido|destello|degrade|respiracion|persecucion", "paleta": ["#RRGGBB", "..."],
           "zonas": [], "velocidad": 1, "titular": "texto corto en español para que el sistema lo ponga (o vacío)"}}"""

CONTROL = """Sos control de calidad de piezas para pantallas LED publicitarias. Mirá la imagen y respondé SOLO JSON:
{"ok": true|false, "texto_o_letras": bool, "logo_o_marca": bool, "rostro_protagonista": bool,
 "lectura_panoramica": "buena|regular|mala", "defectos": "breve", "correccion": "instrucción en inglés para regenerar, o vacío"}
Rechazá (ok=false) si hay cualquier texto, letra o número legible, logo o marca, envase con marca, rostro protagonista,
deformaciones visibles del producto, o si el sujeto queda cortado o perdido en el formato panorámico."""


def revisar(img_bytes, pantalla):
    b64 = base64.b64encode(img_bytes).decode()
    gastar(f'control {pantalla}', PRECIO['claude'], TOPE)
    return claude(CONTROL, [{'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': b64}},
                            {'type': 'text', 'text': f'Pantalla: {PANTALLAS[pantalla]["nombre"]}.'}], 600)


# ---------- fal ----------
def costo_imagen(w, h):
    mp = -(-(w * h) // 1_000_000)
    return PRECIO['imagen_mp'] + PRECIO['imagen_mp_extra'] * max(0, mp - 1)


def fal_cola(modelo, entrada):
    cab = {'Authorization': f'Key {FAL}'}
    r = http(f'https://queue.fal.run/{modelo}', entrada, cab)
    est, res = r['status_url'], r['response_url']
    for _ in range(240):
        s = http(est, cab=cab, metodo='GET')
        if s.get('status') == 'COMPLETED': return http(res, cab=cab, metodo='GET')
        if s.get('status') in ('FAILED', 'ERROR'): raise SystemExit(f'fal {modelo}: {s}')
        time.sleep(4)
    raise SystemExit(f'fal {modelo}: tiempo agotado')


def imagen(prompt, w, h, semilla):
    gastar(f'imagen {w}x{h}', costo_imagen(w, h), TOPE)
    r = fal_cola('fal-ai/flux-2-pro', {'prompt': prompt, 'image_size': {'width': w, 'height': h}, 'seed': semilla,
                                       'output_format': 'jpeg', 'safety_tolerance': '2'})
    return bajar(r['images'][0]['url']), r['images'][0]['url']


def video(url_imagen, movimiento):
    gastar('video 5 s', PRECIO['video5s'], TOPE)
    r = fal_cola('fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
                 {'prompt': movimiento + '. Slow, smooth, premium commercial. No text, no logos.', 'image_url': url_imagen,
                  'duration': '5', 'negative_prompt': 'text, letters, logo, watermark, blur, distortion, people faces'})
    return bajar(r['video']['url'])


def recortar(img_bytes, px):   # «cubrir» centrado al píxel exacto de la pantalla
    im = Image.open(io.BytesIO(img_bytes)).convert('RGB'); W, H = im.size; a = px[0] / px[1]
    cw, ch = (W, W / a) if W / H < a else (H * a, H)
    x0, y0 = (W - cw) / 2, (H - ch) / 2
    return im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch))).resize(px, Image.LANCZOS)


TOPE = 6.0


def main():
    global TOPE
    if not FAL or not ANT: raise SystemExit('Faltan FAL_KEY o ANTHROPIC_API_KEY (GitHub Secrets).')
    pedido = json.load(open(sys.argv[1])); sal = sys.argv[2]; os.makedirs(sal, exist_ok=True)
    TOPE = float(pedido.get('tope_usd', 6))
    informe = ['# Piezas generadas con IA — SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar', '',
               f'Modelo director: {MODELO} · imágenes: Flux 2 Pro (fal) · video: Kling 2.5 Turbo Pro (fal) · tope USD {TOPE}', '']
    for n, pz in enumerate(pedido['piezas']):
        d = os.path.join(sal, pz['id']); os.makedirs(d, exist_ok=True)
        gastar(f'director {pz["id"]}', PRECIO['claude'], TOPE)
        plan = claude(DIRECTOR, f'Brief del cliente: {pz["brief"]}\nVideo pedido: {"sí" if pz.get("video") else "no"}.')
        json.dump(plan, open(os.path.join(d, 'plan.json'), 'w'), ensure_ascii=False, indent=1)
        informe += [f'## {pz["id"]} · {plan.get("titulo", "")}', '', plan.get('concepto', ''), '']
        urls = {}
        for k, (pid, P) in enumerate(PANTALLAS.items()):
            prompt = plan[pid]['prompt'] + ' Absolutely no text, no letters, no numbers, no logos, no brand marks.'
            for intento in range(3):
                b, url = imagen(prompt, *P['gen'], semilla=1000 * n + 10 * k + intento)
                qc = revisar(b, pid)
                if qc.get('ok'): break
                prompt = plan[pid]['prompt'] + ' ' + (qc.get('correccion') or '') + ' Absolutely no text, no letters, no logos.'
            open(os.path.join(d, f'{pid}-hd.jpg'), 'wb').write(b)
            recortar(b, P['px']).save(os.path.join(d, f'{pid}.jpg'), quality=92)
            urls[pid] = url
            informe.append(f'- {pid}: {"aprobada" if qc.get("ok") else "RECHAZADA (se deja la última para revisión)"} '
                           f'en {intento + 1} intento(s) · lectura {qc.get("lectura_panoramica", "?")} · {qc.get("defectos", "")}')
        v = plan.get('video') or {}
        if pz.get('video') and v.get('pantalla') in urls:
            open(os.path.join(d, f'{v["pantalla"]}-video.mp4'), 'wb').write(video(urls[v['pantalla']], v.get('movimiento', 'slow push-in')))
            informe.append(f'- video 5 s en {v["pantalla"]}: {v.get("movimiento", "")}')
        informe.append('')
    informe += ['## Costo estimado', ''] + [f'- {c}: USD {u:.3f}' for c, u in GASTO['detalle']] + ['', f'**Total estimado: USD {GASTO["usd"]:.2f}**']
    open(os.path.join(sal, 'INFORME.md'), 'w').write('\n'.join(informe) + '\n')
    print(f'listo · {len(pedido["piezas"])} piezas · USD {GASTO["usd"]:.2f} estimado')


if __name__ == '__main__':
    try:
        main()
    except BaseException as e:   # el error queda publicado en la rama de salida (sin claves: los mensajes no las incluyen)
        sal = sys.argv[2] if len(sys.argv) > 2 else '.'
        os.makedirs(sal, exist_ok=True)
        open(os.path.join(sal, 'ERROR.txt'), 'w').write(f'{type(e).__name__}: {e}\nGasto estimado hasta el corte: USD {GASTO["usd"]:.2f}\n{GASTO["detalle"]}\n')
        raise
