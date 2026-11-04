// Golden parity: interpreter.ts (every golden `interpret` phrase) and fallback-ai.ts (`fallbackAdvice` per seed).
import { describe, expect, it } from 'vitest';
import { interpret } from '../../src/interpreter';
import { advise } from '../../src/fallback-ai';
import { seed } from '../../src/suggestions';
import { diffClose } from './compare';
import { GOLDEN_ROOMS, goldenIntent, goldenPlane, goldenRoom, loadGolden } from './load';
import type { LightingIntent } from '../../src/model';

const view = (i: LightingIntent) => ({
  kind: i.kind,
  label: i.label,
  region: i.region.map((p) => ({ x: p.x, y: p.y })),
  wallIndex: i.wallIndex,
  objectIndex: i.objectIndex,
  target: i.target,
  targetReason: i.targetReason,
  plane: i.plane,
  behavior: i.behavior,
  isSuggestion: i.isSuggestion,
});

describe('golden: interpret', () => {
  for (const name of GOLDEN_ROOMS) {
    const room = goldenRoom(name);
    for (const entry of loadGolden(name).interpret) {
      it(`${name}: "${entry.text}"`, () => {
        const actual = interpret(room, entry.text).map(view);
        const expected = entry.intents.map((g) => view(goldenIntent(g)));
        expect(diffClose(actual, expected, { abs: 1e-6 })).toEqual([]);
        // exact strings and indices (diffClose already compares them exactly; keep the intent explicit)
        expect(actual.map((a) => [a.kind, a.label, a.targetReason, a.wallIndex, a.objectIndex])).toEqual(
          expected.map((e) => [e.kind, e.label, e.targetReason, e.wallIndex, e.objectIndex]),
        );
      });
    }
  }
});

describe('golden: fallbackAdvice', () => {
  for (const name of GOLDEN_ROOMS) {
    const room = goldenRoom(name);
    const g = loadGolden(name);
    const expected = g.fallbackAdvice.map((a) => ({
      label: a.label,
      target: a.target,
      plane: goldenPlane(a.plane),
      reason: a.reason,
    }));
    const strip = (xs: ReturnType<typeof advise>) =>
      xs.map(({ label, target, plane, reason }) => ({ label, target, plane, reason }));

    it(`${name}: advise(golden seeds) matches exactly`, () => {
      const seeds = g.seeds.map(goldenIntent);
      const advice = advise(room, seeds);
      expect(advice.map((a) => a.intentId)).toEqual(seeds.map((s) => s.id));
      expect(diffClose(strip(advice), expected, { abs: 0 })).toEqual([]);
    });

    it(`${name}: advise(seed(room)) matches exactly`, () => {
      expect(diffClose(strip(advise(room, seed(room))), expected, { abs: 0 })).toEqual([]);
    });

    it(`${name}: advice equals each seed's own label/target/reason/plane`, () => {
      const advice = advise(room, g.seeds.map(goldenIntent));
      g.seeds.forEach((s, i) => {
        expect(advice[i]!.label).toBe(s.label);
        expect(advice[i]!.reason).toBe(s.targetReason);
        expect(advice[i]!.target).toEqual(s.target);
        expect(advice[i]!.plane).toEqual(goldenPlane(s.plane));
      });
    });
  }
});
