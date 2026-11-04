import { describe, expect, it } from 'vitest';
import { cafeteria, dataHall, lobby, office } from '../src/fixtures/demo-rooms';
import { createIntent, createProduct, productInProject, productKey, type IntentKind, type LightingIntent, type StudioProduct } from '../src/model';
import { asProject, FAMILY_IDS, genericFor, packages } from '../src/products';
import { family, familyFit, familyWord, MAX_ALTERNATIVES, needLumens, rank } from '../src/ranker';
import { GOLDEN_ROOMS, goldenIntent, loadGolden, type GoldenRoomName } from './golden/load';

const rooms = { Office: office(), Cafeteria: cafeteria(), Lobby: lobby(), DataHall: dataHall() };
const seeds = (name: GoldenRoomName): LightingIntent[] => loadGolden(name).seeds.map(goldenIntent);
const seeded = (name: GoldenRoomName, kind: IntentKind, nth = 0): LightingIntent | undefined =>
  seeds(name).filter((i) => i.kind === kind)[nth];
const P = (f: string): StudioProduct => asProject().find((p) => p.family === f)!;
const demo = (f: string, lumens: number): StudioProduct => asProject().find((p) => p.family === f && p.lumens === lumens)!;

const plain = (label: string, description: string, lumens: number, watts: number, length: number, width: number, isRound: boolean, beam = 90, up = 0, asym = false) =>
  createProduct({ label, catalog: label, description, lumens, watts, length, width, isRound, beamAngle: beam, uplightShare: up, asymmetric: asym });

describe('family()', () => {
  const cases: [string, StudioProduct, string][] = [
    ['wash words', plain('EVO6 WW', '6 in recessed wall washer', 1500, 14, 0.65, 0.65, true, 90), 'wallwash'],
    ['asymmetric', plain('X', 'recessed', 1500, 14, 0.65, 0.65, true, 90, 0, true), 'wallwash'],
    ['2x2', plain('2BLT2', '2x2 LED troffer', 3200, 26, 2, 2, false), 'volumetric'],
    ['2x4', plain('2BLT4', '2x4 LED troffer', 4800, 38, 4, 2, false), 'troffer'],
    ['6 in downlight', plain('LBR6', '6 in LED downlight', 1800, 16, 0.65, 0.65, true, 80), 'downlight'],
    ['4 in narrow', plain('LBR4', '4 in LED downlight', 2800, 22, 0.45, 0.45, true, 40), 'downlight-ho'],
    ['suspended linear', plain('S4PID', '4 ft suspended direct/indirect', 4000, 32, 4, 0.35, false, 110, 0.4), 'pendant-linear'],
    ['cylinder', plain('CYL', 'Cylinder pendant', 1800, 18, 0.8, 0.8, true, 60), 'pendant-can'],
    ['cove beats strip', plain('CVX', 'Cove strip', 1600, 14, 4, 0.3, false, 180, 1), 'cove'],
    ['gimbal', plain('ACC', 'Adjustable gimbal', 900, 9, 0.4, 0.4, true, 25), 'accent'],
    ['strip', plain('STR', 'LED strip', 4000, 30, 4, 0.4, false), 'strip'],
    ['bright small', plain('HB', '2500 lm downlight', 2500, 20, 0.45, 0.45, true, 40), 'downlight-ho'],
  ];
  for (const [name, p, expected] of cases) it(name, () => expect(family(p)).toBe(expected));
  it('trusts own family', () => {
    for (const p of [...asProject(), ...FAMILY_IDS.map((f) => packages(f)[0]!)]) expect(family(p)).toBe(p.family);
  });
});

describe('familyWord / familyFit', () => {
  it('words', () => {
    expect(familyWord('downlight-ho')).toBe('downlight');
    expect(familyWord('x')).toBe('luminaire');
  });
  it('fits', () => {
    expect(familyFit(rooms.Office, 'Ambient', 'volumetric')).toBe(1.0);
    expect(familyFit(rooms.Lobby, 'Ambient', 'downlight')).toBe(0.55);
    expect(familyFit(rooms.DataHall, 'Task', 'strip')).toBe(1.0);
    expect(familyFit(rooms.Cafeteria, 'KeepDim', 'cove')).toBe(0.5);
  });
});

