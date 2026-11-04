// spec/solver-layouts.md "Test cases" plus unit checks of the generators (Factor, Thin, rows, path, mounting, grid snap).
import { describe, expect, it } from 'vitest';
import { angleDeg, ceilingAt, contains, distance, distanceToSegment, dot, footprint, inflate, inRoom, rect, sub } from '../src/geometry';
import { createFixture, createIntent, createRoom, type LightingIntent } from '../src/model';
import { byFamily, packages } from '../src/products';
import {
  alignToGrid,
  estimateOf,
  factorGrid,
  makeCtx,
  mounting,
  pathPoints,
  rowPoints,
  solve,
  thin,
  type Ctx,
} from '../src/solver';
import { designOf, first, make, seeded, solved } from './solver-helpers';

const frac = (x: number): number => x - Math.floor(x);

describe('solver-layouts.md test cases', () => {
  it('Solve_AmbientFixturesSitOnTheCeilingGridTileCentres', () => {
    const d = solved('Office');
    const g = d.room.ceilingGrid!;
    const amb = first(d, 'Ambient');
    expect(amb.fixtures.length).toBeGreaterThanOrEqual(6);
    for (const f of amb.fixtures) {
      expect(Math.abs(frac((f.center.x - g.origin.x) / g.u.x) - 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(frac((f.center.y - g.origin.y) / g.v.y) - 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(f.height - 9)).toBeLessThan(1e-9);
      expect(f.mount).toBe('ceiling');
    }
    const off = solved('Office', (x) => {
      first(x, 'Ambient').behavior.alignToCeilingGrid = false;
    });
    const loose = first(off, 'Ambient').fixtures;
    expect(
      loose.some((f) => Math.abs(frac(f.center.x / 2) - 0.5) > 1e-6 || Math.abs(frac(f.center.y / 2) - 0.5) > 1e-6),
    ).toBe(true);
  });

  it('Solve_FixturesMountAtTheirCeilingZoneHeight', () => {
    const d = solved('Cafeteria');
    const fs = first(d, 'Ambient').fixtures;
    for (const f of fs) expect(Math.abs(f.height - ceilingAt(d.room, f.center))).toBeLessThan(1e-9);
    expect(fs.some((f) => f.height === 12)).toBe(true);
    expect(fs.some((f) => f.height === 10)).toBe(true);
  });

  it('Solve_WashRunsParallelToTheWallAtAThirdOfTheHeight', () => {
    const d = solved('Office');
    const wash = first(d, 'WallWash');
    const wall = d.room.walls[wash.wallIndex!]!;
    const dir = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y };
    const len = Math.hypot(dir.x, dir.y);
    const u = { x: dir.x / len, y: dir.y / len };
    expect(wash.fixtures.length).toBeGreaterThanOrEqual(3);
    const toWall = angleDeg({ x: wall.inward.x * -1, y: wall.inward.y * -1 });
    for (const f of wash.fixtures) {
      expect(Math.abs(Math.abs(dot(sub(f.center, wall.start), wall.inward)) - 3)).toBeLessThan(0.01);
      expect(f.tilt).toBe(0);
      expect(Math.abs(f.orientation - toWall)).toBeLessThan(1e-6);
    }
    const along = wash.fixtures.map((f) => dot(sub(f.center, wall.start), u)).sort((a, b) => a - b);
    const spacing = along[1]! - along[0]!;
    expect(spacing).toBeGreaterThanOrEqual(2);
    expect(spacing).toBeLessThanOrEqual(4);
    const r0 = dot(sub(wash.region[0]!, wall.start), u);
    const r1 = dot(sub(wash.region[1]!, wall.start), u);
    expect(Math.abs(along[0]! - Math.min(r0, r1) - spacing / 2)).toBeLessThan(0.05);
  });

  it('Solve_WashOffsetBehaviourWins', () => {
    const d = seeded('Office');
    const w2 = d.room.walls[2]!;
    const wash = make(d.room, 'WallWash', [{ ...w2.start }, { ...w2.end }], 2);
    wash.behavior.wallOffset = 2;
    d.intents = [wash];
    solve(d, wash);
    expect(wash.fixtures.length).toBeGreaterThan(0);
    for (const f of wash.fixtures) expect(Math.abs(dot(sub(f.center, w2.start), w2.inward) - 2)).toBeLessThan(0.01);
  });

  it('Solve_AccentIsAimedAtTheFaceCentre', () => {
    const d = solved('Office');
    const acc = first(d, 'Accent');
    const w2 = d.room.walls[2]!;
    expect(acc.fixtures.length).toBeGreaterThanOrEqual(1);
    expect(acc.fixtures.length).toBeLessThanOrEqual(2);
    for (const f of acc.fixtures) {
      expect(Math.abs(dot(sub(f.center, w2.start), w2.inward) - 2.31)).toBeLessThan(0.15);
      expect(f.tilt).toBeGreaterThan(20);
      expect(f.tilt).toBeLessThan(50);
    }
    expect(estimateOf(d, acc).average).toBeGreaterThan(0);
    expect(acc.targetReason.startsWith('3×')).toBe(true);
    const amb = estimateOf(d, first(d, 'Ambient')).average;
    expect(Math.abs(acc.target.average! - 3 * amb)).toBeLessThanOrEqual(0.3 * amb);
  });

  it('Solve_FeaturePendantHangsThirtyInchesAboveTheSurfaceCappedBelowTheCeiling', () => {
    const d = solved('Lobby');
    const fp = first(d, 'FeaturePendant');
    const reception = d.room.objects.find((o) => o.kind.trim().toLowerCase() === 'reception')!;
    const zone = inflate(footprint(reception), 0.5);
    expect(fp.fixtures.length).toBeGreaterThanOrEqual(2);
    for (const f of fp.fixtures) {
      expect(f.mount).toBe('pendant');
      expect(Math.abs(f.height - 5.5)).toBeLessThan(1e-9);
      expect(f.height).toBeLessThanOrEqual(ceilingAt(d.room, f.center) - 1);
      expect(contains(zone, f.center)).toBe(true);
    }
  });

  it('Solve_FeaturePendantHeightCapsAtTheCeilingMinusOneFoot', () => {
    const room = createRoom({
      label: 'Low',
      floor: [rect({ x: 0, y: 0 }, { x: 12, y: 12 })],
      ceilingHeight: 6.5,
      objects: [
        { name: 'High bar', kind: 'bar', center: { x: 6, y: 6 }, length: 6, width: 2, orientation: 0, top: 3.5, bottom: 0 },
      ],
    });
    const fp = make(room, 'FeaturePendant', footprint(room.objects[0]!), null, 0);
    const d = designOf(room, [fp]);
    solve(d, fp);
    expect(fp.fixtures.length).toBeGreaterThanOrEqual(1);
    for (const f of fp.fixtures) expect(Math.abs(f.height - 5.5)).toBeLessThan(1e-9);
  });

  it('Solve_CeilingGlowFollowsTheCloudLoop', () => {
    const d = solved('Cafeteria', (x) => {
      const glow = first(x, 'CeilingGlow');
      glow.target = { minimum: 80, average: 100, maximum: 140 };
      glow.product = { product: packages('cove')[1]!, agentPicked: false, reason: 'Chosen by you', alternatives: [] };
    });
    const glow = first(d, 'CeilingGlow');
    expect(glow.product!.product.lumens).toBe(1600);
    const loop = inflate(glow.region, -0.5);
    expect(glow.fixtures.length).toBeGreaterThanOrEqual(16);
    for (const f of glow.fixtures) {
      expect(f.mount).toBe('cove');
      expect(Math.abs(f.height - 10.3)).toBeLessThan(1e-6);
      const dmin = Math.min(...loop.map((a, k) => distanceToSegment(f.center, a, loop[(k + 1) % loop.length]!)));
      expect(dmin).toBeLessThan(0.05);
      expect(inRoom(d.room, f.center)).toBe(true);
    }
    expect(glow.fixtures).toHaveLength(16);
  });

  it('Solve_CeilingGlowThinsItsModulesToTheTargetAndNeverBelowOnePerEdge', () => {
    const glow = first(solved('Cafeteria'), 'CeilingGlow');
    expect(glow.fixtures.length).toBeGreaterThanOrEqual(4);
    expect(glow.fixtures.length).toBeLessThan(16);
    for (const f of glow.fixtures) expect(f.output).toBe(1);
  });

  it('Solve_PathRunsAlongTheLongAxis', () => {
    const path = first(solved('Lobby'), 'Path');
    expect(path.fixtures.length).toBeGreaterThanOrEqual(2);
    const xs = path.fixtures.map((f) => f.center.x);
    const ys = path.fixtures.map((f) => f.center.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
    expect(path.plane.height).toBe(0);
  });

  it('Golden: Office solved', () => {
    const d = solved('Office');
    const xy = (i: number) => d.intents[i]!.fixtures.map((f) => [f.center.x, f.center.y]);
    const amb = d.intents[0]!;
    expect(xy(0)).toEqual([[3, 5], [11, 5], [17, 5], [25, 5], [3, 13], [11, 13], [17, 13], [3, 21], [11, 21], [17, 21]]);
    for (const f of amb.fixtures) expect(f.height).toBe(9);
    expect(xy(1)).toEqual([[9, 12.75]]);
    expect(xy(2)).toEqual([[9, 5.75]]);
    expect(xy(4)).toEqual([[22, 5.75]]);
    for (const i of [1, 2, 3, 4]) for (const f of d.intents[i]!.fixtures) expect(f.height).toBe(7.5);
    expect(xy(3)).toEqual([[25.25, 15.25], [25.25, 18.75]]);
    const wash = d.intents[5]!;
    expect(xy(5).map(([x, y]) => [x, y])).toEqual([[16, 21], [12, 21], [8, 21], [4, 21]]);
    for (const f of wash.fixtures) expect(f.orientation).toBe(90);
    const acc = d.intents[6]!.fixtures;
    expect(acc).toHaveLength(1);
    expect(acc[0]!.center.x).toBeCloseTo(10, 9);
    expect(acc[0]!.center.y).toBeCloseTo(21.690598923241495, 9);
    expect(acc[0]!.orientation).toBe(90);
    expect(acc[0]!.tilt).toBeCloseTo(30, 9);
  });

  it('Golden: Data hall ambient', () => {
    const amb = first(solved('DataHall'), 'Ambient');
    expect(amb.fixtures).toHaveLength(9);
    const pts = amb.fixtures.map((f) => [f.center.x, f.center.y]);
    for (const x of [20 / 3, 20, 100 / 3])
      for (const y of [5, 15, 25]) expect(pts.some(([a, b]) => Math.abs(a! - x) < 1e-3 && Math.abs(b! - y) < 1e-9)).toBe(true);
    for (const f of amb.fixtures) {
      expect(f.mount).toBe('pendant');
      expect(f.height).toBe(10);
    }
    expect(amb.trace[0]).toContain('rows pattern');
  });

  it('Golden: Cafeteria glow', () => {
    const glow = first(solved('Cafeteria'), 'CeilingGlow');
    expect(glow.fixtures.map((f) => [f.center.x, f.center.y, f.orientation, f.height])).toEqual([
      [24, 6.5, 0, 10.3],
      [35.5, 14, 90, 10.3],
      [24, 21.5, 180, 10.3],
      [12.5, 14, -90, 10.3],
    ]);
    expect(glow.trace[0]).toBe(
      'Cove glow: cove loop 0.5 ft inside the 12′-0″ ceiling edge, 4 modules of 4 ft (16 ft) → 4 × Cove linear, per 4 ft · 800 lm.',
    );
  });
});

describe('generator units', () => {
  const office = seeded('Office');
  const ctxFor = (kind: LightingIntent['kind'], productFamily: string): Ctx => {
    const i = createIntent({ kind, product: { product: byFamily(productFamily)!, agentPicked: false, reason: '', alternatives: [] } });
    return makeCtx(designOf(office.room, [i]), i);
  };

  it('Factor picks the first minimum cost', () => {
    expect(factorGrid(1, 10, 10, 13)).toEqual([1, 1]);
    expect(factorGrid(6, 30, 20, 13)).toEqual([3, 2]);
    expect(factorGrid(4, 10, 10, 13)).toEqual([2, 2]);
  });

  it('Thin removes the most crowded point, later index on ties', () => {
    const pts = [0, 1, 2, 10].map((x) => ({ p: { x, y: 0 }, orientation: 0 }));
    expect(thin(pts, 3).map((q) => q.p.x)).toEqual([0, 1, 10]);
    expect(thin(pts, 4)).toHaveLength(4);
  });

  it('RowPoints: one row of one in the desk cluster C region', () => {
    const region = rect({ x: 17, y: 2.75 }, { x: 27, y: 8.75 });
    expect(rowPoints(region, 1, 6.5, 4)).toEqual([{ p: { x: 22, y: 5.75 }, orientation: 0 }]);
  });

  it('PathPoints: Lobby entry path', () => {
    const region = rect({ x: 2, y: 21 }, { x: 38, y: 25 });
    const ctx = ctxFor('Path', 'downlight-ho');
    expect(pathPoints(region, 1, 13, ctx).map((q) => [q.p.x, q.p.y])).toEqual([
      [8, 23],
      [20, 23],
      [32, 23],
    ]);
  });

  it('Mounting examples (§10)', () => {
    const p = { x: 5, y: 5 };
    expect(mounting(ctxFor('Task', 'pendant-linear'), p, null)).toEqual({ mount: 'pendant', height: 7.5 });
    expect(mounting(ctxFor('Ambient', 'volumetric'), p, null)).toEqual({ mount: 'ceiling', height: 9 });
    expect(mounting(ctxFor('CeilingGlow', 'cove'), p, null)).toEqual({ mount: 'cove', height: 8.5 });
    const fp = ctxFor('FeaturePendant', 'pendant-can');
    expect(mounting(fp, p, 2.5)).toEqual({ mount: 'pendant', height: 5 });
    const high = createRoom({ floor: [rect({ x: 0, y: 0 }, { x: 10, y: 10 })], ceilingHeight: 14 });
    const strip = createIntent({ kind: 'Ambient', product: { product: byFamily('strip')!, agentPicked: false, reason: '', alternatives: [] } });
    expect(mounting(makeCtx(designOf(high, [strip]), strip), p, null).height).toBe(10);
    const recep = createIntent({ kind: 'FeaturePendant' });
    expect(mounting(makeCtx(designOf(high, [recep]), recep), p, 3).height).toBe(5.5);
  });

  it('AlignToGrid uses banker’s rounding (x 18 → 17, y 4 → 5)', () => {
    const ctx = ctxFor('Ambient', 'volumetric');
    const f = createFixture({ center: { x: 18, y: 4 }, mount: 'ceiling', height: 9 });
    const [g] = alignToGrid(ctx, [f]);
    expect(g!.center).toEqual({ x: 17, y: 5 });
    const g2 = alignToGrid(ctx, [f, createFixture({ center: { x: 17.1, y: 4.1 }, mount: 'ceiling', height: 9 })]);
    expect(g2).toHaveLength(1);
    expect(distance(g2[0]!.center, { x: 17, y: 5 })).toBe(0);
  });
});
