"""Parte el paquete offline del kit #73 en ZIP de menos de 30 MiB cada uno (límite de adjuntos del chat).

Uso (después de paquete.py):  python3 -I kit/mcd-73/partir.py <dir_salida>
Lee <dir_salida>/TRUST-McDonalds-kit-offline/ y escribe al lado:
  TRUST-McDonalds-kit-offline-parte1-presentacion.zip  (control/, consola/, pdf/, imagenes/, index.html, ABRIR-PRESENTACION.txt, LEEME.txt, SHA256SUMS.txt)
  TRUST-McDonalds-kit-offline-parte2-videos.zip, parte3-videos.zip, …  (video/ repartido por tamaño, + LEEME.txt y SHA256SUMS.txt)
Desde las 6 creatividades (14/10) los videos ya no entran en una sola parte: la cantidad de partes la decide el tamaño.
Todas usan la misma carpeta raíz: descomprimidas en el mismo lugar reconstruyen el paquete completo.
Verificar con:  kit/mcd-73/verificar_paquete.sh <parte1.zip> <parte2.zip> …
"""
import os, sys, zipfile

LIMITE = 30 * 1024 * 1024
OBJETIVO = 27 * 1024 * 1024  # margen para cabeceras del ZIP y comprimidos que no achican
OUT = os.path.abspath(sys.argv[1])
NAME = 'TRUST-McDonalds-kit-offline'
P = os.path.join(OUT, NAME)
assert os.path.isdir(P), f'falta {P}: correr antes paquete.py'

COMUNES = ['LEEME.txt', 'SHA256SUMS.txt']

def archivos(entradas):
    for e in entradas:
        full = os.path.join(P, e)
        if os.path.isdir(full):
            for raiz, _, fs in os.walk(full):
                for f in sorted(fs):
                    yield os.path.relpath(os.path.join(raiz, f), P)
        else:
            assert os.path.isfile(full), f'falta {full}'
            yield e

# Videos: primero el más grande, cada uno a la primera parte donde entra (first-fit decreasing).
videos = sorted(archivos(['video']), key=lambda r: -os.path.getsize(os.path.join(P, r)))
cajas = []
for v in videos:
    t = os.path.getsize(os.path.join(P, v))
    assert t < OBJETIVO, f'{v}: {t} bytes no entra en una parte'
    for c in cajas:
        if c[0] + t <= OBJETIVO:
            c[0] += t; c[1].append(v); break
    else:
        cajas.append([t, [v]])
PARTES = [('parte1-presentacion', list(archivos(['control', 'consola', 'pdf', 'imagenes', 'index.html', 'ABRIR-PRESENTACION.txt'] + COMUNES)))]
PARTES += [(f'parte{i + 2}-videos', sorted(c[1]) + COMUNES) for i, c in enumerate(cajas)]

for viejo in os.listdir(OUT):  # no dejar partes de una corrida anterior mezcladas con las nuevas
    if viejo.startswith(NAME + '-parte') and viejo.endswith('.zip'):
        os.remove(os.path.join(OUT, viejo))

todos = {os.path.relpath(os.path.join(r, f), P) for r, _, fs in os.walk(P) for f in fs}
cubiertos = set()
for sufijo, rels in PARTES:
    z = os.path.join(OUT, f'{NAME}-{sufijo}.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel in rels:
            zf.write(os.path.join(P, rel), os.path.join(NAME, rel))
            cubiertos.add(rel)
    tam = os.path.getsize(z)
    assert tam < LIMITE, f'{z}: {tam} bytes >= 30 MiB'
    print(f'{os.path.basename(z)}  {tam} bytes ({tam / 1048576:.1f} MiB)')
faltan = sorted(todos - cubiertos)
assert not faltan, f'archivos fuera de las partes: {faltan}'
print(f'OK: {len(todos)} archivos repartidos en {len(PARTES)} partes, cada una < 30 MiB')
