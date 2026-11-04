import { describe, expect, it } from 'vitest';
import { stableId } from '../src/hash';
import {
  createIntent,
  createProduct,
  productKey,
  type IntentKind,
  type LightingIntent,
  type ProductChoice,
  type RoomDesign,
  type TargetRange,
} from '../src/model';
import { rank } from '../src/ranker';
import { estimateOf, solveAll } from '../src/solver';
import { seeded } from './solver-helpers';
import { GOLDEN_ROOMS, type GoldenRoomName } from './golden/load';
import {
  all,
  allPackages,
  asProject,
  asProjectProduct,
  byFamily,
  FAMILY_IDS,
  genericFor,
  isNominal,
  packages,
  packagesOf,
  productOf,
  rememberPackage,
  targetStatus,
  type TargetStatus,
} from '../src/products';
import { cafeteria, dataHall, lobby, office } from '../src/fixtures/demo-rooms';

const nominal = (f: string) => byFamily(f)!;

describe('packages and families', () => {
  it('all has 11 nominals', () => {
    expect(all).toHaveLength(11);
    for (const p of all) {
      expect(p.isGeneric).toBe(true);
      expect(p.lumens).toBeGreaterThan(0);
      expect(p.watts).toBeGreaterThan(0);
    }
  });
  it('volumetric nominal', () => {
    expect(all[0]!.lumens).toBe(3000);
    expect(all[0]!.watts).toBe(25);
    expect(all[0]!.label).toBe('2×2 volumetric troffer · 3000 lm');
  });
  it('simple nominal facts', () => {
    expect(nominal('troffer').lumens).toBe(4000);
    expect(nominal('accent').beamAngle).toBe(25);
    expect(nominal('wallwash').asymmetric).toBe(true);
    expect(nominal('pendant-linear').uplightShare).toBeCloseTo(0.4, 9);
    expect(nominal('cove').uplightShare).toBeCloseTo(1, 9);
    expect(nominal('step').lumens).toBe(300);
  });
  it('every family is packaged', () => {
    for (const n of all) {
      const pk = packages(n.family);
      expect(pk.length).toBeGreaterThanOrEqual(3);
      expect(pk.map((p) => p.lumens)).toEqual([...pk.map((p) => p.lumens)].sort((a, b) => a - b));
      expect(new Set(pk.map(productKey)).size).toBe(pk.length);
      expect(new Set(pk.map((p) => p.label)).size).toBe(pk.length);
      for (const p of pk) {
        expect(p.isGeneric).toBe(true);
        expect(p.family).toBe(n.family);
        expect(p.label.endsWith(` · ${p.lumens} lm`)).toBe(true);
        const efficacy = p.lumens / p.watts;
        expect(efficacy).toBeGreaterThan(60);
        expect(efficacy).toBeLessThan(150);
      }
      expect(pk.map(productKey)).toContain(productKey(n));
    }
  });
  it('lumen lists', () => {
    expect(packages('pendant-linear').map((p) => p.lumens)).toEqual([2000, 3000, 4000]);
    expect(packages('volumetric').map((p) => p.lumens)).toEqual([1500, 2000, 3000, 4000, 5000]);
    expect(packages('downlight').map((p) => p.lumens)).toEqual([800, 1500, 2500]);
  });
  it('case-insensitive and unknown families', () => {
    expect(packages('VOLUMETRIC')).toEqual(packages('volumetric'));
    expect(packages('nope')).toEqual([]);
    expect(packages('')).toEqual([]);
  });
  it('allPackages size, order and nominal flags', () => {
    expect(allPackages).toHaveLength(41);
    expect(allPackages.filter(isNominal).map((p) => p.family)).toEqual([...FAMILY_IDS]);
  });
  it('keys', () => {
    expect(productKey(all[0]!)).toBe('generic:volumetric:3000');
  });
  it('descriptions carry a beam suffix only for round families', () => {
    expect(packages('downlight')[0]!.description).toBe('6 inch recessed downlight, 800 lm, 8 W, 60° beam');
    expect(packages('cove')[0]!.description).toBe('Cove linear per 4 ft, all light up, 800 lm, 7 W');
    expect(packages('pendant-linear')[0]!.description).toBe('4 ft suspended linear, 40% uplight, 2000 lm, 17 W');
  });
});

