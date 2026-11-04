// Golden parity (handoff/golden, see its README). One `describe` block per module; later waves add theirs here or in
// test/golden/<module>.test.ts using the loader in test/golden/load.ts.
import { describe, expect, it } from 'vitest';
import { StudioRoomSchema, demoRoom, feetInches } from '../src/index';
import { diffClose } from './golden/compare';
import { GOLDEN_ROOMS, goldenIntent, goldenRoom, loadGolden, loadMisc } from './golden/load';

describe('golden: demo rooms', () => {
  for (const name of GOLDEN_ROOMS) {
    it(`${name} parses through StudioRoomSchema`, () => {
      expect(StudioRoomSchema.safeParse(loadGolden(name).room).success).toBe(true);
    });
    it(`${name} demo room equals golden room within 1e-6`, () => {
      expect(diffClose(demoRoom(name), goldenRoom(name), { abs: 1e-6 })).toEqual([]);
    });
    it(`${name} demo room is bit-identical with golden room`, () => {
      expect(demoRoom(name)).toStrictEqual(goldenRoom(name));
    });
    it(`${name} golden intents (seeds, interpret, solved) map into the model`, () => {
      const g = loadGolden(name);
      const all = [...g.seeds, ...g.interpret.flatMap((p) => p.intents), ...g.solved.map((s) => s.intent)];
      for (const raw of all) {
        const intent = goldenIntent(raw);
        expect(intent.kind).toBe(raw.kind);
        expect(intent.fixtures.length).toBe(raw.fixtures?.length ?? 0);
      }
    });
  }
});

describe('golden: misc feetInches', () => {
  for (const c of loadMisc().feetInches) {
    it(`feetInches(${c.feet}) = ${c.text}`, () => expect(feetInches(c.feet)).toBe(c.text));
  }
});
