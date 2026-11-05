// Rounding and number formatting that reproduce the reference runtime (spec/geometry.md §11).
// JavaScript defaults differ: Math.round rounds ties toward +∞ and toFixed works on the exact binary value.

/**
 * Banker's rounding (round half to even). With `digits`, computes x·10^digits in floating point, rounds that, then
 * divides by 10^digits (no decimal-string tricks). Negative inputs that round to zero give -0.
 */
export function roundHalfEven(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  if (digits !== 0) {
    const p = Math.pow(10, digits);
    return roundHalfEven(x * p) / p;
  }
  const f = Math.floor(x);
  const diff = x - f;
  let r: number;
  if (diff < 0.5) r = f;
  else if (diff > 0.5) r = f + 1;
  else r = f % 2 === 0 ? f : f + 1;
  if (r === 0 && (x < 0 || Object.is(x, -0))) return -0;
  return r;
}

/** Round half away from zero (the reference's `MidpointRounding.AwayFromZero`) on the binary value. */
export function roundHalfAwayFromZero(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const p = Math.pow(10, digits);
  const v = Math.abs(x) * p;
  const f = Math.floor(v);
  const r = (v - f >= 0.5 ? f + 1 : f) / p;
  return x < 0 ? -r : r;
}

/** The custom numeric format strings used across the specs. */
export type NumberFormat = '0' | '0.#' | '0.##' | '0.0' | '0.00' | '#,0';

interface FormatSpec {
  maxDecimals: number;
  minDecimals: number;
  grouping: boolean;
}

const SPECS: Record<NumberFormat, FormatSpec> = {
  '0': { maxDecimals: 0, minDecimals: 0, grouping: false },
  '0.#': { maxDecimals: 1, minDecimals: 0, grouping: false },
  '0.##': { maxDecimals: 2, minDecimals: 0, grouping: false },
  '0.0': { maxDecimals: 1, minDecimals: 1, grouping: false },
  '0.00': { maxDecimals: 2, minDecimals: 2, grouping: false },
  '#,0': { maxDecimals: 0, minDecimals: 0, grouping: true },
};

/**
 * |x| reduced to its 15-significant-digit decimal form (correctly rounded), then rounded half away from zero to
 * `decimals` digits on those decimal digits. Returns the integer and fraction digit strings.
 */
function decimalDigits(x: number, decimals: number): { int: string; frac: string } {
  const a = Math.abs(x);
  if (a === 0) return { int: '0', frac: '0'.repeat(decimals) };
  // toExponential(14): exactly 15 significant digits, correctly rounded from the binary value.
  const m = /^(\d)\.(\d{14})e([+-]\d+)$/.exec(a.toExponential(14));
  if (!m) throw new Error(`unexpected exponential form for ${x}`);
  const digits = (m[1] ?? '') + (m[2] ?? '');
  const exp = Number(m[3]);
  // value = 0.d1d2...d15 × 10^(exp+1); the decimal point sits after (exp + 1) digits.
  const pointPos = exp + 1;
  let intPart: string;
  let fracPart: string;
  if (pointPos <= 0) {
    intPart = '0';
    fracPart = '0'.repeat(-pointPos) + digits;
  } else if (pointPos >= digits.length) {
    intPart = digits + '0'.repeat(pointPos - digits.length);
    fracPart = '';
  } else {
    intPart = digits.slice(0, pointPos);
    fracPart = digits.slice(pointPos);
  }
  const kept = (intPart + fracPart.padEnd(decimals, '0').slice(0, decimals)).split('').map(Number);
  const next = fracPart.length > decimals ? Number(fracPart[decimals]) : 0;
  if (next >= 5) {
    let i = kept.length - 1;
    while (i >= 0) {
      const d = (kept[i] ?? 0) + 1;
      if (d < 10) {
        kept[i] = d;
        break;
      }
      kept[i] = 0;
      i--;
    }
    if (i < 0) kept.unshift(1);
  }
  const all = kept.join('');
  const intLen = all.length - decimals;
  const int = all.slice(0, intLen).replace(/^0+(?=\d)/, '') || '0';
  return { int, frac: all.slice(intLen) };
}

/** Format `x` with one of the reference's custom numeric formats (invariant culture). */
export function formatNumber(x: number, format: NumberFormat): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  const spec = SPECS[format];
  const { int, frac: rawFrac } = decimalDigits(x, spec.maxDecimals);
  let frac = rawFrac;
  while (frac.length > spec.minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1);
  const intText = spec.grouping ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  const sign = x < 0 ? '-' : '';
  return sign + intText + (frac.length > 0 ? '.' + frac : '');
}

/** Format `"0"`: integer, half away from zero, no grouping (2.5 → `3`). */
export const format0 = (x: number): string => formatNumber(x, '0');
/** Format `"0.#"`: at most one decimal (12.25 → `12.3`, 20 → `20`). */
export const format0_1 = (x: number): string => formatNumber(x, '0.#');
/** Format `"0.##"`: at most two decimals (1.005 → `1.01`). */
export const format0_2 = (x: number): string => formatNumber(x, '0.##');
/** Format `"0.0"`: exactly one decimal (3 → `3.0`). */
export const formatFixed1 = (x: number): string => formatNumber(x, '0.0');
/** Format `"0.00"`: exactly two decimals (0.125 → `0.13`). */
export const formatFixed2 = (x: number): string => formatNumber(x, '0.00');
/** Format `"#,0"`: integer with thousands separators (12500 → `12,500`). */
export const formatGrouped = (x: number): string => formatNumber(x, '#,0');
