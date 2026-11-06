// spec/solver.md "Test cases" (SolverTests) + helper-level checks of Search, packages, keep-dim and trace text.
import { describe, expect, it } from 'vitest';
import { ceilingAt, contains, distance, inflate, inRoom, polygonDistance, rect } from '../src/geometry';
import {
  createFixture,
  createIntent,
  createProduct,
  createRoom,
  type LightingIntent,
  type RoomDesign,
} from '../src/model';
import { byFamily, packages, productOf } from '../src/products';
import {
  enforceKeepDim,
  estimateOf,
  hasTarget,
  leanWant,
  excess,
  shortfall,
  signature,
  isPendant,
  isCove,
  isLinear,
  solve,
  solveAll,
  want,
} from '../src/solver';
import { D1, D2, F1, G0 } from '../src/solver/context';
import { fixtureFootprint, overlapsWallWash } from '../src/solver/fixture-overlap';
import { byKind, designOf, first, make, seeded, solved } from './solver-helpers';
import { GOLDEN_ROOMS } from './golden/load';

const avgOf = (d: RoomDesign, i: LightingIntent): number => estimateOf(d, i).average;

/** "Landed(i, e)". */
function landed(d: RoomDesign, i: LightingIntent): boolean {
  const e = avgOf(d, i);
  const t = i.target.average!;
  if (Math.abs(e - t) / t <= 0.15) return true;
  return e > t && i.trace.some((l) => l.includes('already light this plane') || l.includes('pick a lower-output product'));
}

/** Office with only a fresh ambient over the floor (plus optional extra intents). */
function officeAmbientOnly(tweak?: (a: LightingIntent) => void): { d: RoomDesign; a: LightingIntent } {
  const d = seeded('Office');
  const room = d.room;
  const a = make(room, 'Ambient', room.floor[0]!.map((p) => ({ ...p })));
  tweak?.(a);
  d.intents = [a];
  return { d, a };
}

describe('task zones taking priority over ambient placements', () => {
  it.each(['pinned', 'hand-tuned', 'fixed quantity'] as const)('preserves %s ambient fixtures', (mode) => {
    const { d, a } = officeAmbientOnly();
    if (mode === 'fixed quantity') a.behavior.quantity = 12;
    solveAll(d);
    const fixture = a.fixtures[0]!;
    const { x, y } = fixture.center;
    const region = rect({ x: x - 2, y: y - 2 }, { x: x + 2, y: y + 2 });
    if (mode === 'pinned') fixture.pinned = true;
    if (mode === 'hand-tuned') a.handTuned = true;
    const task = make(d.room, 'Task', region);
    d.intents.push(task);

    solveAll(d, { prioritizeTaskZones: true });

    expect(task.fixtures.length).toBeGreaterThan(0);
    expect(a.fixtures.some((f) => contains(region, f.center))).toBe(true);
    if (mode !== 'fixed quantity') expect(a.fixtures).toContain(fixture);
  });

  it('keeps ambient coverage when an accepted task has no fixtures', () => {
    const { d, a } = officeAmbientOnly();
    const task = make(d.room, 'Task', a.region);
    task.handTuned = true;
    d.intents.push(task);

    solveAll(d, { prioritizeTaskZones: true });

    expect(a.fixtures.length).toBeGreaterThan(0);
    expect(task.fixtures).toHaveLength(0);
  });
});

