#!/usr/bin/env python3
"""Material de marca cifrado dentro del repo público (carpeta material/privado/).

El repo es público: las imágenes del cliente se guardan cifradas (sobre sellado X25519, libsodium).
La clave privada no se guarda en ningún lado: se deriva en el Action de un secret que ya existe
(TRUST_CLAVE) y la clave pública se publica en las anotaciones del check. Sin ese secret no se descifra.

  clave                      imprime la clave pública (en el Action, con CLAVE en el entorno)
  cifrar <pub> <archivos…>   cifra cada archivo en material/privado/<nombre>.enc (local, solo con la pública)
  descifrar <salida>         descifra material/privado/*.enc en <salida>/ (en el Action)
SIMULACIÓN CONCEPTUAL / mockup ilustrativo, no publicar.
"""
import base64, hashlib, hmac, os, pathlib, sys
from nacl.public import PrivateKey, PublicKey, SealedBox

PRIVADO = pathlib.Path(__file__).resolve().parent.parent / 'material' / 'privado'

def privada():
    clave = os.environ.get('CLAVE', '')
    if len(clave) < 6: sys.exit('falta CLAVE')
    return PrivateKey(hmac.new(clave.encode(), b'trust-material-v1', hashlib.sha256).digest())

def main(a):
    if a[:1] == ['clave']:
        print(base64.b64encode(bytes(privada().public_key)).decode())
    elif a[:1] == ['cifrar'] and len(a) >= 3:
        caja = SealedBox(PublicKey(base64.b64decode(a[1]))); PRIVADO.mkdir(exist_ok=True)
        for f in map(pathlib.Path, a[2:]):
            (PRIVADO / (f.name + '.enc')).write_bytes(caja.encrypt(f.read_bytes())); print('cifrado', f.name)
    elif a[:1] == ['descifrar'] and len(a) == 2:
        caja, out = SealedBox(privada()), pathlib.Path(a[1]); out.mkdir(parents=True, exist_ok=True)
        for f in sorted(PRIVADO.glob('*.enc')):
            (out / f.name[:-4]).write_bytes(caja.decrypt(f.read_bytes())); print('descifrado', f.name[:-4])
    else:
        sys.exit(__doc__)

if __name__ == '__main__':
    main(sys.argv[1:])
