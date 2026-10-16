import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { clasificar, clasificarRuta, declarado, gatesDesdeParalelo, raicesWorkspace, tieneAdversarias, verificar } from './risk.lib.mjs';

/**
 * P-03 · clasificador de riesgo: matriz de negativos pedida por el auditor en #53
 * (script que deshabilita un gate, CI que quita un job, secret/auth, hardware) +
 * renames, rutas desconocidas, reducción de tests, rebaja declarada y sección
 * adversaria. Cada forma de que un diff peligroso salga "bajo" tiene que fallar.
 */
const ROOT = path.resolve(__dirname, '../..');
const GATES = gatesDesdeParalelo(readFileSync(path.join(ROOT, 'scripts/collab/paralelo.sh'), 'utf8'), raicesWorkspace(readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')));
const nivel = (archivos: object[]) => clasificar(archivos, GATES).nivel;
const m = (ruta: string, parche = '') => ({ ruta, estado: 'M', parche });
const ADV = '## Pruebas adversarias\n- permisos cruzados: OPERATOR intenta aprobar su propio envío → 403\n';

describe('P-03 · rutas', () => {
  it.each([
    ['.github/workflows/gates.yml', 'alto'], // CI que quita un job
    ['scripts/ci/run.sh', 'alto'], // script que deshabilita un gate
    ['scripts/collab/risk.mjs', 'alto'], // el propio clasificador
    ['scripts/collab/risk.lib.mjs', 'alto'],
    ['scripts/collab/paralelo.sh', 'alto'], // dueño de GATES_RE
    ['.github/CODEOWNERS', 'alto'],
    ['AGENTS.md', 'alto'],
    ['CLAUDE.md', 'alto'],
    ['docs/collab/HANDOFF.md', 'alto'],
    ['docs/collab/DECISIONES.md', 'alto'],
    ['docs/ai-workflow/CLAUDE_Y_CHATGPT.md', 'alto'],
    ['packages/platform-auth/src/session.ts', 'alto'],
    ['apps/platform-api/src/cors.ts', 'alto'],
    ['apps/platform-api/src/approval-routes.ts', 'alto'],
    ['packages/platform-db/src/migrations/0005_x.sql', 'alto'],
    ['packages/platform-storage/src/s3.ts', 'alto'],
    ['packages/platform-media/src/process.ts', 'alto'],
    ['apps/control/src/app/page.tsx', 'alto'],
    ['e2e/experience.spec.ts', 'alto'],
    ['packages/platform-db/scripts/bootstrap-smoke.sh', 'alto'],
    ['edge/trust-edge/src/index.ts', 'alto'], // corre en el edificio
    ['packages/dmx-out/src/index.ts', 'alto'], // hardware (cuando exista)
    ['docs/hardware/novastar.md', 'alto'],
    ['.gitattributes', 'alto'],
    ['.env', 'alto'],
    ['apps/platform-web/.envrc', 'alto'], // Codex #82, P2
    ['apps/platform-web/AGENTS.md', 'alto'], // reglas anidadas (Codex #82, P2)
    ['packages/x/CLAUDE.md', 'alto'],
    ['vitest.platform.config.ts', 'alto'],
    ['pnpm-lock.yaml', 'alto'],
    ['raro/archivo.bin', 'alto'], // sin regla → alto por defecto
    ['Makefile', 'alto'],
    ['apps/platform-web/src/components/CampaignDetail.tsx', 'medio'],
    ['packages/show-engine/src/engine.ts', 'medio'],
    ['apps/platform-web/src/components/views.test.ts', 'medio'],
    ['docs/briefs/F3A_UI.md', 'medio'],
    ['docs/collab/BACKLOG.md', 'medio'],
    ['docs/reviews/P03.md', 'bajo'],
    ['docs/reviews/P03_SALIDA.txt', 'medio'], // evidencia de gates (Codex #82, P2)
    ['docs/notas.txt', 'alto'], // .txt fuera de esa regla: sin regla
    ['scripts/cleanup.ts', 'alto'], // script suelto nuevo: sin regla (Codex #82, P2)
    ['.gitignore', 'alto'],
    ['docs/collab/HISTORIAL.md', 'bajo'],
    ['README.md', 'bajo'],
    ['docs/screenshots/a.png', 'bajo'],
  ])('%s → %s', (ruta, esperado) => {
    expect(clasificarRuta(ruta, GATES).nivel).toBe(esperado);
  });

  it('rutas anómalas (salto de línea, comillas, .., absoluta) → alto', () => {
    for (const r of ['docs/a\n.github/x.yml', 'docs/"a".md', 'docs/../.github/x.md', '/etc/passwd', '']) {
      expect(clasificarRuta(r, GATES).nivel).toBe('alto');
    }
  });

  it('sin GATES_RE en paralelo.sh no hay clasificación (fail-closed)', () => {
    expect(() => gatesDesdeParalelo('#!/bin/bash\n', [])).toThrow(/GATES_RE/);
  });

  it('las raíces del workspace salen de pnpm-workspace.yaml (edge/* incluido)', () => {
    expect(raicesWorkspace("packages:\n  - 'apps/*'\n  - \"edge/*\"\n  - packages/*\n")).toEqual(['apps', 'edge', 'packages']);
    expect(clasificarRuta('edge/trust-edge/scripts/x.sh', GATES).nivel).toBe('alto');
  });
});

describe('P-03 · diff completo', () => {
  it('el nivel es el máximo; un solo archivo alto alcanza', () => {
    expect(nivel([m('docs/reviews/X.md'), m('README.md')])).toBe('bajo');
    expect(nivel([m('docs/reviews/X.md'), m('apps/platform-web/src/a.tsx')])).toBe('medio');
    expect(nivel([m('docs/reviews/X.md'), m('apps/platform-web/src/a.tsx'), m('scripts/ci/run.sh')])).toBe('alto');
  });

  it('diff vacío → alto (no hay "bajo" por omisión)', () => {
    expect(nivel([])).toBe('alto');
  });

  it('rename que saca un workflow de .github/ sigue siendo alto (llega como D + A)', () => {
    expect(nivel([{ ruta: '.github/workflows/gates.yml', estado: 'D' }, { ruta: 'docs/old/gates.yml.md', estado: 'A' }])).toBe('alto');
  });

  it('secret o token en cualquier archivo, también en docs → alto', () => {
    expect(nivel([m('docs/reviews/X.md', '+token: ghp_' + 'a'.repeat(36))])).toBe('alto');
    expect(nivel([m('docs/reviews/X.md', '+-----BEGIN OPENSSH PRIVATE KEY-----')])).toBe('alto');
    expect(nivel([m('apps/platform-web/src/a.ts', '+const k = "AKIA' + 'A'.repeat(16) + '"')])).toBe('alto');
    // formas genéricas en docs (Codex #82, P2)
    expect(nivel([m('docs/reviews/X.md', '+API_TOKEN=sk_live_' + 'a'.repeat(24))])).toBe('alto');
    expect(nivel([m('docs/reviews/X.md', '+Authorization: Bearer ' + 'b'.repeat(32))])).toBe('alto');
    expect(nivel([m('docs/reviews/X.md', '+cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.x')])).toBe('alto');
    expect(nivel([m('docs/reviews/X.md', '+db_password: "' + 'c'.repeat(20) + '"')])).toBe('alto');
    expect(nivel([m('docs/reviews/X.md', '+API_TOKEN="abc:def:ghi:jklmnop"')])).toBe('alto'); // puntuación (Codex #82, P2)
    expect(nivel([m('docs/reviews/X.md', '+API_TOKEN=abc:def:ghi:jklmnop')])).toBe('alto'); // sin comillas
    // texto que nombra credenciales sin valor sigue bajo
    expect(nivel([m('docs/reviews/X.md', '+ el token va en Secrets; `password` nunca en el repo')])).toBe('bajo');
  });

  it('código de producto que agrega procesos externos, secrets o DDL → alto', () => {
    expect(nivel([m('apps/platform-api/src/x.ts', "+import { spawn } from 'node:child_process';")])).toBe('alto');
    expect(nivel([m('packages/platform-assets/src/x.ts', '+  execFile(bin, args)')])).toBe('alto');
    // quitar la llamada directa y pasar a un helper indirecto también es alto (Codex #82, P2)
    expect(nivel([m('packages/platform-assets/src/x.ts', "-  execFile('ffmpeg', safeArgs)\n+  runFfmpeg(userArgs)")])).toBe('alto');
    expect(nivel([m('packages/platform-campaigns/src/q.ts', '+  await db.query(`ALTER TABLE campaign ADD COLUMN x int`)')])).toBe('alto');
    // DDL de cualquier objeto y opciones de proceso (Codex #82, P2)
    for (const q of ['CREATE VIEW v AS SELECT 1', 'ALTER SEQUENCE s RESTART', 'DROP DATABASE trust', 'CREATE OR REPLACE VIEW v AS SELECT 1', 'create view v as select 1', 'alter sequence s restart', 'drop database trust']) {
      expect(nivel([m('packages/platform-campaigns/src/q.ts', `+  await db.query(\`${q}\`)`)])).toBe('alto');
    }
    expect(nivel([m('packages/show-engine/src/runner.ts', '-    shell: false,\n+    shell: true,')])).toBe('alto');
    // sentencia SQL multilínea: CREATE en una línea, el objeto en la siguiente (Codex #82, P2 sobre d27c25d)
    expect(nivel([m('packages/platform-campaigns/src/q.ts', '+  await db.query(`\n+    CREATE\n+    VIEW foo AS SELECT 1`)')])).toBe('alto');
    expect(nivel([m('apps/platform-api/src/q.ts', '+  sql`create\n+    or replace view v as select 1`')])).toBe('alto');
    expect(nivel([m('packages/platform-campaigns/src/q.ts', '-  await db.query(`ALTER\n-    TABLE x ADD c int`)\n+  await run(q)')])).toBe('alto');
    // código JS común no es DDL
    expect(nivel([m('packages/show-engine/src/a.ts', '+  const drop = items.filter((x) => x.create);')])).toBe('medio');
    expect(nivel([m('apps/platform-web/src/a.ts', '+  token: ${{ secrets.X }}')])).toBe('alto');
  });

  it('docs que solo MENCIONAN spawn o ALTER TABLE siguen bajo (texto, no código)', () => {
    expect(nivel([m('docs/reviews/X.md', '+ nunca `spawn(` con shell; `ALTER TABLE` va en migraciones')])).toBe('bajo');
  });

  it('reducción de tests → alto: borrar el archivo, quitar casos, agregar skip/only o retries', () => {
    expect(nivel([{ ruta: 'apps/platform-web/src/a.test.ts', estado: 'D' }])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', "-  it('a', () => {\n-    expect(1).toBe(1);\n+  // nada")])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', "+  it.skip('a', () => {})")])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', "+  test['sk' + 'ip']('a', () => {})".replace("'sk' + 'ip'", "'skip'"))])).toBe('alto'); // corchetes (Codex #82, P2)
    expect(nivel([m('packages/show-engine/src/e.test.ts', "+  it\n+    .skip('a', () => {})")])).toBe('alto'); // partida en dos líneas
    expect(nivel([m('packages/show-engine/src/e.test.ts', '+  describe.' + 'only(() => {})' /* partido: politica-fallas.sh rechaza el literal en tests */)])).toBe('alto');
    // aserción multilínea que pierde solo el matcher (Codex #82, P2)
    expect(nivel([m('apps/platform-web/src/components/views-bl31.test.ts', "-      .toContain('Solo lectura');\n+      ;")])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', '-    ).resolves.toBe(1);')])).toBe('alto');
    // agregar `re.test(` no compensa casos quitados
    expect(nivel([m('packages/show-engine/src/e.test.ts', "-  it('a', () => {\n-  it('b', () => {\n+  ok = re.test(x);\n+  ok = re.test(y);")])).toBe('alto');
    // AUDIT: CAMBIOS sobre c424b9c (P1): cualquier modificación de un test existente es alto,
    // también las que conservan los tokens (cortocircuito, condicional, wrapper) y un renombre
    const corto = "@@ -1 +1 @@\n-it('transporta', () => { expect(true).toBe(true) })\n+false && it('transporta', () => { expect(true).toBe(true) })";
    expect(nivel([m('packages/timeline/src/transport.test.ts', corto)])).toBe('alto');
    expect(nivel([m('packages/timeline/src/transport.test.ts', "-it('a', () => {\n+if (process.env.NUNCA) it('a', () => {")])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', "-  it('a', () => {\n+  it('b', () => {")])).toBe('alto');
    // un archivo de tests NUEVO sin salteos sigue medio; con salteo, alto
    expect(nivel([{ ruta: 'packages/show-engine/src/nuevo.test.ts', estado: 'A', parche: "+it('x', () => { expect(1).toBe(1) })" }])).toBe('medio');
    expect(nivel([{ ruta: 'packages/show-engine/src/nuevo.test.ts', estado: 'A', parche: "+it.skip('x', () => {})" }])).toBe('alto');
    // `retries` con la clave entre comillas (Codex #82, P2 sobre 6c96f82)
    for (const k of ['"retries"', "'retries'", '`retries`', 'retries']) {
      expect(nivel([{ ruta: 'packages/demo/src/new.test.ts', estado: 'A', parche: `+test.describe.configure({ ${k}: 2 })` }])).toBe('alto');
    }
    expect(nivel([{ ruta: 'packages/demo/src/new.test.ts', estado: 'A', parche: '+test.describe.configure({ "retries": 0 })' }])).toBe('medio');
    // directorios convencionales y Python (Codex #82, ronda 8)
    expect(nivel([{ ruta: 'packages/x/tests/api.ts', estado: 'D' }])).toBe('alto');
    expect(nivel([m('tools/test_api.py', '-def test_a(): assert 1')])).toBe('alto');
  });

  it('symlink o submódulo, aunque esté en docs/ → alto', () => {
    expect(nivel([{ ruta: 'docs/a.md', estado: 'A', modoEspecial: true }])).toBe('alto');
  });

  it('bloque "scripts" de un package.json cambiado → alto; binario fuera de docs → alto', () => {
    expect(nivel([{ ruta: 'apps/platform-web/package.json', estado: 'M', scriptsCambian: true }])).toBe('alto');
    expect(nivel([{ ruta: 'apps/platform-web/public/x.png', estado: 'A', binario: true }])).toBe('alto');
    expect(nivel([{ ruta: 'docs/screenshots/x.png', estado: 'A', binario: true }])).toBe('bajo');
  });
});

describe('P-03 · declarado vs calculado', () => {
  it('lee una sola declaración en sus formas habituales', () => {
    expect(declarado('Riesgo: bajo').nivel).toBe('bajo');
    expect(declarado('**Riesgo:** alto — toca gates').nivel).toBe('alto');
    expect(declarado('- **Riesgo**: `medio`').nivel).toBe('medio');
    expect(declarado('sin nada').error).toMatch(/no declara/);
    expect(declarado('Riesgo: bajo\nRiesgo: alto').error).toMatch(/más de una vez/);
    expect(declarado('Riesgo: medio\nRiesgo: medio').error).toMatch(/más de una vez/); // Codex #82, P2
    expect(declarado('Riesgo: bajo | medio | alto').error).toMatch(/más de un nivel/); // plantilla sin elegir
    // después de una línea en blanco (cuerpo típico de PR; Codex #82, P2 sobre d27c25d)
    expect(declarado('## Resumen\n\nRiesgo: bajo | medio | alto').error).toMatch(/más de un nivel/);
    expect(declarado('## Resumen\n\n\n  - **Riesgo:** bajo | alto\n').error).toMatch(/más de un nivel/);
    expect(declarado('## Resumen\n\nRiesgo: medio\n\nOtra cosa').nivel).toBe('medio');
    expect(declarado('**Riesgo:** alto — toca gates, no es bajo').error).toMatch(/más de un nivel/);
    expect(declarado('**Riesgo:** alto — toca gates').nivel).toBe('alto');
    expect(declarado('Riesgo: bajísimo').error).toMatch(/no declara/);
  });

  it('declarar menos que lo calculado falla; declarar más eleva (y exige adversarias si queda alto)', () => {
    expect(verificar('alto', 'Riesgo: bajo\n' + ADV).errores.join()).toMatch(/nunca rebajar/);
    expect(verificar('medio', 'Riesgo: bajo').errores.join()).toMatch(/nunca rebajar/);
    expect(verificar('bajo', 'Riesgo: medio').errores).toEqual([]);
    const v = verificar('medio', 'Riesgo: alto');
    expect(v.efectivo).toBe('alto');
    expect(v.errores.join()).toMatch(/Pruebas adversarias/);
    expect(verificar('medio', 'Riesgo: alto\n' + ADV).errores).toEqual([]);
  });

  it('alto sin sección adversaria, o con la sección vacía, falla', () => {
    expect(verificar('alto', 'Riesgo: alto').errores.join()).toMatch(/Pruebas adversarias/);
    expect(verificar('alto', 'Riesgo: alto\n## Pruebas adversarias\n\n## Otra\n- algo largo de verdad').errores.join()).toMatch(/Pruebas adversarias/);
    expect(verificar('alto', 'Riesgo: alto\n' + ADV).errores).toEqual([]);
  });

  it('la sección acepta tabla con al menos una fila', () => {
    expect(tieneAdversarias('### Pruebas adversarias\n| eje | caso |\n|---|---|\n| concurrencia | dos escritores |')).toBe(true);
    expect(tieneAdversarias('### Pruebas adversarias\n| eje | caso |\n|---|---|\n')).toBe(false);
    expect(tieneAdversarias('### Pruebas adversarias\n| eje | caso |\n|---|---|\n| | |')).toBe(false); // Codex #82, P2
  });

  it('ignora lo que GitHub no renderiza: comentarios HTML y bloques cercados (Codex #82, P2)', () => {
    const oculto = '<!--\nRiesgo: alto\n## Pruebas adversarias\n- caso oculto suficiente\n-->';
    expect(verificar('alto', oculto).errores.join()).toMatch(/no declara/);
    expect(verificar('alto', oculto).errores.join()).toMatch(/Pruebas adversarias/);
    expect(verificar('alto', 'Riesgo: alto\n```md\n## Pruebas adversarias\n- caso dentro del ejemplo\n```').errores.join()).toMatch(/Pruebas adversarias/);
    expect(declarado('~~~\nRiesgo: bajo\n~~~\nRiesgo: alto').nivel).toBe('alto'); // la del ejemplo no cuenta como duplicada
    expect(declarado('texto <!-- Riesgo: bajo --> más').error).toMatch(/no declara/);
    // sin cierre: hasta el final (como CommonMark); se descarta, nunca se cuenta
    expect(declarado('<!-- sin cerrar\nRiesgo: alto').error).toMatch(/no declara/);
    expect(tieneAdversarias('## Pruebas adversarias\n```\n- caso dentro de un bloque sin cerrar')).toBe(false);
    // un cierre más corto o con info no cierra el bloque
    expect(declarado('````\n```\nRiesgo: alto\n````').error).toMatch(/no declara/);
    // lo visible sigue valiendo
    expect(verificar('alto', '<!-- plantilla -->\nRiesgo: alto\n' + ADV + '\n```\nejemplo\n```').errores).toEqual([]);
  });
});

describe('P-03 · CLI sobre un repo git real', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'p03-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  const cli = (...a: string[]) => {
    try {
      return { rc: 0, out: execFileSync('node', [path.join(ROOT, 'scripts/collab/risk.mjs'), ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { rc: err.status, out: err.stdout + err.stderr };
    }
  };
  const escribir = (ruta: string, txt: string) => {
    mkdirSync(path.dirname(path.join(dir, ruta)), { recursive: true });
    writeFileSync(path.join(dir, ruta), txt);
  };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  escribir('docs/a.md', 'a\n');
  escribir('.github/workflows/ñ.yml', 'on: push\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  it('docs → bajo; rename de un workflow con nombre no-ASCII fuera de .github → alto (merge-base, -z, --no-renames)', () => {
    g('checkout', '-qb', 'docs');
    escribir('docs/a.md', 'a\nb\n');
    g('commit', '-qam', 'docs');
    const ok = cli('calcular', 'main', 'docs');
    expect(ok.out).toMatch(/riesgo calculado: bajo/);
    g('checkout', '-qb', 'mv', 'main');
    g('mv', '.github/workflows/ñ.yml', 'docs/n.md');
    g('commit', '-qm', 'mv');
    const r = cli('calcular', 'main', 'mv');
    expect(r.out).toMatch(/riesgo calculado: alto/);
    expect(r.out).toMatch(/\.github\/workflows\/ñ\.yml/);
  });

  it('symlink en docs/ → alto (modo 120000 por --raw)', () => {
    g('checkout', '-qb', 'ln', 'main');
    execFileSync('ln', ['-s', '../.github/workflows/ñ.yml', 'docs/l.md'], { cwd: dir });
    g('add', '-A');
    g('commit', '-qm', 'ln');
    expect(cli('calcular', 'main', 'ln').out).toMatch(/riesgo calculado: alto[\s\S]*symlink/);
  });

  it('ruta con magia de pathspec se toma literal y su contenido se analiza (AUDIT: CAMBIOS @ e08a47b, P1)', () => {
    g('checkout', '-qb', 'magia', 'main');
    escribir(':(exclude)leak.md', 'PASSWORD="correct horse battery staple"\n');
    g('add', '-A');
    g('commit', '-qm', 'magia');
    const r = cli('calcular', 'main', 'magia');
    expect(r.out).toMatch(/riesgo calculado: alto[\s\S]*token o clave privada/);
  });

  it('credencial entre comillas con espacios en README.md → alto (AUDIT: CAMBIOS @ e08a47b, P2)', () => {
    g('checkout', '-qb', 'readme', 'main');
    escribir('README.md', 'PASSWORD="correct horse battery staple"\n');
    g('add', '-A');
    g('commit', '-qm', 'readme');
    expect(cli('calcular', 'main', 'readme').out).toMatch(/riesgo calculado: alto[\s\S]*token o clave privada/);
  });

  it('alta o baja de package.json sin bloque "scripts" no es cambio de scripts; con bloque real sí (AUDIT: CAMBIOS @ 157a7f7, P2)', () => {
    const det = (rama: string) => cli('calcular', 'main', rama).out;
    g('checkout', '-qb', 'pkg-alta', 'main');
    escribir('apps/foo/package.json', '{"name":"foo","private":true}\n');
    g('add', '-A');
    g('commit', '-qm', 'alta');
    expect(det('pkg-alta')).not.toMatch(/bloque "scripts"/);
    g('checkout', '-qb', 'pkg-base', 'main');
    escribir('apps/bar/package.json', '{"name":"bar"}\n');
    escribir('apps/con/package.json', '{"name":"con","scripts":{"test":"vitest"}}\n');
    escribir('apps/mal/package.json', '{"name":"mal","scripts":{}}\n');
    g('add', '-A');
    g('commit', '-qm', 'base pkg');
    g('checkout', '-qb', 'pkg-baja', 'pkg-base');
    g('rm', '-q', 'apps/bar/package.json');
    g('commit', '-qm', 'baja');
    expect(cli('calcular', 'pkg-base', 'pkg-baja').out).not.toMatch(/bloque "scripts"/);
    g('checkout', '-qb', 'pkg-baja-scripts', 'pkg-base');
    g('rm', '-q', 'apps/con/package.json');
    g('commit', '-qm', 'baja con scripts');
    expect(cli('calcular', 'pkg-base', 'pkg-baja-scripts').out).toMatch(/riesgo calculado: alto[\s\S]*apps\/con\/package\.json[\s\S]*bloque "scripts"/);
    g('checkout', '-qb', 'pkg-alta-scripts', 'main');
    escribir('apps/foo/package.json', '{"name":"foo","scripts":{"build":"tsc"}}\n');
    g('add', '-A');
    g('commit', '-qm', 'alta con scripts');
    expect(det('pkg-alta-scripts')).toMatch(/riesgo calculado: alto[\s\S]*bloque "scripts"/);
    g('checkout', '-qb', 'pkg-roto', 'pkg-base');
    escribir('apps/mal/package.json', '{"name":"mal",\n');
    g('commit', '-qam', 'json roto');
    expect(cli('calcular', 'pkg-base', 'pkg-roto').out).toMatch(/riesgo calculado: alto[\s\S]*bloque "scripts"/); // fail-closed
    g('checkout', '-q', 'main');
  });

  it('verificar: rebaja → exit 2; declaración correcta → exit 0; base inexistente → exit 1 (sin veredicto)', () => {
    escribir(path.join('..', path.basename(dir) + '-bajo.md'), 'Riesgo: bajo\n');
    const cuerpoBajo = path.join(dir, '..', path.basename(dir) + '-bajo.md');
    const cuerpoAlto = cuerpoBajo.replace('-bajo', '-alto');
    writeFileSync(cuerpoAlto, 'Riesgo: alto\n' + ADV);
    expect(cli('verificar', 'main', 'mv', cuerpoBajo).rc).toBe(2);
    expect(cli('verificar', 'main', 'mv', cuerpoAlto).rc).toBe(0);
    expect(cli('verificar', 'main', 'docs', cuerpoBajo).rc).toBe(0);
    expect(cli('verificar', 'no-existe', 'docs', cuerpoBajo).rc).toBe(1);
    rmSync(cuerpoBajo);
    rmSync(cuerpoAlto);
  });
});

describe('P-03 · riesgo-ci.sh: pendiente → final → revalidación (Codex #82, P1)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'p03ci-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const sh = (cmd: string, cwd: string) => execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
  // remoto bare + clon con los scripts reales de este árbol (lo que en CI es el checkout de main)
  sh('git init -q --bare -b main remoto.git && git init -q -b main clon', dir);
  const clon = path.join(dir, 'clon');
  sh(`git config user.email t@t && git config user.name t && mkdir -p scripts/collab docs && cp ${ROOT}/scripts/collab/{risk.mjs,risk.lib.mjs,paralelo.sh,riesgo-ci.sh} scripts/collab/ && cp ${ROOT}/pnpm-workspace.yaml . && echo a > docs/a.md && git add -A && git commit -qm base && git remote add origin ../remoto.git && git push -q origin main`, clon);
  sh('git checkout -qb pr && echo b >> docs/a.md && git commit -qam pr && git push -q origin pr:refs/pull/7/head pr:refs/pull/8/head main:refs/heads/fase && git checkout -q main', clon);
  const HEAD_PR = sh('git rev-parse pr', clon).trim();
  // gh falso: cada `api repos/R/pulls/7` devuelve el cuerpo N de la secuencia; POST check-runs se registra
  mkdirSync(path.join(dir, 'bin'));
  writeFileSync(
    path.join(dir, 'bin/gh'),
    `#!/usr/bin/env bash
set -e
D=${dir}
if [ "$1 $2" = "api -X" ]; then
  f=$(cat "$D/postfalla" 2>/dev/null || echo 0); if [ "$f" -gt 0 ]; then echo $((f-1)) > "$D/postfalla"; exit 1; fi
  cat "$6" >> "$D/checks.log"; echo >> "$D/checks.log"; echo https://x/check; exit 0
fi
case "$2" in *'pulls?state=open'*)
  f=$(cat "$D/listafalla" 2>/dev/null || echo 0); if [ "$f" -gt 0 ]; then echo $((f-1)) > "$D/listafalla"; echo "HTTP 502" >&2; exit 1; fi
  cat "$D/lista" 2>/dev/null; exit 0 ;; esac
# cuerpo fijo por PR (dos PR con el mismo HEAD; AUDIT: CAMBIOS @ e08a47b, P1)
# base por PR (PR hacia otra base con el mismo HEAD; AUDIT: CAMBIOS @ 94bad43, P2)
pr=\${2##*/}; if [ -f "$D/cuerpo_$pr" ]; then
  [ "$(cat "$D/cuerpo_$pr")" != "__falla__" ] || { echo "HTTP 502" >&2; exit 1; }
  base=$(cat "$D/base_$pr" 2>/dev/null || echo main)
  # secuencia de bases por foto (retarget durante el lote; AUDIT: CAMBIOS @ 9a7170b, P2)
  if [ -f "$D/bases_$pr" ]; then k=$(cat "$D/nb_$pr" 2>/dev/null || echo 0); k=$((k+1)); echo $k > "$D/nb_$pr"
    base=$(sed -n "\${k}p" "$D/bases_$pr"); [ -n "$base" ] || base=$(tail -n1 "$D/bases_$pr"); fi
  jq -n --arg h "${HEAD_PR}" --arg base "$base" --rawfile b "$D/cuerpo_$pr" '{state:"open", head:{sha:$h}, base:{ref:$base}, body:$b}'; exit 0; fi
n=$(cat "$D/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$D/n"
cuerpo=$(sed -n "\${n}p" "$D/cuerpos"); [ -n "$cuerpo" ] || cuerpo=$(tail -n1 "$D/cuerpos")
[ "$cuerpo" != "__falla__" ] || { echo "HTTP 502" >&2; exit 1; }
h=${HEAD_PR}; if [ -f "$D/heads" ]; then hh=$(sed -n "\${n}p" "$D/heads"); [ -n "$hh" ] && h=$hh || h=$(tail -n1 "$D/heads"); fi
jq -n --arg h "$h" --arg b "$cuerpo" '{state:"open", head:{sha:$h}, base:{ref:"main"}, body:$b}'
`,
    { mode: 0o755 },
  );
  let ultimosShas: string[] = [];
  let ultimos: { name: string; head_sha: string; status: string; conclusion?: string }[] = [];
  const correr = (cuerpos: string[], extra: { lista?: string; postfalla?: number; listafalla?: number; args?: string[]; sinMain?: boolean } = {}) => {
    writeFileSync(path.join(dir, 'lista'), extra.lista ?? `7 ${HEAD_PR}\n`);
    writeFileSync(path.join(dir, 'listafalla'), String(extra.listafalla ?? 0));
    writeFileSync(path.join(dir, 'postfalla'), String(extra.postfalla ?? 0));
    // la primera foto la consume la pasada que pone TODOS los HEAD en en_progreso
    writeFileSync(path.join(dir, 'cuerpos'), [cuerpos[0], ...cuerpos].join('\n') + '\n');
    rmSync(path.join(dir, 'n'), { force: true });
    rmSync(path.join(dir, 'checks.log'), { force: true });
    let rc = 0;
    try {
      execFileSync('bash', ['scripts/collab/riesgo-ci.sh', ...(extra.args ?? ['7'])], { cwd: clon, env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x', RIESGO_GLOBAL: '1' }, stdio: 'pipe' });
    } catch (e) {
      rc = (e as { status: number }).status;
    }
    const checks = readFileSync(path.join(dir, 'checks.log'), 'utf8').trim().split('\n\n').map((j) => JSON.parse(j));
    ultimosShas = checks.map((c: { head_sha: string }) => c.head_sha);
    ultimos = checks;
    return { rc, checks: checks.map((c: { status: string; conclusion?: string; output: { title: string } }) => c.conclusion ?? c.status) };
  };

  it('estable y bien declarado → en_progreso y success', () => {
    expect(correr(['Riesgo: bajo'])).toEqual({ rc: 0, checks: ['in_progress', 'in_progress', 'success'] });
  });
  it('cuerpo editado durante la evaluación → failure caducado (sin success)', () => {
    expect(correr(['Riesgo: bajo', 'Riesgo: alto'])).toEqual({ rc: 1, checks: ['in_progress', 'in_progress', 'failure'] });
  });
  it('cuerpo editado justo después de publicar success → se pisa con failure', () => {
    expect(correr(['Riesgo: bajo', 'Riesgo: bajo', 'Riesgo: medio'])).toEqual({ rc: 1, checks: ['in_progress', 'in_progress', 'success', 'failure'] });
  });
  it('main avanzó respecto de los scripts que corrieron → failure caducado', () => {
    sh('git commit -q --allow-empty -m otro && git push -q origin HEAD:main && git reset -q --hard HEAD~1', clon);
    expect(correr(['Riesgo: bajo'])).toEqual({ rc: 1, checks: ['in_progress', 'in_progress', 'failure'] });
    sh('git pull -q --ff-only origin main', clon);
  });
  it('un verde del lote que cambia antes de terminar el lote → la conciliación final lo pisa (Codex #82, P1)', () => {
    // fotos: pasada previa, F1, F2, F3 iguales; la conciliación final ve el cuerpo editado
    expect(correr(['Riesgo: bajo', 'Riesgo: bajo', 'Riesgo: bajo', 'Riesgo: medio'])).toEqual({ rc: 1, checks: ['in_progress', 'in_progress', 'success', 'failure'] });
  });
  it('un PR que entra a main durante el lote recibe failure "sin veredicto" (Codex #82, P1)', () => {
    const r = correr(['Riesgo: bajo'], { lista: `7 ${HEAD_PR}\n9 ${'9'.repeat(40)}\n` });
    expect(r).toEqual({ rc: 1, checks: ['in_progress', 'in_progress', 'success', 'failure'] });
  });
  it('POST que falla de forma transitoria se reintenta y el lote sigue (Codex #82, P1)', () => {
    expect(correr(['Riesgo: bajo'], { postfalla: 2 })).toEqual({ rc: 0, checks: ['in_progress', 'in_progress', 'success'] });
  });
  it('API caída al tomar la foto → failure, nunca "no abierto" con exit 0 (Codex #82, P1)', () => {
    // pasada previa OK (pone en_progreso), F1 falla → rc 1; el HEAD queda en en_progreso, no verde
    const r = correr(['Riesgo: bajo', '__falla__', '__falla__']);
    expect(r.rc).toBe(1);
    expect(r.checks).not.toContain('success');
  });
  it('primera foto falla con HEAD listado → failure sobre ese HEAD (Codex #82, P1)', () => {
    // todas las fotos fallan: sin la lista N:HEAD no habría dónde publicar
    const r = correr(['__falla__'], { args: [`7:${HEAD_PR}`] });
    expect(r.rc).toBe(1);
    expect(r.checks).toContain('failure');
    expect(r.checks).not.toContain('success');
  });
  it('el PR avanza durante la evaluación → failure también sobre el HEAD nuevo (Codex #82, P1)', () => {
    // fotos: previa y F1 con HEAD_PR; F2 con otro HEAD → failure en ambos
    const otro = 'f'.repeat(40);
    writeFileSync(path.join(dir, 'heads'), `${HEAD_PR}\n${HEAD_PR}\n${otro}\n`);
    const r = correr(['Riesgo: bajo']);
    rmSync(path.join(dir, 'heads'), { force: true });
    expect(r.rc).toBe(1);
    expect(r.checks).not.toContain('success');
    expect(ultimosShas).toContain(otro);
  });
  it('PR rechazado que avanza a otro HEAD durante el lote → failure también sobre el HEAD nuevo listado (Codex #82, P1)', () => {
    const nuevo = 'e'.repeat(40);
    // sin declaración → rechazado sobre HEAD_PR; la lista final ya muestra el HEAD nuevo
    const r = correr(['nada'], { lista: `7 ${nuevo}\n` });
    expect(r.rc).toBe(1);
    expect(ultimosShas).toContain(nuevo);
    expect(r.checks).not.toContain('success');
  });
  for (const orden of [['7', '8'], ['8', '7']]) {
    it(`dos PR con el mismo HEAD, uno rechazado (orden ${orden.join(',')}) → el último check del HEAD es failure (AUDIT: CAMBIOS @ e08a47b, P1)`, () => {
      writeFileSync(path.join(dir, 'cuerpo_7'), 'nada\n');
      writeFileSync(path.join(dir, 'cuerpo_8'), 'Riesgo: bajo\n');
      const r = correr(['Riesgo: bajo'], { lista: `7 ${HEAD_PR}\n8 ${HEAD_PR}\n`, args: orden });
      rmSync(path.join(dir, 'cuerpo_7'));
      rmSync(path.join(dir, 'cuerpo_8'));
      expect(r.rc).toBe(1);
      expect(r.checks).toContain('success'); // #8 sí pasó…
      expect(r.checks.at(-1)).toBe('failure'); // …pero el rechazo de #7 manda sobre el SHA
      expect(ultimosShas.at(-1)).toBe(HEAD_PR);
    });
  }
  // AUDIT: CAMBIOS @ 94bad43, P2: riesgo.yml agrega el PR del evento hacia otra base como `N:HEAD:otra`
  const deCheck = (n: string) => ultimos.filter((c) => c.name === n).map((c) => c.conclusion ?? c.status);
  const conBase = (cuerpo7: string, cuerpo8: string, base8: string | null, args: string[]) => {
    writeFileSync(path.join(dir, 'cuerpo_7'), cuerpo7);
    writeFileSync(path.join(dir, 'cuerpo_8'), cuerpo8);
    if (base8) writeFileSync(path.join(dir, 'base_8'), base8);
    try {
      return correr(['Riesgo: bajo'], { lista: `7 ${HEAD_PR}\n`, args });
    } finally {
      for (const f of ['cuerpo_7', 'cuerpo_8', 'base_8']) rmSync(path.join(dir, f), { force: true });
    }
  };
  for (const args of [['7', `8:${HEAD_PR}:otra`], [`8:${HEAD_PR}:otra`, '7']]) {
    it(`PR hacia otra base rechazado con el mismo HEAD que uno válido hacia main (orden ${args.map((a) => a[0]).join(',')}) → \`riesgo\` queda success; el rechazo va a \`riesgo (otra base)\` (AUDIT: CAMBIOS @ 94bad43, P2)`, () => {
      const r = conBase('Riesgo: bajo\n', 'nada\n', 'fase', args);
      expect(r.rc).toBe(1); // el lote informa el rechazo de #8…
      expect(deCheck('riesgo')).not.toContain('failure'); // …pero no pinta el check de #7
      expect(deCheck('riesgo').at(-1)).toBe('success');
      expect(deCheck('riesgo (otra base)').at(-1)).toBe('failure');
      expect(new Set(ultimosShas)).toEqual(new Set([HEAD_PR]));
    });
  }
  it('PR hacia otra base bien declarado → success en `riesgo (otra base)`, no toca `riesgo` (AUDIT: CAMBIOS @ 94bad43, P2)', () => {
    const r = conBase('nada\n', 'Riesgo: bajo\n', 'fase', ['7', `8:${HEAD_PR}:otra`]);
    expect(r.rc).toBe(1); // #7 (main) sin declaración
    expect(deCheck('riesgo').at(-1)).toBe('failure');
    expect(deCheck('riesgo (otra base)').at(-1)).toBe('success');
  });
  it('PR del evento hacia otra base sin foto (API caída) → failure solo en `riesgo (otra base)` (AUDIT: CAMBIOS @ 94bad43, P2)', () => {
    const r = conBase('Riesgo: bajo\n', '__falla__', null, ['7', `8:${HEAD_PR}:otra`]);
    expect(r.rc).toBe(1);
    expect(deCheck('riesgo')).not.toContain('failure');
    expect(deCheck('riesgo').at(-1)).toBe('success');
    expect(deCheck('riesgo (otra base)')).toEqual(['failure', 'failure']);
  });
  it('marcado `:otra` pero la foto dice base main (retarget) → cuenta como PR hacia main y su rechazo domina (AUDIT: CAMBIOS @ 94bad43, P2)', () => {
    const r = conBase('Riesgo: bajo\n', 'nada\n', null, ['7', `8:${HEAD_PR}:otra`]);
    expect(r.rc).toBe(1);
    expect(deCheck('riesgo').at(-1)).toBe('failure');
    expect(deCheck('riesgo (otra base)')).toEqual([]);
  });
  // AUDIT: CAMBIOS @ 9a7170b, P2: #8 (mismo HEAD que #7, válido hacia main) se retargetea de main a
  // una rama de fase en la foto N; su `caducado` va a `riesgo (otra base)` y no bloquea a #7.
  // Fotos de #8: F0 (pasada previa), F1, F2 (tras evaluar), F3 (tras publicar success), FX (conciliación final).
  const retarget = (bases8: string[], args: string[], con7 = true, cuerpo7 = 'Riesgo: bajo\n') => {
    writeFileSync(path.join(dir, 'cuerpo_7'), cuerpo7);
    writeFileSync(path.join(dir, 'cuerpo_8'), 'Riesgo: bajo\n');
    writeFileSync(path.join(dir, 'bases_8'), bases8.join('\n') + '\n');
    rmSync(path.join(dir, 'nb_8'), { force: true });
    try {
      return correr(['Riesgo: bajo'], { lista: con7 ? `7 ${HEAD_PR}\n` : '', args });
    } finally {
      for (const f of ['cuerpo_7', 'cuerpo_8', 'bases_8', 'nb_8']) rmSync(path.join(dir, f), { force: true });
    }
  };
  const caminos: [string, string[]][] = [
    ['F2 (tras evaluar)', ['main', 'main', 'fase']],
    ['F3 (tras publicar success)', ['main', 'main', 'main', 'fase']],
    ['FX (conciliación final)', ['main', 'main', 'main', 'main', 'fase']],
  ];
  for (const [camino, bases8] of caminos) {
    for (const args of [['7', '8'], ['8', '7']]) {
      it(`retarget main → fase en ${camino} (orden ${args.join(',')}) → \`riesgo\` queda success para #7; el caducado va a \`riesgo (otra base)\` (AUDIT: CAMBIOS @ 9a7170b, P2)`, () => {
        const r = retarget(bases8, args);
        expect(r.rc).toBe(1); // el lote informa el caducado de #8…
        expect(deCheck('riesgo').at(-1)).toBe('success'); // …sin pintar de rojo a #7
        expect(deCheck('riesgo')).not.toContain('failure');
        expect(deCheck('riesgo (otra base)').at(-1)).toBe('failure');
        expect(new Set(ultimosShas)).toEqual(new Set([HEAD_PR]));
      });
    }
    it(`retarget main → fase en ${camino} sin otro PR hacia main con ese HEAD → \`riesgo\` no queda success (AUDIT: CAMBIOS @ 9a7170b, P2)`, () => {
      const r = retarget(bases8, ['8'], false);
      expect(r.rc).toBe(1);
      expect(deCheck('riesgo').at(-1)).toBe('failure');
      expect(deCheck('riesgo (otra base)').at(-1)).toBe('failure');
    });
  }
  // AUDIT: CAMBIOS @ 6c96f82, P2: en el sentido fase → main el nombre viejo (`riesgo (otra base)`)
  // tiene que cerrarse; si otro PR hacia la fase comparte HEAD y quedó válido, no se lo ensucia.
  const caminosFase: [string, string[]][] = [
    ['F2 (tras evaluar)', ['fase', 'fase', 'main']],
    ['F3 (tras publicar success)', ['fase', 'fase', 'fase', 'main']],
    ['FX (conciliación final)', ['fase', 'fase', 'fase', 'fase', 'main']],
  ];
  for (const [camino, bases8] of caminosFase) {
    it(`retarget fase → main en ${camino} → el caducado va a \`riesgo\` y domina sobre el verde de #7; \`riesgo (otra base)\` no queda en_progreso (AUDIT: CAMBIOS @ 6c96f82, P2)`, () => {
      const r = retarget(bases8, ['7', `8:${HEAD_PR}:otra`]);
      expect(r.rc).toBe(1);
      expect(deCheck('riesgo').at(-1)).toBe('failure');
      expect(deCheck('riesgo (otra base)').at(-1)).toBe('failure');
      expect(new Set(ultimosShas)).toEqual(new Set([HEAD_PR]));
    });
    for (const args of [[`7:${HEAD_PR}:otra`, `8:${HEAD_PR}:otra`], [`8:${HEAD_PR}:otra`, `7:${HEAD_PR}:otra`]]) {
      it(`retarget fase → main en ${camino} con #7 válido hacia la fase (orden ${args.map((a) => a[0]).join(',')}) → \`riesgo (otra base)\` queda success para #7 (AUDIT: CAMBIOS @ 6c96f82, P2)`, () => {
        writeFileSync(path.join(dir, 'base_7'), 'fase');
        try {
          const r = retarget(bases8, args, false);
          expect(r.rc).toBe(1); // el lote informa el caducado de #8…
          expect(deCheck('riesgo (otra base)').at(-1)).toBe('success'); // …sin pintar de rojo a #7
          expect(deCheck('riesgo').at(-1)).toBe('failure'); // el caducado de #8 queda en `riesgo`
        } finally {
          rmSync(path.join(dir, 'base_7'), { force: true });
        }
      });
    }
  }
  it('retarget fase → main con #7 hacia la fase rechazado sobre el mismo HEAD → `riesgo (otra base)` queda failure (AUDIT: CAMBIOS @ 6c96f82, P2)', () => {
    writeFileSync(path.join(dir, 'base_7'), 'fase');
    try {
      const r = retarget(['fase', 'fase', 'main'], [`7:${HEAD_PR}:otra`, `8:${HEAD_PR}:otra`], false, 'nada\n');
      expect(r.rc).toBe(1);
      expect(deCheck('riesgo (otra base)').at(-1)).toBe('failure');
      expect(deCheck('riesgo (otra base)')).not.toContain('success');
    } finally {
      rmSync(path.join(dir, 'base_7'), { force: true });
    }
  });
  it('PR que comparte HEAD con un verde pero no se evaluó en el lote → failure (AUDIT: CAMBIOS @ e08a47b, P1)', () => {
    const r = correr(['Riesgo: bajo'], { lista: `7 ${HEAD_PR}\n8 ${HEAD_PR}\n` });
    expect(r.rc).toBe(1);
    expect(r.checks.at(-1)).toBe('failure');
  });
  it('re-listado final que falla de forma transitoria se reintenta y el verde queda (AUDIT: CAMBIOS @ 157a7f7, P1)', () => {
    expect(correr(['Riesgo: bajo'], { listafalla: 2 })).toEqual({ rc: 0, checks: ['in_progress', 'in_progress', 'success'] });
  });
  it('re-listado final que falla siempre (502) → el último check del HEAD es failure, rc 1 (AUDIT: CAMBIOS @ 157a7f7, P1)', () => {
    const r = correr(['Riesgo: bajo'], { listafalla: 99 });
    expect(r).toEqual({ rc: 1, checks: ['in_progress', 'in_progress', 'success', 'failure'] });
    expect(ultimosShas.at(-1)).toBe(HEAD_PR);
  });
  it('sin declaración → failure', () => {
    expect(correr(['nada'])).toEqual({ rc: 1, checks: ['in_progress', 'in_progress', 'failure'] });
  });
});
