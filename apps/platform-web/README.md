# @trust/platform-web

UI de plataforma de M3A.1 (E3): login, campañas y, desde E3b, revisión y
aprobación de cuatro ojos. Brief: `docs/briefs/M3A1_FASE_E3.md`. Arquitectura
de sesión: ADR-063 en `docs/architecture/DECISIONS.md`.

- Consume **solo** `platform-api`, **directo desde el navegador**
  (`NEXT_PUBLIC_TRUST_API_URL`), con `credentials: 'include'` y el
  `X-CSRF-Token` de C1. No hay proxy ni rewrites.
- La API tiene que listar el origen de esta app en `TRUST_CORS_ORIGINS`.
- En producción: hosts HTTPS del mismo site (`web.<site>`, `control.<site>`,
  `api.<site>`).

```bash
# API (otra terminal): TRUST_CORS_ORIGINS=http://localhost:3002 pnpm --filter @trust/platform-api start
NEXT_PUBLIC_TRUST_API_URL=http://localhost:4000 pnpm --filter @trust/platform-web dev
```

En desarrollo por `http://localhost` la cookie no es `Secure` y no lleva el
prefijo `__Host-`; los puertos no separan cookies, así que esto **no** prueba la
topología de producción. El gate multihost (hosts distintos con TLS) es de E3c.
