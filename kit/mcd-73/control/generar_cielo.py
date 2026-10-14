"""Máscara de CIELO de la foto nocturna (para la vista Día simulada). No toca la foto: genera fotos/trust-cielo.png (alfa = cielo).
Uso: python3 -I kit/mcd-73/control/generar_cielo.py [foto.jpg salida.png]  (por defecto, la foto base)
Criterio: píxeles oscuros, con dominante azul y textura lisa (el cielo no tiene ventanas ni molduras), conectados con el borde
superior (relleno por inundación). Bordes suavizados 2 px. Se valida a ojo con la captura de la vista Día."""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
from collections import deque

AQUI = os.path.dirname(os.path.abspath(__file__))
ENT, SAL = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ('trust-noche.jpg', 'trust-cielo.png')
im = np.asarray(Image.open(os.path.join(AQUI, 'fotos', ENT)).convert('RGB')).astype(np.float32)
H, W, _ = im.shape
# trabajo a 1/4 para velocidad
s = 4 if W > 2000 else 2
sm = np.asarray(Image.fromarray(im.astype(np.uint8)).resize((W // s, H // s), Image.BILINEAR)).astype(np.float32)
h, w, _ = sm.shape
r, g, b = sm[..., 0], sm[..., 1], sm[..., 2]
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
# textura: desvío local en ventana 5×5
from numpy.lib.stride_tricks import sliding_window_view
pad = np.pad(lum, 2, mode='edge'); var = sliding_window_view(pad, (5, 5)).std(axis=(-1, -2))
umbral = max(40, float(np.median(lum[:3])) + 20)   # el cielo de cada toma tiene su propio brillo
cand = (lum < umbral) & (b - r > 9) & (var < 2.6)
mask = np.zeros((h, w), bool); q = deque()
for x in range(w):
    if cand[0, x]: mask[0, x] = True; q.append((0, x))
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        yy, xx = y + dy, x + dx
        if 0 <= yy < h and 0 <= xx < w and not mask[yy, xx] and cand[yy, xx] and abs(lum[yy, xx] - lum[y, x]) < 3.5:
            mask[yy, xx] = True; q.append((yy, xx))
# borde: el halo oscuro entre cielo y edificio (resplandor del cielo urbano) también es cielo; crece hasta 3 pasos sobre lo oscuro
suelto = (lum < umbral + 12) & (b >= r - 2)
for _ in range(3):
    vec = np.zeros_like(mask); vec[1:] |= mask[:-1]; vec[:-1] |= mask[1:]; vec[:, 1:] |= mask[:, :-1]; vec[:, :-1] |= mask[:, 1:]
    mask = mask | (vec & suelto)
m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
m = m.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2))
alfa = np.asarray(m)
out = np.zeros((H, W, 4), np.uint8); out[..., 3] = alfa
Image.fromarray(out, 'RGBA').save(os.path.join(AQUI, 'fotos', SAL), optimize=True)
print('cielo: %.1f %% de la foto' % (alfa.mean() / 2.55))
