/**
 * BL-23 · Matriz de aceptación ejecutable (master §48; brief E, propuesta
 * aceptada). Esta lista es la ÚNICA fuente de los 19 puntos y de sus estados.
 * `docs/reviews/M3A1_ACEPTACION.md` se GENERA desde acá y desde los tags
 * `[§48.N]` en los nombres de los tests (`pnpm acceptance:generate`).
 *
 * Estados:
 *   - cubierto      → exige al menos un test con el tag, en la suite que CI
 *                     verifica con resultados (*.db.test.ts, job postgres), o
 *                     evidencia Playwright declarada (solo el 19, M2C congelado);
 *   - pendiente     → exige `motivo`; nunca se muestra como verde;
 *   - no-aplicable  → exige `motivo`.
 */
export const POINTS = [
  { n: 1, texto: 'creo Campaign', estado: 'cubierto', rol: 'OPERATOR (Advertiser y Contract: ADMIN)' },
  { n: 2, texto: 'Builder guarda un Draft en PostgreSQL', estado: 'cubierto', rol: 'OPERATOR', nota: 'A nivel API, sesión y store (`@trust/builder-repository`, el código del Builder desde D3). El E2E de navegador es E3: ver «Pendientes de navegador».' },
  { n: 3, texto: 'revision protege concurrencia', estado: 'cubierto', rol: 'OPERATOR' },
  { n: 4, texto: 'subo assets', estado: 'cubierto', rol: 'OPERATOR' },
  { n: 5, texto: 'ffprobe los valida realmente', estado: 'cubierto', rol: 'OPERATOR' },
  { n: 6, texto: 'assets quedan identificados por SHA-256', estado: 'cubierto', rol: 'OPERATOR' },
  { n: 7, texto: 'envío Draft', estado: 'cubierto', rol: 'OPERATOR' },
  { n: 8, texto: 'servidor recompila', estado: 'cubierto', rol: 'OPERATOR → servidor' },
  { n: 9, texto: 'servidor ejecuta preflight', estado: 'cubierto', rol: 'OPERATOR → servidor' },
  { n: 10, texto: 'crea ShowVersion inmutable', estado: 'cubierto', rol: 'OPERATOR → servidor' },
  { n: 11, texto: 'calcula hash determinista', estado: 'cubierto', rol: 'servidor' },
  { n: 12, texto: 'otro usuario la aprueba', estado: 'cubierto', rol: 'INTERNAL_APPROVER (≠ OPERATOR del submit)' },
  { n: 13, texto: 'evidencia queda congelada', estado: 'cubierto', rol: 'INTERNAL_APPROVER' },
  { n: 14, texto: 'aprobación refiere al hash exacto', estado: 'cubierto', rol: 'INTERNAL_APPROVER' },
  { n: 15, texto: 'edito Campaign', estado: 'cubierto', rol: 'OPERATOR' },
  { n: 16, texto: 'versión aprobada NO cambia', estado: 'cubierto', rol: 'OPERATOR' },
  { n: 17, texto: 'audit log registra todo', estado: 'cubierto', rol: 'ADMIN, OPERATOR, INTERNAL_APPROVER' },
  { n: 18, texto: 'ningún endpoint puede modificar ShowVersion', estado: 'cubierto', rol: '—' },
  {
    n: 19, texto: 'M2C.2 sigue pasando sin regresión', estado: 'cubierto', rol: '—',
    // M2C está congelado: no se le agregan tags. Se vincula a su evidencia.
    playwright: { files: ['e2e/experience.spec.ts', 'e2e/builder.spec.ts'], tests: 14, job: 'e2e-m2c' },
    nota: 'Solo en CI (job `e2e-m2c`, 14/14); intermitencia histórica en #26.',
  },
];

/** Lo que §41/§47 piden en navegador y todavía no existe (E3, #31). Siempre pendiente. */
export const PENDIENTES_NAVEGADOR = [
  { id: 'E3-41', texto: '§41 E2E Playwright: login, campaña, envío, aprobación por otro usuario y versión aprobada vs. working draft, en navegador', motivo: 'E3a (login, campañas, CORS) aprobada; E3b entrega la UI de campaña, assets, envío y aprobación de cuatro ojos. El E2E Playwright de §41 por rol es E3c: no implementado ni verificado.' },
  { id: 'E3-47', texto: '§47 screenshots y video del flujo', motivo: 'Dependen del job `e2e-platform` de E3c (artifact de CI con manifest, BL-29).' },
];

/** Suite cuyos resultados verifica CI (job postgres): solo ahí puede haber tags. */
export const SUITE_VERIFICADA = /\.db\.test\.ts$/;