describe('genericFor', () => {
  const cases: [IntentKind, ReturnType<typeof office>, string][] = [
    ['Ambient', office(), 'volumetric'],
    ['Ambient', lobby(), 'downlight-ho'],
    ['Ambient', dataHall(), 'strip'],
    ['Task', office(), 'pendant-linear'],
    ['Task', cafeteria(), 'downlight'],
    ['WallWash', office(), 'wallwash'],
    ['Accent', lobby(), 'accent'],
    ['FeaturePendant', lobby(), 'pendant-can'],
    ['CeilingGlow', cafeteria(), 'cove'],
    ['Path', lobby(), 'downlight-ho'],
    ['Path', dataHall(), 'strip'],
    ['Task', dataHall(), 'strip'],
    ['KeepDim', office(), 'downlight'],
    ['KeepDim', dataHall(), 'downlight'],
  ];
  for (const [kind, room, fam] of cases) {
    it(`${kind} in ${room.label} -> ${fam}`, () => {
      expect(genericFor(kind, room).family).toBe(fam);
    });
  }
  it('KeepDim nominal label (golden Office keep-dim)', () => {
    expect(genericFor('KeepDim', office()).label).toBe('6″ downlight · 1500 lm');
  });
});

describe('demo project', () => {
  it('is stable and complete', () => {
    const a = asProject();
    const b = asProject();
    expect(a).toBe(b);
    expect(a).toHaveLength(allPackages.length);
    for (const p of a) {
      expect(p.productId).not.toBeNull();
      expect(p.isGeneric).toBe(false);
    }
    expect(new Set(a.map((p) => p.productId)).size).toBe(a.length);
  });
  it('nominal first, keeps family id', () => {
    for (const f of FAMILY_IDS) {
      const first = asProject().find((p) => p.family === f)!;
      expect(first.productId).toBe(stableId(f));
      expect(first.lumens).toBe(byFamily(f)!.lumens);
    }
  });
  it('packagesOf demo products', () => {
    for (const f of FAMILY_IDS) {
      const first = asProject().find((p) => p.family === f)!;
      expect(packagesOf(first)).toHaveLength(packages(f).length);
    }
  });
  it('asProjectProduct', () => {
    const p = asProjectProduct(packages('downlight')[0]!);
    expect(p.lumens).toBe(800);
    expect(p.productId).not.toBeNull();
  });
  it('real product has no packages', () => {
    const real = createProduct({ ...packages('downlight')[0]!, productId: stableId('uploaded'), isGeneric: false, catalog: 'Uploaded' });
    expect(packagesOf(real)).toEqual([]);
  });
  it('catalog naming', () => {
    const p = asProject().find((q) => q.family === 'downlight-ho')!;
    expect(p.catalog).toBe('DEMO-DOWNLIGHT-HO');
    expect(p.brand).toBe('Demo');
  });
  it('stableId vectors', () => {
    const vectors: [string, string][] = [
      ['downlight', '8713baa4-22dc-51c2-6e01-fb595b1d00b5'],
      ['existing-lobby-0', '8a105443-3344-103a-4577-087e27d5e99c'],
      ['volumetric', '4d8c8455-d245-9b55-2540-05adbe812031'],
      ['troffer', '0ad75c6a-2bcc-d685-0f64-43a11538fc65'],
      ['downlight-ho', 'c1d547cc-c447-318e-5009-d4ea1ff9529f'],
      ['wallwash', '4259a34b-56c2-8dda-5677-3b98c452fff4'],
      ['accent', '77e4a964-9948-6848-2d81-6576f8121617'],
      ['pendant-linear', 'c72e82af-e699-c62e-07d5-1997453b42f7'],
      ['pendant-can', '6f202738-d59d-7cf4-1820-3dc9c8515a5b'],
      ['cove', '11e94b02-bda1-3c05-2e63-158248bb3ca8'],
      ['strip', '1d32d533-2612-b703-c987-85b950d558e3'],
      ['step', 'd254d04c-300e-62e2-3a0f-4dcb0fba3b5a'],
      ['volumetric:1500', 'cea7810f-fe18-3df7-716c-2fedfe4c6154'],
      ['downlight:2500', 'bda914ed-d90a-07fa-6fa5-2da69b018baa'],
    ];
    for (const [text, id] of vectors) expect(stableId(text)).toBe(id);
  });
});

