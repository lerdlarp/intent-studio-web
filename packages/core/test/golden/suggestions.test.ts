// Golden parity: suggestions.ts seeds against handoff/golden (four demo rooms).
import { describe, expect, it } from 'vitest';
import { clusters } from '../../src/defaults';
import { seed } from '../../src/suggestions';
import { diffClose } from './compare';
import { GOLDEN_ROOMS, goldenPlane, goldenRoom, goldenRoomDerived, loadGolden } from './load';

const xy = (pts: { x: number; y: number }[]): { x: number; y: number }[] => pts.map((p) => ({ x: p.x, y: p.y }));

describe('golden: suggestions', () => {
  for (const name of GOLDEN_ROOMS) {
    describe(name, () => {
      const room = goldenRoom(name);
      const g = loadGolden(name);
      const s = seed(room);

      it('seed count and order of kinds/labels', () => {
        expect(s.map((i) => [i.kind, i.label])).toEqual(g.seeds.map((i) => [i.kind, i.label]));
      });

      it('every field matches golden (regions 1e-6, rest exact)', () => {
        const bad: string[] = [];
        g.seeds.forEach((raw, k) => {
          const a = s[k];
          if (!a) return void bad.push(`#${k} missing`);
          const tag = `#${k} ${raw.label}`;
          const exact = diffClose(
            {
              kind: a.kind,
              label: a.label,
              target: a.target,
              targetReason: a.targetReason,
              plane: a.plane,
              wallIndex: a.wallIndex,
              objectIndex: a.objectIndex,
              isSuggestion: a.isSuggestion,
              labelSuggested: a.labelSuggested,
              product: a.product,
              fixtures: a.fixtures,
              trace: a.trace,
              behavior: a.behavior,
            },
            {
              kind: raw.kind,
              label: raw.label,
              target: raw.target,
              targetReason: raw.targetReason,
              plane: goldenPlane(raw.plane),
              wallIndex: raw.wallIndex,
              objectIndex: raw.objectIndex,
              isSuggestion: raw.isSuggestion,
              labelSuggested: true,
              product: raw.product,
              fixtures: raw.fixtures ?? [],
              trace: raw.trace ?? [],
              behavior: raw.behavior,
            },
            { abs: 0 },
          );
          const region = diffClose(a.region, xy(raw.region), { abs: 1e-6 });
          bad.push(...[...exact, ...region].map((m) => `${tag} ${m}`));
        });
        expect(bad).toEqual([]);
      });

      it('room.clusters equals Clusters(room)', () => {
        const actual = clusters(room).map(({ group, ordinal, objects, region }) => ({
          group,
          ordinal,
          objects,
          region,
        }));
        const expected = goldenRoomDerived(name).clusters.map((c) => ({ ...c, region: xy(c.region) }));
        expect(diffClose(actual, expected, { abs: 1e-6 })).toEqual([]);
      });
    });
  }
});
