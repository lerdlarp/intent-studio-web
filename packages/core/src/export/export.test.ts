import { describe, expect, it } from 'vitest';
import { createIntent, demoRoom, type RoomDesign } from '../index';
import { solveAll } from '../solver';
import { DesignDocumentSchema } from '../model';
import {
  capLights,
  csvField,
  describeLights,
  designJson,
  fileStem,
  kelvinToHex,
  kelvinToRgb,
  KELVIN_TABLE,
  parseDesignJson,
  peakCandela,
  scheduleCsv,
  scheduleRows,
  type FixtureLight,
} from './index';
import { createFixture, createProduct } from '../model';
import { parseIes, productFromIes } from '../ies';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const iesDir = fileURLToPath(new URL('../../test/fixtures/ies/', import.meta.url));

function officeDesign(): RoomDesign {
  const room = demoRoom('Office');
  const design: RoomDesign = {
    room,
    intents: [
      createIntent({ kind: 'Ambient', label: 'Open, "ambient"', target: { minimum: null, average: 30, maximum: null }, region: room.floor[0]!, behavior: { ...createIntent().behavior, cct: 4000 } }),
    ],
    removedExisting: [],
    calculation: null,
    revision: 1,
  };
  solveAll(design);
  return design;
}

describe('kelvin table', () => {
  it('hits the anchors exactly and is monotone in blue', () => {
    for (const [k, r, g, b] of KELVIN_TABLE) expect(kelvinToRgb(k)).toEqual([r, g, b]);
    let prev = -1;
    for (let k = 2700; k <= 6500; k += 100) {
      const [, , b] = kelvinToRgb(k);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });
  it('clamps outside 2700–6500 and interpolates between anchors', () => {
    expect(kelvinToRgb(1000)).toEqual(kelvinToRgb(2700));
    expect(kelvinToRgb(9000)).toEqual(kelvinToRgb(6500));
    expect(kelvinToRgb(3250)).toEqual([255, 188, 122]);
    expect(kelvinToHex(2700)).toBe('#ffa957');
  });
});

describe('csv', () => {
  it('quotes per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(3.5)).toBe('3.5');
  });
  it('has a header, one row per fixture and a totals row (CRLF)', () => {
    const d = officeDesign();
    const rows = scheduleRows(d);
    expect(rows.length).toBeGreaterThan(0);
    const csv = scheduleCsv(d);
    const lines = csv.split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(lines[0]).toBe('Type,Lumens,Watts,CCT (K),Mount,Height (ft),X (ft),Y (ft),Intent');
    expect(lines).toHaveLength(rows.length + 3);
    expect(lines.at(-2)).toMatch(new RegExp(`^Total \\(${rows.length} fixtures\\),`));
    expect(lines[1]).toContain('"Open, ""ambient"""'); // intent label quoted
    expect(rows[0]!.cct).toBe(4000);
  });
  it('metric converts lengths', () => {
    const d = officeDesign();
    const ft = scheduleRows(d, 'imperial')[0]!;
    const m = scheduleRows(d, 'metric')[0]!;
    expect(m.x).toBeCloseTo(ft.x / 3.28084, 2);
    expect(scheduleCsv(d, 'metric').split('\r\n')[0]).toContain('Height (m)');
  });
});

describe('design json', () => {
  it('round-trips through DesignDocumentSchema', () => {
    const d = officeDesign();
    const parsed = parseDesignJson(designJson(d));
    expect(parsed.schemaVersion).toBe(1);
    expect(DesignDocumentSchema.parse(JSON.parse(designJson(d)))).toEqual(parsed);
    expect(parsed.design.intents[0]!.fixtures).toEqual(d.intents[0]!.fixtures);
    expect(parsed.design.room.label).toBe(d.room.label);
    expect(designJson(parseDesignJson(designJson(d)).design)).toBe(designJson(d));
  });
  it('rejects a wrong version', () => {
    expect(() => parseDesignJson(JSON.stringify({ schemaVersion: 2, design: {} }))).toThrow();
  });
});

describe('file stem', () => {
  it('is filesystem safe', () => {
    expect(fileStem('204 Open Office / East')).toBe('204-open-office-east');
    expect(fileStem('///')).toBe('room');
  });
});

