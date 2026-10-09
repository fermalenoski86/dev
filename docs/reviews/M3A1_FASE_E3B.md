# M3A.1 — Fase E3b: campaña, assets, envío y aprobación de cuatro ojos en `apps/platform-web`

**Estado:** entregado para auditoría. Autorizado al aprobar E3a
([#34](https://github.com/fermalenoski86/dev/pull/34)): "comenzar E3b … detalle
de campaña, assets, submit, revisión, evidencia y aprobación de cuatro ojos".
No toca `platform-api` (ni rutas ni lógica), `apps/control`, M2C.2, `e2e/` ni
la arquitectura de storage B1.

**Rama:** `fase/m3a1-e3b` desde `main@4034ac2`. Brief: `docs/briefs/M3A1_FASE_E3.md` §E3b.

## Resultados (ejecución real, 2026-10-09, este entorno)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15 · ffprobe 6.1. Salida en `M3A1_FASE_E3B_SALIDA.txt`.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK, sin dependencias nuevas (el lockfile no cambia) |
| `pnpm verify` | **740 passed + 1 skipped** (21 nuevos de platform-web). Lint: 0 errores y los mismos 12 warnings |
| `pnpm build` | OK. Rutas nuevas `/campaigns/[id]` y `/versions/[id]` (dinámicas, `next start`) |
| PostgreSQL 16 | **267 passed + 6 skipped** (3 nuevos: `platform-web-e3b.db.test.ts`) |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones | **9/9 nuevas `e3b:` atrapadas** (tanda 258:267); autoprueba OK. La corrida completa de las 267 queda en CI |
| acceptance | 19 puntos y 12 tags (solo cambia el motivo de E3-41/E3-47) |
| `docs:contract` | `openapi.json` sin diff |
| E2E M2C (14) | **No ejecutado localmente** (no hay Chrome con H.264). Evidencia: job `e2e-m2c` de CI |

**Smoke de navegador real del flujo §41** (no es gate). Chromium con hosts
`web.trust.test` / `api.trust.test`, API real con ffprobe y `next start`:
1. OPERATOR crea la campaña, sube dos MP4 reales (READY con su SHA-256) y uno
   falso (REJECTED con motivo), los asigna al draft, envía y ve el hash.
2. Logout → 401.
3. INTERNAL_APPROVER abre el enlace, ve el mismo hash, adjunta un PDF y
   aprueba.
4. OPERATOR, con un login nuevo, ve APPROVED VERSION v1 con el hash exacto y
   el WORKING DRAFT aparte.

**El smoke encontró un bug**, ya corregido con test y mutación:
`crypto.randomUUID` no existe en un origen http que no sea localhost, y el
upload fallaba. Detalle en la SALIDA.

## Qué se entrega

1. **Cliente** (`apps/platform-web/src/lib/api.ts`):
   - `getCampaign`, `getDraft` y `putDraft` (`expectedRevision`; un 409 llega
     con sus detalles);
   - `listAssets` y `uploadAsset`: multipart con los campos antes que el
     archivo, `Idempotency-Key` y CSRF. Un 422 con `details.asset` vuelve como
     asset **REJECTED** con su motivo y remediación;
   - `submit` (`draftRevision` + `Idempotency-Key`);
   - `getVersion`, `uploadEvidence`, `approve` (evidencia + `versionHash`) y
     `reject` (motivo + `versionHash`), cada uno con su `Idempotency-Key`;
   - `evidenceUrl`;
   - `randomKey()`: UUID v4 con `getRandomValues` cuando no hay `randomUUID`.
2. **`/campaigns/[id]`** (`CampaignDetail`):
   - **APPROVED VERSION vN con el hash exacto** y **WORKING DRAFT rev R**, por
     separado (§32);
   - enlace al Builder `<NEXT_PUBLIC_TRUST_BUILDER_URL>/?campaign=<id>` (D3);
   - tabla de ranuras del draft con el asset asignado (nombre + SHA-256);
   - **assets**: upload, lista con estado, formato (ffprobe), SHA-256, motivo
     y remediación de un rechazo, y botón "Usar en <ranura>" para los READY
     (ver decisión 1);
   - **envío**: `submit` de la revisión vigente. Muestra vN, el estado, el
     **hash exacto** (§41 "hash visible") y el enlace de revisión.
3. **`/versions/[id]`** (`VersionReview`):
   - estado, hash exacto, aviso de cuatro ojos y assets por SHA-256;
   - evidencia con enlace de descarga (attachment desde el host de la API);
   - adjuntar evidencia (PDF, EMAIL o MESSAGE);
   - **aprobar**: exige elegir la evidencia y marcar "Apruebo exactamente la
     versión con hash <hash>". La UI cita el hash que muestra;
   - **rechazar**: con motivo.
   - Los errores del servidor (cuatro ojos, hash distinto, permisos) se
     muestran tal cual: la UI no duplica reglas.
   - Una versión ya decidida muestra la decisión y el hash citado, sin
     formularios.
4. **Accesibilidad** (BL-28, parte E3b): etiquetas en todos los campos,
   `role="alert"` para errores, `role="status"` para resultados, `caption` y
   `scope` en las tablas, y un checkbox con label para confirmar el hash.
5. **Tests**:
   - `apps/platform-api/src/platform-web-e3b.db.test.ts` (3): el flujo de §41
     con el cliente de la web contra la API real (HTTP, PostgreSQL, ffprobe
     sobre fixtures reales, CORS y CSRF), rol por rol y haciendo lo mismo que
     los componentes. Cubre:
     - asset READY y REJECTED;
     - asignación con `expectedRevision` y un 409 sin pisar nada;
     - submit con hash, y el operador no puede aprobar (403);
     - evidencia con descarga byte a byte, un hash distinto da 409 y la
       aprobación del hash exacto;
     - la edición posterior no cambia la versión aprobada.
   - El helper `navegador.testkit.ts` queda compartido con
     `platform-web-client.db.test.ts`.
   - Unitarios: `api-e3b.test.ts` (8), `draft-assets.test.ts` (3) y
     `views-e3b.test.ts` (10).
6. **9 mutaciones `e3b:`**:
   - la asignación pisa todas las superficies;
   - se puede asignar un asset no READY;
   - upload sin `Idempotency-Key`;
   - un REJECTED se trata como error;
   - el submit cita otra revisión;
   - se puede aprobar sin confirmar el hash;
   - §32 muestra la revisión del draft como versión aprobada;
   - §41 no muestra el hash enviado;
   - la key depende de `randomUUID`.

## Decisiones de Claude a validar

1. **"Usar en <ranura>": `platform-web` escribe SOLO `surfaces.<slot>` del
   draft.** El Builder (apps/control, congelado) usa su registro local de
   assets y no puede elegir un asset subido a la plataforma. Sin esto, el
   submit de §41 no tiene contenido real. La escritura:
   - toma el draft vigente del servidor;
   - cambia una sola ranura (misma tabla que `SLOT_SURFACE` del submit);
   - usa `expectedRevision`, así que un 409 no pisa al Builder;
   - no inventa estructura si el draft no tiene `surfaces`.

   Moments, duración y el resto del draft siguen siendo del Builder. Si el
   auditor lo considera fuera de alcance, la alternativa es un issue
   `decisión-producto` (por ejemplo, un selector de assets de plataforma en el
   Builder, que hoy está congelado).
2. **El aprobador llega a la versión por el enlace** que ve el operador al
   enviar (`/versions/<id>`). La API no tiene una lista de versiones por
   campaña, y el brief no autoriza rutas nuevas. Ver BL-31.
3. **Aprobar exige confirmar explícitamente el hash mostrado** (checkbox con
   el hash en el label), además de la evidencia que exige la API. El rechazo
   exige motivo.
4. **Las rutas de detalle son dinámicas** (`ƒ`, `next start`): son client
   components con `useParams`, sin `output: export`.

## Propuestas de mejora (≤ 3)

- **BL-31 · `GET /api/v1/campaigns/:id/versions`** (solo lectura, roles
  internos, paginado por número de versión).
  - Problema: hoy el aprobador necesita el enlace que le pasa el operador;
    tampoco hay historial de versiones en la UI.
  - Beneficio: bandeja de revisión y trazabilidad para el cliente.
  - Prioridad P2, ~0,5 día (ruta + OpenAPI + tests + vista). Decide el
    auditor si entra en E3c o después.
  - Criterio: un INTERNAL_APPROVER ve las versiones SUBMITTED de las campañas
    que puede leer, sin ids en la URL compartida; un rol sin lectura recibe
    403.
