import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter } from './limiter';
import { MediaAbortError } from './types';

const diferido = () => { let r = () => {}; const p = new Promise<void>((res) => { r = res; }); return { p, r }; };

describe('CRITERIO: limitador de concurrencia', () => {
  it('nunca supera el máximo; el resto espera en cola FIFO', async () => {
    const l = new ConcurrencyLimiter(2);
    const orden: number[] = [];
    let vivos = 0, pico = 0;
    const gates = Array.from({ length: 6 }, diferido);
    const tareas = gates.map((g, i) => l.run(async () => { vivos++; pico = Math.max(pico, vivos); orden.push(i); await g.p; vivos--; }));
    expect([l.active, l.queued]).toEqual([2, 4]);
    for (const g of gates) { g.r(); await new Promise((r) => setTimeout(r, 0)); }
    await Promise.all(tareas);
    expect(pico).toBe(2);
    expect(orden).toEqual([0, 1, 2, 3, 4, 5]);
    expect([l.active, l.queued]).toEqual([0, 0]);
  });
  it('cancelar mientras espera: sale de la cola y NUNCA ejecuta', async () => {
    const l = new ConcurrencyLimiter(1);
    const g = diferido();
    const primera = l.run(() => g.p);
    const ac = new AbortController();
    let ejecuto = false;
    const segunda = l.run(async () => { ejecuto = true; }, ac.signal);
    expect(l.queued).toBe(1);
    ac.abort();
    await expect(segunda).rejects.toBeInstanceOf(MediaAbortError);
    expect(l.queued).toBe(0);
    g.r();
    await primera;
    expect(ejecuto).toBe(false);
    expect(l.active).toBe(0);
  });
  it('una tarea que falla libera su lugar', async () => {
    const l = new ConcurrencyLimiter(1);
    await expect(l.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await l.run(async () => 7)).toBe(7);
  });
  it('máximo inválido se rechaza', () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow();
    expect(() => new ConcurrencyLimiter(1.5)).toThrow();
  });
});
