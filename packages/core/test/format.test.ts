import { describe, expect, it } from 'vitest';
import {
  format0,
  format0_1,
  format0_2,
  formatFixed1,
  formatFixed2,
  formatGrouped,
  formatNumber,
  roundHalfAwayFromZero,
  roundHalfEven,
} from '../src/index';

describe('format: roundHalfEven', () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [-1.5, -2],
    [-2.5, -2],
    [0.49999999999999994, 0],
    [1.4999999999999998, 1],
    [2.5000000000000004, 3],
    [144.48, 144],
    [7, 7],
    [-7.6, -8],
    [1e16, 1e16],
  ])('roundHalfEven(%d) = %d', (x, r) => expect(roundHalfEven(x)).toBe(r));
  it('−0.5 → −0', () => expect(Object.is(roundHalfEven(-0.5), -0)).toBe(true));
  it('−0.2 → −0', () => expect(Object.is(roundHalfEven(-0.2), -0)).toBe(true));
  it('non-finite passes through', () => {
    expect(roundHalfEven(NaN)).toBeNaN();
    expect(roundHalfEven(Infinity)).toBe(Infinity);
  });
  it.each([
    [1.25, 1, 1.2],
    [1.35, 1, 1.4], // 1.35·10 = 13.5 in binary → tie → 14
    [2.675, 2, 2.68], // 2.675·100 = 267.5 in binary → tie → 268
    [1.005, 2, 1], // 1.005·100 = 100.49999999999999 → 100
    [2.665, 2, 2.66], // 266.5 tie → even 266
    [1.2345678, 4, 1.2346],
    [2.5, 4, 2.5],
    [36, 1, 36],
    [-1.25, 1, -1.2],
  ])('roundHalfEven(%d, %d) = %d (binary product)', (x, d, r) => expect(roundHalfEven(x, d)).toBe(r));
});

describe('format: roundHalfAwayFromZero', () => {
  it.each([
    [0.5, 0, 1],
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [1.4, 0, 1],
  ])('(%d, %d) = %d', (x, d, r) => expect(roundHalfAwayFromZero(x, d)).toBe(r));
});

describe('format: custom numeric formats', () => {
  it.each([
    // "0"
    [1500, '0', '1500'],
    [2.5, '0', '3'],
    [-2.5, '0', '-3'],
    [3.5, '0', '4'],
    [0.4, '0', '0'],
    [1500.5, '0', '1501'],
    [12345678, '0', '12345678'],
    // "0.#"
    [20, '0.#', '20'],
    [12.25, '0.#', '12.3'],
    [12.04, '0.#', '12'],
    [0.35, '0.#', '0.4'],
    [0.05, '0.#', '0.1'],
    [0.15, '0.#', '0.2'],
    [0.25, '0.#', '0.3'],
    [12.3, '0.#', '12.3'],
    [9.96, '0.#', '10'],
    [-0.04, '0.#', '-0'],
    [-1.25, '0.#', '-1.3'],
    [8.799999999999999, '0.#', '8.8'],
    [12.345678901234567, '0.#', '12.3'],
    [0, '0.#', '0'],
    // "0.##"
    [1.005, '0.##', '1.01'],
    [2.5, '0.##', '2.5'],
    [0.57, '0.##', '0.57'],
    [0.125, '0.##', '0.13'],
    [3, '0.##', '3'],
    [2.675, '0.##', '2.68'],
    [0.999, '0.##', '1'],
    // "0.0" / "0.00"
    [3, '0.0', '3.0'],
    [0.25, '0.0', '0.3'],
    [12.04, '0.0', '12.0'],
    [0.125, '0.00', '0.13'],
    [3, '0.00', '3.00'],
    [1.005, '0.00', '1.01'],
    [-0.5, '0.00', '-0.50'],
    // "#,0"
    [12500, '#,0', '12,500'],
    [999.5, '#,0', '1,000'],
    [2500, '#,0', '2,500'],
    [650, '#,0', '650'],
    [1234567.5, '#,0', '1,234,568'],
    [-1234, '#,0', '-1,234'],
    [0.4, '#,0', '0'],
  ] as const)('formatNumber(%d, %s) = %s', (x, f, s) => expect(formatNumber(x, f)).toBe(s));

  it('15-significant-digit reduction before rounding', () => {
    // 0.35 is 0.34999999999999997779… in binary; .NET reduces to 15 digits (0.350000000000000) first.
    expect(format0_1(0.35)).toBe('0.4');
    // 1.0049999999999999 (16 digits) reduces to 1.00500000000000 → 1.01
    expect(format0_2(1.0049999999999999)).toBe('1.01');
    // 1.00499999999999 has its 15th digit below 5 → 1
    expect(format0_2(1.00499999999999)).toBe('1');
  });
  it('very large and very small values', () => {
    expect(format0(1e21)).toBe('1000000000000000000000');
    expect(format0_2(1e-7)).toBe('0');
    expect(format0_2(0.0049)).toBe('0');
    expect(format0_2(0.005)).toBe('0.01');
  });
  it('named helpers', () => {
    expect(format0(2.5)).toBe('3');
    expect(format0_1(12.25)).toBe('12.3');
    expect(format0_2(1.005)).toBe('1.01');
    expect(formatFixed1(3)).toBe('3.0');
    expect(formatFixed2(0.125)).toBe('0.13');
    expect(formatGrouped(12500)).toBe('12,500');
  });
  it('non-finite', () => {
    expect(format0(NaN)).toBe('NaN');
    expect(format0(Infinity)).toBe('Infinity');
    expect(format0(-Infinity)).toBe('-Infinity');
  });
});
