import { describe, it, expect } from 'vitest';
import { Transport, ManualClock } from './index';

const make = (durationMs = 30000, loop = false) => {
  const clock = new ManualClock(1000);
  const t = new Transport({ durationMs, now: clock.now, loop });
  return { clock, t };
};

describe('Transport', () => {
  it('arranca detenido en 0', () => {
    const { t } = make();
    expect(t.getStatus()).toBe('stopped');
    expect(t.getTimeMs()).toBe(0);
  });

  it('no avanza si el reloj no avanza', () => {
    const { t } = make();
    t.play();
    expect(t.getTimeMs()).toBe(0);
    expect(t.getTimeMs()).toBe(0);
  });

  it('avanza con el reloj externo', () => {
    const { clock, t } = make();
    t.play();
    clock.advance(5000);
    expect(t.getTimeMs()).toBe(5000);
  });

  it('pause congela el tiempo aunque el reloj siga', () => {
    const { clock, t } = make();
    t.play();
    clock.advance(4000);
    t.pause();
    clock.advance(10000);
    expect(t.getTimeMs()).toBe(4000);
    expect(t.getStatus()).toBe('paused');
  });

  it('reanuda desde donde pausó, sin saltar el tiempo transcurrido', () => {
    const { clock, t } = make();
    t.play();
    clock.advance(4000);
    t.pause();
    clock.advance(60000); // el operador se fue a tomar un café
    t.play();
    clock.advance(1000);
    expect(t.getTimeMs()).toBe(5000);
  });

  it('stop vuelve a 0', () => {
    const { clock, t } = make();
    t.play();
    clock.advance(9000);
    t.stop();
    expect(t.getTimeMs()).toBe(0);
    expect(t.getStatus()).toBe('stopped');
  });

  it('seek mantiene playing y sigue corriendo desde el punto nuevo', () => {
    const { clock, t } = make();
    t.play();
    clock.advance(2000);
    t.seek(20000);
    expect(t.getTimeMs()).toBe(20000);
    clock.advance(1500);
    expect(t.getTimeMs()).toBe(21500);
  });

  it('seek hacia atrás es exacto', () => {
    const { clock, t } = make();
    t.play();
    clock.advance(25000);
    t.seek(3000);
    expect(t.getTimeMs()).toBe(3000);
  });

  it('clampea fuera de rango', () => {
    const { t } = make(30000);
    t.seek(-5000);
    expect(t.getTimeMs()).toBe(0);
    t.seek(999999);
    expect(t.getTimeMs()).toBe(30000);
  });

  it('nudge relativo adelante y atrás', () => {
    const { t } = make();
    t.seek(10000);
    t.nudge(2500);
    expect(t.getTimeMs()).toBe(12500);
    t.nudge(-5000);
    expect(t.getTimeMs()).toBe(7500);
  });

  it('sin loop se clampea en durationMs', () => {
    const { clock, t } = make(10000);
    t.play();
    clock.advance(999999);
    expect(t.getTimeMs()).toBe(10000);
    expect(t.isFinished()).toBe(true);
  });

  it('con loop vuelve a empezar', () => {
    const { clock, t } = make(10000, true);
    t.play();
    clock.advance(25000);
    expect(t.getTimeMs()).toBe(5000);
    expect(t.isFinished()).toBe(false);
  });

  it('play después de terminar reinicia desde 0', () => {
    const { clock, t } = make(10000);
    t.play();
    clock.advance(20000);
    t.pause();
    expect(t.getTimeMs()).toBe(10000);
    t.play();
    expect(t.getTimeMs()).toBe(0);
  });

  it('rate lento no distorsiona lo ya transcurrido', () => {
    const { clock, t } = make();
    t.play();
    clock.advance(4000);
    t.setRate(0.5);
    clock.advance(4000);
    expect(t.getTimeMs()).toBe(6000);
  });

  it('dos transports con el mismo reloj dan el mismo tiempo', () => {
    const clock = new ManualClock(0);
    const a = new Transport({ durationMs: 30000, now: clock.now });
    const b = new Transport({ durationMs: 30000, now: clock.now });
    a.play();
    b.play();
    clock.advance(7331);
    expect(a.getTimeMs()).toBe(b.getTimeMs());
  });
});
