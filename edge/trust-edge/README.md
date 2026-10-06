# TRUST EDGE

> Placeholder. No implementado en el MVP.

Servicio local instalado en el edificio. Ejecuta shows contra hardware real
(Art-Net/sACN/DMX, procesadores LED).

- Sin internet o sin CONTROL → **DEGRADED_OFFLINE**: sigue la programación
  cacheada.
- Fallo local, contenido inválido, seguridad, watchdog u operador →
  **SAFE_MODE**.

Definición canónica: `docs/architecture/OPERATING_STATES.md`.
