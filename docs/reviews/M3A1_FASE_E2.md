# M3A.1 — Fase E2: E2E de plataforma sin navegador (§41, §48)

**Estado:** entregado para auditoría. Lo autorizó el auditor al aprobar D3
(#27): "E2 — E2E de plataforma sin navegador, exactamente según
`docs/briefs/M3A1_FASE_E.md`". **E3 sigue sin autorización.** No toca
`apps/control`, M2C.2, la arquitectura de storage B1 ni el código de
producción.

**Rama:** `fase/m3a1-e2` desde `main@dca798d` (D3 mergeada). Brief: §E2.

## Resultados (ejecución real, 2026-10-09, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15 · ffprobe 6.1. Salida completa en `M3A1_FASE_E2_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK, sin dependencias nuevas |
| `pnpm verify` | 693 passed + 1 skipped. Lint: 0 errores y 12 warnings, los mismos que en `main` |
| `pnpm build` | OK |
| PostgreSQL 16 + ffprobe | **247 passed + 6 skipped** (9 nuevos: `e2e-flow.db.test.ts`) |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones | **4/4 nuevas `e2:` atrapadas** (tanda 240:244); autoprueba OK. La corrida completa de las 244 queda en CI. |
| E2E M2C (14) | No se corrió localmente: no hay Google Chrome con H.264. La evidencia es el job de CI. |

## Qué se entrega

1. **`apps/platform-api/src/e2e-flow.db.test.ts`**. Recorre §41 por **HTTP
   real**: Fastify escuchando en un puerto, PostgreSQL, ffprobe sobre fixtures
   reales, y login con contraseña, cookie y CSRF.
   - Cada rol entra con su login y sale con logout. El test verifica que la
     cookie muere en el servidor (`/auth/me` → 401).
   - Los pasos, en orden:
     1. **ADMIN**: crea el Advertiser y el Contract.
     2. **OPERATOR**: crea la Campaign y guarda el draft con
        `connectBuilderBackend` + `CampaignSession`, el código del Builder
        desde D3. Una revisión vieja recibe 409 sin escribir.
     3. **OPERATOR**: sube dos MP4 reales. ffprobe da resolución, fps, codec y
        duración; el `sha256` coincide con los bytes; un archivo que no es
        video recibe 422 `ASSET_CORRUPT`.
     4. **OPERATOR**: submit. El hash coincide con el recompilado localmente
        con el mismo compilador y preflight. El paquete referencia contenido,
        no ids. El OPERATOR no puede aprobar (403).
     5. **INTERNAL_APPROVER** (otro usuario): ve la versión, adjunta un PDF
        (SHA-256 verificado, descarga idéntica, fila inmutable), un hash
        distinto da 409 y aprueba el hash exacto.
     6. **OPERATOR**: APPROVED VERSION con el hash exacto y el WORKING DRAFT
        aparte, por API y en la vista del Builder.
     7. **OPERATOR**: edita la campaña. La fila de `show_versions` y la de
        `approvals` quedan idénticas.
     8. `verifyChain` OK y cada audit event con el actor de su rol.
   - Además, §48.18: del registro de Fastify, las únicas escrituras sobre
     `/show-versions` son POST que crean filas. No hay PUT/PATCH/DELETE, y la
     base rechaza UPDATE/DELETE.
2. **`docs/reviews/M3A1_ACEPTACION.md`**: los 19 puntos de §48, cada uno con
   el paso de E2, los tests específicos, el rol y el estado.
   - 18 cubiertos por la plataforma.
   - El 19 (M2C) está cubierto en CI.
   - El 2 (Builder) está cubierto a nivel API, sesión y store; el E2E de
     navegador es E3.
   - **M3A.1 no se declara cerrado**, porque falta el E2E de navegador de §41.
3. **4 mutaciones `e2:`**. Cada una solo la atrapa este test: aprobación que no
   publica la versión en la campaña, logout que no revoca la sesión, submit
   auditado con otro actor y validación de asset sin audit.

## Decisiones de Claude a validar

1. **Solo los usuarios se siembran por la base** (`createUser`): no hay
   endpoint de alta (es el CLI de C1). Todo lo demás pasa por HTTP.
2. **El draft se guarda con `@trust/builder-repository`** y no con PUT a mano,
   como pide el brief. El 409 de concurrencia sí se prueba con un PUT directo,
   para mostrar el contrato HTTP.
3. **El E2E vive en la suite de PostgreSQL** (job `postgres`, que ya tiene
   ffmpeg instalado): no hace falta un job nuevo.
4. **La matriz no da M3A.1 por cerrado**: §41 pide Playwright, y la UI y E3
   no están autorizadas.

## Propuestas de mejora (≤ 3)

- **BL-27 · Alta de usuarios por API solo para ADMIN** (hoy es el CLI de C1):
  permitiría que el E2E no toque la base y es lo que va a necesitar una UI de
  administración. Es una decisión de producto, no de E2. ~1 día.
