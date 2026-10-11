# e2e-platform — E2E de plataforma (§41, §47) · M3A.1 E3c

Playwright contra el stack **real**, separado de los 14 de M2C congelados
(`e2e/`, `playwright.config.ts`). Config: `playwright.platform.config.ts`.
CI: job `e2e-platform` en `.github/workflows/gates.yml`.

## Qué levanta `global-setup.ts`

- **TLS de test:** certificado autofirmado generado con `openssl` (no se
  versiona) y un terminador (`tls-proxy.mjs`) en `:8443` que enruta por `Host`:
  - `web.trust.test` → platform-web (`next start`, :3002);
  - `control.trust.test` → apps/control, el Builder (:3001);
  - `api.trust.test` → platform-api (:4000);
  - `evil.trust.test` → la misma web, desde un origen **no** listado.
  Chrome resuelve `*.trust.test` a 127.0.0.1 con `--host-resolver-rules`: son
  hosts distintos, no solo puertos (ADR-063).
- **Backend:** `apps/platform-api/scripts/e2e-stack.ts`.
  - PostgreSQL descartable y migrada;
  - usuarios con el **CLI de C1**, uno por rol y por worker (BL-25), con
    contraseñas generadas que solo quedan en un directorio temporal 0700;
  - API con `createServer` en modo producción: cookie `__Host-trust_session` y
    `TRUST_CORS_ORIGINS` con web y control.
- **Datos por worker:** advertiser y contrato propios, creados por la API como
  ADMIN de ese worker.

## Specs

| Spec | Qué prueba |
|---|---|
| `session-multihost.spec.ts` | Gate del [P1] del brief: la cookie solo existe para el host de la API; el Builder hace `/auth/me` (200) y `PUT` con CSRF; un origen no listado no lee ni escribe; después del logout, el Builder recibe 401 |
| `flow-41.spec.ts` | §41 exacto con los tres logins por la UI, en contextos nuevos y sin `storageState`. Screenshots de §47 por paso y video de cada test |
| `a11y.spec.ts` | BL-28: axe con cero violaciones (login, campañas, detalle, revisión) y el recorrido principal solo con teclado, con foco visible y errores anunciados |
| `history.spec.ts` | BL-31: el aprobador va de una versión al historial de su campaña (más nueva primero), abre otra versión desde ahí; axe sin violaciones en `/campaigns/[id]/versions` |

Los títulos llevan `[E3-41]` y `[E3-47]`. El job corre
`pnpm acceptance:check --playwright-results …` (BL-23) y exige que cada uno haya
**pasado**.

## Evidencia §47 (BL-29)

`node scripts/e2e-platform/manifest.mjs build` arma `e2e-platform-evidence/`
con los screenshots, los videos y `evidence-manifest.json`:
- commit y navegador;
- roles, campaignId, versionId y hash;
- specs con el resultado de cada test;
- el SHA-256 de cada archivo.

`validate` lo verifica, y CI lo sube como artifact `e2e-platform-evidence` con
`retention-days: 90`. No se versionan binarios.

## Correrlo local

```bash
bash scripts/dev/pg-up.sh
(cd apps/platform-web && NEXT_PUBLIC_TRUST_API_URL=https://api.trust.test:8443 \
  NEXT_PUBLIC_TRUST_BUILDER_URL=https://control.trust.test:8443 npx next build)
(cd apps/control && NEXT_PUBLIC_TRUST_API_URL=https://api.trust.test:8443 npx next build)
npm i --no-save --prefix /tmp/pw @playwright/test@1.56.1 @axe-core/playwright@4.10.2
NODE_PATH=/tmp/pw/node_modules TRUST_CHROMIUM_PATH=/ruta/a/chrome E2E_WORKERS=2 \
  /tmp/pw/node_modules/.bin/playwright test -c playwright.platform.config.ts
```

Los puertos 3001, 3002, 4000 y 8443 tienen que estar libres.
