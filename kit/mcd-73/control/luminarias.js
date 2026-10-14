// Posiciones de las 46 luminarias SOBRE fotos/trust-noche.jpg (coordenadas normalizadas 0..1 de ESA foto).
// Fuente obligatoria: la imagen anotada de Fer «UBICACIÓN REAL DE LUMINARIAS» (ROJO superior 16 · AMARILLO medio 16 · VERDE inferior 14).
// Esa imagen es OTRA foto y OTRA perspectiva: sus píxeles NO se copian acá. Cada punto se ubica a mano sobre esta foto
// (editor de posiciones: Shift+E) mirando la imagen anotada, y se anota abajo quién y cuándo lo calibró.
// Mientras un equipo no tenga posición, se controla igual (panel y timeline) pero no se dibuja su luz sobre la foto.
// Ubicaciones PRELIMINARES de presentación: no son plano de montaje ni verificación física.
window.LUMINARIAS = {
  foto_sha256: '8ac8a62f0ee6de8348f59061e385ae024a2f6bd1de87daa030d21abf1d87aeee', // se valida contra GEOMETRIA.foto.noche.sha256 al cargar
  calibracion: null, // p. ej. { por: 'Claude con Fer', fecha: '2026-10-14', referencia: 'imagen anotada 1024×1536' }
  puntos: {
    // 'SUP-01': [x, y], ...
  },
};
