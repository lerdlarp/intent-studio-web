// spec/estimate.md test tables.
import { describe, expect, it } from 'vitest';
import {
  createFixture,
  createIntent,
  createProduct,
  createRoom,
  type LightingIntent,
  type RoomDesign,
  type StudioProduct,
} from '../src/model';
import { rect } from '../src/geometry';
import {
  at,
  buildSources,
  estimate,
  estimateAll,
  exponent,
  makeSource,
  pieceCount,
  power,
  samples,
  uniformity,
  type ProductResolver,
} from '../src/estimate';
import { zoneShape, type ZoneShape } from '../src/zones';
import { GOLDEN_ROOMS, goldenIntent, goldenRoom, loadGolden, loadMisc, type GoldenRoomName } from './golden/load';

declare const performance: { now(): number };

function goldenPackage(family: string, lumens: number): StudioProduct {
  const pkg = loadMisc().genericPackages.find((p) => p.family === family && p.lumens === lumens);
  if (!pkg) throw new Error(`no golden package ${family} ${lumens}`);
  const { nominal: _n, ...fields } = pkg;
  return createProduct({ ...fields, catalog: 'Generic', brand: 'Generic', isGeneric: true });
}

function solved(name: GoldenRoomName): { design: RoomDesign; productOf: ProductResolver } {
  const products = new Map<LightingIntent, StudioProduct>();
  const intents = loadGolden(name).solved.map((s) => {
    const intent = goldenIntent(s.intent);
    if (s.intent.product) products.set(intent, goldenPackage(s.intent.product.family, s.intent.product.lumens));
    return intent;
  });
  return {
    design: { room: goldenRoom(name), intents, removedExisting: [], calculation: null, revision: 0 },
    productOf: (_r, i) => products.get(i) ?? null,
  };
}

const design = (room: RoomDesign['room'], intents: LightingIntent[]): RoomDesign => ({
  room,
  intents,
  removedExisting: [],
  calculation: null,
  revision: 0,
});

describe('exponent', () => {
  it('cos¹ at 120°', () => expect(Math.abs(exponent(120) - 1)).toBeLessThan(1e-9));
  it('cos² at 90°', () => expect(Math.abs(exponent(90) - 2)).toBeLessThan(1e-9));
  it('narrower is higher', () => expect(exponent(25)).toBeGreaterThan(exponent(60)));
  it('golden table', () => {
    for (const { beam, n } of loadMisc().exponents) expect(Math.abs(exponent(beam) - n) / n).toBeLessThan(1e-12);
  });
  it('clamps', () => {
    expect(exponent(0)).toBeCloseTo(284.2023339496307, 9);
    expect(exponent(8)).toBe(exponent(0));
    expect(exponent(200)).toBe(exponent(170));
    expect(Math.abs(exponent(170) - 0.2840698893561952)).toBeLessThan(1e-15);
  });
});

