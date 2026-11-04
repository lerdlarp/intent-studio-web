import { describe, expect, it } from 'vitest';
import { allPackages, isNominal, packages, familyIdOf } from '../../src/products';
import { GOLDEN_ROOMS, loadGolden, loadMisc } from './load';

describe('golden: generic packages', () => {
  it('allPackages equals misc.json genericPackages field for field', () => {
    const g = loadMisc().genericPackages;
    expect(allPackages).toHaveLength(g.length);
    allPackages.forEach((p, i) => {
      const e = g[i]!;
      expect({
        family: p.family, label: p.label, description: p.description, lumens: p.lumens, watts: p.watts,
        length: p.length, width: p.width, isRound: p.isRound, beamAngle: p.beamAngle,
        uplightShare: p.uplightShare, asymmetric: p.asymmetric, nominal: isNominal(p),
      }).toEqual({
        family: e.family, label: e.label, description: e.description, lumens: e.lumens, watts: e.watts,
        length: e.length, width: e.width, isRound: e.isRound, beamAngle: e.beamAngle,
        uplightShare: e.uplightShare, asymmetric: e.asymmetric, nominal: e.nominal,
      });
    });
  });
  for (const name of GOLDEN_ROOMS) {
    it(`${name}: every solved product resolves to a known generic package`, () => {
      for (const s of loadGolden(name).solved) {
        const p = s.intent.product;
        if (!p) continue;
        expect(familyIdOf(p.family), `${name} #${s.intent.index} family`).not.toBeNull();
        const match = packages(p.family).find((q) => q.lumens === p.lumens);
        expect(match, `${name} #${s.intent.index} ${p.label}`).toBeDefined();
        expect(match!.label).toBe(p.label);
        expect(match!.watts).toBe(p.watts);
        expect(match!.beamAngle).toBe(p.beamAngle);
        expect(p.isGeneric).toBe(true);
      }
    });
  }
});
