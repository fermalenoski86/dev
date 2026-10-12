import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos (script de CI, sin build)
import { contar, evaluar, fechaValida, jobDe, render, validar } from './progreso.lib.mjs';
// @ts-expect-error módulo .mjs sin tipos
import { ENTREGABLES, PISTAS, REPO } from './entregables.mjs';
// @ts-expect-error módulo .mjs sin tipos
import { NAVEGADOR, POINTS } from '../acceptance/points.mjs';

/**
 * P-02 · negativos controlados del reporte de progreso: cada forma de que
 * PROGRESO.md diga más de lo que el repo prueba tiene que fallar.
 */
const ROOT = path.resolve(__dirname, '../..');
const AUDIT = (n: number) => `https://github.com/${REPO}/pull/${n}#issuecomment-6000000000`;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const existe = (p: string) => existsSync(path.join(ROOT, p));
const ctxReal = { repo: REPO, pistas: PISTAS, points: POINTS, navegador: NAVEGADOR, existe };
// Contexto de laboratorio: pistas reales, puntos/ids controlados, "existe" solo lo que declaramos.
const ARCHIVOS = ['docs/b.md', 'apps/platform-api/src/x.db.test.ts', 'packages/p/src/u.test.ts', 'e2e-platform/f.spec.ts'];
const puntos = (estado5 = 'cubierto') => POINTS.map((p: { n: number }) => (p.n === 5 ? { ...p, estado: estado5, motivo: 'lab' } : p));
const lab = (over: Partial<typeof ctxReal> = {}) => ({ repo: REPO, pistas: PISTAS, points: puntos(), navegador: NAVEGADOR, existe: (p: string) => ARCHIVOS.includes(p), ...over });
const producto = (over: Record<string, unknown> = {}) => ({
  id: 'X-1',
  pista: 'gestion',
  tipo: 'producto',
  texto: 'algo',
  brief: 'docs/b.md',
  codigo: { prs: [{ numero: 7, merge: SHA_A, auditado: SHA_B, audit: AUDIT(7) }] },
  simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/x.db.test.ts'] }],
  real: [],
  ...over,
});
const real = { referencia: 'docs/hardware/pruebas/2026-11-03-tb60.md', condiciones: 'TB60 real, pantalla Pellegrini, 18:30, señal desde platform-api', fecha: '2026-11-03', responsable: 'Fer' };

