// Heat scale (spec/heatmap.md §1): footcandles → colour. Blue at min, red at max. Rounding is half-even.
import { roundHalfEven } from './format';
import type { TargetRange } from './model';

export interface HeatScale {
  min: number;
  max: number;
  label: string;
}
export type Rgb = readonly [number, number, number];

/** Anything carrying calculated point values (a zone result). */
export interface ValueZone {
  points: readonly { value: number }[];
}

export const heatScale = (min: number, max: number, label = ''): HeatScale => ({ min, max, label });

/** Position of `fc` in the scale, clamped to 0..1. Degenerate span or NaN → 0. */
export function heatFraction(scale: HeatScale, fc: number): number {
  const span = scale.max - scale.min;
  if (!(span > 1e-9) || Number.isNaN(fc)) return 0;
  return Math.min(1, Math.max(0, (fc - scale.min) / span));
}

/** HSL (full saturation, half lightness) hue in degrees → 8-bit RGB. */
export function fromHue(hue: number): Rgb {
  const h = Math.min(360, Math.max(0, hue)) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  let r: number, g: number, b: number;
  switch (Math.floor(h)) {
    case 0:
      [r, g, b] = [1, x, 0];
      break;
    case 1:
      [r, g, b] = [x, 1, 0];
      break;
    case 2:
      [r, g, b] = [0, 1, x];
      break;
    case 3:
      [r, g, b] = [0, x, 1];
      break;
    case 4:
      [r, g, b] = [x, 0, 1];
      break;
    default:
      [r, g, b] = [1, 0, x];
  }
  return [roundHalfEven(r * 255), roundHalfEven(g * 255), roundHalfEven(b * 255)];
}

/** Colour of a value on the scale. */
export const heatColorAt = (scale: HeatScale, fc: number): Rgb => fromHue(240 * (1 - heatFraction(scale, fc)));

/** Scale spanning every finite point value of every zone. */
export function autoScale(zones: readonly ValueZone[]): HeatScale {
  let min = Infinity;
  let max = -Infinity;
  for (const z of zones)
    for (const p of z.points) {
      if (!Number.isFinite(p.value)) continue;
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  if (min > max) return { min: 0, max: 100, label: 'Auto range' };
  if (max - min < 1e-6) max = min + 1;
  return { min, max, label: 'Auto range' };
}

/** Blue at half the minimum, red at the maximum. */
export function targetScale(target: TargetRange): HeatScale {
  const min = (target.minimum ?? 0) * 0.5;
  let max = target.maximum ?? (target.average ?? 0) * 2;
  if (max <= min) max = min + 10;
  return { min, max, label: 'Target range' };
}

/** Legend ramp: 13 stops at positions i/12. */
export function heatRamp(): { position: number; color: Rgb }[] {
  return Array.from({ length: 13 }, (_, i) => ({ position: i / 12, color: fromHue(240 * (1 - i / 12)) }));
}

/** Direct (un-quantised) colour of a value. */
export const colorOf = heatColorAt;
