// Generado por generar_encuadre.py: no editar a mano.
// rect = [x, y, ancho, alto] de la foto base calibrada dentro de cada encuadre (0..1).
window.ENCUADRES = {
 "completo": {
  "nombre": "Edificio completo",
  "archivo": "fotos/trust-noche-completa.jpg",
  "ancho": 1190,
  "alto": 1330,
  "sha256": "9e316afc773a92ca044dc7a3273e9a3d47ceda0c047da3503f0b312a5f18a970",
  "relieve": "fotos/trust-relieve-completa.jpg",
  "cielo": "fotos/trust-cielo-completa.png",
  "rect": [
   0.001175,
   0.009267,
   0.996171,
   0.603376
  ],
  "calibracion": {
   "metodo": "SIFT + RANSAC (similaridad) contra la foto base",
   "puntos": 279,
   "error_px_mediana": 1.2,
   "rotacion_corregida_grados": 0.055,
   "escala": 0.46306,
   "nota": "misma toma que la foto base; la foto base ocupa el rectángulo rect"
  }
 },
 "cerca": {
  "nombre": "Fachada (encuadre original)",
  "archivo": "fotos/trust-noche.jpg",
  "ancho": 2560,
  "alto": 1733,
  "relieve": "fotos/trust-relieve.jpg",
  "cielo": "fotos/trust-cielo.png",
  "rect": [
   0,
   0,
   1,
   1
  ]
 }
};
