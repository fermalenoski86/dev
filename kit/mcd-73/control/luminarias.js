// Posiciones de las 46 luminarias SOBRE fotos/trust-noche.jpg (coordenadas normalizadas 0..1 de ESA foto).
// Fuente: imagen anotada de Fer «UBICACIÓN REAL DE LUMINARIAS» (1024×1536, foto de día, otra perspectiva), recibida el 14/10/2026.
// Sus píxeles NO se copiaron: cada fila se transfirió por referencias de la fachada que se ven en las dos fotos.
//
// ROJO · nivel superior (16): sobre la cornisa que corre arriba de las ventanas de arco (borde superior leído sobre esta foto
//   con grilla de 0,01). Posición a lo largo de la fachada, lineal por tramos entre 4 anclas comunes:
//   borde izquierdo del edificio (anotada x≈100 → 0,118) · eje de la ochava / reloj (625 → 0,4875) ·
//   unión con la torre blanca (893 → 0,735) · borde derecho de la torre (980 → 0,838).
//   La anotada tiene 17 círculos rojos (numerales 5 y 8 repetidos, falta el 13) contra 16 de la leyenda: se mantuvieron los
//   extremos y la distribución dibujada y se re-muestrearon a 16 equipos por índice. A VALIDAR con Fer.
// AMARILLO · nivel medio (16): sobre el borde superior de la pantalla media (marquesina), con sus mismas 3 anclas:
//   extremo izquierdo (87 → 0,092) · punto más alto (620 → 0,4473) · extremo derecho (947 → 0,748).
// VERDE · nivel inferior (14): sobre los locales de planta baja. Esa franja queda FUERA DE CUADRO en esta foto (corta un piso
//   debajo de la marquesina): se controlan igual en el panel y el timeline, pero no se dibujan. No se inventa su lugar.
// Ubicaciones PRELIMINARES de presentación: no son plano de montaje ni verificación física.
window.LUMINARIAS = {
  foto_sha256: '8ac8a62f0ee6de8348f59061e385ae024a2f6bd1de87daa030d21abf1d87aeee',
  calibracion: { por: 'Claude, sobre la imagen anotada de Fer', fecha: '2026-10-14', referencia: 'imagen anotada 1024×1536', fuera_de_cuadro: ['inferior'] },
  puntos: {
    'SUP-01': [0.1293, 0.6624],
    'SUP-02': [0.1632, 0.6562],
    'SUP-03': [0.1998, 0.6471],
    'SUP-04': [0.2406, 0.6389],
    'SUP-05': [0.284, 0.6289],
    'SUP-06': [0.3313, 0.6135],
    'SUP-07': [0.3774, 0.5996],
    'SUP-08': [0.4197, 0.596],
    'SUP-09': [0.4607, 0.5965],
    'SUP-10': [0.5086, 0.5994],
    'SUP-11': [0.5645, 0.6043],
    'SUP-12': [0.6135, 0.6084],
    'SUP-13': [0.6598, 0.617],
    'SUP-14': [0.7029, 0.6256],
    'SUP-15': [0.7449, 0.6321],
    'SUP-16': [0.7954, 0.6367],
    'MED-01': [0.1013, 0.859],
    'MED-02': [0.134, 0.8542],
    'MED-03': [0.1707, 0.8476],
    'MED-04': [0.208, 0.8406],
    'MED-05': [0.2467, 0.8329],
    'MED-06': [0.2846, 0.8252],
    'MED-07': [0.3233, 0.818],
    'MED-08': [0.364, 0.8104],
    'MED-09': [0.402, 0.8053],
    'MED-10': [0.4473, 0.8032],
    'MED-11': [0.5108, 0.8067],
    'MED-12': [0.5659, 0.813],
    'MED-13': [0.6165, 0.8201],
    'MED-14': [0.6643, 0.8275],
    'MED-15': [0.7103, 0.8348],
    'MED-16': [0.748, 0.8394],
  },
};