describe('P-02 · progreso verificable', () => {
  it('el manifiesto real valida sin errores y PROGRESO.md coincide byte a byte con lo generado', () => {
    expect(validar(ENTREGABLES, ctxReal)).toEqual([]);
    const doc = readFileSync(path.join(ROOT, 'docs/collab/PROGRESO.md'), 'utf8');
    expect(doc).toBe(render(ENTREGABLES, ctxReal));
  });

  it('regenerar es reproducible: misma entrada, mismo texto; sin fecha ni porcentaje', () => {
    const a = render(ENTREGABLES, ctxReal);
    const b = render(ENTREGABLES, ctxReal);
    expect(a).toBe(b);
    expect(a).not.toMatch(/%/);
    expect(a).not.toMatch(/\b20\d\d-\d\d-\d\dT/);
  });

  it('jobDe deduce el job de CI por nombre; lo que CI no corre no es evidencia', () => {
    expect(jobDe('apps/platform-api/src/x.db.test.ts')).toBe('postgres');
    expect(jobDe('packages/platform-media/src/m.real.test.ts')).toBe('media');
    expect(jobDe('e2e-platform/flow.spec.ts')).toBe('e2e-platform');
    expect(jobDe('e2e/experience.spec.ts')).toBe('e2e-m2c');
    expect(jobDe('packages/p/src/u.test.ts')).toBe('verify-build');
    expect(jobDe('packages/platform-storage/src/s3.contract.test.ts')).toBe('compose-smoke');
    expect(jobDe('scripts/collab/handoff.test.sh')).toBe('verify-build');
    expect(jobDe('e2e/diag/warmup-trace.spec.ts')).toBeNull();
    expect(jobDe('packages/p/src/u.ts')).toBeNull();
  });

  it('un entregable con PR + AUDIT + test cuenta en código y simulado, nunca en equipo real', () => {
    const ev = evaluar(producto(), lab());
    expect(ev.codigo.ok).toBe(true);
    expect(ev.simulado.ok).toBe(true);
    expect(ev.real).toEqual({ ok: false, motivo: 'sin evidencia' });
    expect(contar([producto()], lab()).get('gestion')).toEqual({ definidos: 1, codigo: 1, simulado: 1, real: 0 });
  });

  it('NEGATIVO: PR mergeado sin AUDIT no cuenta y el validador lo rechaza', () => {
    const x = producto({ codigo: { prs: [{ numero: 7, merge: SHA_A, auditado: SHA_B }] } });
    expect(validar([x], lab())).toEqual([expect.stringContaining('PR #7: mergeado sin AUDIT enlazado — no cuenta')]);
    expect(evaluar(x, lab()).codigo).toEqual({ ok: false, motivo: 'PR sin AUDIT' });
  });

  it('NEGATIVO: el AUDIT tiene que ser un comentario del mismo PR y los SHA, completos', () => {
    const otroPr = producto({ codigo: { prs: [{ numero: 7, merge: SHA_A, auditado: SHA_B, audit: AUDIT(8) }] } });
    expect(validar([otroPr], lab())).toEqual([expect.stringContaining('audit debe ser un comentario de ese mismo PR')]);
    const corto = producto({ codigo: { prs: [{ numero: 7, merge: 'abc1234', auditado: SHA_B, audit: AUDIT(7) }] } });
    expect(validar([corto], lab())).toEqual([expect.stringContaining('merge debe ser un SHA completo')]);
    const issue = producto({ codigo: { prs: [{ numero: 7, merge: SHA_A, auditado: SHA_B, audit: `https://github.com/${REPO}/issues/66#issuecomment-1` }] } });
    expect(validar([issue], lab())).toEqual([expect.stringContaining('audit debe ser un comentario de ese mismo PR')]);
  });

  it('NEGATIVO: sin PR hace falta motivo; con motivo, código queda en rojo con ese motivo', () => {
    expect(validar([producto({ codigo: { prs: [] } })], lab())).toEqual(['X-1: sin PR y sin motivo (codigo.sin)']);
    const x = producto({ codigo: { prs: [], sin: 'anterior a GitHub' } });
    expect(validar([x], lab())).toEqual([]);
    expect(evaluar(x, lab()).codigo).toEqual({ ok: false, motivo: 'anterior a GitHub' });
  });

  it('NEGATIVO: sin test, "probado simulado" es ✗ "sin test" y nunca ✔', () => {
    const x = producto({ simulado: [] });
    expect(validar([x], lab())).toEqual([]);
    expect(evaluar(x, lab()).simulado).toEqual({ ok: false, motivo: 'sin test' });
    expect(render([x], lab())).toContain('| ✗ sin test |');
  });

  it('NEGATIVO: un test que no existe o que CI no corre no es evidencia', () => {
    expect(validar([producto({ simulado: [{ tipo: 'tests', archivos: ['apps/platform-api/src/no.db.test.ts'] }] })], lab())).toEqual([expect.stringContaining('test no existe en el repo')]);
    expect(validar([producto({ simulado: [{ tipo: 'tests', archivos: ['docs/b.md'] }] })], lab())).toEqual([expect.stringContaining('no es un archivo de test que CI corra')]);
  });

  it('NEGATIVO: un punto §48 pendiente deja "simulado" en rojo aunque el test exista', () => {
    const x = producto({ simulado: [{ tipo: 'acceptance', puntos: [5] }] });
    expect(validar([x], lab({ points: puntos('pendiente') }))).toEqual([]);
    const ev = evaluar(x, lab({ points: puntos('pendiente') }));
    expect(ev.simulado).toEqual({ ok: false, motivo: 'pendiente: §48.5 pendiente', partes: ['§48: 5⏳'] });
    expect(validar([producto({ simulado: [{ tipo: 'acceptance', puntos: [20] }] })], lab())).toEqual(['X-1: [§48.20] no es un punto de §48']);
    expect(validar([producto({ simulado: [{ tipo: 'navegador', ids: ['E3-99'] }] })], lab())).toEqual(['X-1: «E3-99» no es un id de navegador de points.mjs']);
  });

  it('NEGATIVO: una prueba simulada rotulada como "equipo real" se rechaza, esté en la referencia o en las condiciones', () => {
    for (const referencia of ['apps/platform-api/src/x.db.test.ts', 'e2e-platform/f.spec.ts', 'https://github.com/fermalenoski86/dev/actions/runs/38222115237', 'simulador NovaStar en docker']) {
      const x = producto({ real: [{ ...real, referencia }] });
      expect(validar([x], lab())).toEqual([expect.stringContaining('cuya referencia describe una prueba simulada')]);
      expect(contar([x], lab()).get('gestion')!.real).toBe(0);
    }
    // #67 AUDIT: CAMBIOS (P2), reproducción del auditor: la simulación estaba solo en `condiciones`
    const enCondiciones = producto({ real: [{ referencia: 'docs/evidencia.md', condiciones: 'simulador NovaStar en Docker', fecha: '2026-10-01', responsable: 'Fer' }] });
    expect(validar([enCondiciones], lab())).toEqual([expect.stringContaining('cuya condiciones describe una prueba simulada')]);
    expect(contar([enCondiciones], lab()).get('gestion')!.real).toBe(0);
    expect(evaluar(enCondiciones, lab()).real).toEqual({ ok: false, motivo: 'evidencia inválida (ver validar)' });
  });

  it('NEGATIVO: evidencia real incompleta, con fecha inválida o firmada por un agente se rechaza', () => {
    expect(validar([producto({ real: [{ ...real, condiciones: '' }] })], lab())).toEqual(['X-1: evidencia real sin condiciones']);
    expect(validar([producto({ real: [{ ...real, condiciones: '   ' }] })], lab())).toEqual(['X-1: evidencia real sin condiciones']);
    expect(validar([producto({ real: [{ ...real, fecha: '3/11/2026' }] })], lab())).toEqual([expect.stringContaining('fecha inválida')]);
    expect(validar([producto({ real: [{ ...real, responsable: 'Claude (implementador)' }] })], lab())).toEqual([expect.stringContaining('tiene que ser una persona, no un agente')]);
    // #67 AUDIT: CAMBIOS (P2): el agente con espacio adelante pasaba por la ancla ^ sin normalizar
    const conEspacio = producto({ real: [{ referencia: 'docs/evidencia.md', condiciones: 'pantalla real', fecha: '2026-10-01', responsable: ' Claude' }] });
    expect(validar([conEspacio], lab())).toEqual([expect.stringContaining('responsable «Claude»: tiene que ser una persona, no un agente')]);
    expect(contar([conEspacio], lab()).get('gestion')!.real).toBe(0);
    for (const responsable of ['\tChatGPT', 'codex ', ' bot auditor']) expect(validar([producto({ real: [{ ...real, responsable }] })], lab())).toEqual([expect.stringContaining('no un agente')]);
  });

  it('NEGATIVO: la fecha tiene que existir en el calendario, no solo tener la forma AAAA-MM-DD', () => {
    // #67 AUDIT: CAMBIOS (P2), reproducción del auditor
    const imposible = producto({ real: [{ referencia: 'docs/evidencia.md', condiciones: 'pantalla real', fecha: '2026-99-99', responsable: 'Fer' }] });
    expect(validar([imposible], lab())).toEqual(['X-1: evidencia real con fecha inválida «2026-99-99» (AAAA-MM-DD del calendario)']);
    expect(contar([imposible], lab()).get('gestion')!.real).toBe(0);
    for (const fecha of ['2026-00-10', '2026-13-01', '2026-02-29', '2026-04-31', '2026-10-00', '2026-1-5', '2026-10-12T00:00:00Z']) expect(fechaValida(fecha), fecha).toBe(false);
    for (const fecha of ['2026-10-12', '2024-02-29', '2026-12-31', '2026-01-01']) expect(fechaValida(fecha), fecha).toBe(true);
    expect(validar([producto({ real: [{ ...real, fecha: ' 2024-02-29 ' }] })], lab())).toEqual([]);
  });

  it('evidencia real completa cuenta 1/1 y se muestra con referencia, condiciones, fecha y responsable', () => {
    const x = producto({ real: [real] });
    expect(validar([x], lab())).toEqual([]);
    expect(contar([x], lab()).get('gestion')!.real).toBe(1);
    expect(render([x], lab())).toContain('✔ docs/hardware/pruebas/2026-11-03-tb60.md (TB60 real, pantalla Pellegrini, 18:30, señal desde platform-api; 2026-11-03; Fer)');
  });

  it('una pista sin entregables se informa como 0/0 "todavía no definidos", distinto de 0/N', () => {
    const md = render([producto()], lab());
    expect(md).toContain('| Integración NovaStar / procesador LED | **0/0 — entregables todavía no definidos** | — | — | — |');
    expect(md).toContain('## Integración NovaStar / procesador LED\n\n**0/0 — entregables todavía no definidos.** Fuera de M3A');
    const pendiente = producto({ id: 'NS-1', pista: 'novastar', codigo: { prs: [], sin: 'sin PR todavía' }, simulado: [] });
    const md2 = render([producto(), pendiente], lab());
    expect(md2).toContain('| Integración NovaStar / procesador LED | 1 | 0/1 | 0/1 | 0/1 |');
    expect(md2).not.toContain('| Integración NovaStar / procesador LED | **0/0');
  });

  it('un brief aprobado o una herramienta de proceso no cuenta como funcionalidad', () => {
    const brief = producto({ id: 'B-1', tipo: 'brief', simulado: [] });
    const proceso = producto({ id: 'P-9', tipo: 'proceso' });
    expect(validar([brief, proceso], lab())).toEqual([]);
    expect(contar([brief, proceso], lab()).get('gestion')).toEqual({ definidos: 0, codigo: 0, simulado: 0, real: 0 });
    const md = render([brief, proceso], lab());
    expect(md).toContain('| Software de gestión (plataforma + platform-web) | **0/0 — entregables todavía no definidos** |');
    expect(md).toContain('| B-1 | algo | `docs/b.md` | ✔ [#7]');
    expect(md).toContain('| P-9 | algo | `docs/b.md` | ✔ [#7]');
    expect(validar([producto({ tipo: 'brief' })], lab())).toEqual(['X-1: un brief no tiene evidencia simulada: un documento acordado no es funcionalidad']);
    expect(validar([producto({ tipo: 'brief', simulado: [], real: [real] })], lab())).toEqual(['X-1: un brief no puede tener evidencia con equipo real']);
  });

  it('NEGATIVO: ids repetidos, pista o tipo desconocidos y brief inexistente fallan', () => {
    expect(validar([producto(), producto()], lab())).toEqual(['X-1: id repetido']);
    expect(validar([producto({ pista: 'cupula' })], lab())).toEqual(['X-1: pista desconocida «cupula»']);
    expect(validar([producto({ tipo: 'idea' })], lab())).toEqual([expect.stringContaining('tipo desconocido «idea»')]);
    expect(validar([producto({ brief: 'docs/no.md' })], lab())).toEqual(['X-1: brief no existe en el repo: docs/no.md']);
  });
});
