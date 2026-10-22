"""Ajustes a las piezas guardadas en R2 (las de «Piezas y shows guardados»), aplicados al publicar.

Lee r2_ajustes.json:
  ocultar   -> piezas cuyo título contiene alguno de estos textos: su meta.json pasa a meta.oculta.json
               (desaparecen de la galería y del simulador; reversible renombrando el archivo de vuelta).
  renombrar -> {texto del título actual: campos que se reemplazan en el meta.json}.
Las comparaciones ignoran mayúsculas y acentos. Informa todo como anotaciones del check (nunca imprime secretos).
Uso: python3 r2_ajustes.py r2_ajustes.json  (con CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en el entorno)
"""
import json, os, subprocess, sys, tempfile, unicodedata, urllib.request, urllib.parse

BUCKET = 'trust-piezas'
W = ['npx', '--yes', 'wrangler@4.20.0']


def norma(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s).lower()) if unicodedata.category(c) != 'Mn').strip()


def listar(prefijo):
    acct, tok, claves, cursor = os.environ['CLOUDFLARE_ACCOUNT_ID'], os.environ['CLOUDFLARE_API_TOKEN'], [], None
    while True:
        q = {'prefix': prefijo, 'per_page': '1000'}
        if cursor: q['cursor'] = cursor
        url = f'https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/{BUCKET}/objects?' + urllib.parse.urlencode(q)
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': f'Bearer {tok}'})))
        claves += [o['key'] for o in r.get('result') or []]
        cursor = (r.get('result_info') or {}).get('cursor')
        if not (r.get('result_info') or {}).get('is_truncated') or not cursor: return claves


def wr(*args):
    subprocess.run(W + ['r2', 'object', *args, '--remote'], check=True, capture_output=True)


def leer(clave):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f: ruta = f.name
    wr('get', f'{BUCKET}/{clave}', '--file', ruta)
    return json.load(open(ruta, encoding='utf-8'))


def escribir(clave, datos):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f: json.dump(datos, f, ensure_ascii=False); ruta = f.name
    wr('put', f'{BUCKET}/{clave}', '--file', ruta, '--content-type', 'application/json')


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    ocultar = [norma(x) for x in cfg.get('ocultar', [])]
    renombrar = {norma(k): v for k, v in cfg.get('renombrar', {}).items()}
    metas = [k for k in listar('piezas/') if k.endswith('/meta.json')]
    hechos, titulos = [], []
    for k in metas:
        m = leer(k); t = norma(m.get('titulo', ''))
        titulos.append(m.get('titulo', '?'))
        if any(x in t for x in ocultar):
            escribir(k[:-len('meta.json')] + 'meta.oculta.json', m); wr('delete', f'{BUCKET}/{k}')
            hechos.append(f"oculta «{m.get('titulo')}»"); continue
        for x, campos in renombrar.items():
            if x in t:
                m.update(campos); escribir(k, m); hechos.append(f"«{x}» → «{m.get('titulo')}»")
    print(f"::notice title=piezas R2::{len(metas)} guardadas: {' · '.join(titulos)[:900]}")
    print(f"::notice title=ajustes R2::{' · '.join(hechos) if hechos else 'nada para cambiar'}")


if __name__ == '__main__':
    main()