describe('lights', () => {
  it('one light per fixture with candela, colour and downward aim', () => {
    const d = officeDesign();
    const lights = describeLights(d);
    expect(lights).toHaveLength(d.intents[0]!.fixtures.length);
    for (const l of lights) {
      expect(l.candela).toBeGreaterThan(0);
      expect(l.cct).toBe(4000);
      expect(l.rgb).toEqual([1, 209 / 255, 163 / 255]);
      expect(Math.hypot(l.direction.x, l.direction.y, l.direction.z)).toBeCloseTo(1, 9);
    }
  });
  it('peak candela uses cosⁿ from lumens + beam, or the IES peak when present', () => {
    const p = createProduct({ lumens: 1000, beamAngle: 60 });
    // n = ln .5 / ln cos30° ≈ 4.82 → I0 = 1000·(n+1)/2π
    expect(peakCandela(p)).toBeCloseTo((1000 * (Math.log(0.5) / Math.log(Math.cos(Math.PI / 6)) + 1)) / (2 * Math.PI), 6);
    // IES: the table's peak scaled by flux / table flux (iesPeakCandela).
    const ies = { derived: { peakCandela: 1234, lumens: 2000 } } as unknown as NonNullable<typeof p.ies>;
    expect(peakCandela({ ...p, ies })).toBeCloseTo(617, 9);
    expect(peakCandela({ ...p, ies }, 2000)).toBeCloseTo(1234, 9);
  });
  it('IES product (downlight fixture file): light candela = parsed peak × fixture lumens / table lumens', () => {
    const r = parseIes(readFileSync(iesDir + 'downlight-1995.ies', 'utf8'));
    if (!r.ok) throw new Error(r.error);
    const p = productFromIes(r.data, 'downlight-1995.ies');
    const d = r.data.derived;
    expect(peakCandela(p)).toBeCloseTo((d.peakCandela * p.lumens) / d.lumens, 9);
    expect(peakCandela(p, p.lumens / 2)).toBeCloseTo(peakCandela(p) / 2, 9);
    const room = demoRoom('Office');
    const intent = createIntent({
      kind: 'Ambient',
      region: room.floor[0]!,
      product: { product: p, agentPicked: false, reason: '', alternatives: [] },
      fixtures: [
        createFixture({ center: { x: 10, y: 10 }, mount: 'ceiling', output: 1 }),
        createFixture({ center: { x: 20, y: 10 }, mount: 'ceiling', output: 0.5 }),
      ],
    });
    const lights = describeLights({ room, intents: [intent], removedExisting: [], calculation: null, revision: 1 });
    expect(lights).toHaveLength(2);
    expect(lights[0]!.candela).toBeCloseTo(peakCandela(p), 9);
    expect(lights[1]!.candela).toBeCloseTo(peakCandela(p) / 2, 9);
    // not the old unscaled placeholder: a package with different lumens changes the intensity
    const brighter = { ...p, lumens: p.lumens * 2 };
    expect(peakCandela(brighter)).toBeCloseTo(2 * peakCandela(p), 9);
  });
  it('capLights leaves small sets alone and merges big ones conserving candela and count', () => {
    const mk = (i: number): FixtureLight => ({
      fixtureId: String(i), intentId: 'a', intentLabel: 'a', productLabel: 'p',
      position: { x: (i % 20) * 3, y: Math.floor(i / 20) * 3, z: 9 }, direction: { x: 0, y: 0, z: -1 },
      candela: 100, beamAngle: 60, cct: 3500, rgb: [1, 1, 1], count: 1,
    });
    const few = Array.from({ length: 10 }, (_, i) => mk(i));
    expect(capLights(few, 64)).toMatchObject({ merged: false, total: 10 });
    const many = Array.from({ length: 300 }, (_, i) => mk(i));
    const c = capLights(many, 64);
    expect(c.merged).toBe(true);
    expect(c.total).toBe(300);
    expect(c.lights.length).toBeLessThanOrEqual(64);
    expect(c.lights.reduce((a, l) => a + l.count, 0)).toBe(300);
    expect(c.lights.reduce((a, l) => a + l.candela, 0)).toBeCloseTo(30000, 6);
    expect(capLights(many, 64)).toEqual(c); // deterministic
  });
});
