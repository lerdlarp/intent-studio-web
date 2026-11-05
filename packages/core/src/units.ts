// Unit conversions (core is feet / footcandles; convert only at display and import/export) and the feet-inches
// designer notation (spec/geometry.md §10).
import { roundHalfEven } from './format';

/** Feet per metre (1 m = 3.28084 ft). */
export const FEET_PER_METER = 3.28084;
/** Lux per footcandle (lux = fc × 10.7639). */
export const LUX_PER_FOOTCANDLE = 10.7639;

export const metersToFeet = (m: number): number => m * FEET_PER_METER;
export const feetToMeters = (ft: number): number => ft / FEET_PER_METER;
export const footcandlesToLux = (fc: number): number => fc * LUX_PER_FOOTCANDLE;
export const luxToFootcandles = (lux: number): number => lux / LUX_PER_FOOTCANDLE;

/** U+2032 PRIME (feet). */
export const PRIME = '′';
/** U+2033 DOUBLE PRIME (inches). */
export const DOUBLE_PRIME = '″';

/**
 * Feet-and-inches designer notation, e.g. `2′-6″`. Inches are banker's-rounded; the sign is decided after rounding
 * (−0.02 ft → `0′-0″`).
 */
export function feetInches(feet: number): string {
  const totalInches = roundHalfEven(feet * 12);
  const sign = totalInches < 0 ? '-' : '';
  const n = Math.abs(totalInches);
  return `${sign}${Math.floor(n / 12)}${PRIME}-${n % 12}${DOUBLE_PRIME}`;
}
