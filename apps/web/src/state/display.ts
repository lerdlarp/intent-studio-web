// Display-only unit conversion and formatting. The model stays in feet and footcandles; nothing here feeds back.
import {
  feetInches,
  feetToMeters,
  footcandlesToLux,
  format0_1,
  formatFixed1,
  formatFixed2,
  formatGrouped,
  targetStatus,
  uniformity,
  type IntentEstimate,
  type TargetRange,
  type TargetStatus,
} from '@intent-studio/core';
import type { Units } from './store';

const SQFT_PER_SQM = 10.7639;

export const illuminanceUnit = (u: Units): string => (u === 'imperial' ? 'fc' : 'lx');

/** Illuminance value in display units, no unit suffix (fc with one decimal, lux whole). */
export const illuminanceValue = (fc: number, u: Units): string =>
  u === 'imperial' ? formatFixed1(fc) : formatGrouped(footcandlesToLux(fc));

export const illuminance = (fc: number, u: Units): string => `${illuminanceValue(fc, u)} ${illuminanceUnit(u)}`;

export const length = (ft: number, u: Units): string =>
  u === 'imperial' ? feetInches(ft) : `${formatFixed2(feetToMeters(ft))} m`;

export const area = (ft2: number, u: Units): string =>
  u === 'imperial' ? `${formatGrouped(ft2)} ft²` : `${formatFixed1(ft2 / SQFT_PER_SQM)} m²`;

/** Lighting power density; the model's LPD is W/ft². */
export const lpd = (wPerFt2: number, u: Units): string =>
  u === 'imperial' ? `${formatFixed2(wPerFt2)} W/ft²` : `${formatFixed1(wPerFt2 * SQFT_PER_SQM)} W/m²`;

export const watts = (w: number): string => `${formatGrouped(w)} W`;

/** The inspector estimate line: `avg · min · max fc · U 0.62`. */
export function estimateLine(e: IntentEstimate, u: Units): string {
  const v = (x: number) => illuminanceValue(x, u);
  return `${v(e.average)} · ${v(e.minimum)} · ${v(e.maximum)} ${illuminanceUnit(u)} · U ${formatFixed2(uniformity(e))}`;
}

/** Target as text, e.g. `avg 30 · min 20 fc`; "no target" when every bound is empty. */
export function targetText(t: TargetRange, u: Units): string {
  const v = (fc: number) => (u === 'imperial' ? format0_1(fc) : illuminanceValue(fc, u));
  const parts: string[] = [];
  if (t.minimum !== null) parts.push(`min ${v(t.minimum)}`);
  if (t.average !== null) parts.push(`avg ${v(t.average)}`);
  if (t.maximum !== null) parts.push(`max ${v(t.maximum)}`);
  return parts.length ? `${parts.join(' · ')} ${illuminanceUnit(u)}` : 'no target';
}

export const STATUS_GLYPH: Readonly<Record<TargetStatus, string>> = { Meets: '✓', Under: '↓', Over: '↑' };
export const STATUS_TEXT: Readonly<Record<TargetStatus, string>> = {
  Meets: 'meets target',
  Under: 'under target',
  Over: 'over target',
};

export const statusOf = (t: TargetRange, e: IntentEstimate): TargetStatus => targetStatus(t, e.average);
