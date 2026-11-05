import { describe, expect, it } from 'vitest';
import { rasterize, type HeatZone } from '../src/heatmap';
import { heatColorAt, heatRamp } from '../src/heatscale';

const sc = (min: number, max: number) => ({ min, max, label: '' });
const px = (r: { pixels: Uint8ClampedArray; width: number }, col: number, row: number) => [
  ...r.pixels.slice((row * r.width + col) * 4, (row * r.width + col) * 4 + 4),
];
const clear = [0, 0, 0, 0];

const S: HeatZone = {
  outline: [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 2, z: 0 },
    { x: 0, y: 2, z: 0 },
  ],
  normal: { x: 0, y: 0, z: 1 },
  columnSpacing: 1,
  rowSpacing: 1,
  points: [
    { x: 0.5, y: 0.5, z: 0, value: 0 },
    { x: 1.5, y: 0.5, z: 0, value: 10 },
    { x: 0.5, y: 1.5, z: 0, value: 20 },
    { x: 1.5, y: 1.5, z: 0, value: 30 },
  ],
};

describe('rasterize', () => {
  it('S at 1 px/ft', () => {
    const r = rasterize(S, sc(0, 30), 1);
    expect([r.width, r.height]).toEqual([2, 2]);
    expect(r.origin).toEqual({ x: 0, y: 0, z: 0 });
    expect(r.uEnd).toEqual({ x: 2, y: 0, z: 0 });
    expect(r.vEnd).toEqual({ x: 0, y: 2, z: 0 });
    expect(px(r, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(r, 1, 0)).toEqual([0, 255, 171, 255]);
    expect(px(r, 0, 1)).toEqual([171, 255, 0, 255]);
    expect(px(r, 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it('S at 2 px/ft (bilinear)', () => {
    const r = rasterize(S, sc(0, 30), 2);
    expect([r.width, r.height]).toEqual([4, 4]);
    const rows = [
      [
        [0, 0, 255],
        [0, 86, 255],
        [0, 255, 255],
        [0, 255, 171],
      ],
      [
        [0, 170, 255],
        [0, 255, 255],
        [0, 255, 85],
        [1, 255, 0],
      ],
      [
        [1, 255, 0],
        [85, 255, 0],
        [255, 255, 0],
        [255, 170, 0],
      ],
      [
        [171, 255, 0],
        [255, 255, 0],
        [255, 86, 0],
        [255, 0, 0],
      ],
    ];
    rows.forEach((row, y) => row.forEach((c, x) => expect(px(r, x, y)).toEqual([...c, 255])));
  });

  it('triangle mask', () => {
    const pts = [];
    for (let x = 0; x <= 3; x++)
      for (let y = 0; y <= 3 - x; y++) pts.push({ x: x + 0.5, y: y + 0.5, z: 0, value: 10 * (x + y) });
    const z: HeatZone = {
      outline: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      normal: { x: 0, y: 0, z: 1 },
      columnSpacing: 1,
      rowSpacing: 1,
      points: pts,
    };
    const scale = sc(0, 30);
    const r = rasterize(z, scale, 1);
    expect([r.width, r.height]).toEqual([4, 4]);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) {
        if (col + row <= 3) {
          const i = Math.round((Math.min(10 * (col + row), 30) / 30) * 511);
          const want = heatColorAt(scale, scale.min + (scale.max * i) / 511);
          expect(px(r, col, row)).toEqual([...want, 255]);
        } else expect(px(r, col, row)).toEqual(clear);
      }
  });

  it('wall, nearest, first-wins tie', () => {
    const z: HeatZone = {
      outline: [
        { x: 0, y: 24, z: 0 },
        { x: 36, y: 24, z: 0 },
        { x: 36, y: 24, z: 9 },
        { x: 0, y: 24, z: 9 },
      ],
      normal: { x: 0, y: -1, z: 0 },
      columnSpacing: 3,
      rowSpacing: 3,
      points: [
        { x: 1.5, y: 24, z: 1.5, value: 5 },
        { x: 4.5, y: 24, z: 1.5, value: 15 },
      ],
    };
    const r = rasterize(z, sc(0, 20), 0.5);
    expect([r.width, r.height]).toEqual([18, 5]);
    expect(r.origin).toEqual({ x: 0, y: 24, z: 0 });
    expect(r.uEnd).toEqual({ x: 36, y: 24, z: 0 });
    expect(r.vEnd).toEqual({ x: 0, y: 24, z: 9 });
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 18; col++) {
        let want = clear;
        if (row < 2 && col < 2) want = [0, 255, 255, 255];
        else if (row < 2 && col === 2) want = [255, 255, 0, 255];
        expect(px(r, col, row)).toEqual(want);
      }
  });

  it('bounds outline', () => {
    const z: HeatZone = {
      outline: [],
      normal: { x: 0, y: 0, z: 1 },
      columnSpacing: 2,
      rowSpacing: 2,
      points: [
        { x: 1, y: 1, z: 2.5, value: 10 },
        { x: 3, y: 1, z: 2.5, value: 20 },
      ],
    };
    const r = rasterize(z, sc(0, 20), 1);
    expect(r.outline).toEqual([
      { x: 0, y: 0, z: 2.5 },
      { x: 4, y: 0, z: 2.5 },
      { x: 4, y: 2, z: 2.5 },
      { x: 0, y: 2, z: 2.5 },
    ]);
    expect([r.width, r.height]).toEqual([4, 2]);
    expect(r.origin).toEqual({ x: 0, y: 0, z: 2.5 });
    for (let row = 0; row < 2; row++)
      [
        [1, 255, 0],
        [1, 255, 0],
        [255, 0, 0],
        [255, 0, 0],
      ].forEach((c, col) => expect(px(r, col, row)).toEqual([...c, 255]));
  });

  it('empty', () => {
    const r = rasterize(
      { outline: [], normal: { x: 0, y: 0, z: 1 }, columnSpacing: 1, rowSpacing: 1, points: [] },
      sc(0, 1),
    );
    expect([r.width, r.height]).toEqual([1, 1]);
    expect([...r.pixels]).toEqual(clear);
    for (const c of [r.origin, r.uEnd, r.vEnd]) expect(c).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('size caps', () => {
    const z: HeatZone = {
      outline: [
        { x: 0, y: 0, z: 0 },
        { x: 2000, y: 0, z: 0 },
        { x: 2000, y: 10, z: 0 },
        { x: 0, y: 10, z: 0 },
      ],
      normal: { x: 0, y: 0, z: 1 },
      columnSpacing: 0,
      rowSpacing: 0,
      points: [],
    };
    const r = rasterize(z, sc(0, 1), 6);
    expect([r.width, r.height]).toEqual([1024, 6]);
  });

  it('min ppf', () => {
    const r = rasterize(S, sc(0, 30), 0.1);
    expect([r.width, r.height]).toEqual([1, 1]);
  });
});

describe('rasterize: properties', () => {
  const tri: HeatZone = {
    ...S,
    outline: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
  };
  it('length = w*h*4 across ppf values', () => {
    for (const ppf of [0.1, 0.5, 1, 3, 7.5, 12]) {
      const r = rasterize(S, sc(0, 30), ppf);
      expect(r.pixels.length).toBe(r.width * r.height * 4);
    }
  });
  it('masked-out pixels are transparent', () => {
    const r = rasterize(tri, sc(0, 30), 8);
    let masked = 0;
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) {
        const cx = (col + 0.5) / 8;
        const cy = (row + 0.5) / 8;
        if (cx + cy > 2 + 1e-9) {
          masked++;
          expect(px(r, col, row)).toEqual(clear);
        }
      }
    expect(masked).toBeGreaterThan(0);
  });
  it('monotone ramp: rising values never lower red nor raise blue', () => {
    // one row of 8 columns with values 0..7 on a 0..7 scale
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: i + 0.5, y: 0.5, z: 0, value: i }));
    const z: HeatZone = {
      outline: [
        { x: 0, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
        { x: 8, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      normal: { x: 0, y: 0, z: 1 },
      columnSpacing: 1,
      rowSpacing: 1,
      points: pts,
    };
    const r = rasterize(z, sc(0, 7), 4);
    for (let c = 1; c < r.width; c++) {
      const a = px(r, c - 1, 0);
      const b = px(r, c, 0);
      expect(b[0]).toBeGreaterThanOrEqual(a[0] as number);
      expect(b[2]).toBeLessThanOrEqual(a[2] as number);
    }
    expect(heatRamp().length).toBe(13);
  });
});
