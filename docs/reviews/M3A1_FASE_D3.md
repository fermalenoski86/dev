# M3A.1 — Fase D3: el Builder usa el repositorio (§31, §32)

**Estado:** entregado para auditoría. **Alcance autorizado por Fer en #15
(opción 1):** el store del Builder con `CampaignRepository` inyectado + un
indicador de versión. **No se tocan** la experiencia ejecutiva, el renderer,
la geometría ni los screenshots; los 14 E2E de M2C siguen siendo gate.

**Rama:** `fase/m3a1-d3` desde `main@ba928e5` (E1 aprobada y mergeada en #23).
Brief: `docs/briefs/M3A1_FASE_D.md` §D3. ADR-062. Detalle técnico:
`docs/platform/BUILDER_REPOSITORY.md` §D3.

## Resultados (ejecución real, 2026-10-09, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15. Salida completa en `M3A1_FASE_D3_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK. Solo una dependencia interna nueva: `apps/control` → `@trust/builder-repository` (workspace). Sin paquetes externos nuevos. |
| `pnpm verify` | **693 passed + 1 skipped** (24 nuevos). Lint: 0 errores y 12 warnings, los mismos que en `main`. |
| `pnpm build` | OK (`apps/control` incluido). |
| PostgreSQL 16 | **238 passed + 6 skipped** (6 nuevos contra la API real). |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones | **12/12 nuevas `d3:` atrapadas** (tanda 228:240). Corrida completa de las 240: ver `_SALIDA.txt` y el job `mutations` de CI. |
| E2E M2C (14) | **No se corrió localmente**: no hay Google Chrome con H.264. La evidencia es el job `e2e-m2c` de CI. `e2e/` no cambia. |

## Qué se entrega

1. **`CampaignSession`** (`packages/builder-repository/src/session.ts`). La
   lógica de concurrencia vive fuera de React, donde se prueba sin DOM:
   - serializa los guardados: nunca dos PUT en paralelo; si se encolan varios,
     sube **solo el último**;
   - el `expectedRevision` sale del repositorio (`status().revision`), nunca
     del componente;
   - publica una `CampaignView` (fase, revisión, versión aprobada, conflicto,
     error, copia local) para el indicador;
   - expone las tres salidas de §9 sin decidir nada sola.
   - `connectBuilderBackend()` lee el CSRF de la sesión de C1 en
     `GET /api/v1/auth/me` y compone `SyncingCampaignRepository` +
     `ApiCampaignRepository` de D2 con el `fetch` inyectado (§31).
   - `campaignIdFromSearch()`: solo un uuid en `?campaign=`.
2. **Store del Builder** (`apps/control/src/state/useBuilderStore.ts`):
   - `campaign` / `campaignSession`. **Sin sesión, `save()` es el de M2C sin
     cambios.**
   - Con sesión, el autosave delega en la sesión. Queda `SAVED` solo si lo
     confirmado es el draft que está en pantalla.
   - Un conflicto o un error dejan el draft sucio: preset o import piden
     confirmación.
   - Si la campaña no abre, el error se muestra y el autosave sigue local:
     nunca hacia una campaña no abierta.
   - `openCampaign` (inyectable), `connectCampaign`, `syncCampaign`,
     `resolveConflict`.
3. **Indicador** (`apps/control/src/components/builder/CampaignStatus.tsx`):
   APPROVED VERSION vN (solo lectura, §32), WORKING DRAFT rev R, estado y los
   tres botones de §9 con confirmación. "Duplicar" ofrece descargar la copia
   local. **Sin campaña no renderiza nada.**
4. **`TakeoverBuilder.tsx`** (+23 líneas): al montar, con `?campaign=` abre la
   campaña (si falla, `loadFromStorage()` de M2C); escucha `online` para
   subir lo pendiente; monta `<CampaignStatus />` junto al badge de guardado.
5. **Tests**:
   - 11 unitarios de `CampaignSession` y la composición;
   - 7 del store (incluido "sin campaña: M2C no cambia");
   - 6 del indicador (render estático, sin DOM);
   - 6 contra la API real (Fastify + PostgreSQL + sesión C1).
   - `vitest.config.ts` suma `apps/control/src/**/*.test.ts` y el runtime JSX
     automático.

## Qué NO cambia

- La experiencia ejecutiva (`app/experience`), el renderer, la geometría, los
  screenshots y `e2e/`.
- El formato de `trust.builder.draft.v1` y el protocolo de dos claves de D2.
- La API (sin rutas nuevas), la base y la arquitectura de storage B1.

## Decisiones de Claude a validar

1. **Activación por `?campaign=<uuid>`** en vez de una ruta nueva: es la
   adaptación mínima de §42. Sin el parámetro, M2C queda idéntico.
2. **La sesión vive en el paquete y no en el store**: la concurrencia se prueba
   sin React y el store queda delgado (ADR-062).
3. **Conflicto y error = draft sucio**: así ningún preset o import pisa trabajo
   en conflicto sin confirmar.
4. **"Duplicar" no crea una campaña**: adopta el draft del servidor y ofrece
   descargar la copia. Crear la campaña requiere UI de contratos (Fase E).
5. **Campaña que no abre → Builder local**, con el error visible. No se
   inventa un modo intermedio.

## Límites conocidos

- No hay login en el Builder (Fase E). La sesión de C1 tiene que existir en el
  navegador, con cookie del mismo origen. Sin sesión: `ERROR · UNAUTHENTICATED`
  y el Builder sigue local.
- El flujo con `?campaign=` no tiene E2E de navegador: el set de M2C está
  congelado y levantar la API en Playwright es de Fase E. El comportamiento se
  cubre con:
  - el store y el indicador en la suite default;
  - la sesión contra la API real.

## Propuestas de mejora (≤ 3)

- **BL-25 · E2E del Builder con backend** (Fase E): Playwright con la API y
  PostgreSQL efímeros, abrir con `?campaign=`, editar, conflicto desde otra
  pestaña y resolver. Fuera del set congelado de M2C. ~1 día.
- **BL-26 · Reintento con backoff de lo pendiente**: además del evento
  `online`, un reintento exponencial acotado (p. ej. 5 s → 5 min). Hoy, si el
  backend vuelve sin que cambie la conectividad del navegador, lo pendiente
  espera al próximo autosave. ~0,5 día.
