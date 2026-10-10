import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from '@trust/platform-db';
import { ROUTES } from './openapi';

/**
 * E1 · master §43 — inventario de entrega generado desde el código:
 * rutas (la misma tabla que valida el test de contrato contra Fastify),
 * migraciones (el mapa que corre el migrator), archivos de test y variables
 * de `.env.example`. El test de contrato exige diff vacío contra
 * `docs/platform/DELIVERY.md`: si algo cambia sin regenerar, CI falla.
 *
 * Regenerar: `pnpm docs:contract`.
 */

const IGNORAR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', 'test-results', 'playwright-report']);

function archivosDeTest(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (IGNORAR.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(test|spec)\.(ts|tsx)$/.test(e.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

function suiteDe(f: string): string {
  if (f.endsWith('.db.test.ts')) return 'PostgreSQL (`vitest.platform.config.ts`)';
  if (f.endsWith('.media.test.ts')) return 'Medios (`vitest.media.config.ts`)';
  // issue #26: e2e/diag/ se corre solo en diag-e2e.yml (workflow_dispatch o push a diag/**); no es gate
  if (f.startsWith('e2e/diag/')) return 'Diagnóstico E2E (`diag-e2e.yml`, no es gate)';
  if (f.endsWith('.spec.ts')) return 'E2E (Playwright, CI)';
  if (f.startsWith('packages/')) return 'Unidad (`pnpm verify`)';
  return 'Unidad de app (vitest del paquete)';
}

function variablesEnv(root: string): string[] {
  return readFileSync(path.join(root, '.env.example'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((v): v is string => Boolean(v));
}

/**
 * `registradas`: las rutas tal como las registró Fastify (hook onRoute, sin HEAD
 * automático), en orden de registro. La lista sale de ahí, no de la tabla: la
 * tabla OpenAPI solo aporta roles/CSRF/idempotencia, y una ruta registrada que
 * no esté en la tabla hace fallar la generación.
 */
export function deliveryText(root: string, registradas: Array<{ method: string; url: string }>): string {
  const filas = registradas.map(({ method, url }) => {
    const r = ROUTES.find((x) => x.method === method && x.path === url);
    if (!r) throw new Error(`ruta registrada sin documentar en ROUTES (openapi.ts): ${method} ${url}`);
    return r;
  });
  const sobrantes = ROUTES.filter((r) => !registradas.some((x) => x.method === r.method && x.url === r.path));
  if (sobrantes.length) throw new Error(`ROUTES documenta rutas que Fastify no registró: ${sobrantes.map((r) => `${r.method} ${r.path}`).join(', ')}`);
  const L: string[] = [];
  L.push('# DELIVERY — inventario de entrega de platform-api');
  L.push('');
  L.push('> Generado por `pnpm docs:contract` (`apps/platform-api/src/delivery.ts`). No editar a mano:');
  L.push('> el test `contract.db.test.ts` exige diff vacío contra lo generado.');
  L.push('');
  L.push('Contrato HTTP: [`openapi.json`](openapi.json) (OpenAPI 3.1, mismo origen). Modelo de datos: [ERD.md](ERD.md).');
  L.push('Errores, idempotencia y límites: [API.md](API.md). Backups y restauración: [../ops/BACKUPS.md](../ops/BACKUPS.md).');
  L.push('');
  L.push(`## Rutas (${filas.length}, del registro de Fastify)`);
  L.push('');
  L.push('| Método | Ruta | Roles | CSRF | Idempotency-Key | Respuestas |');
  L.push('|---|---|---|---|---|---|');
  for (const r of filas) {
    const roles = r.roles === null ? 'pública' : r.roles.length === 0 ? 'cualquier sesión' : r.roles.join(', ');
    L.push(`| ${r.method} | \`${r.path}\` | ${roles} | ${r.csrf ? 'sí' : '—'} | ${r.idempotency ? 'sí' : '—'} | ${Object.keys(r.responses).join(', ')} |`);
  }
  L.push('');
  const migs = Object.keys(MIGRATIONS).sort();
  L.push(`## Migraciones (${migs.length})`);
  L.push('');
  for (const m of migs) L.push(`- \`${m}\`${MIGRATIONS[m]?.reversible ? ' (reversible)' : ' (no reversible)'}`);
  L.push('');
  const tests = archivosDeTest(root);
  L.push(`## Archivos de test (${tests.length})`);
  L.push('');
  L.push('| Archivo | Suite |');
  L.push('|---|---|');
  for (const f of tests) L.push(`| \`${f}\` | ${suiteDe(f)} |`);
  L.push('');
  const vars = variablesEnv(root);
  L.push(`## Variables de entorno (${vars.length}, de \`.env.example\`)`);
  L.push('');
  L.push(vars.map((v) => `\`${v}\``).join(' · '));
  L.push('');
  return `${L.join('\n')}`;
}