describe('rank()', () => {
  it('project downlight for office task', () => {
    const t = seeded('Office', 'Task')!;
    const dl = demo('downlight', 2500);
    const r = rank(rooms.Office, t, [dl, P('cove'), P('wallwash')]);
    expect(r.product.productId).toBe(dl.productId);
    expect(r.agentPicked).toBe(true);
    expect(r.reason).toBe('In your project · 2,500 lm downlight, 60° beam suits task light under a 9′ ceiling');
    expect(r.alternatives.length).toBeLessThanOrEqual(MAX_ALTERNATIVES);
    expect(r.alternatives.map(productKey)).not.toContain(productKey(r.product));
    expect(r.alternatives.map((a) => a.label)).toEqual([
      demo('downlight', 800).label,
      demo('downlight', 1500).label,
      '4 ft pendant linear, direct/indirect · 4000 lm',
    ]);
    expect(r.alternatives[0]!.productId).toBe(demo('downlight', 800).productId);
  });
  it('wall washer for a wash', () => {
    const r = rank(rooms.Office, seeded('Office', 'WallWash')!, [P('downlight'), P('troffer'), P('wallwash'), P('accent')]);
    expect(family(r.product)).toBe('wallwash');
    expect(productInProject(r.product)).toBe(true);
  });
  it('whole project, Cafeteria', () => {
    const want: [IntentKind, string, number][] = [
      ['WallWash', 'wallwash', 1500],
      ['Accent', 'accent', 450],
      ['FeaturePendant', 'pendant-can', 1000],
      ['CeilingGlow', 'cove', 1600],
    ];
    for (const [kind, fam, lm] of want) {
      const i = seeded('Cafeteria', kind);
      if (!i) continue;
      const r = rank(rooms.Cafeteria, i, asProject());
      expect(family(r.product)).toBe(fam);
      expect(r.product.lumens).toBe(lm);
    }
  });
  it('project then generic', () => {
    const r = rank(rooms.Office, seeded('Office', 'Ambient')!, [P('volumetric'), P('troffer'), P('downlight')]);
    expect(r.product.productId).toBe(demo('volumetric', 3000).productId);
    expect(r.alternatives.map((a) => a.label)).toEqual([
      ...[1500, 2000, 4000, 5000].map((l) => demo('volumetric', l).label),
      P('troffer').label,
      P('downlight').label,
      '2×2 volumetric troffer · 3000 lm',
    ]);
    expect(r.alternatives.at(-1)!.isGeneric).toBe(true);
  });
  it('nothing -> stand-in', () => {
    for (const name of GOLDEN_ROOMS) {
      for (const i of seeds(name)) {
        const r = rank(rooms[name], i, []);
        if (i.kind === 'KeepDim') {
          expect(r.agentPicked).toBe(false);
          expect(r.alternatives).toEqual([]);
          expect(r.product).toEqual(genericFor('KeepDim', rooms[name]));
          expect(r.reason).toBe('Keep dim places no fixtures');
        } else {
          expect(r.product.isGeneric).toBe(true);
          expect(r.reason.startsWith('Generic stand-in')).toBe(true);
        }
      }
    }
  });
  it('never a cove for a task', () => {
    const r = rank(rooms.Office, seeded('Office', 'Task')!, [P('cove')]);
    expect(r.product.isGeneric).toBe(true);
    expect(r.product.label).toBe('4 ft pendant linear, direct/indirect · 4000 lm');
    expect(r.alternatives.map((a) => a.lumens)).toEqual([2000, 3000]);
    expect(r.alternatives.every((a) => !(productInProject(a) && family(a) === 'cove'))).toBe(true);
  });
  it('other packages first', () => {
    const r = rank(rooms.Office, seeded('Office', 'Ambient')!, asProject());
    expect(r.product.productId).toBe(demo('volumetric', 3000).productId);
    expect(r.reason).toBe('In your project · 3,000 lm volumetric troffer, 120° beam suits a 9′ ceiling');
    expect(r.alternatives.map((a) => a.label)).toEqual([
      ...[1500, 2000, 4000, 5000].map((l) => demo('volumetric', l).label),
      '2×4 troffer · 3000 lm',
      '6″ downlight · 2500 lm',
      '4 ft pendant linear, direct/indirect · 3000 lm',
      '4″ high-output downlight · 2500 lm',
    ]);
    expect(r.alternatives).toHaveLength(8);
  });
  it('reason names lumens and ceiling', () => {
    const r = rank(rooms.DataHall, seeded('DataHall', 'Task')!, []);
    expect(r.reason).toBe('Generic stand-in · 4,000 lm linear strip, 110° beam suits task light under a 14′ ceiling; pick a product to place it');
  });
  it('reason with a project product', () => {
    const hb = createProduct({ productId: '11111111-2222-3333-4444-555555555555', label: 'HB', catalog: 'HB', description: '2500 lm downlight', lumens: 2500, watts: 20, length: 0.45, width: 0.45, isRound: true, beamAngle: 40 });
    const r = rank(rooms.DataHall, seeded('DataHall', 'Task')!, [hb]);
    expect(r.reason).toContain('lm');
    expect(r.reason).toContain('14′');
  });
  it('derived reasons for seeds with an empty project', () => {
    const exp: [GoldenRoomName, IntentKind, string][] = [
      ['Office', 'Ambient', 'Generic stand-in · 3,000 lm volumetric troffer, 120° beam suits a 9′ ceiling; pick a product to place it'],
      ['Office', 'Task', 'Generic stand-in · 4,000 lm linear pendant, 110° beam suits task light under a 9′ ceiling; pick a product to place it'],
      ['Office', 'WallWash', 'Generic stand-in · 1,000 lm wall washer, 100° beam suits an even wash on a wall; pick a product to place it'],
      ['Cafeteria', 'Ambient', 'Generic stand-in · 3,000 lm volumetric troffer, 120° beam suits a 12′ ceiling; pick a product to place it'],
      ['Cafeteria', 'CeilingGlow', 'Generic stand-in · 1,600 lm cove linear suits a glow on the ceiling; pick a product to place it'],
      ['Lobby', 'Ambient', 'Generic stand-in · 2,500 lm downlight, 40° beam suits a 14′ ceiling; pick a product to place it'],
      ['Lobby', 'Path', 'Generic stand-in · 2,500 lm downlight, 40° beam suits a path under a 10′ ceiling; pick a product to place it'],
    ];
    for (const [name, kind, text] of exp) {
      const i = seeded(name, kind);
      expect(i, `${name} ${kind}`).toBeDefined();
      expect(rank(rooms[name], i!, []).reason).toBe(text);
    }
  });
});

