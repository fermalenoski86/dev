/**
 * P-02 · Manifiesto de entregables: la ÚNICA fuente de `docs/collab/PROGRESO.md`
 * (`pnpm progress:generate`; CI corre `pnpm progress:check`).
 *
 * Es un archivo de DATOS, no de memoria: cada línea apunta a algo que se puede
 * comprobar (un PR, un comentario `AUDIT: APROBADO`, un archivo de test, una
 * evidencia física). `progreso.lib.mjs` lo valida y lo convierte en tablas.
 * El reporte no opina: si acá falta un dato, la celda queda en rojo.
 *
 * Reglas (acordadas en #53, P-02 "aceptada con ajustes"):
 *   - `código` ✔ solo con PR mergeado en `main` + comentario `AUDIT: APROBADO`
 *     enlazado. PR sin AUDIT no cuenta. Brief aprobado no es funcionalidad.
 *   - `simulado` ✔ solo con evidencia que CI verifica: archivos de test que
 *     existen en el repo (el job se deduce del nombre), puntos `[§48.N]`
 *     cubiertos en `scripts/acceptance/points.mjs` o ids de navegador cubiertos.
 *     Un test acredita solo lo que prueba: se citan archivos, no fases.
 *   - `real` ✔ solo con evidencia física: referencia comprobable, condiciones,
 *     fecha y responsable (una persona, nunca un agente). Un test, una corrida
 *     de CI o un simulador NUNCA cuentan como equipo real: el validador lo rechaza.
 *   - Una pista sin entregables se informa como `0/0 — entregables todavía no
 *     definidos`, que es distinto de `0/N` (definidos y pendientes).
 *
 * `tipo`: `producto` entra en las pistas y en los conteos; `brief` (documento
 * acordado) y `proceso` (herramientas de colaboración) se listan aparte y no
 * cuentan como funcionalidad.
 */

export const REPO = 'fermalenoski86/dev';

export const PISTAS = [
  { id: 'gestion', nombre: 'Software de gestión (plataforma + platform-web)' },
  {
    id: 'novastar',
    nombre: 'Integración NovaStar / procesador LED',
    sinPlan: 'Fuera de M3A por el brief maestro (`docs/briefs/M3A1_MASTER.md`, "NO implementar todavía"); entra con TRUST EDGE (M3C). Sin brief ni entregables definidos.',
  },
  {
    id: 'dmx',
    nombre: 'DMX / Art-Net / iluminación',
    sinPlan: 'Fuera de M3A por el brief maestro ("NO implementar todavía: DMX"). Sin brief ni entregables definidos.',
  },
  {
    id: 'reloj',
    nombre: 'Reloj / cúpula',
    sinPlan: 'Sin brief ni entregables definidos. La medición de sincronía (BL-06) depende de hardware y de acceso al edificio: "Fer decide".',
  },
  {
    id: 'hardware',
    nombre: 'Hardware físico e instalación',
    sinPlan: 'Sin brief ni entregables definidos. Decisiones de producto registradas en `docs/collab/DECISIONES.md` (#61: medidas de EL_TRUST, dos TB60); la marquesina sigue abierta con el proveedor.',
  },
];

const pr = (numero, merge, auditado, comentario) => ({
  numero,
  merge,
  auditado,
  audit: `https://github.com/${REPO}/pull/${numero}#issuecomment-${comentario}`,
});

/** Lo que se entregó antes de que el repo existiera en GitHub (2026-10-06): se audita en chat, sin enlace. */
const SIN_PR = 'entregado antes de que existiera el repo en GitHub (2026-10-06); auditado en chat, sin PR ni AUDIT enlazable';

