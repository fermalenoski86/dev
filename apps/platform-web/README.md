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

Rutas: `/login`, `/campaigns` (lista y alta), `/campaigns/<id>` (versión
aprobada y working draft, assets, envío) y `/versions/<id>` (revisión,
evidencia y aprobación de cuatro ojos). `NEXT_PUBLIC_TRUST_BUILDER_URL`
(opcional) es la base de `apps/control` para el enlace al Builder
(`/?campaign=<id>`).

```bash
# API (otra terminal): TRUST_CORS_ORIGINS=http://localhost:3002 pnpm --filter @trust/platform-api start
NEXT_PUBLIC_TRUST_API_URL=http://localhost:4000 pnpm --filter @trust/platform-web dev
```

En desarrollo por `http://localhost` la cookie no es `Secure` y no lleva el
prefijo `__Host-`; los puertos no separan cookies, así que esto **no** prueba la
topología de producción. El gate multihost (hosts distintos con TLS) es de E3c.

## Build para desplegar (BL-30)

`NEXT_PUBLIC_*` se **incrusta en el build**: el artefacto queda atado a esa API
y no se puede promover a otro entorno con otra API (se construye uno por
entorno). Un build para desplegar se hace con `TRUST_BUILD_STRICT=1`: falla si
`NEXT_PUBLIC_TRUST_API_URL` falta o no es https, y si
`NEXT_PUBLIC_TRUST_BUILDER_URL`, cuando está, no es https. El `pnpm build` del
gate `verify-build` no usa la bandera: compila, y la app muestra el error de
configuración en runtime.

```bash
TRUST_BUILD_STRICT=1 NEXT_PUBLIC_TRUST_API_URL=https://api.<site> \
  NEXT_PUBLIC_TRUST_BUILDER_URL=https://control.<site> pnpm --filter @trust/platform-web build
```