describe('productOf / settled package', () => {
  const room = office();
  const choice = (): ProductChoice => ({ product: nominal('accent'), agentPicked: false, reason: '', alternatives: [] });
  it('choice wins', () => {
    const i = createIntent({ kind: 'Ambient', product: choice() });
    rememberPackage(i, nominal('cove'));
    expect(productOf(room, i)).toBe(i.product!.product);
  });
  it('settled next, removal, default', () => {
    const i = createIntent({ kind: 'Ambient' });
    expect(productOf(room, i)).toBe(genericFor('Ambient', room));
    const x = packages('volumetric')[0]!;
    rememberPackage(i, x);
    expect(productOf(room, i)).toBe(x);
    rememberPackage(i, null);
    expect(productOf(room, i)).toBe(genericFor('Ambient', room));
  });
  it('is keyed by object identity', () => {
    const a = createIntent({ id: 'same', kind: 'Ambient' });
    const b = createIntent({ id: 'same', kind: 'Ambient' });
    rememberPackage(a, packages('volumetric')[0]!);
    expect(productOf(room, b)).toBe(genericFor('Ambient', room));
  });
});

describe('targetStatus (inspector rule)', () => {
  const t = (minimum: number | null, average: number | null, maximum: number | null) => ({ minimum, average, maximum });
  it('classifies', () => {
    expect(targetStatus(t(30, null, null), 29.3)).toBe('Under');
    expect(targetStatus(t(30, null, null), 29.4)).toBe('Meets');
    expect(targetStatus(t(null, 30, null), 26.9)).toBe('Under');
    expect(targetStatus(t(null, 30, null), 27)).toBe('Meets');
    expect(targetStatus(t(null, null, 20), 20.4)).toBe('Meets');
    expect(targetStatus(t(null, null, 20), 20.5)).toBe('Over');
    expect(targetStatus(t(null, null, null), 5)).toBe('Meets');
  });
});