describe('wall-wash fixtures taking priority over ambient placements', () => {
  it('clears the Brand wall wash housings while keeping the vertical zone and ambient coverage', () => {
    const d = seeded('Office');
    d.intents = d.intents.filter((i) => ['Open office ambient', 'Desk cluster A task', 'Brand wall wash'].includes(i.label));
    const ambient = first(d, 'Ambient');
    const wash = first(d, 'WallWash');
    const region = wash.region.slice();
    const overlappingAmbient = () => {
      const washers = wash.fixtures.map((f) => fixtureFootprint(f, productOf(d.room, wash)));
      return ambient.fixtures.filter((f) => overlapsWallWash(f, productOf(d.room, ambient), washers));
    };

    solveAll(d, { prioritizeTaskZones: true });
    expect(wash.plane.kind).toBe('Vertical');
    expect(overlappingAmbient().length).toBeGreaterThan(0);

    solveAll(d, { prioritizeTaskZones: true, avoidWallWashOverlap: true });
    expect(wash.region).toEqual(region);
    expect(wash.fixtures.length).toBeGreaterThan(0);
    expect(ambient.fixtures.length).toBeGreaterThan(0);
    expect(overlappingAmbient()).toHaveLength(0);
  });

  it('uses housing edges, rotation and mounting height', () => {
    const product = createProduct({ length: 4, width: 2 });
    const wash = createProduct({ length: 0.65, width: 0.65, isRound: true });
    const washers = [fixtureFootprint(createFixture({ center: { x: 0, y: 2.2 }, height: 9 }), wash)];
    const ambient = createFixture({ height: 9, orientation: 90 });

    expect(overlapsWallWash(ambient, product, washers)).toBe(true);
    expect(overlapsWallWash({ ...ambient, orientation: 0 }, product, washers)).toBe(false);
    expect(overlapsWallWash({ ...ambient, height: 8 }, product, washers)).toBe(false);
  });
});

describe('number formats and shared definitions', () => {
  it('formats trace numbers like the reference', () => {
    expect(F1(24.69)).toBe('24.7');
    expect(F1(11)).toBe('11');
    expect(F1(0.15)).toBe('0.2');
    expect(D1(4)).toBe('4.0');
    expect(D2(0.6)).toBe('0.60');
    expect(D2(0.641)).toBe('0.64');
    expect(G0(1500)).toBe('1,500');
    expect(G0(600)).toBe('600');
    expect(G0(10000)).toBe('10,000');
  });
  it('Want, LeanWant, Excess, Shortfall, HasTarget', () => {
    const i = createIntent({ target: { minimum: 10, average: 20, maximum: 35 } });
    expect(want(i)).toBe(20);
    expect(leanWant(i)).toBeCloseTo(10.6, 12);
    expect(want(createIntent({ target: { minimum: 10, average: null, maximum: 30 } }))).toBe(20);
    expect(want(createIntent({ target: { minimum: 10, average: null, maximum: null } }))).toBe(10);
    expect(want(createIntent({ target: { minimum: null, average: null, maximum: 5 } }))).toBe(5);
    expect(want(createIntent())).toBe(20);
    expect(leanWant(createIntent({ target: { minimum: null, average: 30, maximum: null } }))).toBeCloseTo(28.62, 12);
    expect(leanWant(createIntent({ target: { minimum: null, average: null, maximum: 5 } }))).toBeNull();
    expect(excess(i.target, 35.7)).toBe(0);
    expect(excess(i.target, 70)).toBeCloseTo(1, 12);
    expect(shortfall(i.target, 9.8)).toBe(0);
    expect(shortfall(i.target, 5)).toBeCloseTo(0.5, 12);
    expect(hasTarget(createIntent({ target: { minimum: 1, average: null, maximum: null } }))).toBe(false);
    expect(hasTarget(createIntent({ target: { minimum: 1, average: null, maximum: 2 } }))).toBe(true);
  });
  it('Signature', () => {
    const f = (x: number, y: number) => createFixture({ center: { x, y } });
    expect(signature([f(25.25, 15.25), f(25.25, 18.75)])).toBe('2:25.25,15.25;25.25,18.75');
  });
  it('product flags', () => {
    expect(isPendant(byFamily('pendant-linear')!)).toBe(true);
    expect(isPendant(byFamily('strip')!)).toBe(true);
    expect(isPendant(byFamily('pendant-can')!)).toBe(true);
    expect(isPendant(byFamily('volumetric')!)).toBe(false);
    expect(isCove(byFamily('cove')!)).toBe(true);
    expect(isCove(createProduct({ label: 'Recessed cove light' }))).toBe(true);
    expect(isCove(createProduct({ label: 'Alcove light' }))).toBe(false);
    expect(isLinear(byFamily('troffer')!)).toBe(false);
    expect(isLinear(byFamily('pendant-linear')!)).toBe(true);
  });
});

