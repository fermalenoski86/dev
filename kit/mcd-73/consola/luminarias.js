// Posiciones de las 46 luminarias RGBW sobre base-trust-noche.jpg (coordenadas normalizadas 0..1, x hacia la derecha, y hacia abajo).
// FUENTE ÚNICA: la leyenda de la imagen anotada de Fer «UBICACIÓN REAL DE LUMINARIAS» (#73, 14/10/2026):
// ROJA = nivel superior (16), AMARILLA = nivel medio (16), VERDE = nivel inferior (14). Corrige el 14/16/16 anterior.
// Las coordenadas de referencia están en luminarias-referencia.json, en el espacio de ESA imagen (1024×1536):
// no se aplican a base-trust-noche.jpg (otra perspectiva) sin calibración visual; ahí hay 17 círculos rojos
// visibles contra 16 declarados, pendiente de validar con Fer.
// Mientras `puntos` esté vacío, la consola NO dibuja luces sobre la foto: no se inventan coordenadas.
// Para cargarlas: abrir consola.html → "Editor de posiciones" → marcar sobre la foto siguiendo la imagen anotada → "Exportar" y pegar acá.
// Ubicaciones PRELIMINARES para presentación: no son plano de montaje ni verificación física.
window.LUMINARIAS = {
  fuente: null, // p. ej. "imagen anotada de Fer, 13/10/2026"
  lineas: {
    roja:     { nombre: "Superior (cornisa bajo ventanas altas)", n: 16, puntos: [] },
    amarilla: { nombre: "Media (cornisa intermedia)",             n: 16, puntos: [] },
    verde:    { nombre: "Inferior (sobre marquesina / local)",     n: 14, puntos: [] }
  }
};
