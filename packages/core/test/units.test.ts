import { describe, expect, it } from 'vitest';
import {
  FEET_PER_METER,
  LUX_PER_FOOTCANDLE,
  feetInches,
  feetToMeters,
  footcandlesToLux,
  luxToFootcandles,
  metersToFeet,
} from '../src/index';

describe('units: conversions', () => {
  it('constants', () => {
    expect(FEET_PER_METER).toBe(3.28084);
    expect(LUX_PER_FOOTCANDLE).toBe(10.7639);
  });
  it('m → ft', () => expect(metersToFeet(1)).toBe(3.28084));
  it('ft → m round trip', () => expect(metersToFeet(feetToMeters(9))).toBeCloseTo(9, 12));
  it('fc → lux', () => expect(footcandlesToLux(10)).toBeCloseTo(107.639, 10));
  it('lux → fc round trip', () => expect(luxToFootcandles(footcandlesToLux(30))).toBeCloseTo(30, 12));
});

describe('units: feetInches (geometry.md §10)', () => {
  it.each([
    [2.5, '2′-6″'],
    [0, '0′-0″'],
    [14, '14′-0″'],
    [3.5, '3′-6″'],
    [3, '3′-0″'],
    [9, '9′-0″'],
    [10.5, '10′-6″'],
    [-1.25, '-1′-3″'],
    [12.04, '12′-0″'],
    [0.375, '0′-4″'],
    [0.625, '0′-8″'],
    [-0.02, '0′-0″'],
    [-0.0625, '-0′-1″'],
  ])('feetInches(%d) = %s', (ft, s) => expect(feetInches(ft)).toBe(s));
  it('uses U+2032 / U+2033 and ASCII hyphen', () => expect(feetInches(2.5)).toBe('2′-6″'));
});
