// Posiciones de las 46 luminarias SOBRE fotos/trust-noche.jpg (coordenadas normalizadas 0..1 de ESA foto).
// Fuente: imagen anotada de Fer «UBICACIÓN REAL DE LUMINARIAS» (1024×1536, foto de día, otra perspectiva), recibida el 14/10/2026.
// Sus píxeles NO se copiaron: cada fila se transfirió por referencias de la fachada que se ven en las dos fotos.
//
// ROJO · nivel superior (16): sobre la cornisa que corre arriba de las ventanas de arco (borde superior leído sobre esta foto
//   con grilla de 0,01). Posición a lo largo de la fachada, lineal por tramos entre 3 anclas comunes:
//   borde izquierdo del edificio (anotada x≈100 → 0,118) · eje de la ochava / reloj (625 → 0,4875) ·
//   último círculo (944 → 0,722, la unión con la torre blanca). Corrección de Fer (14/10): la torre blanca de la derecha es
//   OTRO edificio; ninguna luminaria va sobre ella. La fila termina en la unión (bajada pluvial ≈ 0,727).
//   La anotada tiene 17 círculos rojos (numerales 5 y 8 repetidos, falta el 13) contra 16 de la leyenda: se mantuvieron los
//   extremos y la distribución dibujada y se re-muestrearon a 16 equipos por índice. A VALIDAR con Fer.
// AMARILLO · nivel medio (16): sobre el borde superior de la pantalla media (marquesina), con sus mismas 3 anclas:
//   amarilla 1 (101 → 0,101) · punto más alto (620 → 0,4473) · amarilla 16 (955 → 0,722, antes de la torre blanca).
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
    'SUP-10': [0.5043, 0.5992],
    'SUP-11': [0.5488, 0.6029],
    'SUP-12': [0.5878, 0.6061],
    'SUP-13': [0.6247, 0.6102],
    'SUP-14': [0.659, 0.6168],
    'SUP-15': [0.6906, 0.6231],
    'SUP-16': [0.722, 0.6292],
    'MED-01': [0.101, 0.859],
    'MED-02': [0.1337, 0.8543],
    'MED-03': [0.1704, 0.8477],
    'MED-04': [0.2078, 0.8407],
    'MED-05': [0.2465, 0.8329],
    'MED-06': [0.2845, 0.8253],
    'MED-07': [0.3232, 0.818],
    'MED-08': [0.3639, 0.8105],
    'MED-09': [0.4019, 0.8053],
    'MED-10': [0.4473, 0.8032],
    'MED-11': [0.5039, 0.8061],
    'MED-12': [0.5531, 0.8113],
    'MED-13': [0.5982, 0.8174],
    'MED-14': [0.6408, 0.8237],
    'MED-15': [0.6818, 0.8304],
    'MED-16': [0.722, 0.8364],
  },
};
