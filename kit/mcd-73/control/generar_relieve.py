"""Genera fotos/trust-relieve.jpg: el DETALLE FINO de la foto nocturna (molduras, pilastras, marcos, juntas), como paso alto
de la luminancia (foto − desenfoque gaussiano de 9 px), comprimido con tanh para no generar halos, más un modelado vertical (luz desde abajo:
caras inferiores de molduras algo más claras, sombra de contacto sobre cada saliente). Gris medio = sin detalle.
La foto original NO se modifica: este mapa es una capa aparte que el render usa en modo 'soft-light' para que la luz lea el relieve.
Uso, desde la raíz del repo: python3 -I kit/mcd-73/control/generar_relieve.py"""
import os
from PIL import Image, ImageFilter
import numpy as np
D = os.path.join(os.getcwd(), 'kit/mcd-73/control/fotos')
im = Image.open(os.path.join(D, 'trust-noche.jpg')).convert('RGB')
a = np.asarray(im).astype(np.float32) / 255
L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
bl = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(9))).astype(np.float32) / 255
# + modelado de luz DESDE ABAJO (bañadores ascendentes): caras inferiores de molduras más claras, sombra de contacto arriba
Ls = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255
d = 3
abajo = np.zeros_like(Ls); abajo[d:-d] = Ls[2 * d:] - Ls[:-2 * d]   # positivo si la piedra de abajo es más clara que la de arriba
g = np.clip(0.5 + np.tanh((L - bl) * 5.0) * 0.42 + np.tanh(abajo * 6.0) * 0.16, 0, 1)
Image.fromarray((g * 255).astype(np.uint8), 'L').save(os.path.join(D, 'trust-relieve.jpg'), quality=88)
print('trust-relieve.jpg OK')
