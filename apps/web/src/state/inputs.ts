// Inspector input conversion: model values (feet, footcandles) ⇄ the text a designer types in display units. Display
// only — parsed values go straight back to feet / footcandles before they reach the store.
import {
  DOUBLE_PRIME,
  PRIME,
  feetInches,
  feetToMeters,
  footcandlesToLux,
  format0_1,
  formatFixed2,
  formatNumber,
  luxToFootcandles,
  metersToFeet,
} from '@intent-studio/core';
import type { Units } from './store';

/** Parse result: a number, null for an empty field (no value / automatic), undefined when the text is not valid. */
export type Parsed = number | null | undefined;

const NUMBER = /^[+]?(\d+(\.\d*)?|\.\d+)$/;

function plainNumber(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (!NUMBER.test(t)) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/** Illuminance field text (fc with up to one decimal, lux whole); '' for no bound. */
export function illuminanceInput(fc: number | null, u: Units): string {
  if (fc === null) return '';
  return u === 'imperial' ? format0_1(fc) : formatNumber(footcandlesToLux(fc), '0');
}

/** Typed illuminance in display units → footcandles. */
export function parseIlluminance(text: string, u: Units): Parsed {
  const t = text.trim().replace(/\s*(fc|lx|lux)$/i, '');
  if (t === '') return null;
  const v = plainNumber(t);
  if (v === undefined) return undefined;
  return u === 'imperial' ? v : luxToFootcandles(v);
}

/** Length field text: feet-inches (`2′-6″`) or metres with two decimals; '' when unset. */
export function lengthInput(ft: number | null, u: Units): string {
  if (ft === null) return '';
  return u === 'imperial' ? feetInches(ft) : formatFixed2(feetToMeters(ft));
}

const FEET_INCHES = new RegExp(
  `^(?:(\\d+(?:\\.\\d*)?)\\s*(?:'|${PRIME}|ft)\\s*-?\\s*)?(?:(\\d+(?:\\.\\d*)?)\\s*(?:"|${DOUBLE_PRIME}|in))?$`,
  'i',
);

/**
 * Typed length → feet. Imperial takes `2′-6″`, `2'-6"`, `2' 6"`, `2'`, `6"`, `30 in`, `2.5` or `2.5 ft` (a bare number is
 * feet); metric takes `0.76` or `0.76 m`.
 */
export function parseLength(text: string, u: Units): Parsed {
  const t = text.trim();
  if (t === '') return null;
  if (u === 'metric') {
    const v = plainNumber(t.replace(/\s*m$/i, ''));
    return v === undefined ? undefined : metersToFeet(v);
  }
  const bare = plainNumber(t.replace(/\s*(ft|'|′)$/i, ''));
  if (bare !== undefined) return bare;
  const m = FEET_INCHES.exec(t);
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
  const feet = m[1] === undefined ? 0 : Number(m[1]);
  const inches = m[2] === undefined ? 0 : Number(m[2]);
  if (!Number.isFinite(feet) || !Number.isFinite(inches)) return undefined;
  return feet + inches / 12;
}

/** Whole-number field (quantity, degrees, kelvin); '' when unset. */
export const integerInput = (v: number | null): string => (v === null ? '' : formatNumber(v, '0'));

/** Typed integer (sign allowed when `signed`). */
export function parseInteger(text: string, signed = false): Parsed {
  const t = text.trim();
  if (t === '') return null;
  if (!(signed ? /^[-+]?\d+$/ : /^\+?\d+$/).test(t)) return undefined;
  return Number(t);
}