describe('needLumens()', () => {
  it('accent range and wash', () => {
    const a = needLumens(rooms.Office, seeded('Office', 'Accent')!);
    expect(a).toBeGreaterThanOrEqual(300);
    expect(a).toBeLessThanOrEqual(1500);
    expect(a).toBeCloseTo(720, 6);
    expect(needLumens(rooms.Office, seeded('Office', 'WallWash')!)).toBeCloseTo(941.1764705882352, 9);
  });
  it('scales with target', () => {
    const amb = seeded('Office', 'Ambient')!;
    const base = needLumens(rooms.Office, amb);
    expect(base).toBeCloseTo(2464.1711229946523, 9);
    const bright = createIntent({ kind: 'Ambient', region: amb.region, plane: amb.plane, target: { minimum: null, average: (amb.target.average ?? 0) * 2, maximum: null } });
    expect(needLumens(rooms.Office, bright)).toBeGreaterThan(1.9 * base);
  });
  it('derived values', () => {
    const tasks = seeds('Office').filter((i) => i.kind === 'Task').slice(0, 4).map((i) => needLumens(rooms.Office, i));
    const want = [2695.187165775401, 2695.187165775401, 2470.5882352941176, 3850.267379679144];
    want.forEach((w, k) => expect(tasks[k]).toBeCloseTo(w, 9));
    expect(needLumens(rooms.Cafeteria, seeded('Cafeteria', 'FeaturePendant')!)).toBeCloseTo(887.4444444444443, 9);
    expect(needLumens(rooms.Cafeteria, seeded('Cafeteria', 'CeilingGlow')!)).toBe(1400);
    expect(needLumens(rooms.Cafeteria, seeded('Cafeteria', 'Accent')!)).toBeCloseTo(540, 9);
    expect(needLumens(rooms.DataHall, seeded('DataHall', 'Ambient')!)).toBeCloseTo(15401.069518716578, 9);
    expect(needLumens(rooms.DataHall, seeded('DataHall', 'Task')!)).toBeCloseTo(7187.165775401069, 9);
  });
});
