// Whole-room result (core/room-calc.ts): room lumen method per zone elevation over every luminaire type, merged with
// the point-by-point grid when there is one; overlay order by elevation.
import { describe, expect, it } from 'vitest';
import { calculate } from '../src/calc';
import { estimateAll, power } from '../src/estimate';
import { rect } from '../src/geometry';
import { createFixture, createIntent, createProduct, createRoom, type LightingIntent, type RoomDesign } from '../src/model';
import { productOf } from '../src/products';
import {
  ROOM_RESULT_LABEL,
  coefficientOfUtilisation,
  lumenAt,
  overlayOrder,
  roomCavityRatio,
  roomResult,
} from '../src/room-calc';
import { GOLDEN_ROOMS } from './golden/load';
import { solved } from './solver-helpers';

const downlight = createProduct({
  family: 'downlight',
  label: 'Downlight',
  lumens: 1500,
  watts: 14,
  length: 0.65,
  width: 0.65,
  isRound: true,
  beamAngle: 60,
  isGeneric: true,
});
const room = createRoom({ floor: [rect({ x: 0, y: 0 }, { x: 20, y: 20 })], ceilingHeight: 10 });
const plane = (height: number) => ({ kind: 'Horizontal' as const, height, bottom: 0, top: 0, inferred: true, reason: '' });
const choice = { product: downlight, agentPicked: false, reason: '', alternatives: [] };

function oneDownlight(): RoomDesign {
  const base = createIntent({
    kind: 'Ambient',
    region: rect({ x: 0, y: 0 }, { x: 20, y: 20 }),
    target: { minimum: null, average: 1.5, maximum: null },
    plane: plane(0),
    product: choice,
  });
  base.fixtures = [createFixture({ intentId: base.id, center: { x: 10, y: 10 }, height: 10 })];
  const task = createIntent({
    kind: 'Task',
    region: rect({ x: 8, y: 8 }, { x: 12, y: 12 }),
    target: { minimum: 20, average: 30, maximum: 50 },
    plane: plane(3),
  });
  return { room, intents: [base, task], removedExisting: [], calculation: null, revision: 4 };
}

describe('room lumen method', () => {
  it('uses the solver CU rule', () => {
    expect(roomCavityRatio(10, 20, 20)).toBe(5);
    expect(coefficientOfUtilisation(5)).toBeCloseTo(0.545, 12);
    expect(coefficientOfUtilisation(0)).toBe(0.7);
    expect(coefficientOfUtilisation(20)).toBe(0.45);
    expect(roomCavityRatio(0.2, 20, 20)).toBe(roomCavityRatio(1, 20, 20)); // cavity floored at 1 ft
  });

  it('whole-room zone: every lumen spreads over the floor (derived)', () => {
    const r = roomResult(oneDownlight(), null, productOf);
    const base = r.zones[0]!;
    expect(base.lumen!.average).toBeCloseTo((1500 * 0.545 * 0.85) / 400, 12);
    expect(base.lumen!.rcr).toBe(5);
    expect(base.average).toBe(base.lumen!.average);
    expect(base.point).toBeNull();
  });

  it('each zone is measured at its own elevation, with fixtures of every zone (derived)', () => {
    const r = roomResult(oneDownlight(), null, productOf);
    const task = r.zones[1]!;
    expect(task.elevation).toBe(3);
    const cu = coefficientOfUtilisation(roomCavityRatio(7, 20, 20));
    const radius = 7 * Math.tan(Math.PI / 6);
    const local = 16 / (Math.PI * radius * radius);
    const want = 0.85 * ((1500 * cu * local) / 16 + (1500 * cu * (1 - local)) / 400);
    expect(task.lumen!.average).toBeCloseTo(want, 12);
    // the task zone has no fixtures of its own but gets the base light, more of it than the floor-wide average
    expect(task.lumen!.average).toBeGreaterThan(r.zones[0]!.lumen!.average);
    expect(task.status).toBe('low');
    expect(r.worst).toBe(task.intentId);
  });

  it('a fixture outside a zone only adds its room share; a fixture below the plane adds nothing', () => {
    const p = rect({ x: 0, y: 0 }, { x: 4, y: 4 });
    const lit = [{ x: 15, y: 15, height: 10, flux: 1000, up: 0, beam: 60 }];
    const out = lumenAt(p, 0, lit, { rl: 20, rw: 20, area: 400 });
    expect(out.average).toBeCloseTo((1000 * 0.545 * 0.85) / 400, 12);
    expect(lumenAt(p, 12, lit, { rl: 20, rw: 20, area: 400 }).average).toBe(0);
  });

  it('uplight reaches the plane at half the CU', () => {
    const p = rect({ x: 0, y: 0 }, { x: 20, y: 20 });
    const lit = [{ x: 10, y: 10, height: 10, flux: 1000, up: 1, beam: 60 }];
    expect(lumenAt(p, 0, lit, { rl: 20, rw: 20, area: 400 }).average).toBeCloseTo((1000 * 0.545 * 0.5 * 0.85) / 400, 12);
  });
});

