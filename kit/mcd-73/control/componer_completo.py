"""Foto «Edificio completo» de alta definición: la foto base (fotos/trust-noche.jpg, 2560 px, ya retocada: sin las farolas
delante de la fachada) se apoya sobre la toma entera de Fer, ampliada a la misma escala y con el color igualado; solo
planta baja, vereda, calle y cielo vienen de la toma entera. Las dos farolas se quitan también de la parte baja.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/componer_completo.py   (después de generar_encuadre.py)
Salida: fotos/trust-noche-completa.jpg (reemplaza la de generar_encuadre.py) y actualiza ancho/alto/sha256 en encuadres.js.
Las fotos de origen no se modifican."""
import os, re, json, hashlib
import cv2, numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__)); F = os.path.join(AQUI, 'fotos')
txt = open(os.path.join(AQUI, 'encuadres.js')).read()
ENC = json.loads(txt[txt.index('{'):txt.rindex('}') + 1])
rx, ry, rw, rh = ENC['completo']['rect']
B = cv2.imread(os.path.join(F, 'trust-noche.jpg')).astype(np.float32)
C = cv2.imread(os.path.join(F, 'trust-noche-completa-alineada.jpg')).astype(np.float32)
k = B.shape[1] / (rw * C.shape[1])                       # ampliación para que la base quede 1:1
W, H = int(round(C.shape[1] * k)), int(round(C.shape[0] * k))
U = cv2.resize(C, (W, H), interpolation=cv2.INTER_LANCZOS4)
# nitidez moderada en lo ampliado (no inventa detalle: realza el que hay)
bl = cv2.GaussianBlur(U, (0, 0), 2.2); U = np.clip(U + 0.55 * (U - bl), 0, 255)
x0, y0 = int(round(rx * W)), int(round(ry * H)); bw, bh = B.shape[1], B.shape[0]
x1, y1 = min(W, x0 + bw), min(H, y0 + bh); B = B[: y1 - y0, : x1 - x0]
# color: ajuste por canal (cuadrático) de la toma entera hacia la base, medido en la zona común
reg = U[y0:y1, x0:x1]; mues = np.s_[::6, ::6]
for c in range(3):
    a = reg[..., c][mues].ravel(); b = B[..., c][mues].ravel()
    co = np.polyfit(a, b, 2); U[..., c] = np.clip(np.polyval(co, U[..., c]), 0, 255)
# fusión: la base manda; borde suave de 60 px hacia la toma entera (sobre todo abajo)
al = np.ones((y1 - y0, x1 - x0), np.float32); f = 60
ramp = np.linspace(0, 1, f, dtype=np.float32)
al[-f:] *= ramp[::-1][:, None]; al[:f] *= ramp[:, None]
O = U.copy(); O[y0:y1, x0:x1] = B * al[..., None] + U[y0:y1, x0:x1] * (1 - al[..., None])
# farolas: debajo de la foto base todavía se ven los dos postes. Se tapan clonando la fachada de al lado (como un sello de
# clonado: conserva las líneas horizontales de pisos y vidrieras), con bordes fundidos. Sin IA.
ya, yb = y1 - f, int(0.812 * H)
for xn in ENC['completo'].get('farolas_x', []):
    xn, desp = xn if isinstance(xn, list) else (xn, 1)
    xc = int(round(xn * W)); ancho = int(0.0105 * W); xa, xb = xc - ancho, xc + ancho; d = int(round(desp * 0.049 * W))   # un módulo de fachada
    src = O[ya:yb, xa + d:xb + d].copy()
    mezcla = np.ones(xb - xa, np.float32); e = 5; mezcla[:e] = np.linspace(0, 1, e); mezcla[-e:] = np.linspace(1, 0, e)
    vert = np.ones(yb - ya, np.float32); vert[:f] = np.linspace(0, 1, f)
    m = (vert[:, None] * mezcla[None, :])[..., None]
    O[ya:yb, xa:xb] = src * m + O[ya:yb, xa:xb] * (1 - m)
cv2.imwrite(os.path.join(F, 'trust-noche-completa.jpg'), np.clip(O, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
sha = hashlib.sha256(open(os.path.join(F, 'trust-noche-completa.jpg'), 'rb').read()).hexdigest()
ENC['completo'].update({ 'ancho': W, 'alto': H, 'sha256': sha, 'composicion': 'foto base retocada (2560 px) + toma entera ampliada ×%.3f y con color igualado; farolas quitadas' % k })
open(os.path.join(AQUI, 'encuadres.js'), 'w').write(txt[:txt.index('{')] + json.dumps(ENC, ensure_ascii=False, indent=1) + ';\n')
print(W, H, round(k, 4))