describe('source derived values', () => {
  const src = (beam: number) => makeSource(1, exponent(beam), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  it('cosCut per beam', () => {
    expect(src(25).cosCut).toBeCloseTo(0.8064734864179842, 14);
    expect(src(40).cosCut).toBeCloseTo(0.5725279031120898, 14);
    expect(src(60).cosCut).toBeCloseTo(0.2753677774975419, 14);
    expect(src(90).cosCut).toBeCloseTo(0.04472135954999584, 14);
    expect(src(120).cosCut).toBeCloseTo(0.0020000000000000044, 16);
    expect(src(170).cosCut).toBeCloseTo(3.154e-10, 12);
    expect(src(180).cosCut).toBe(src(170).cosCut);
  });
  it('integer power fast path', () => {
    expect(src(90).power).toBe(2);
    expect(src(120).power).toBe(1);
    expect(src(100).power).toBe(0);
    expect(src(110).power).toBe(0);
    expect(src(60).power).toBe(0);
  });
  it('linear pieces (round half even)', () => {
    const p = (length: number, width = 0.3) => pieceCount(createProduct({ length, width }));
    expect(p(4)).toBe(2);
    expect(p(5)).toBe(2);
    expect(p(6)).toBe(3);
    expect(p(7)).toBe(4);
    expect(p(12)).toBe(4);
    expect(p(4, 2)).toBe(1); // 2×4 troffer: length < 3·width
    expect(p(2, 0.3)).toBe(1);
  });
});

describe('single downlight point-source formula', () => {
  const downlight = createProduct({
    family: 'downlight',
    lumens: 1500,
    watts: 14,
    length: 0.65,
    width: 0.65,
    isRound: true,
    beamAngle: 60,
    isGeneric: true,
  });
  const room = createRoom({ floor: [rect({ x: 0, y: 0 }, { x: 20, y: 20 })], ceilingHeight: 10 });
  const intent = createIntent({
    kind: 'Ambient',
    region: rect({ x: 0, y: 0 }, { x: 20, y: 20 }),
    target: { minimum: null, average: 10, maximum: null },
    plane: { kind: 'Horizontal', height: 0, bottom: 0, top: 0, inferred: true, reason: '' },
    product: { product: downlight, agentPicked: false, reason: '', alternatives: [] },
  });
  intent.fixtures = [createFixture({ intentId: intent.id, center: { x: 10, y: 10 }, height: 10 })];
  const d = design(room, [intent]);
  const up = { x: 0, y: 0, z: 1 };
  const n = exponent(60);
  const i0 = (1500 * (n + 1)) / (2 * Math.PI);
  const under = at(d, { x: 10, y: 10, z: 0 }, up);

  it('under the fixture', () => {
    const approx = (i0 / 100 + ((1500 * 0.25) / 400) * 2) * 0.85;
    expect(Math.abs(under - approx) / approx).toBeLessThan(0.01);
    expect(under).toBeCloseTo(13.401492058217213, 12);
  });
  it('off to the side', () => {
    const side = at(d, { x: 15, y: 10, z: 0 }, up);
    expect(side).toBeLessThan(0.6 * under);
    expect(side).toBeCloseTo(6.1305133602106325, 12);
  });
  it('facing away', () => {
    const away = at(d, { x: 10, y: 10, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(Math.abs(away - 1.59375) / 1.59375).toBeLessThan(0.01);
    expect(away).toBeCloseTo(1.59375, 12);
  });
  it('corner (derived)', () => expect(at(d, { x: 0, y: 0, z: 0 }, up)).toBeCloseTo(0.6278257080819616, 12));
  it('no sources → 0', () => expect(at(design(room, []), { x: 1, y: 1, z: 0 }, up)).toBe(0));
  it('suggestions and existing fixtures emit nothing', () => {
    const s = { ...intent, isSuggestion: true };
    expect(buildSources(design(room, [s])).sources).toHaveLength(0);
  });
});

describe('output, counts, watts, power (Office solved)', () => {
  const { design: d, productOf } = solved('Office');
  const ambient = d.intents.find((i) => i.kind === 'Ambient')!;

  it('output scales', () => {
    const full = estimate(d, ambient, productOf).average;
    const halved = { ...ambient, fixtures: ambient.fixtures.map((f) => ({ ...f, output: 0.5 })) };
    const prod = productOf(d.room, ambient);
    const d2 = { ...d, intents: d.intents.map((i) => (i === ambient ? halved : i)) };
    const po: ProductResolver = (r, i) => (i === halved ? prod : productOf(r, i));
    const half = estimate(d2, halved, po).average;
    expect(half).toBeLessThan(0.8 * full);
    expect(half).toBeGreaterThan(0.3 * full);
  });
  it('fixtures and watts', () => {
    const e = estimate(d, ambient, productOf);
    expect(e.fixtures).toBe(ambient.fixtures.length);
    expect(e.fixtures).toBe(10);
    expect(Math.abs(e.watts - 130)).toBeLessThanOrEqual(1e-6);
    expect(e.minimum).toBeLessThanOrEqual(e.average);
    expect(e.average).toBeLessThanOrEqual(e.maximum);
  });
  it('power', () => {
    const p = power(d, productOf);
    expect(p.watts).toBeGreaterThan(130);
    expect(Math.abs(p.lpd - p.watts / 864)).toBeLessThan(1e-9);
    expect(p.lpd).toBeGreaterThan(0.05);
    expect(p.lpd).toBeLessThan(2.5);
    expect(p.watts).toBe(249);
    expect(p.lpd).toBeCloseTo(0.2881944444444444, 15);
  });
  it('keep-dim gets others’ light, no fixtures/watts', () => {
    const kd = d.intents.find((i) => i.kind === 'KeepDim')!;
    const e = estimate(d, kd, productOf);
    expect(e.fixtures).toBe(0);
    expect(e.watts).toBe(0);
    expect(e.average).toBeCloseTo(8.529608628712793, 12);
  });
  it('estimateAll covers every non-suggestion intent and equals estimate', () => {
    const sugg = createIntent({ isSuggestion: true, region: rect({ x: 0, y: 0 }, { x: 10, y: 10 }) });
    const d2 = { ...d, intents: [...d.intents, sugg] };
    const all = estimateAll(d2, productOf);
    expect(all.size).toBe(d.intents.length);
    expect(all.has(sugg.id)).toBe(false);
    for (const i of d.intents) expect(all.get(i.id)).toEqual(estimate(d2, i, productOf));
  });
  it('uniformity', () => {
    expect(uniformity({ average: 0, minimum: 0 })).toBe(0);
    expect(uniformity({ average: 20, minimum: 5 })).toBe(0.25);
  });
});

describe('planes', () => {
  it('wall normal', () => {
    const { design: d, productOf } = solved('Office');
    const wash = d.intents.find((i) => i.kind === 'WallWash')!;
    const wall = d.room.walls[wash.wallIndex!]!;
    const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2, z: 5 };
    const inward = { x: wall.inward.x, y: wall.inward.y, z: 0 };
    const outward = { x: -wall.inward.x, y: -wall.inward.y, z: 0 };
    expect(at(d, mid, inward, productOf)).toBeGreaterThan(2 * at(d, mid, outward, productOf));
  });
  it('cove lights the ceiling', () => {
    const { design: d, productOf } = solved('Cafeteria');
    const glow = d.intents.find((i) => i.kind === 'CeilingGlow')!;
    const e = estimate(d, glow, productOf);
    expect(e.average).toBeGreaterThan(1);
    const avg = glow.target.average!;
    const onTarget = Math.abs(e.average - avg) / avg <= 0.15;
    const explained = glow.trace.some(
      (t) => t.includes('already light this plane') || t.includes('pick a lower-output product'),
    );
    expect(onTarget || (e.average > avg && explained)).toBe(true);
    expect(e.average).toBeCloseTo(13.119212290786182, 12);
  });
});

describe('sampling', () => {
  const counts: Record<GoldenRoomName, number[]> = {
    Office: [384, 84, 84, 77, 60, 96, 12, 30],
    Cafeteria: [384, 174, 196, 384, 6, 375],
    Lobby: [368, 90, 154, 15, 36, 144],
    DataHall: [391, 112, 112, 112],
  };
  it('≤ 400 samples (Cafeteria Ambient)', () => {
    const { design: d } = solved('Cafeteria');
    const amb = d.intents.find((i) => i.kind === 'Ambient')!;
    const n = samples(zoneShape(d, amb)!).points.length;
    expect(n).toBeLessThanOrEqual(400);
    expect(n).toBe(384);
  });
  for (const name of GOLDEN_ROOMS) {
    it(`counts ${name}`, () => {
      const { design: d } = solved(name);
      expect(d.intents.map((i) => samples(zoneShape(d, i)!).points.length)).toEqual(counts[name]);
    });
  }
  it('centroid fallback', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 7 },
      { x: 10, y: 6.95 },
    ];
    const shape: ZoneShape = {
      kind: 'Horizontal',
      polygon: tri,
      height: 2.5,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      bottom: 0,
      top: 0,
      inward: { x: 0, y: 0 },
    };
    const s = samples(shape);
    expect(s.points).toHaveLength(1);
    expect(s.points[0]!.x).toBeCloseTo(20 / 3, 9);
    expect(s.points[0]!.y).toBeCloseTo(13.95 / 3, 9);
    expect(s.points[0]!.z).toBe(2.5);
    expect(s.normal).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('vertical layout', () => {
    const s = samples({
      kind: 'Vertical',
      polygon: [],
      height: 2,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      bottom: 2,
      top: 8,
      inward: { x: 0, y: 1 },
    });
    expect(s.points).toHaveLength(60);
    expect(s.points[0]).toEqual({ x: 0.5, y: 0, z: 2.5 });
    expect(s.points[1]).toEqual({ x: 0.5, y: 0, z: 3.5 });
    expect(s.normal).toEqual({ x: 0, y: 1, z: 0 });
  });
  it('ceiling normal faces down', () => {
    const { design: d } = solved('Cafeteria');
    const glow = d.intents.find((i) => i.kind === 'CeilingGlow')!;
    expect(samples(zoneShape(d, glow)!).normal).toEqual({ x: 0, y: 0, z: -1 });
  });
  it('speed: 200 fixtures, one estimate < 25 ms', () => {
    const room = goldenRoom('Cafeteria');
    const product = goldenPackage('volumetric', 3000);
    const intent = createIntent({
      kind: 'Ambient',
      region: room.floor[0]!,
      product: { product, agentPicked: false, reason: '', alternatives: [] },
    });
    intent.fixtures = Array.from({ length: 200 }, (_, i) =>
      createFixture({
        intentId: intent.id,
        center: { x: 2 + (i % 20) * 2.2, y: 2 + Math.floor(i / 20) * 3 },
        height: 10,
      }),
    );
    const d = design(room, [intent]);
    estimate(d, intent);
    const runs = 10;
    const t0 = performance.now();
    for (let r = 0; r < runs; r++) estimate(d, intent);
    expect((performance.now() - t0) / runs).toBeLessThan(25);
  });
});