export const ENTREGABLES = [
  // ---- CREATE / PLAY (M2C, congelado) ------------------------------------
  {
    id: 'M2C',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'CREATE (Takeover Builder, compiler) y PLAY (ShowEngine); M2C.2 congelado',
    brief: 'docs/architecture/FREEZE_M2C2.md',
    codigo: { prs: [], sin: SIN_PR },
    simulado: [
      { tipo: 'acceptance', puntos: [19] },
      { tipo: 'tests', archivos: ['packages/show-engine/src/compile.test.ts', 'packages/show-engine/src/preflight.test.ts', 'packages/show-engine/src/playback.test.ts', 'packages/show-authoring/src/authoring.test.ts', 'e2e/experience.spec.ts', 'e2e/builder.spec.ts'] },
    ],
    real: [],
  },
  // ---- M3A.1 --------------------------------------------------------------
  {
    id: 'M3A1-A',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fases A/A.1: esquema relacional (migración 0001), roles mínimos, ShowVersion inmutable, cuatro ojos por contrato, auditoría encadenada',
    brief: 'docs/briefs/M3A1_FASE_A1.md',
    codigo: { prs: [], sin: SIN_PR },
    simulado: [
      { tipo: 'tests', archivos: ['packages/platform-db/src/schema.db.test.ts', 'packages/platform-audit/src/audit.db.test.ts'] },
      { tipo: 'acceptance', puntos: [10, 17, 18] },
    ],
    real: [],
  },
  {
    id: 'M3A1-B1',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fases B1/B1.1: almacenamiento content-addressed (disco local y S3 compatible) con contrato de tests compartido',
    brief: 'docs/briefs/M3A1_FASE_B.md',
    codigo: { prs: [], sin: SIN_PR },
    simulado: [{ tipo: 'tests', archivos: ['packages/platform-storage/src/local-disk.test.ts', 'packages/platform-storage/src/s3.contract.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-B1-FIX',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'B1 · limpieza con TTL 0 compara mtime con resolución de ms (corrección)',
    brief: 'docs/reviews/M3A1_FIX_B1_CLEANUP.md',
    codigo: { prs: [pr(12, '87591f069bb880aa1348996caeaae41ecb5fde5f', '34dcf24013adc504fc4fe1f875460de20c4a461b', 6074016623)] },
    simulado: [{ tipo: 'tests', archivos: ['packages/platform-storage/src/local-disk.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-B2',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase B2: inspección y validación de medios con ffprobe/ffmpeg reales, remediación y gate de mutaciones',
    brief: 'docs/briefs/M3A1_FASE_B2.md',
    codigo: { prs: [pr(2, '5ba9f1a61ff3e982243a45eb5d6eee1902eac023', 'a35eb5b0a3922cc78cc5a6fe509f23abc91af121', 6030654008)] },
    simulado: [
      { tipo: 'tests', archivos: ['packages/platform-media/src/validator.test.ts', 'packages/platform-media/src/media.real.test.ts', 'packages/platform-media/src/remediation.real.test.ts', 'packages/platform-media/src/process.real.test.ts'] },
      { tipo: 'acceptance', puntos: [5] },
    ],
    real: [],
  },
  {
    id: 'M3A1-B3',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase B3: AssetUploadService, migración 0002, audit e idempotencia',
    brief: 'docs/briefs/M3A1_FASE_B.md',
    codigo: { prs: [pr(3, 'decbb0016d822774b37b828a4cb8c38883c1becf', '4e2876883c16a13e4ccd36ea106410a799fb5f5a', 6033692739)] },
    simulado: [
      { tipo: 'tests', archivos: ['packages/platform-assets/src/upload.db.test.ts', 'packages/platform-db/src/asset-consistency.db.test.ts', 'packages/platform-db/src/idempotency.db.test.ts'] },
      { tipo: 'acceptance', puntos: [4, 6] },
    ],
    real: [],
  },
  {
    id: 'M3A1-B4',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase B4: platform-api (Fastify), health/readiness, errores y remediación',
    brief: 'docs/briefs/M3A1_FASE_B.md',
    codigo: { prs: [pr(5, '0341d1510d8feaf036ae2542de55e58cb9be624a', '33110978dda783e03b0e882b21307cbe6b233905', 6037450237)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/api.db.test.ts', 'apps/platform-api/src/upload-limits.db.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-C1',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase C1: autenticación, sesiones, roles y rate limit',
    brief: 'docs/briefs/M3A1_FASE_C.md',
    codigo: { prs: [pr(7, '4ea6cbd3be9688160b5b63f7b689b5c58167f035', '8c4709a8774ea4917aeb9d8bc37938fdecea2f4f', 6043735018)] },
    simulado: [{ tipo: 'tests', archivos: ['packages/platform-auth/src/auth.db.test.ts', 'packages/platform-auth/src/rate-limit.test.ts', 'apps/platform-api/src/auth.db.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-C2',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase C2: evidencia congelada y approve/reject con cuatro ojos (migración 0003)',
    brief: 'docs/briefs/M3A1_FASE_C.md',
    codigo: { prs: [pr(8, '4a75fa4c9ead88b61a0809d46183d6fb2ad4c5a3', 'cf7f23e756b01de9d7f419c4e0ec8a07f2825fde', 6047750632)] },
    simulado: [
      { tipo: 'tests', archivos: ['apps/platform-api/src/approval.db.test.ts', 'packages/platform-db/src/approval-schema.db.test.ts', 'packages/platform-approval/src/detect.test.ts'] },
      { tipo: 'acceptance', puntos: [12, 13, 14] },
    ],
    real: [],
  },
  {
    id: 'M3A1-C3',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase C3: submit server-side sobre el Draft persistido (recompila, preflight, ShowVersion, hash determinista)',
    brief: 'docs/briefs/M3A1_FASE_C.md',
    codigo: { prs: [pr(10, '053318df64d19677e61fd6d9f90d8c059a6b8eee', '1e9e9652f76f3fd02c3c7704ba069f013f5d4c01', 6050622175)] },
    simulado: [
      { tipo: 'tests', archivos: ['apps/platform-api/src/submit.db.test.ts', 'packages/platform-contracts/src/canonical.test.ts'] },
      { tipo: 'acceptance', puntos: [7, 8, 9, 10, 11] },
    ],
    real: [],
  },
  {
    id: 'M3A1-D1',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase D1: API de Campaign y Draft con concurrencia optimista',
    brief: 'docs/briefs/M3A1_FASE_D.md',
    codigo: { prs: [pr(16, '164f5189617667b264fdf9adfac60c381910f47f', '14f0ca2c1d57b5959647be88f879a800949cdeb9', 6055509787)] },
    simulado: [
      { tipo: 'tests', archivos: ['apps/platform-api/src/campaigns.db.test.ts', 'packages/platform-campaigns/src/surfaces.test.ts'] },
      { tipo: 'acceptance', puntos: [1, 3, 15, 16] },
    ],
    real: [],
  },
  {
    id: 'M3A1-D2',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase D2: repositorio del Builder con offline y conflicto (§9, §31)',
    brief: 'docs/briefs/M3A1_FASE_D.md',
    codigo: { prs: [pr(18, 'f23f2623e1c611477e0eb842af313af0acf7ce9f', 'd42bf121d400ec84d6777f2686abbebca774399e', 6061535285)] },
    simulado: [
      { tipo: 'tests', archivos: ['packages/builder-repository/src/repository.test.ts', 'packages/builder-repository/src/session.test.ts', 'apps/platform-api/src/builder-repository.db.test.ts'] },
      { tipo: 'acceptance', puntos: [2] },
    ],
    real: [],
  },
  {
    id: 'M3A1-D3',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase D3: el Builder usa el CampaignRepository + indicador de versión (#15)',
    brief: 'docs/briefs/M3A1_FASE_D.md',
    codigo: { prs: [pr(27, '2e39d3fbdf991fcf6884713b403ab3c5100610c8', '66b1f44c2689d5ba3547f59b2e91654dbca30279', 6076998058)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/control/src/state/useBuilderStore.test.ts', 'apps/control/src/components/builder/CampaignStatus.test.ts', 'apps/platform-api/src/builder-d3.db.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-E1',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase E1: hardening y entregables (BL-10, BL-11, §33 restore drill, §34 logs sin secretos, §35 compose + S3, §47)',
    brief: 'docs/briefs/M3A1_FASE_E.md',
    codigo: { prs: [pr(23, '4c42e919b20099f50c714d69f75c03ef46367eb1', '2f30671d38eb7c24bd387fa9ca3473c0baf236c8', 6075263530)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/restore-drill.db.test.ts', 'apps/platform-api/src/logs-sin-secretos.db.test.ts', 'packages/platform-db/src/bootstrap.smoke.db.test.ts', 'packages/platform-storage/src/s3.contract.test.ts', 'apps/platform-api/src/contract.db.test.ts'] }],
    real: [],
  },
  {
    id: 'MEDIA-FIXTURES-FIX',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Media · carrera del caché de fixtures entre workers paralelos (corrección)',
    brief: 'docs/reviews/FIX_MEDIA_FIXTURES_SALIDA.txt',
    codigo: { prs: [pr(25, '0db8730d9a05ba23ea8abdc3d2e991bacb5247f0', 'df98ff94ef85eb25853bcd204cb4b916880b118d', 6071404533)] },
    simulado: [{ tipo: 'tests', archivos: ['packages/platform-media/src/fixtures.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-E2',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase E2: E2E de plataforma por HTTP real + matriz de aceptación §48 ejecutable (BL-23)',
    brief: 'docs/briefs/M3A1_FASE_E.md',
    codigo: { prs: [pr(29, '0234055a572107ca3623363bcb8e45d7dfe6326c', 'ea635b1c845fe6e357bc668907ec1139a822234a', 6080498773)] },
    simulado: [
      { tipo: 'tests', archivos: ['apps/platform-api/src/e2e-flow.db.test.ts', 'scripts/acceptance/matrix.test.ts'] },
      { tipo: 'acceptance', puntos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] },
    ],
    real: [],
  },
  {
    id: 'M3A1-E3A',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase E3a: apps/platform-web (login, campañas) directo a la API + CORS por allowlist',
    brief: 'docs/briefs/M3A1_FASE_E3.md',
    codigo: { prs: [pr(34, '88f8a9a56239552a8678ecf226e3e3b0338d8f52', 'f8ff978eceac109d5b308f8ba59c5914d3a405ce', 6089938993)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-web/src/lib/api.test.ts', 'apps/platform-web/src/lib/session.test.ts', 'apps/platform-web/src/components/views.test.ts', 'apps/platform-web/src/build-env.test.ts', 'apps/platform-api/src/cors.db.test.ts', 'apps/platform-api/src/platform-web-client.db.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-E3B',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase E3b: campaña, assets, envío y aprobación de cuatro ojos en platform-web',
    brief: 'docs/briefs/M3A1_FASE_E3.md',
    codigo: { prs: [pr(36, '754d3198767c0ba04ab027d77d431d026ae32a7b', '24336db7f1ac2459b303efa5ff011a80a6939ef5', 6091297474)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-web/src/components/views-e3b.test.ts', 'apps/platform-web/src/lib/api-e3b.test.ts', 'apps/platform-web/src/lib/draft-assets.test.ts', 'apps/platform-api/src/platform-web-e3b.db.test.ts'] }],
    real: [],
  },
  {
    id: 'M3A1-E3C',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'Fase E3c: E2E Playwright de §41 en navegador (hosts HTTPS distintos, __Host-), evidencia §47 y matriz',
    brief: 'docs/briefs/M3A1_FASE_E3.md',
    codigo: { prs: [pr(38, 'cc6c4d85b957ed5a4237af73e353811acf16d941', 'a233ee29223e1592357286f4803533b592f63809', 6093558367)] },
    simulado: [
      { tipo: 'navegador', ids: ['E3-41', 'E3-47'] },
      { tipo: 'tests', archivos: ['e2e-platform/flow-41.spec.ts', 'e2e-platform/session-multihost.spec.ts', 'e2e-platform/a11y.spec.ts', 'scripts/e2e-platform/manifest.test.ts'] },
    ],
    real: [],
  },
  // ---- Backlog aceptado ----------------------------------------------------
  {
    id: 'BL-31',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'BL-31: historial de versiones por campaña (API + platform-web)',
    brief: 'docs/collab/BACKLOG.md',
    codigo: { prs: [pr(42, '1db6944be730d9c0caaa10088af09bf4a30c21f4', 'f8d129d0d2f7f936ac526e716042a01431a59142', 6105271159)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/versions-history.db.test.ts', 'apps/platform-api/src/platform-web-bl31.db.test.ts', 'apps/platform-web/src/components/views-bl31.test.ts', 'apps/platform-web/src/lib/api-bl31.test.ts', 'packages/platform-contracts/src/versions.test.ts', 'e2e-platform/history.spec.ts'] }],
    real: [],
  },
  {
    id: 'BL-07',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'BL-07: reporte read-only de Assets no terminales vencidos',
    brief: 'docs/collab/BACKLOG.md',
    codigo: { prs: [pr(45, 'e19ac239e10fef2c5d5017aea062ead90a1f97f2', '70d7456bf01f5d0a09e819718a1b861a7a27b644', 6106041561)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/cli/assets-stale-report.db.test.ts'] }],
    real: [],
  },
  {
    id: 'BL-08',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'BL-08: reporte read-only de blobs huérfanos con período de gracia (cero borrados)',
    brief: 'docs/collab/BACKLOG.md',
    codigo: { prs: [pr(48, '5f06effa826f2d1a1986d6b38b748142a0daf0ab', '9e0a1d0c9760eabb6c22b481dedd8948ccb42261', 6106938699)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/cli/blobs-orphan-report.db.test.ts'] }],
    real: [],
  },
  // ---- F3(a) --------------------------------------------------------------
  {
    id: 'F3A',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'F3(a): versión vigente administrativa y rollback con cuatro ojos (migración 0004 + API)',
    brief: 'docs/briefs/F3A_REDEPLOY.md',
    codigo: { prs: [pr(56, '8fae6fe0456092a0600f2756e2a73a1766481479', '20d6620e99f46e12625412a9cf8c0ba8cc25478a', 6113127134)] },
    simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/active-version.db.test.ts', 'packages/platform-db/src/active-version-schema.db.test.ts'] }],
    real: [],
  },
  {
    id: 'F3A-UI',
    pista: 'gestion',
    tipo: 'producto',
    texto: 'F3(a) UI: versión vigente en platform-web (pedir / confirmar / cancelar con intención ante resultado incierto)',
    brief: 'docs/briefs/F3A_UI.md',
    codigo: { prs: [pr(64, '2ee3551d1fa07a86879c48c5bfc2fd49dbbe8aa7', '9830a079ef8f111cc5463922a64b4be18daf17d5', 6118661022)] },
    simulado: [
      { tipo: 'navegador', ids: ['F3A-UI-1', 'F3A-UI-2', 'F3A-UI-3'] },
      { tipo: 'tests', archivos: ['apps/platform-web/src/components/views-f3a.test.ts', 'apps/platform-web/src/lib/api-f3a.test.ts', 'apps/platform-api/src/platform-web-f3a.db.test.ts', 'e2e-platform/active-version.spec.ts'] },
    ],
    real: [],
  },
  // ---- Briefs acordados (documentos: NO son funcionalidad) -------------------
  { id: 'BRIEF-D', pista: 'gestion', tipo: 'brief', texto: 'Brief de Fase D (API de Campaign/Draft y Builder)', brief: 'docs/briefs/M3A1_FASE_D.md', codigo: { prs: [pr(13, 'c845f356c7b7ad8fd58f156377fe807b4c92f0a0', '5135901048077df59168acd3301b4b3055c830e5', 6051885581)] }, simulado: [], real: [] },
  { id: 'BRIEF-E', pista: 'gestion', tipo: 'brief', texto: 'Brief de Fase E (hardening, E2E y aceptación)', brief: 'docs/briefs/M3A1_FASE_E.md', codigo: { prs: [pr(20, '8debee5b5c97ceaba4dd8ee925b63e08c112b4ef', 'e88ed3cead4894f040088ae735afd0dbad167b6b', 6067934329)] }, simulado: [], real: [] },
  { id: 'BRIEF-E3', pista: 'gestion', tipo: 'brief', texto: 'Brief de Fase E3 (platform-web + E2E Playwright de §41)', brief: 'docs/briefs/M3A1_FASE_E3.md', codigo: { prs: [pr(32, '1494c15ff7e9c1d75254337144f0c8cc05995ea3', '178f8d1a4c05138e3cd37b1299782622a33d3284', 6088307539)] }, simulado: [], real: [] },
  { id: 'BRIEF-F3A', pista: 'gestion', tipo: 'brief', texto: 'Brief F3(a): versión vigente y rollback con cuatro ojos', brief: 'docs/briefs/F3A_REDEPLOY.md', codigo: { prs: [pr(50, '0742479d6e54e3ebd96eb4fc85b3192f95f1a35f', '9a6bc302c6490a35eb0e8be42ed27086b2f58a90', 6110866495)] }, simulado: [], real: [] },
  { id: 'BRIEF-F3A-UI', pista: 'gestion', tipo: 'brief', texto: 'Brief F3(a) UI: vista de versión vigente en platform-web', brief: 'docs/briefs/F3A_UI.md', codigo: { prs: [pr(60, '114061630eb13f09ef099b690df656608dceb2ba', '990700216288d6f03482926d2152ae2ff99b04ea', 6115363443)] }, simulado: [], real: [] },
  // ---- Proceso y herramientas (NO son producto) ------------------------------
  { id: 'ISSUE26-OBS', pista: 'gestion', tipo: 'proceso', texto: 'Issue #26: observabilidad del E2E M2C intermitente (paso 1) y pintores vivos vs muertos (paso 2)', brief: 'docs/collab/BACKLOG.md', codigo: { prs: [pr(40, 'd4b15e809aebbc9b2e3f42c9caf2fee0832b4e3d', 'fd07e14bf1bab7a6653597ff519274a3a06d2a2e', 6094441354), pr(41, '94826248610a2c343248795faf3e35682b9bd46b', '85ba52fbd92316cb5266b3f5974974ecbcb2df2f', 6094441446)] }, simulado: [], real: [] },
  { id: 'P-06-PR1', pista: 'gestion', tipo: 'proceso', texto: 'PoC P-06 · PR 1: Code Review Rules en AGENTS.md + check delegated-audit-gate en report-only (sin delegación ni merge automático)', brief: 'docs/reviews/P06.md', codigo: { prs: [pr(88, 'c403b6b25192a1835180d5356d68e74970fbf51e', '98f917fc748daa269e36a1db9807b15950b6c864', 6247439187)] }, simulado: [{ tipo: 'tests', archivos: ['scripts/collab/delegated-audit.test.ts'] }], real: [] },
  { id: 'P-03', pista: 'gestion', tipo: 'proceso', texto: 'P-03: auditoría basada en riesgo (risk.mjs sobre el diff real, alto ante la duda, check riesgo con declaración y Pruebas adversarias)', brief: 'docs/reviews/P03.md', codigo: { prs: [pr(82, 'db31db955ee156044fd3f25123d623d3bb54bdcc', '8a5a39d09dd12c360a5d3f66f5f1bf894c433d15', 6223642598)] }, simulado: [{ tipo: 'tests', archivos: ['scripts/collab/risk.test.ts'] }], real: [] },
  { id: 'P-04', pista: 'gestion', tipo: 'proceso', texto: 'P-04: diagnóstico de fallas de CI (plazo y vigía, evidencia sanitizada aun sin checkout, política sin reintentos, causa no determinada con issue)', brief: 'docs/reviews/P04.md', codigo: { prs: [pr(75, '3a8e4fc1054ea37d255824060c7869233312c37f', '8bd04c5381ec970564b986178ef898aa4bb2677e', 6186511591)] }, simulado: [{ tipo: 'tests', archivos: ['scripts/ci/run.test.sh'] }], real: [] },
  { id: 'P-05', pista: 'gestion', tipo: 'proceso', texto: 'P-05: trabajo paralelo controlado (paralelo.sh R1–R4/R3b/R4b, paralelo-reevaluar.sh, workflow paralelo.yml desde main, handoff con fase activa)', brief: 'docs/reviews/P05.md', codigo: { prs: [pr(69, '4fd1f0313f8926844586ea1de37c32fa1cfcaa0e', '2fd28b9acc433df9a644b2655c0db0767eae535c', 6135785390)] }, simulado: [{ tipo: 'tests', archivos: ['scripts/collab/paralelo.test.sh', 'scripts/collab/handoff.test.sh'] }], real: [] },
  { id: 'P-02', pista: 'gestion', tipo: 'proceso', texto: 'P-02: PROGRESO.md generado desde este manifiesto (progress.mjs generate/check/verificar-github)', brief: 'docs/reviews/P02.md', codigo: { prs: [pr(67, '68b7e22edb099dcf93b668ca9244223051ccea29', '65b3775595f620f3117e4c4bc8b6160abe020772', 6125999057)] }, simulado: [{ tipo: 'tests', archivos: ['scripts/collab/progreso.test.ts'] }], real: [] },
  { id: 'P-01', pista: 'gestion', tipo: 'proceso', texto: 'P-01: handoff.sh — compare-and-swap y push solo fast-forward para HANDOFF.md', brief: 'docs/reviews/P01.md', codigo: { prs: [pr(58, 'e7bac5ab50ba078ab4e833572cb5e2967cc2d68a', 'fb77a49d664604fd4e39ac8ebc2163ff93bc9b90', 6121930565)] }, simulado: [{ tipo: 'tests', archivos: ['scripts/collab/handoff.test.sh'] }], real: [] },
];
