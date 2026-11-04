// Golden parity for the quick estimate (spec/estimate.md): misc exponents, every solved intent's estimate, probes,
// power. Products are rebuilt from golden data (solved product summary → misc.json genericPackages by family+lumens),
// so this test does not depend on products.ts.
import { describe, expect, it } from 'vitest';
import { createProduct, type LightingIntent, type RoomDesign, type StudioProduct } from '../../src/model';
import {
  buildSources,
  estimate,
  estimateAll,
  exponent,
  floorArea,
  illuminance,
  power,
  type ProductResolver,
} from '../../src/estimate';
import { GOLDEN_ROOMS, goldenIntent, goldenRoom, loadGolden, loadMisc, type GoldenRoomName } from './load';

declare const performance: { now(): number };

const REL = 1e-6;
const relErr = (a: number, e: number): number => (a === e ? 0 : Math.abs(a - e) / Math.max(Math.abs(e), 1e-300));

/** Full product data for a golden product summary (family + lumens). */
function goldenPackage(family: string, lumens: number): StudioProduct {
  const pkg = loadMisc().genericPackages.find((p) => p.family === family && p.lumens === lumens);
  if (!pkg) throw new Error(`no golden package ${family} ${lumens}`);
  const { nominal: _n, ...fields } = pkg;
  return createProduct({ ...fields, catalog: 'Generic', brand: 'Generic', isGeneric: true });
}

/** The solved golden design of a room plus a resolver returning each intent's golden product. */
function goldenSolvedDesign(name: GoldenRoomName): { design: RoomDesign; productOf: ProductResolver } {
  const g = loadGolden(name);
  const products = new Map<LightingIntent, StudioProduct>();
  const intents = g.solved.map((s) => {
    const intent = goldenIntent(s.intent);
    const p = s.intent.product;
    if (p) products.set(intent, goldenPackage(p.family, p.lumens));
    return intent;
  });
  const design: RoomDesign = {
    room: goldenRoom(name),
    intents,
    removedExisting: [],
    calculation: null,
    revision: 0,
  };
  return { design, productOf: (_room, intent) => products.get(intent) ?? null };
}

let maxErr = 0;

describe('golden: estimate exponents', () => {
  for (const { beam, n } of loadMisc().exponents) {
    it(`exponent(${beam})`, () => {
      const err = relErr(exponent(beam), n);
      maxErr = Math.max(maxErr, err);
      expect(err).toBeLessThanOrEqual(REL);
    });
  }
});

describe('golden: estimates, probes, power', () => {
  for (const name of GOLDEN_ROOMS) {
    const g = loadGolden(name);
    const { design, productOf } = goldenSolvedDesign(name);

    it(`${name} solved estimates (estimate and estimateAll)`, () => {
      const all = estimateAll(design, productOf);
      g.solved.forEach((s, i) => {
        const intent = design.intents[i]!;
        for (const e of [estimate(design, intent, productOf), all.get(intent.id)!]) {
          for (const k of ['average', 'minimum', 'maximum'] as const) {
            const err = relErr(e[k], s.estimate[k]);
            maxErr = Math.max(maxErr, err);
            expect(err, `${name}[${i}].${k}: ${e[k]} vs ${s.estimate[k]}`).toBeLessThanOrEqual(REL);
          }
          expect(e.fixtures).toBe(s.estimate.fixtures);
          expect(e.watts).toBe(s.estimate.watts);
        }
      });
    });

    it(`${name} probes`, () => {
      const set = buildSources(design, productOf);
      for (const p of g.probes) {
        const fc = illuminance(set, p.point, p.normal);
        const err = relErr(fc, p.fc);
        maxErr = Math.max(maxErr, err);
        expect(err, `${JSON.stringify(p.point)}: ${fc} vs ${p.fc}`).toBeLessThanOrEqual(REL);
      }
    });

    it(`${name} power`, () => {
      const pw = power(design, productOf);
      expect(pw.watts).toBe(g.power.watts);
      expect(Math.abs(pw.lpd - g.power.lpdWPerFt2)).toBeLessThanOrEqual(1e-9);
      expect(floorArea(design.room)).toBe(g.power.floorAreaFt2);
    });
  }

  it('reports the largest relative error', () => {
    console.log(`estimate golden max relative error: ${maxErr}`);
    expect(maxErr).toBeLessThanOrEqual(REL);
  });
});

describe('golden: estimateAll timing', () => {
  it('largest golden room (by sample work) estimates quickly', () => {
    let worst = { name: '', ms: 0 };
    for (const name of GOLDEN_ROOMS) {
      const { design, productOf } = goldenSolvedDesign(name);
      estimateAll(design, productOf); // warm-up
      const runs = 20;
      const t0 = performance.now();
      for (let r = 0; r < runs; r++) estimateAll(design, productOf);
      const ms = (performance.now() - t0) / runs;
      console.log(`estimateAll ${name}: ${ms.toFixed(3)} ms`);
      if (ms > worst.ms) worst = { name, ms };
    }
    expect(worst.ms).toBeLessThan(250);
  });
});
