// IES LM-63 parser, derived photometry and productFromIes (PLAN.md §3). Fixtures in test/fixtures/ies/ are
// hand-made files covering each header variant, TILT form, symmetry shortcut and unit system.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FEET_PER_METRE,
  candelaAt,
  expandedOf,
  parseIes,
  productFromIes,
  type IesParseResult,
} from '../src/ies';
import { IesDataSchema, StudioProductSchema, type IesData } from '../src/model';

const dir = import.meta.url.replace(/^file:\/\//, '').replace(/[^/]*$/, '') + 'fixtures/ies/';
const text = (name: string): string => readFileSync(dir + name, 'utf8');
function load(name: string): { data: IesData; warnings: string[] } {
  const r = parseIes(text(name));
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r;
}
const err = (r: IesParseResult): string => (r.ok ? '' : r.error);

/** A rotational type C file with I(v) = i0·cosᵖ v (0 above 90°) at `step` degrees, absolute photometry. */
function synthetic(step: number, i0: number, p = 1, vMax = 90): string {
  const v: number[] = [];
  for (let a = 0; a <= vMax + 1e-9; a += step) v.push(a);
  const c = v.map((a) => (a >= 90 ? 0 : i0 * Math.cos((a * Math.PI) / 180) ** p));
  return `IESNA:LM-63-2002\n[TEST] synthetic\nTILT=NONE\n1 -1 1 ${v.length} 1 1 1 0 0 0\n1 1 10\n${v.join(' ')}\n0\n${c.join(' ')}\n`;
}

describe('ies: header variants', () => {
  it('LM-63-2002, absolute photometry, keywords with [MORE]', () => {
    const { data } = load('lambert-2002.ies');
    expect(data.format).toBe('LM-63-2002');
    expect(data.keywords['MANUFAC']).toBe('Example Works');
    expect(data.keywords['LUMINAIRE']).toBe('Lambertian test panel\nsecond line of the description');
    expect(data.lampLumens).toBeNull();
    expect(data.inputWatts).toBe(30);
    expect(data.derived.symmetry).toBe('rotational');
    expect(IesDataSchema.safeParse(data).success).toBe(true);
  });
  it('LM-63-1995 relative photometry, round opening (negative dims)', () => {
    const { data } = load('downlight-1995.ies');
    expect(data.format).toBe('LM-63-1995');
    expect(data.lampLumens).toBe(1500);
    expect(data.opening).toEqual({ width: 0.5, length: 0.5, height: 0.1, round: true });
  });
  it('IESNA91 with TILT=INCLUDE (tilt table skipped), metres, multiplier × ballast', () => {
    const { data, warnings } = load('quadrant-1991.ies');
    expect(data.format).toBe('LM-63-1991');
    expect(warnings.join(' ')).toContain('TILT=INCLUDE');
    expect(data.opening.width).toBeCloseTo(0.6 * FEET_PER_METRE, 9);
    expect(data.opening.length).toBeCloseTo(1.2 * FEET_PER_METRE, 9);
    // file value 400 at nadir × multiplier 2 × ballast 0.9 × ballast-lamp factor 1
    expect(data.candela[0]![0]).toBeCloseTo(720, 9);
    expect(data.lampCount).toBe(2);
    expect(data.derived.symmetry).toBe('quadrant');
  });
  it('LM-63-1986 (no header line, free text, CRLF) with bilateral 0–180 symmetry', () => {
    const { data } = load('linear-1986.ies');
    expect(data.format).toBe('LM-63-1986');
    expect(data.keywords['TEXT']).toContain('Linear strip test file');
    expect(data.derived.symmetry).toBe('bilateral');
  });
  it('LM-63-2019 full 0–345 table wraps to 360', () => {
    const { data } = load('washer-2019.ies');
    expect(data.format).toBe('LM-63-2019');
    expect(data.derived.symmetry).toBe('full');
    const t = expandedOf(data);
    expect(t.h[t.nH - 1]).toBe(360);
    expect(candelaAt(t, 30, 360)).toBeCloseTo(candelaAt(t, 30, 0), 9);
    // 2019's "file generation type" slot is not a photometric factor
    expect(data.candela[0]![0]).toBeCloseTo(300, 0);
  });
  it('bilateral about the 90–270 plane mirrors h → 180 − h', () => {
    const { data } = load('bilateral90-2002.ies');
    expect(data.derived.symmetry).toBe('bilateral90');
    const t = expandedOf(data);
    expect(candelaAt(t, 45, 30)).toBeCloseTo(candelaAt(t, 45, 150), 9);
    expect(candelaAt(t, 45, 300)).toBeCloseTo(candelaAt(t, 45, 240), 9);
  });
});

describe('ies: derived photometry', () => {
  it('cosine distribution integrates to π·I0 within 1 % (5° table)', () => {
    const { data } = load('lambert-2002.ies');
    expect(Math.abs(data.derived.lumens / (Math.PI * 1000) - 1)).toBeLessThan(0.01);
    expect(data.derived.peakCandela).toBe(1000);
    expect(data.derived.beamAngle).toBeCloseTo(120, 0);
    expect(data.derived.fieldAngle).toBeCloseTo(2 * (Math.acos(0.1) * 180) / Math.PI, 0);
    expect(data.derived.uplightShare).toBe(0);
    expect(data.derived.asymmetric).toBe(false);
  });
  it('fine synthetic cosine and cos⁴ tables integrate within 0.1 %', () => {
    for (const [step, p] of [[1, 1], [2.5, 4]] as const) {
      const r = parseIes(synthetic(step, 2000, p));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(Math.abs(r.data.derived.lumens / ((2 * Math.PI * 2000) / (p + 1)) - 1)).toBeLessThan(0.001);
    }
  });
  it('60° cosⁿ downlight: beam ≈ 60°, flux 2π·I0/(n+1)', () => {
    const { data } = load('downlight-1995.ies');
    const n = Math.log(0.5) / Math.log(Math.cos(Math.PI / 6));
    expect(Math.abs(data.derived.lumens / ((2 * Math.PI * 2000) / (n + 1)) - 1)).toBeLessThan(0.01);
    expect(Math.abs(data.derived.beamAngle - 60)).toBeLessThan(1);
    expect(data.derived.fieldAngle).toBeGreaterThan(data.derived.beamAngle);
  });
  it('quadrant table: 0° and 90° planes integrate to the rotational average', () => {
    const { data } = load('quadrant-1991.ies');
    // the cos 2h term integrates to zero over the circle → ≈ 1.8 · 400 · π
    expect(Math.abs(data.derived.lumens / (1.8 * 400 * Math.PI) - 1)).toBeLessThan(0.02);
    expect(data.derived.asymmetric).toBe(false);
  });
  it('uplight share: all-up file → 1; linear file has a small uplight share', () => {
    expect(load('uplight-2002.ies').data.derived.uplightShare).toBeCloseTo(1, 9);
    expect(load('uplight-2002.ies').data.derived.beamAngle).toBeCloseTo(120, 0);
    const lin = load('linear-1986.ies').data.derived.uplightShare;
    expect(lin).toBeGreaterThan(0.01);
    expect(lin).toBeLessThan(0.2);
  });
  it('wall washer is asymmetric; symmetric files are not', () => {
    expect(load('washer-2019.ies').data.derived.asymmetric).toBe(true);
    for (const f of ['lambert-2002.ies', 'downlight-1995.ies', 'linear-1986.ies', 'uplight-2002.ies'])
      expect(load(f).data.derived.asymmetric).toBe(false);
  });
  it('linear file: narrower across (90° plane) than along — beam between the two plane widths', () => {
    const { data } = load('linear-1986.ies');
    const t = expandedOf(data);
    expect(candelaAt(t, 40, 90)).toBeLessThan(candelaAt(t, 40, 0));
    expect(data.derived.beamAngle).toBeGreaterThan(40);
    expect(data.derived.beamAngle).toBeLessThan(120);
  });
});

describe('ies: rejects garbage without throwing', () => {
  const bad: [string, unknown, string][] = [
    ['empty', '', 'empty'],
    ['not text', 42, 'text'],
    ['null', null, 'text'],
    ['no TILT', 'hello\nworld', 'TILT'],
    ['truncated', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 3 1 1 1 0 0 0\n1 1 10\n0 45', 'ends early'],
    ['word in numbers', 'IESNA:LM-63-2002\nTILT=NONE\n1 abc 1 3 1 1 1 0 0 0', 'expected a number'],
    ['zero angles', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 0 1 1 1 0 0 0\n1 1 10', 'vertical angles'],
    ['huge table', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 2000 2000 1 1 0 0 0\n1 1 10', 'too large'],
    ['decreasing', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 3 1 1 1 0 0 0\n1 1 10\n0 50 45\n0\n1 1 1', 'increase'],
    ['dark', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 3 1 1 1 0 0 0\n1 1 10\n0 45 90\n0\n0 0 0', 'no light'],
    ['bad h range', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 2 2 1 1 0 0 0\n1 1 10\n0 90\n10 20\n1 1 1 1', 'horizontal angle range'],
    ['type A', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 2 1 3 1 0 0 0\n1 1 10\n0 90\n0\n1 1', 'type A'],
  ];
  for (const [name, input, msg] of bad) {
    it(name, () => {
      const r = parseIes(input);
      expect(r.ok).toBe(false);
      expect(err(r)).toContain(msg);
    });
  }
  it('type B is rejected with a clear message', () => {
    const r = parseIes(text('typeb-2002.ies'));
    expect(r.ok).toBe(false);
    expect(err(r)).toMatch(/type B/);
  });
  it('random bytes never throw', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let k = 0; k < 200; k++) {
      const head = k % 2 ? 'IESNA:LM-63-2002\nTILT=NONE\n' : '';
      const s = head + Array.from({ length: 40 }, () => (rnd() < 0.8 ? (rnd() * 200 - 20).toFixed(1) : '#')).join(' ');
      expect(() => parseIes(s)).not.toThrow();
    }
  });
});

describe('ies: productFromIes', () => {
  it('Lambertian panel → downlight-like product with the table attached', () => {
    const { data } = load('lambert-2002.ies');
    const p = productFromIes(data, 'LAM-1.ies');
    expect(p.lumens).toBe(Math.round(data.derived.lumens));
    expect(p.watts).toBe(30);
    expect(p.brand).toBe('Example Works');
    expect(p.catalog).toBe('LAM-1');
    expect(p.label).toContain('Lambertian test panel');
    expect(p.beamAngle).toBeCloseTo(120, 0);
    expect(p.isGeneric).toBe(false);
    expect(p.productId).toBeNull();
    expect(p.ies).toBe(data);
    expect(StudioProductSchema.parse(p).ies?.derived.lumens).toBe(data.derived.lumens);
  });
  it('families by ranker rules', () => {
    expect(productFromIes(load('washer-2019.ies').data).family).toBe('wallwash');
    expect(productFromIes(load('uplight-2002.ies').data).family).toBe('cove');
    expect(productFromIes(load('linear-1986.ies').data, 'strip-4.ies').family).toBe('strip');
    expect(productFromIes(load('downlight-1995.ies').data).family).toBe('downlight');
    expect(productFromIes(load('quadrant-1991.ies').data).family).toBe('troffer');
  });
  it('label falls back to the file name', () => {
    const p = productFromIes(load('linear-1986.ies').data, 'C:\\files\\strip-4.IES');
    expect(p.label.startsWith('strip-4 · ')).toBe(true);
    expect(p.length).toBe(4);
    expect(p.width).toBeCloseTo(0.3, 9);
  });
});