describe('solver-level package behaviour (solver wave)', () => {
  type Flow = 'generic' | 'ranked';
  const FLOWS: Flow[] = ['generic', 'ranked'];
  /** Accept every seed; ranked flow: product = rank(room, intent, asProject()); then solveAll. */
  function flow(name: GoldenRoomName, kind: Flow, tweak?: (d: RoomDesign) => void): RoomDesign {
    const d = seeded(name);
    if (kind === 'ranked') for (const i of d.intents) i.product = rank(d.room, i, asProject());
    tweak?.(d);
    solveAll(d);
    return d;
  }
  /** Inspector rule plus the test's extra Over: no maximum, an average a and estimate > 1.3·a. */
  function status(t: TargetRange, avg: number): TargetStatus {
    const s0 = targetStatus(t, avg);
    if (s0 === 'Meets' && t.maximum === null && t.average !== null && avg > 1.3 * t.average) return 'Over';
    return s0;
  }
  const targeted = (i: LightingIntent) => i.target.minimum !== null || i.target.average !== null || i.target.maximum !== null;
  const ambientOf = (d: RoomDesign) => d.intents.find((i) => i.kind === 'Ambient')!;

  for (const name of GOLDEN_ROOMS) {
    for (const kind of FLOWS) {
      it(`most intents meet target: ${name} ${kind}`, () => {
        const d = flow(name, kind);
        const ts = d.intents.filter(targeted);
        expect(ts.length).toBeGreaterThanOrEqual(1);
        const meets = ts.filter((i) => status(i.target, estimateOf(d, i).average) === 'Meets').length;
        expect(meets / ts.length).toBeGreaterThanOrEqual(0.75);
      });
      it(`no needless overshoot: ${name} ${kind}`, () => {
        const d = flow(name, kind);
        const capped = d.intents.filter((i) => i.fixtures.length > 0 && i.target.maximum !== null);
        expect(capped.length).toBeGreaterThanOrEqual(1);
        for (const i of capped) {
          if (estimateOf(d, i).average <= i.target.maximum! * 1.02) continue;
          const p = productOf(d.room, i);
          expect(packagesOf(p).some((q) => q.lumens < p.lumens - 0.5), `${name} ${i.label}`).toBe(false);
        }
      });
    }
  }

  it('ranked: other packages first (Office first Ambient; alternatives lead with the sibling packages)', () => {
    const d = seeded('Office');
    const amb = ambientOf(d);
    const choice = rank(d.room, amb, asProject());
    const key = productKey(choice.product);
    const siblings = packagesOf(choice.product).filter((p) => productKey(p) !== key);
    expect(siblings.length).toBeGreaterThan(1);
    expect(choice.alternatives.slice(0, siblings.length).map(productKey)).toEqual(siblings.map(productKey));
    expect(choice.alternatives.map(productKey)).not.toContain(key);
    expect(choice.alternatives.length).toBeLessThanOrEqual(8);
    const g = rank(d.room, amb, []);
    expect(g.product.isGeneric).toBe(true);
    const gs = packages(g.product.family).filter((p) => productKey(p) !== productKey(g.product));
    expect(g.alternatives.slice(0, gs.length).map(productKey)).toEqual(gs.map(productKey));
  });

  it('ranked: steps down and says why ("Stepped down to", "overshoots 35 fc at the fewest fixtures")', () => {
    const d = flow('Office', 'ranked');
    const amb = ambientOf(d);
    expect(amb.product!.agentPicked).toBe(true);
    expect(productOf(d.room, amb).lumens).toBeLessThan(3000);
    expect(amb.trace.some((l) => l.includes('Stepped down to') && l.includes('overshoots 35 fc at the fewest fixtures'))).toBe(true);
    const alts = amb.product!.alternatives;
    expect(alts.map((p) => p.lumens)).toContain(3000);
    for (const p of alts.slice(0, 4)) expect(p.family).toBe(amb.product!.product.family);
    expect(amb.product!.reason).toContain('the one whose fixture count lands closest to the target');
  });

  it('generic: package kept out of the intent (product absent; "no product chosen yet" trace)', () => {
    const d = flow('Office', 'generic');
    for (const i of d.intents) expect(i.product).toBeNull();
    const amb = ambientOf(d);
    expect(productOf(d.room, amb).lumens).toBe(1500);
    expect(amb.fixtures).toHaveLength(10);
    expect(amb.trace.some((l) => l.startsWith(`${amb.label}: no product chosen yet`))).toBe(true);
  });

  it('designer choice never changed ("package of this family would land closer")', () => {
    const nominalVol = byFamily('volumetric')!;
    const d = flow('Office', 'generic', (x) => {
      ambientOf(x).product = { product: nominalVol, agentPicked: false, reason: 'Chosen by you', alternatives: [] };
    });
    const amb = ambientOf(d);
    expect(amb.product!.product).toBe(nominalVol);
    expect(amb.product!.agentPicked).toBe(false);
    expect(amb.product!.reason).toBe('Chosen by you');
    expect(amb.trace.some((l) => l.includes('Stepped'))).toBe(false);
    expect(amb.trace.some((l) => l.includes('package of this family would land closer'))).toBe(true);
  });

  it('real product kept ("pick a lower-output product")', () => {
    const real = {
      ...byFamily('volumetric')!,
      productId: stableId('uploaded-volumetric'),
      isGeneric: false,
      catalog: 'Uploaded',
      brand: 'Uploaded',
      label: 'Uploaded 2x2 3000',
    };
    const d = flow('Office', 'generic', (x) => {
      ambientOf(x).product = { product: real, agentPicked: true, reason: 'Agent pick', alternatives: [] };
    });
    const amb = ambientOf(d);
    expect(amb.product!.product).toBe(real);
    expect(amb.product!.reason).toBe('Agent pick');
    expect(amb.trace.some((l) => l.includes('Stepped'))).toBe(false);
    expect(amb.trace.some((l) => l.includes('pick a lower-output product'))).toBe(true);
  });

  it("ambient counts others' light", () => {
    const all = flow('Office', 'generic');
    const alone = flow('Office', 'generic', (x) => {
      x.intents = x.intents.filter((i) => i.kind === 'Ambient');
    });
    const lm = (d: RoomDesign) => ambientOf(d).fixtures.length * productOf(d.room, ambientOf(d)).lumens;
    expect(lm(all)).toBeLessThan(lm(alone));
  });

  it('deterministic and stable (ranked flow solved twice)', () => {
    for (const name of GOLDEN_ROOMS) {
      const pairs = (d: RoomDesign) => d.intents.map((i) => [productKey(productOf(d.room, i)), i.fixtures.length]);
      const a = flow(name, 'ranked');
      const b = flow(name, 'ranked');
      expect(pairs(a)).toEqual(pairs(b));
      const before = pairs(a);
      solveAll(a);
      expect(pairs(a)).toEqual(before);
    }
  });
});
