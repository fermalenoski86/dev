# M3A.1 — Fase D2: repositorio del Builder (§31) y offline/conflicto (§9)

**Estado:** entregado para auditoría. D3 sigue **bloqueado** por el issue #15
(decisión de Fer). **No se toca `apps/control`, `show-authoring` ni el formato
de `DraftStorage`.** B, C, D1 y M2C.2 no cambian.

**Rama:** `fase/m3a1-d2` desde `main@164f518` (D1 aprobada y mergeada en #16).
Brief: `docs/briefs/M3A1_FASE_D.md` §D2 + decisiones 6 y 7 del auditor. ADR-061.
Detalle técnico: `docs/platform/BUILDER_REPOSITORY.md`.

## Resultados (ejecución real, 2026-10-08, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16. Salida completa en `M3A1_FASE_D2_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK. Paquete nuevo `@trust/builder-repository`; dependencias: `@trust/show-authoring` y `zod` (ya presente en el monorepo). |
| `pnpm verify` | **659 passed + 1 skipped**. Lint: 0 errores y 12 warnings, los mismos que en `main`. |
| `pnpm build` | OK |
| PostgreSQL 16 | **215 passed + 6 skipped**. Nuevos: 7 contra la API real. |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones (209 reglas) | corrida completa: **209/209 atrapadas** (9 nuevas de D2) |
| E2E M2C (14) | **No se corrió localmente** porque no hay Chrome con H.264. La evidencia es el job `e2e-m2c` de CI. |

## Qué se entrega

1. **`@trust/builder-repository`** (paquete nuevo, decisión 6):
   - `CampaignRepository`: `open`, `save(draft, expectedRevision)` y `status`.
   - `LocalCampaignRepository`: usa `saveDraft`/`loadDraft` tal cual, sin cambiar el formato.
   - `ApiCampaignRepository`: `fetch` inyectado, cookie y CSRF de C1, Zod en las respuestas.
   - `SyncingCampaignRepository`: guarda local siempre. Si no hay conexión, queda `pending` hasta `sync()`. Si el servidor responde 409, queda `conflict` y no se sube nada.
   - Las tres salidas de §9: `recoverServer`, `keepLocal` y `duplicateAsNew`. Esta última no escribe nada remoto (decisión 7).
2. **Tests**:
   - 17 unitarios: storage en memoria y un doble de la API.
   - 7 contra la API real de D1, con Fastify escuchando, PostgreSQL y sesiones reales. Cubren:
     - el ciclo offline → online → conflicto, con la base intacta;
     - las tres salidas, verificando revisión, contenido y la cantidad de `DRAFT_UPDATED`;
     - el PUT confirmado sin respuesta;
     - reabrir con trabajo pendiente;
     - CSRF y roles.
3. **9 mutaciones `d2:`**:
   - last-write-wins ante el 409;
   - `save` sin guardar local;
   - PUT sin CSRF;
   - `keepLocal` sin rebasar;
   - PUT perdido tomado como conflicto;
   - conflicto real tomado como propio;
   - local sin chequeo de revisión;
   - metadata de otra campaña;
   - offline sin `pending`.
4. **Docs**: `docs/platform/BUILDER_REPOSITORY.md`, ADR-061 y el estado de D2 en el brief.

## Decisiones (para validar)

1. **"Mantener local" sube.** Hace el PUT sobre la `serverRevision` que el
   usuario vio en el conflicto. Es una elección explícita y queda en el audit
   como `DRAFT_UPDATED`. Si el servidor volvió a cambiar, es otro conflicto:
   no hay reintento automático. La alternativa era dejarlo solo local, pero
   entonces el conflicto nunca se cierra.
2. **La metadata de sync va en una clave aparte por campaña**
   (`trust.builder.sync.v1:<campaignId>`). El draft sigue en
   `trust.builder.draft.v1` con el formato de M2C. Así el Builder actual, sin
   backend, sigue viendo el último draft.
3. **PUT confirmado sin respuesta.** Ante un 409, el repositorio lee el draft
   del servidor. Si la revisión coincide y el contenido es el mismo (sin
   importar el orden de claves), devuelve `saved` en vez de conflicto. Sin
   esto, un corte de red en el momento justo produce un conflicto falso contra
   el propio trabajo.
4. **502, 503 y 504 cuentan como "sin conexión"** (el cambio queda
   `pending`); el resto de los errores HTTP son `RepositoryError`.
5. **`open()` también devuelve `approvedVersion`**, la última APROBADA de
   `GET /campaigns/:id`. Es lo que D3 necesita para mostrar
   "APPROVED VERSION vN / WORKING DRAFT" (§32), sin otra llamada desde la UI.

## No hecho a propósito

- D3: el Builder no usa todavía el repositorio (issue #15).
- No hay UI de conflicto.
- No se crea la campaña nueva al "duplicar" (decisión 7).
- No hay sync automático por eventos `online`/`offline` del navegador: eso es
  de la UI (D3), y el repositorio expone `sync()`.
- BL-19, BL-20 y BL-21 siguen en el backlog.

## Propuestas de mejora (≤ 3)

- **BL-22 · Avisar el conflicto antes de editar.** Al reabrir con trabajo
  `pending`, el Builder puede saber si el servidor avanzó (`revision` de
  `GET /draft` mayor que `baseRevision`) antes del primer PUT, y mostrarlo
  apenas abre. Hoy se ve en el primer `sync`. Es solo cliente, ~0,5 día, y
  pertenece a D3.