describe('room result', () => {
  it('is labelled an estimate', () => {
    expect(roomResult(oneDownlight()).label).toBe(ROOM_RESULT_LABEL);
    expect(ROOM_RESULT_LABEL).toMatch(/^Estimate/);
  });

  it('takes point-by-point values from a calculation of the same revision, and ignores a stale one', () => {
    const d = oneDownlight();
    const calc = calculate(d, { productOf, surfaces: false });
    const r = roomResult(d, calc, productOf);
    expect(r.calculated).toBe(true);
    for (const z of r.zones) {
      const g = calc.zones.find((x) => x.zoneId === z.intentId)!;
      expect(z.point!.average).toBe(g.avg);
      expect(z.average).toBe(g.avg);
      expect(z.lumen).not.toBeNull(); // both methods are kept
    }
    const stale = roomResult({ ...d, revision: d.revision + 1 }, calc, productOf);
    expect(stale.calculated).toBe(false);
    expect(stale.zones.every((z) => z.point === null)).toBe(true);
    expect(roomResult(d, { ...calc, aborted: true }, productOf).calculated).toBe(false);
  });

  it('suggestions are not zones and their fixtures do not count', () => {
    const d = oneDownlight();
    const sugg: LightingIntent = { ...d.intents[0]!, id: 'sugg', isSuggestion: true };
    const r = roomResult({ ...d, intents: [...d.intents, sugg] }, null, productOf);
    expect(r.zones.map((z) => z.intentId)).not.toContain('sugg');
    expect(r.fixtures).toBe(1);
  });

  for (const name of GOLDEN_ROOMS)
    it(`${name}: one result over every zone and type; watts match power()`, () => {
      const d = solved(name);
      const r = roomResult(d, null, productOf);
      const quick = estimateAll(d, productOf);
      const accepted = d.intents.filter((i) => !i.isSuggestion);
      expect(r.zones.length).toBe(accepted.length);
      expect(r.watts).toBeCloseTo(power(d, productOf).watts, 9);
      expect(r.fixtures).toBe(accepted.filter((i) => productOf(d.room, i).lumens > 0).reduce((n, i) => n + i.fixtures.length, 0));
      expect(r.types.reduce((n, t) => n + t.fixtures, 0)).toBe(r.fixtures);
      for (const z of r.zones) {
        if (z.plane === 'horizontal') {
          expect(z.lumen).not.toBeNull();
          expect(z.lumen!.average).toBeGreaterThanOrEqual(0);
          expect(z.lumen!.cu).toBeGreaterThanOrEqual(0.45);
          expect(z.lumen!.cu).toBeLessThanOrEqual(0.7);
          expect(z.source).toBe('lumen');
        } else {
          // the lumen method has no wall or ceiling value: the quick point estimate stands in
          expect(z.lumen).toBeNull();
          expect(z.source).toBe('quick');
          expect(z.average).toBe(quick.get(z.intentId)!.average);
        }
      }
      expect(r.elevations).toEqual([...r.elevations].sort((a, b) => a - b));
      expect(r.onTarget).toBeLessThanOrEqual(r.withTarget);
    });
});

describe('overlay order', () => {
  it('floor and work planes by elevation, larger first at one elevation, then walls, then ceilings', () => {
    const z = (intentId: string, plane: 'horizontal' | 'vertical' | 'ceiling', elevation: number, area: number) => ({
      intentId,
      plane,
      elevation,
      area,
    });
    expect(
      overlayOrder([
        z('glow', 'ceiling', 12, 300),
        z('wash', 'vertical', 2, 40),
        z('counter', 'horizontal', 3, 80),
        z('base', 'horizontal', 2.5, 1500),
        z('pendants', 'horizontal', 2.5, 900),
        z('path', 'horizontal', 0, 30),
      ]),
    ).toEqual(['path', 'base', 'pendants', 'counter', 'wash', 'glow']);
  });
  it('is stable for ties', () => {
    const a = { intentId: 'a', plane: 'horizontal' as const, elevation: 0, area: 10 };
    expect(overlayOrder([a, { ...a, intentId: 'b' }])).toEqual(['a', 'b']);
  });
});
