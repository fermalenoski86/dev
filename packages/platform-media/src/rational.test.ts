import { describe, expect, it } from 'vitest';
import { parseRational, rationalToString, secondsToMs } from './rational';

describe('CRITERIO: fps como racional exacto', () => {
  it('reduce y compara fracciones, no floats', () => {
    expect(parseRational('25/1')).toEqual({ numerator: 25, denominator: 1 });
    expect(parseRational('50/2')).toEqual({ numerator: 25, denominator: 1 });
    expect(parseRational('30000/1001')).toEqual({ numerator: 30000, denominator: 1001 });
    expect(parseRational('60000/2002')).toEqual({ numerator: 30000, denominator: 1001 });
    expect(parseRational('24')).toEqual({ numerator: 24, denominator: 1 });
  });
  it('inválidos ⇒ null: 0/0, x/0, negativos, decimales, basura', () => {
    for (const malo of ['0/0', '25/0', '0/1', '-25/1', '25.0', '29.97', 'abc', '', ' / ', '1e3', undefined, null]) {
      expect(parseRational(malo as string), String(malo)).toBeNull();
    }
  });
  it('29.97 no es 30: no hay tolerancia accidental', () => {
    expect(rationalToString(parseRational('30000/1001') ?? { numerator: 0, denominator: 1 })).not.toBe('30/1');
  });
});

describe('duración exacta, sin float', () => {
  it('trunca a ms', () => {
    expect(secondsToMs('2.000000')).toBe(2000);
    expect(secondsToMs('2.002000')).toBe(2002);
    expect(secondsToMs('0.4')).toBe(400);
    expect(secondsToMs('11.9999')).toBe(11999);
    expect(secondsToMs('7')).toBe(7000);
  });
  it('inválidos ⇒ null', () => {
    for (const malo of ['N/A', '-1.0', '', 'abc', undefined]) expect(secondsToMs(malo as string)).toBeNull();
  });
});
