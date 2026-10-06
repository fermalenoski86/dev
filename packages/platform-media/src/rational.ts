/**
 * Racionales exactos para fps — M3A.1 B2, punto 8.
 *
 * ffprobe informa fps como fracción ("25/1", "30000/1001", "0/0"). La decisión
 * se toma comparando fracciones REDUCIDAS, nunca floats con tolerancia:
 * 30000/1001 (29.97) no es 30/1, y no se acepta por redondeo.
 */
export interface Rational {
  numerator: number;
  denominator: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** "25/1" | "30000/1001" | "24" → fracción reducida. null si es inválida (0/0, negativa, decimal, basura). */
export function parseRational(raw: string | null | undefined): Rational | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,12})(?:\/(\d{1,12}))?$/.exec(raw.trim());
  if (!m?.[1]) return null;
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) return null;
  const g = gcd(num, den);
  return { numerator: num / g, denominator: den / g };
}

export const sameRational = (a: Rational, b: Rational): boolean =>
  a.numerator === b.numerator && a.denominator === b.denominator;

export const rationalToString = (r: Rational): string => `${r.numerator}/${r.denominator}`;

/** Solo para mostrar: 3 decimales. NUNCA para decidir. */
export const rationalValue = (r: Rational): number => Math.round((r.numerator / r.denominator) * 1000) / 1000;

/**
 * "2.002000" → 2002 ms, sin pasar por float: entero y decimales se procesan
 * como texto, y los decimales se TRUNCAN (floor). Truncar es lo conservador
 * para "¿cubre la duración pedida?". null si no es un número decimal >= 0.
 */
export function secondsToMs(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,9})(?:\.(\d+))?$/.exec(raw.trim());
  if (!m?.[1]) return null;
  const frac = (m[2] ?? '').padEnd(3, '0').slice(0, 3);
  const ms = Number(m[1]) * 1000 + Number(frac);
  return Number.isSafeInteger(ms) ? ms : null;
}
