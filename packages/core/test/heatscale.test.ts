import { describe, expect, it } from 'vitest';
import { autoScale, colorOf, fromHue, heatColorAt, heatFraction, heatRamp, targetScale } from '../src/heatscale';
import { targetRange } from '../src/model';

const s01 = { min: 0, max: 1, label: '' };
const zone = (...values: number[]) => ({ points: values.map((value) => ({ value })) });

describe('heatscale: colorAt', () => {
  it.each([
    ['min is blue', 0, [0, 0, 255]],
    ['1/8', 0.125, [0, 128, 255]],
    ['quarter', 0.25, [0, 255, 255]],
    ['third', 1 / 3, [0, 255, 170]],
    ['half', 0.5, [0, 255, 0]],
    ['three quarters', 0.75, [255, 255, 0]],
    ['max is red', 1, [255, 0, 0]],
    ['clamps low', -1, [0, 0, 255]],
    ['clamps high', 2, [255, 0, 0]],
    ['NaN', NaN, [0, 0, 255]],
  ])('%s', (_n, fc, rgb) => {
    expect([...heatColorAt(s01, fc)]).toEqual(rgb);
  });
  it('zero span fraction is 0', () => expect(heatFraction({ min: 5, max: 5, label: '' }, 7)).toBe(0));
  it('colorOf is direct', () => expect([...colorOf({ min: 0, max: 30, label: '' }, 10)]).toEqual([0, 255, 170]));
  it('fromHue clamps', () => {
    expect([...fromHue(-10)]).toEqual([255, 0, 0]);
    expect([...fromHue(400)]).toEqual([255, 0, 0]);
  });
});

describe('heatscale: ramp', () => {
  it('13 exact stops', () => {
    const want = [
      [0, 0, 255],
      [0, 85, 255],
      [0, 170, 255],
      [0, 255, 255],
      [0, 255, 170],
      [0, 255, 85],
      [0, 255, 0],
      [85, 255, 0],
      [170, 255, 0],
      [255, 255, 0],
      [255, 170, 0],
      [255, 85, 0],
      [255, 0, 0],
    ];
    const r = heatRamp();
    expect(r.map((s) => [...s.color])).toEqual(want);
    expect(r[6]?.position).toBeCloseTo(0.5, 12);
  });
  it('property: red falls... blue falls monotonically along the ramp', () => {
    const blue = heatRamp().map((s) => s.color[2]);
    for (let i = 1; i < blue.length; i++) expect(blue[i]).toBeLessThanOrEqual(blue[i - 1] as number);
    const red = heatRamp().map((s) => s.color[0]);
    for (let i = 1; i < red.length; i++) expect(red[i]).toBeGreaterThanOrEqual(red[i - 1] as number);
  });
  it('property: hue → colour is continuous (adjacent hues differ by ≤ 5 per channel)', () => {
    let prev = fromHue(0);
    for (let h = 0.5; h <= 360; h += 0.5) {
      const c = fromHue(h);
      for (let k = 0; k < 3; k++) expect(Math.abs((c[k] as number) - (prev[k] as number))).toBeLessThanOrEqual(5);
      prev = c;
    }
  });
});

describe('heatscale: auto / target', () => {
  it('auto', () =>
    expect(autoScale([zone(3, NaN), zone(9, Infinity)])).toEqual({ min: 3, max: 9, label: 'Auto range' }));
  it('auto flat', () => expect(autoScale([zone(4, 4)])).toMatchObject({ min: 4, max: 5 }));
  it('auto empty', () => expect(autoScale([zone(NaN)])).toEqual({ min: 0, max: 100, label: 'Auto range' }));
  it('auto no zones', () => expect(autoScale([])).toMatchObject({ min: 0, max: 100 }));
  it('forTarget full', () =>
    expect(targetScale(targetRange(10, 20, 35))).toEqual({ min: 5, max: 35, label: 'Target range' }));
  it('forTarget avg only', () => expect(targetScale(targetRange(null, 30, null))).toMatchObject({ min: 0, max: 60 }));
  it('forTarget max only', () => expect(targetScale(targetRange(null, null, 5))).toMatchObject({ min: 0, max: 5 }));
  it('forTarget degenerate', () =>
    expect(targetScale(targetRange(null, null, null))).toMatchObject({ min: 0, max: 10 }));
});
