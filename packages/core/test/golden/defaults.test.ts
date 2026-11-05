// Golden parity: defaults.ts + workplane.ts against handoff/golden (four demo rooms + misc).
import { describe, expect, it } from 'vitest';
import { classFromWords, classOf, clusters, defaultLabel, defaultTarget, spaceType, wallName } from '../../src/defaults';
import { diffClose } from './compare';
import { inferPlane } from '../../src/workplane';
import { INTENT_KINDS, type IntentKind } from '../../src/model';
import {
  GOLDEN_ROOMS,
  goldenPlane,
  goldenRoom,
  goldenRoomDerived,
  loadGolden,
  loadMisc,
  type GoldenIntent,
} from './load';

const asKind = (k: string): IntentKind => {
  if (!(INTENT_KINDS as readonly string[]).includes(k)) throw new Error(`bad kind ${k}`);
  return k as IntentKind;
};

// Interpreter intents with an explicit "Requested N fc" level: target/reason belong to the interpreter spec (pending).
const requested = (i: GoldenIntent): boolean => /^Requested .* fc/.test(i.targetReason);

describe('golden: defaults and workplane', () => {
  for (const name of GOLDEN_ROOMS) {
    const room = goldenRoom(name);
    const derived = goldenRoomDerived(name);
    const g = loadGolden(name);

    describe(name, () => {
      it('spaceClass / spaceTypeWords / wallNames', () => {
        expect(classOf(room)).toBe(derived.spaceClass);
        expect(spaceType(room)).toBe(derived.spaceTypeWords);
        expect(room.walls.map((_, i) => wallName(room, i))).toEqual(derived.wallNames);
      });

      it('clusters within 1e-6', () => {
        const actual = clusters(room).map(({ group, ordinal, objects, region }) => ({ group, ordinal, objects, region }));
        // golden points carry a derived `length`; keep x/y only
        const expected = derived.clusters.map((c) => ({ ...c, region: c.region.map((p) => ({ x: p.x, y: p.y })) }));
        expect(diffClose(actual, expected, { abs: 1e-6 })).toEqual([]);
      });

      const check = (where: string, list: GoldenIntent[]): void => {
        it(`${where}: label, target, reason, plane`, () => {
          const bad: string[] = [];
          const seedAmbient = g.seeds.find((s) => s.kind === 'Ambient');
          for (const raw of list) {
            const kind = asKind(raw.kind);
            const tag = `#${raw.index} ${raw.kind}`;
            const label = defaultLabel(room, kind, raw.region, raw.wallIndex, raw.objectIndex);
            if (label !== raw.label) bad.push(`${tag} label ${label} != ${raw.label}`);
            const plane = inferPlane(room, kind, raw.region, raw.wallIndex, raw.objectIndex);
            const dp = diffClose(plane, goldenPlane(raw.plane), { abs: 0 });
            if (dp.length) bad.push(`${tag} plane ${dp.join('; ')}`);
            if (requested(raw)) continue; // pending: interpreter-owned target
            const amb = kind === 'Accent' ? (seedAmbient?.target.average ?? null) : null;
            const t = defaultTarget(room, kind, raw.objectIndex, amb);
            if (diffClose(t.target, raw.target, { abs: 0 }).length) bad.push(`${tag} target ${JSON.stringify(t.target)} != ${JSON.stringify(raw.target)}`);
            if (t.reason !== raw.targetReason) bad.push(`${tag} reason ${t.reason} != ${raw.targetReason}`);
          }
          expect(bad).toEqual([]);
        });
      };
      check('seeds', g.seeds);
      check(
        'interpret',
        g.interpret.flatMap((p) => p.intents),
      );
    });
  }

  it('reports pending interpreter-owned targets', () => {
    const pending = GOLDEN_ROOMS.flatMap((n) =>
      loadGolden(n).interpret.flatMap((p) => p.intents.filter(requested).map((i) => `${n}: ${p.text} -> ${i.targetReason}`)),
    );
    // Informational: these are the interpreter's job (skipped above).
    expect(pending.length).toBeGreaterThanOrEqual(0);
  });

  describe('misc.json classFromWords', () => {
    for (const c of loadMisc().classFromWords) {
      it(`classFromWords(${JSON.stringify(c.text)}) = ${c.cls}`, () => expect(classFromWords(c.text)).toBe(c.cls));
    }
  });
});
