"""Encuadre COMPLETO (edificio entero con planta baja y calle), alineado con la foto base calibrada.
Uso (desde la raíz del repo): python3 -I kit/mcd-73/control/generar_encuadre.py
La foto base (fotos/trust-noche.jpg) es un recorte de la MISMA toma que Fer mandó entera (fotos/trust-noche-completa-original.jpg).
Se buscan puntos en común (SIFT + RANSAC), se corrige la mínima rotación para que la relación sea una escala + desplazamiento
exactos, se recorta (planta baja y calle incluidas) y se escribe encuadres.js con el rectángulo que ocupa la foto base dentro de
la completa. Así TODA la calibración aprobada (pantallas, reloj, 46 luminarias, máscaras) vale tal cual en las dos vistas:
no se recalibra nada a mano ni se toca la geometría aprobada. La foto original no se modifica."""
import os, json, hashlib
import cv2, numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(AQUI, 'fotos')
base = cv2.imread(os.path.join(F, 'trust-noche.jpg')); orig = cv2.imread(os.path.join(F, 'trust-noche-completa-original.jpg'))
g1, g2 = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY), cv2.cvtColor(orig, cv2.COLOR_BGR2GRAY)
sift = cv2.SIFT_create(8000)
k1, d1 = sift.detectAndCompute(g1, None); k2, d2 = sift.detectAndCompute(g2, None)
pares = [m for m, n in cv2.BFMatcher().knnMatch(d1, d2, k=2) if m.distance < 0.75 * n.distance]
p1 = np.float32([k1[m.queryIdx].pt for m in pares]); p2 = np.float32([k2[m.trainIdx].pt for m in pares])
A, ok = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=3.0)
s = float(np.hypot(A[0, 0], A[1, 0])); rot = float(np.degrees(np.arctan2(A[1, 0], A[0, 0])))
inl = ok.ravel().astype(bool)
err = np.hypot(*(cv2.transform(p1[inl][None], A)[0] - p2[inl]).T)
# corregir la rotación: J = S ∘ A⁻¹ aplicado a la original, con S(base) = s·base + t (sin rotación)
t = A[:, 2]
Ai = cv2.invertAffineTransform(A)
S = np.array([[s, 0, t[0]], [0, s, t[1]]])
M = S[:, :2] @ Ai[:, :2]; M = np.hstack([M, (S[:, :2] @ Ai[:, 2:] + S[:, 2:])])
J = cv2.warpAffine(orig, M, (orig.shape[1], orig.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
# recorte: desde un poco de cielo sobre el edificio hasta la senda peatonal
y0, y1 = 570, 1900
C = J[y0:y1]
cv2.imwrite(os.path.join(F, 'trust-noche-completa-alineada.jpg'), C, [cv2.IMWRITE_JPEG_QUALITY, 95])
cv2.imwrite(os.path.join(F, 'trust-noche-completa.jpg'), C, [cv2.IMWRITE_JPEG_QUALITY, 92])
H, W = C.shape[:2]
rect = [t[0] / W, (t[1] - y0) / H, base.shape[1] * s / W, base.shape[0] * s / H]
sha = hashlib.sha256(open(os.path.join(F, 'trust-noche-completa.jpg'), 'rb').read()).hexdigest()
ENC = {
  'completo': { 'nombre': 'Edificio completo', 'archivo': 'fotos/trust-noche-completa.jpg', 'ancho': W, 'alto': H, 'sha256': sha,
    'relieve': 'fotos/trust-relieve-completa.jpg', 'cielo': 'fotos/trust-cielo-completa.png', 'rect': [round(v, 6) for v in rect],
    'farolas_x': [[0.4728, 1], [0.6537, -1]],   # postes de las dos farolas frente a la fachada (x normalizada en el encuadre)
    'calibracion': { 'metodo': 'SIFT + RANSAC (similaridad) contra la foto base', 'puntos': int(inl.sum()), 'error_px_mediana': round(float(np.median(err)), 2),
      'rotacion_corregida_grados': round(rot, 3), 'escala': round(s, 5), 'nota': 'misma toma que la foto base; la foto base ocupa el rectángulo rect' } },
  'cerca': { 'nombre': 'Fachada (encuadre original)', 'archivo': 'fotos/trust-noche.jpg', 'ancho': base.shape[1], 'alto': base.shape[0],
    'relieve': 'fotos/trust-relieve.jpg', 'cielo': 'fotos/trust-cielo.png', 'rect': [0, 0, 1, 1] },
}
open(os.path.join(AQUI, 'encuadres.js'), 'w').write('// Generado por generar_encuadre.py: no editar a mano.\n// rect = [x, y, ancho, alto] de la foto base calibrada dentro de cada encuadre (0..1).\nwindow.ENCUADRES = ' + json.dumps(ENC, ensure_ascii=False, indent=1) + ';\n')
print(json.dumps(ENC['completo']['calibracion']), ENC['completo']['rect'], W, H)