describe('solver.md test cases', () => {
  it('Solve_OfficeIntentsLandOnTheirTargets', () => {
    const d = solved('Office');
    const keep = first(d, 'KeepDim');
    const checked = d.intents.filter(
      (i) =>
        i.kind === 'Ambient' ||
        ((i.kind === 'Task' || i.kind === 'WallWash') && polygonDistance(keep.region, i.region) > 8),
    );
    expect(checked.length).toBeGreaterThan(1);
    for (const i of checked) {
      expect(i.fixtures.length, i.label).toBeGreaterThan(0);
      expect(landed(d, i), i.label).toBe(true);
    }
  });

  it('Solve_CafeteriaIntentsLandOnTheirTargets', () => {
    const d = solved('Cafeteria');
    for (const i of d.intents.filter((x) => ['Ambient', 'Task', 'WallWash'].includes(x.kind))) {
      expect(i.fixtures.length, i.label).toBeGreaterThan(0);
      expect(landed(d, i), i.label).toBe(true);
    }
  });

  it('Solve_EveryRoomSolvesWithSaneFixturesAndOutputs', () => {
    for (const name of GOLDEN_ROOMS) {
      const d = solved(name);
      for (const i of d.intents) {
        if (i.kind === 'KeepDim') {
          expect(i.fixtures).toHaveLength(0);
          continue;
        }
        expect(i.fixtures.length, `${name} ${i.label}`).toBeGreaterThanOrEqual(1);
        expect(i.fixtures.length).toBeLessThanOrEqual(300);
        expect(i.trace.length).toBeGreaterThan(0);
        for (const f of i.fixtures) {
          expect(inRoom(d.room, f.center)).toBe(true);
          expect(f.output).toBe(1);
          expect(f.height).toBeGreaterThan(0);
          expect(f.height).toBeLessThanOrEqual(ceilingAt(d.room, f.center) + 0.01);
          expect(f.intentId).toBe(i.id);
        }
      }
    }
  });

  it('Solve_EveryIntentInARoomHasItsOwnLabel', () => {
    for (const name of GOLDEN_ROOMS) {
      const labels = solved(name).intents.map((i) => i.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
    expect(byKind(solved('DataHall'), 'Task').map((i) => i.label)).toEqual(['Aisle 1 task', 'Aisle 2 task', 'Aisle 3 task']);
  });

  it('Solve_IsDeterministic', () => {
    const pick = (d: RoomDesign) => d.intents.map((i) => i.fixtures.map((f) => [f.center.x, f.center.y, f.output]));
    expect(pick(solved('Office'))).toEqual(pick(solved('Office')));
  });

  it('SolveAll_LeavesHandTunedIntentsAlone', () => {
    const d = solved('Office');
    const task = first(d, 'Task');
    task.fixtures[0] = { ...task.fixtures[0]!, center: { x: 10.1, y: 12.2 }, pinned: true };
    task.handTuned = true;
    const before = task.fixtures.map((f) => [f.id, f.center.x, f.center.y]);
    solveAll(d);
    expect(task.fixtures.map((f) => [f.id, f.center.x, f.center.y])).toEqual(before);
    expect(task.trace.some((l) => l.includes('hand-tuned'))).toBe(true);
  });

  it('SolveAll_SuggestionsPlaceNothing', () => {
    const d = seeded('Office', false);
    d.intents[0]!.isSuggestion = false;
    solveAll(d);
    expect(d.intents[0]!.fixtures.length).toBeGreaterThan(0);
    for (const i of d.intents.slice(1)) {
      expect(i.fixtures).toHaveLength(0);
      expect(i.trace).toEqual([`${i.label}: a suggestion; it places nothing until you accept it.`]);
    }
    expect(d.intents.reduce((n, i) => n + i.fixtures.length, 0)).toBe(d.intents[0]!.fixtures.length);
  });

  it('Solve_HitsTheTargetWithCountNotOutput', () => {
    const counts: number[] = [];
    for (const fc of [20, 40, 60]) {
      const { d, a } = officeAmbientOnly((x) => {
        x.target = { minimum: null, average: fc, maximum: null };
        x.product = {
          product: { ...packages('volumetric')[2]!, lumens: 1000 },
          agentPicked: false,
          reason: 'Chosen by you',
          alternatives: [],
        };
      });
      solve(d, a);
      for (const f of a.fixtures) expect(f.output).toBe(1);
      expect(Math.abs(avgOf(d, a) - fc) / fc).toBeLessThan(0.2);
      counts.push(a.fixtures.length);
    }
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
  });

  it('Solve_SaysSoWhenEvenTheFewestFixturesOverLightThePlane', () => {
    const { d, a } = officeAmbientOnly((x) => {
      x.target = { minimum: null, average: 2, maximum: null };
    });
    const r = solve(d, a);
    expect(r.estimate.average).toBeGreaterThan(2.3);
    const lines = a.trace.filter((l) => l.includes('pick a lower-output product'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`even ${a.fixtures.length} fixtures give`);
    for (const f of a.fixtures) expect(f.output).toBe(1);
  });

  it('Solve_QuantityOverrideIsExact', () => {
    const { d, a } = officeAmbientOnly((x) => {
      x.behavior.quantity = 12;
    });
    solve(d, a);
    expect(a.fixtures).toHaveLength(12);
    expect(a.trace[0]).toContain('quantity fixed at 12');
    expect(a.trace.some((l) => l.includes('a count you set'))).toBe(true);
  });

  it('Solve_DensityMovesTheFixtureCount', () => {
    const count = (density: number) => {
      const { d, a } = officeAmbientOnly((x) => {
        x.behavior.alignToCeilingGrid = false;
        x.behavior.density = density;
      });
      solve(d, a);
      if (density !== 1) expect(a.trace.some((l) => l.includes(`density ${D1(density)} sets the spacing`))).toBe(true);
      return a.fixtures.length;
    };
    const c06 = count(0.6);
    const c1 = count(1);
    const c16 = count(1.6);
    expect(c06).toBeGreaterThan(c1);
    expect(c1).toBeGreaterThanOrEqual(c16);
  });

  it('Solve_PatternsAreHonoured', () => {
    const { d, a } = officeAmbientOnly((x) => {
      x.behavior.alignToCeilingGrid = false;
      x.behavior.pattern = 'staggered';
    });
    solve(d, a);
    const xs = new Set(a.fixtures.map((f) => f.center.x.toFixed(2)));
    const ys = new Set(a.fixtures.map((f) => f.center.y.toFixed(2)));
    expect(xs.size).toBeGreaterThan(ys.size);
    expect(a.trace.some((l) => l.includes('staggered'))).toBe(true);
    a.behavior.pattern = 'perimeter';
    solve(d, a);
    expect(a.fixtures.length).toBeGreaterThan(0);
    for (const f of a.fixtures) {
      const { x, y } = f.center;
      expect(Math.min(x, 36 - x, y, 24 - y)).toBeLessThan(2.1);
    }
  });

  it('Solve_PinnedFixturesStayWhereTheyAre', () => {
    const { d, a } = officeAmbientOnly();
    solve(d, a);
    const pin = { ...a.fixtures[3]!, center: { x: 17.33, y: 11.77 }, pinned: true, output: 0.8 };
    a.fixtures[3] = pin;
    a.handTuned = true;
    solve(d, a);
    const kept = a.fixtures.find((f) => f.id === pin.id)!;
    expect(kept.center).toEqual({ x: 17.33, y: 11.77 });
    expect(kept.output).toBe(0.8);
    expect(a.fixtures.length).toBeGreaterThan(5);
    expect(a.trace.some((l) => l.includes('by hand'))).toBe(true);
    for (const f of a.fixtures) if (f.id !== pin.id) expect(distance(f.center, pin.center)).toBeGreaterThanOrEqual(1.5);
  });

  it('KeepDim_RemovesNearbyFixturesInsteadOfDimmingAndSaysWhereItFallsShort', () => {
    const noKeep = seeded('Office');
    const keepSeed = first(noKeep, 'KeepDim');
    noKeep.intents = noKeep.intents.filter((i) => i.kind !== 'KeepDim');
    solveAll(noKeep);
    const probe = { ...keepSeed, target: { minimum: null, average: null, maximum: 5 } };
    const before = avgOf(noKeep, probe);
    const d = solved('Office');
    const keep = first(d, 'KeepDim');
    const after = avgOf(d, keep);
    expect(before).toBeGreaterThan(5);
    expect(after).toBeLessThan(before);
    expect(d.intents.some((i) => i.kind !== 'KeepDim' && i.trace.some((l) => l.startsWith('Removed ')))).toBe(true);
    expect(keep.trace.some((l) => l.startsWith('Removed ') && l.includes('Screen — keep dim'))).toBe(true);
    expect(d.intents.some((i) => i.trace.some((l) => l.startsWith('Dimmed ')))).toBe(false);
    expect(after <= 5.25 || keep.trace.some((l) => l.includes('keep-dim zone is over its maximum'))).toBe(true);
  });

  it('KeepDim_NeverDimsAndNeverEmptiesAnIntent', () => {
    const d = solved('Office');
    for (const i of d.intents) {
      if (i.kind === 'KeepDim') continue;
      expect(i.fixtures.length).toBeGreaterThanOrEqual(1);
      for (const f of i.fixtures) expect(f.output).toBe(1);
    }
  });

  it('KeepDim_NoFixturesLandInsideItsMargin', () => {
    const d = solved('Office');
    const keep = first(d, 'KeepDim');
    const amb = first(d, 'Ambient');
    const beam = productOf(d.room, amb).beamAngle;
    const margin = Math.min(4, 9 * Math.tan(((beam / 2) * Math.PI) / 180));
    const zone = inflate(keep.region, margin);
    for (const f of amb.fixtures) expect(contains(zone, f.center)).toBe(false);
  });

  it('KeepDim_MarginBehaviourWidensTheExclusion', () => {
    const d = seeded('Office');
    const keep = make(d.room, 'KeepDim', rect({ x: 16, y: 10 }, { x: 20, y: 14 }));
    keep.behavior.keepDimMargin = 5;
    const a = make(d.room, 'Ambient', d.room.floor[0]!.map((p) => ({ ...p })));
    a.behavior.alignToCeilingGrid = false;
    d.intents = [keep, a];
    solve(d, a);
    expect(a.fixtures.length).toBeGreaterThan(3);
    const zone = inflate(keep.region, 5);
    for (const f of a.fixtures) expect(contains(zone, f.center)).toBe(false);
    expect(a.trace.some((l) => l.includes('keep-dim'))).toBe(true);
  });

  /** The 20×20 "Open office" room of the keep-dim enforcement cases. */
  function keepRoom(fixtures: [number, number][], keepMax = 0.5) {
    const room = createRoom({
      label: 'Open office',
      floor: [rect({ x: 0, y: 0 }, { x: 20, y: 20 })],
      ceilingHeight: 9,
    });
    const keep = createIntent({
      kind: 'KeepDim',
      label: 'Screen — keep dim',
      region: rect({ x: 9, y: 9 }, { x: 11, y: 11 }),
      target: { minimum: null, average: null, maximum: keepMax },
    });
    const amb = createIntent({
      kind: 'Ambient',
      label: 'Open office ambient',
      region: rect({ x: 0, y: 0 }, { x: 20, y: 20 }),
      target: { minimum: 10, average: 20, maximum: 35 },
    });
    amb.fixtures = fixtures.map(([x, y]) =>
      createFixture({ intentId: amb.id, center: { x, y }, height: 9, mount: 'ceiling' }),
    );
    return { d: designOf(room, [keep, amb]), keep, amb };
  }

  it('KeepDim_RemovesTheNearestFixtureWhenItIsOverTheMaximum', () => {
    const { d, keep, amb } = keepRoom([
      [10, 13],
      [10, 7],
      [4, 4],
      [16, 16],
    ]);
    enforceKeepDim(d);
    expect(amb.fixtures.length).toBeLessThan(4);
    expect(amb.fixtures.length).toBeGreaterThanOrEqual(1);
    expect(keep.trace.some((l) => l.startsWith('Removed '))).toBe(true);
    for (const f of amb.fixtures) expect(f.output).toBe(1);
    const at = (x: number, y: number) => amb.fixtures.some((f) => f.center.x === x && f.center.y === y);
    expect(at(10, 13) && at(10, 7)).toBe(false);
  });

  it('KeepDim_MovesAnIntentsLastFixtureOutOfTheMarginInsteadOfRemovingIt', () => {
    const { d, keep, amb } = keepRoom([[10, 10]]);
    enforceKeepDim(d);
    expect(amb.fixtures).toHaveLength(1);
    const c = amb.fixtures[0]!.center;
    const margin = Math.min(4, 9 * Math.tan((30 * Math.PI) / 180));
    expect(margin).toBe(4);
    expect(contains(inflate(keep.region, margin), c)).toBe(false);
    expect(contains(amb.region, c)).toBe(true);
    expect(inRoom(d.room, c)).toBe(true);
    expect(amb.trace.some((l) => l.startsWith('Moved the last fixture'))).toBe(true);
  });

  it('KeepDim_KeepsTheLastFixtureAndReportsTheZoneIsOverItsMaximum', () => {
    const { d, keep, amb } = keepRoom([[16, 10]], 0.01);
    const touched = enforceKeepDim(d);
    expect(amb.fixtures.map((f) => f.center)).toEqual([{ x: 16, y: 10 }]);
    expect(touched.size).toBe(0);
    expect(keep.trace.some((l) => l.includes('keep-dim zone is over its maximum'))).toBe(true);
    expect(amb.trace.some((l) => l.includes('keep-dim zone is over its maximum'))).toBe(true);
    expect(keep.trace.at(-1)).toMatch(
      /^Keep-dim: Screen — keep dim still reads [\d.]+ fc against its 0 fc maximum, so the keep-dim zone is over its maximum\. The last fixture of Open office ambient stays, and fixtures cannot be dimmed\.$/,
    );
  });

  it('Solve_AnIntentWhoseWholeAreaIsInsideTheMarginStillGetsOneFixture', () => {
    const d = seeded('Office');
    const keep = make(d.room, 'KeepDim', rect({ x: 10, y: 8 }, { x: 20, y: 16 }));
    keep.behavior.keepDimMargin = 4;
    const task = make(d.room, 'Task', rect({ x: 13, y: 10 }, { x: 17, y: 14 }));
    d.intents = [keep, task];
    solveAll(d);
    expect(task.fixtures.length).toBeGreaterThanOrEqual(1);
    expect(task.trace.some((l) => l.includes('keep-dim'))).toBe(true);
  });
});

describe('solver.md §10 worked example (Office)', () => {
  const d = solved('Office');
  it('desk cluster C, wash, accent, ambient, meeting-table lean', () => {
    const c = d.intents[4]!;
    expect(c.trace[0]).toBe(
      'Desk cluster C task: lumen method for 30 fc over 60 ft² (CU 0.66, LLF 0.85) gives 2, rows pattern → 1 × 4 ft pendant linear, direct/indirect · 2000 lm.',
    );
    expect(c.fixtures.map((f) => [f.center.x, f.center.y, f.height, f.mount])).toEqual([[22, 5.75, 7.5, 'pendant']]);
    const amb = d.intents[0]!;
    expect(productOf(d.room, amb).lumens).toBe(1500);
    expect(amb.fixtures).toHaveLength(10);
    expect(amb.trace).toContain(
      'Open office ambient: Stepped down to 1,500 lm: 3,000 lm overshoots 35 fc at the fewest fixtures.',
    );
    const mt = d.intents[3]!;
    expect(mt.trace).toContain(
      'Meeting table task: leans to the bottom of its range (21.2 fc) because its light puts Screen — keep dim over its 5 fc maximum, and fixtures cannot be dimmed.',
    );
    expect(d.intents[7]!.trace).toContain(
      'Screen — keep dim: Meeting table task gives up light here (14.4 fc → 11.4 fc) to keep it under 5 fc.',
    );
    const acc = d.intents[6]!;
    expect(acc.target.average).toBe(74.1);
    expect(acc.targetReason).toBe('3× the surrounding ambient (24.7 fc)');
  });
  it('a lone Solve keeps the keep-dim lines flushed (no duplicates)', () => {
    const amb = d.intents[0]!;
    solve(d, amb);
    for (const i of d.intents) {
      const removed = i.trace.filter((l) => l.startsWith('Removed '));
      expect(new Set(removed).size).toBe(removed.length);
    }
  });
});
