// Full calculation (core/calc.ts): zone grids at zone spacing, same engine as the estimate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CALC_LABEL, calcPlan, calculate, resolveProducts, resolverFromMap, toSnapshot } from '../src/calc';
import { estimateAll } from '../src/estimate';
import { parseIes, productFromIes } from '../src/ies';
import { productOf } from '../src/products';
import { CalculationSnapshotSchema, type RoomDesign } from '../src/model';
import { zones } from '../src/zones';
import { GOLDEN_ROOMS } from './golden/load';
import { solved } from './solver-helpers';

declare const performance: { now(): number };

const cache = new Map<string, RoomDesign>();
const design = (name: (typeof GOLDEN_ROOMS)[number]): RoomDesign => {
  let d = cache.get(name);
  if (!d) cache.set(name, (d = solved(name)));
  return d;
};

describe('calc: full point-by-point', () => {
  it('one grid per zone (intents + surfaces), labelled as an estimate', () => {
    const d = design('Office');
    const r = calculate(d, { productOf });
    expect(r.label).toBe(CALC_LABEL);
    expect(r.label).toBe('Estimate (point-by-point, simplified inter-reflection)');
    expect(r.aborted).toBe(false);
    expect(r.zones.map((z) => z.zoneId)).toEqual(zones(d).map((z) => z.id));
    for (const g of r.zones) {
      expect(g.points.length).toBe(g.values.length);
      expect(g.points.length).toBeGreaterThan(0);
      expect(g.min).toBeLessThanOrEqual(g.avg + 1e-12);
      expect(g.avg).toBeLessThanOrEqual(g.max + 1e-12);
      expect(g.U).toBeCloseTo(g.avg > 0 ? g.min / g.avg : 0, 12);
    }
  });
  it('intent averages track the quick estimate (same engine, different sampling)', () => {
    for (const name of GOLDEN_ROOMS) {
      const d = design(name);
      const est = estimateAll(d, productOf);
      const r = calculate(d, { productOf });
      for (const g of r.zones) {
        const e = est.get(g.zoneId);
        if (!e || e.average < 1) continue;
        expect(Math.abs(g.avg / e.average - 1)).toBeLessThan(0.2);
      }
    }
  });
  it('grids follow zone spacing: floor surface of the Office at 2 ft', () => {
    const d = design('Office');
    const floor = calcPlan(d).find((p) => p.zone.id === 'surface:floor')!;
    expect(floor.columnSpacing).toBeLessThanOrEqual(2);
    expect(floor.columnSpacing).toBeGreaterThan(1.8);
    const wall = calcPlan(d).find((p) => p.zone.id === 'surface:wall:0')!;
    const w = d.room.walls[0]!;
    expect(wall.normal.x).toBeCloseTo(w.inward.x, 12);
    expect(wall.normal.y).toBeCloseTo(w.inward.y, 12);
  });
  it('point budget widens every spacing', () => {
    const d = design('Cafeteria');
    const n = calculate(d, { productOf, maxPoints: 500 }).pointCount;
    expect(n).toBeLessThanOrEqual(500);
    expect(n).toBeGreaterThan(100);
  });
  it('deterministic', () => {
    const d = design('Lobby');
    expect(calculate(d, { productOf })).toEqual(calculate(d, { productOf }));
  });
  it('progress is monotonic and ends at 1; abort stops early', () => {
    const d = design('Cafeteria');
    const seen: number[] = [];
    calculate(d, { productOf, onProgress: (f) => seen.push(f) });
    expect(seen.at(-1)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    let calls = 0;
    const r = calculate(d, { productOf, shouldAbort: () => ++calls >= 1 });
    expect(r.aborted).toBe(true);
    expect(r.zones.length).toBeLessThan(zones(d).length);
  });
  it('resolved product map reproduces the settled-package resolver (worker hand-off)', () => {
    const d = design('Office');
    const viaMap = calculate(structuredCloneLike(d), { productOf: resolverFromMap(resolveProducts(d, productOf)) });
    expect(viaMap.zones).toEqual(calculate(d, { productOf }).zones);
  });
  it('snapshot validates against the model schema', () => {
    const r = calculate(design('Office'), { productOf });
    const snap = toSnapshot(r, '2026-01-01T00:00:00.000Z');
    expect(CalculationSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(Object.keys(snap.zones)).toHaveLength(r.zones.length);
  });
  it('uses IES photometry when the product has it', () => {
    const d = structuredCloneLike(design('Office'));
    const res = parseIes(readFileSync(import.meta.url.replace(/^file:\/\//, '').replace(/[^/]*$/, '') + 'fixtures/ies/lambert-2002.ies', 'utf8'));
    if (!res.ok) throw new Error(res.error);
    const map = resolveProducts(d, productOf);
    const amb = d.intents.find((i) => i.kind === 'Ambient')!;
    const base = calculate(d, { productOf: resolverFromMap(map) }).zones.find((z) => z.zoneId === amb.id)!;
    const ies = productFromIes(res.data, 'x.ies');
    const withIes = calculate(d, {
      productOf: resolverFromMap({ ...map, [amb.id]: { ...ies, lumens: map[amb.id]!.lumens } }),
    }).zones.find((z) => z.zoneId === amb.id)!;
    expect(withIes.avg).not.toBe(base.avg);
    expect(withIes.avg).toBeGreaterThan(0);
  });
  it('largest demo room in < 2 s', () => {
    let worst = 0;
    let worstName = '';
    for (const name of GOLDEN_ROOMS) {
      const d = design(name);
      calculate(d, { productOf });
      const t0 = performance.now();
      const r = calculate(d, { productOf });
      const ms = performance.now() - t0;
      if (ms > worst) {
        worst = ms;
        worstName = `${name} (${r.pointCount} points)`;
      }
    }
    console.log(`calc: slowest demo room ${worstName} ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(2000);
    // every intent on an IES product (bilinear table lookups instead of cosⁿ)
    const res = parseIes(readFileSync(import.meta.url.replace(/^file:\/\//, '').replace(/[^/]*$/, '') + 'fixtures/ies/washer-2019.ies', 'utf8'));
    if (!res.ok) throw new Error(res.error);
    const ies = productFromIes(res.data);
    const d = design('Cafeteria');
    const map = Object.fromEntries(Object.entries(resolveProducts(d, productOf)).map(([k, p]) => [k, { ...ies, lumens: p.lumens }]));
    calculate(d, { productOf: resolverFromMap(map) });
    const t0 = performance.now();
    calculate(d, { productOf: resolverFromMap(map) });
    const ms = performance.now() - t0;
    console.log(`calc: Cafeteria with IES on every intent ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

function structuredCloneLike<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
