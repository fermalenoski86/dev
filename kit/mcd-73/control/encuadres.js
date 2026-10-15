// Generado por generar_encuadre.py: no editar a mano.
// rect = [x, y, ancho, alto] de la foto base calibrada dentro de cada encuadre (0..1).
window.ENCUADRES = {
 "completo": {
  "nombre": "Edificio completo",
  "archivo": "fotos/trust-noche-completa.jpg",
  "ancho": 2570,
  "alto": 2872,
  "sha256": "71ba348cf2c96f185feda4231f7eaff62a1db3fd72563f198f2cb0159b05ba27",
  "relieve": "fotos/trust-relieve-completa.jpg",
  "cielo": "fotos/trust-cielo-completa.png",
  "rect": [
   0.001175,
   0.009267,
   0.996171,
   0.603376
  ],
  "farolas_x": [
   [
    0.4728,
    1
   ],
   [
    0.6537,
    -1
   ]
  ],
  "calibracion": {
   "metodo": "SIFT + RANSAC (similaridad) contra la foto base",
   "puntos": 279,
   "error_px_mediana": 1.2,
   "rotacion_corregida_grados": 0.055,
   "escala": 0.46306,
   "nota": "misma toma que la foto base; la foto base ocupa el rectángulo rect"
  },
  "composicion": "foto base retocada (2560 px) + toma entera ampliada ×2.160 y con color igualado; farolas quitadas"
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
