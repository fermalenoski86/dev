"""Parte el paquete offline del kit #73 en dos ZIP de menos de 30 MiB cada uno (límite de adjuntos del chat).

Uso (después de paquete.py):  python3 -I kit/mcd-73/partir.py <dir_salida>
Lee <dir_salida>/TRUST-McDonalds-kit-offline/ y escribe al lado:
  TRUST-McDonalds-kit-offline-parte1-videos-consola.zip  (video/, consola/, index.html, LEEME.txt, SHA256SUMS.txt)
  TRUST-McDonalds-kit-offline-parte2-pdf-imagenes.zip    (pdf/, imagenes/, LEEME.txt, SHA256SUMS.txt)
Las dos partes usan la misma carpeta raíz: descomprimidas en el mismo lugar reconstruyen el paquete completo.
Verificar con:  kit/mcd-73/verificar_paquete.sh <parte1.zip> <parte2.zip>
"""
import os, sys, zipfile

LIMITE = 30 * 1024 * 1024
OUT = os.path.abspath(sys.argv[1])
NAME = 'TRUST-McDonalds-kit-offline'
P = os.path.join(OUT, NAME)
assert os.path.isdir(P), f'falta {P}: correr antes paquete.py'

COMUNES = ['LEEME.txt', 'SHA256SUMS.txt']
PARTES = [
    ('parte1-videos-consola', ['video', 'consola', 'index.html'] + COMUNES),
    ('parte2-pdf-imagenes', ['pdf', 'imagenes'] + COMUNES),
]

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

todos = {os.path.relpath(os.path.join(r, f), P) for r, _, fs in os.walk(P) for f in fs}
cubiertos = set()
for sufijo, entradas in PARTES:
    z = os.path.join(OUT, f'{NAME}-{sufijo}.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel in archivos(entradas):
            zf.write(os.path.join(P, rel), os.path.join(NAME, rel))
            cubiertos.add(rel)
    tam = os.path.getsize(z)
    assert tam < LIMITE, f'{z}: {tam} bytes >= 30 MiB'
    print(f'{os.path.basename(z)}  {tam} bytes ({tam / 1048576:.1f} MiB)')
faltan = sorted(todos - cubiertos)
assert not faltan, f'archivos fuera de las partes: {faltan}'
print(f'OK: {len(todos)} archivos repartidos en {len(PARTES)} partes, cada una < 30 MiB')
