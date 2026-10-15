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
  });

  it('código de producto que agrega procesos externos, secrets o DDL → alto', () => {
    expect(nivel([m('apps/platform-api/src/x.ts', "+import { spawn } from 'node:child_process';")])).toBe('alto');
    expect(nivel([m('packages/platform-assets/src/x.ts', '+  execFile(bin, args)')])).toBe('alto');
    // quitar la llamada directa y pasar a un helper indirecto también es alto (Codex #82, P2)
    expect(nivel([m('packages/platform-assets/src/x.ts', "-  execFile('ffmpeg', safeArgs)\n+  runFfmpeg(userArgs)")])).toBe('alto');
    expect(nivel([m('packages/platform-campaigns/src/q.ts', '+  await db.query(`ALTER TABLE campaign ADD COLUMN x int`)')])).toBe('alto');
    expect(nivel([m('apps/platform-web/src/a.ts', '+  token: ${{ secrets.X }}')])).toBe('alto');
  });

  it('docs que solo MENCIONAN spawn o ALTER TABLE siguen bajo (texto, no código)', () => {
    expect(nivel([m('docs/reviews/X.md', '+ nunca `spawn(` con shell; `ALTER TABLE` va en migraciones')])).toBe('bajo');
  });

  it('reducción de tests → alto: borrar el archivo, quitar casos, agregar skip/only o retries', () => {
    expect(nivel([{ ruta: 'apps/platform-web/src/a.test.ts', estado: 'D' }])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', "-  it('a', () => {\n-    expect(1).toBe(1);\n+  // nada")])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', "+  it.skip('a', () => {})")])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', '+  describe.' + 'only(() => {})' /* partido: politica-fallas.sh rechaza el literal en tests */)])).toBe('alto');
    // aserción multilínea que pierde solo el matcher (Codex #82, P2)
    expect(nivel([m('apps/platform-web/src/components/views-bl31.test.ts', "-      .toContain('Solo lectura');\n+      ;")])).toBe('alto');
    expect(nivel([m('packages/show-engine/src/e.test.ts', '-    ).resolves.toBe(1);')])).toBe('alto');
    // agregar `re.test(` no compensa casos quitados
    expect(nivel([m('packages/show-engine/src/e.test.ts', "-  it('a', () => {\n-  it('b', () => {\n+  ok = re.test(x);\n+  ok = re.test(y);")])).toBe('alto');
    // mismo número de casos (renombrar un test) no reduce
    expect(nivel([m('packages/show-engine/src/e.test.ts', "-  it('a', () => {\n+  it('b', () => {")])).toBe('medio');
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
    expect(declarado('Riesgo: bajo\nRiesgo: alto').error).toMatch(/más de un/);
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
  sh('git checkout -qb pr && echo b >> docs/a.md && git commit -qam pr && git push -q origin pr:refs/pull/7/head && git checkout -q main', clon);
  const HEAD_PR = sh('git rev-parse pr', clon).trim();
  // gh falso: cada `api repos/R/pulls/7` devuelve el cuerpo N de la secuencia; POST check-runs se registra
  mkdirSync(path.join(dir, 'bin'));
  writeFileSync(
    path.join(dir, 'bin/gh'),
    `#!/usr/bin/env bash
set -e
D=${dir}
if [ "$1 $2" = "api -X" ]; then cat >> "$D/checks.log"; echo >> "$D/checks.log"; echo https://x/check; exit 0; fi
n=$(cat "$D/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$D/n"
cuerpo=$(sed -n "\${n}p" "$D/cuerpos"); [ -n "$cuerpo" ] || cuerpo=$(tail -n1 "$D/cuerpos")
jq -n --arg h ${HEAD_PR} --arg b "$cuerpo" '{state:"open", head:{sha:$h}, base:{ref:"main"}, body:$b}'
`,
    { mode: 0o755 },
  );
  const correr = (cuerpos: string[]) => {
    writeFileSync(path.join(dir, 'cuerpos'), cuerpos.join('\n') + '\n');
    rmSync(path.join(dir, 'n'), { force: true });
    rmSync(path.join(dir, 'checks.log'), { force: true });
    let rc = 0;
    try {
      execFileSync('bash', ['scripts/collab/riesgo-ci.sh', '7'], { cwd: clon, env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x' }, stdio: 'pipe' });
    } catch (e) {
      rc = (e as { status: number }).status;
    }
    const checks = readFileSync(path.join(dir, 'checks.log'), 'utf8').trim().split('\n\n').map((j) => JSON.parse(j));
    return { rc, checks: checks.map((c: { status: string; conclusion?: string; output: { title: string } }) => c.conclusion ?? c.status) };
  };

  it('estable y bien declarado → en_progreso y success', () => {
    expect(correr(['Riesgo: bajo'])).toEqual({ rc: 0, checks: ['in_progress', 'success'] });
  });
  it('cuerpo editado durante la evaluación → failure caducado (sin success)', () => {
    expect(correr(['Riesgo: bajo', 'Riesgo: alto'])).toEqual({ rc: 1, checks: ['in_progress', 'failure'] });
  });
  it('cuerpo editado justo después de publicar success → se pisa con failure', () => {
    expect(correr(['Riesgo: bajo', 'Riesgo: bajo', 'Riesgo: medio'])).toEqual({ rc: 1, checks: ['in_progress', 'success', 'failure'] });
  });
  it('main avanzó respecto de los scripts que corrieron → failure caducado', () => {
    sh('git commit -q --allow-empty -m otro && git push -q origin HEAD:main && git reset -q --hard HEAD~1', clon);
    expect(correr(['Riesgo: bajo'])).toEqual({ rc: 1, checks: ['in_progress', 'failure'] });
    sh('git pull -q --ff-only origin main', clon);
  });
  it('sin declaración → failure', () => {
    expect(correr(['nada'])).toEqual({ rc: 1, checks: ['in_progress', 'failure'] });
  });
});
