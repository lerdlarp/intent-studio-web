import { describe, expect, it } from 'vitest';
import { createIntent, demoRoom, FEET_PER_METER, solveAll, type RoomDesign } from '@intent-studio/core';
import { BASE_EXPOSURE, exposureOfEv, litPreview, MAX_LIT_LIGHTS } from './litPreview';

function design(): RoomDesign {
  const room = demoRoom('Office');
  const d: RoomDesign = {
    room,
    intents: [createIntent({ kind: 'Ambient', label: 'Ambient', target: { minimum: null, average: 30, maximum: null }, region: room.floor[0]! })],
    removedExisting: [],
    calculation: null,
    revision: 1,
  };
  solveAll(d);
  return d;
}

describe('litPreview descriptors', () => {
  it('one spot per fixture; angle = beam/2; downward target in three space; intensity scaled for feet', () => {
    const d = design();
    const lp = litPreview(d);
    const n = d.intents[0]!.fixtures.length;
    expect(lp.merged).toBe(false);
    expect(lp.spots).toHaveLength(n);
    const s = lp.spots[0]!;
    expect(s.target[1]).toBeLessThan(s.position[1]); // aims down (Y up)
    expect(s.angle).toBeGreaterThan(0);
    expect(s.angle).toBeLessThan(Math.PI / 2);
    expect(s.intensity).toBeGreaterThan(0);
    expect(s.intensity / (FEET_PER_METER * FEET_PER_METER)).toBeGreaterThan(50); // candela scale
  });
  it('caps and reports merging', () => {
    const d = design();
    const lp = litPreview(d, 3);
    expect(lp.spots.length).toBeLessThanOrEqual(3);
    expect(lp.merged).toBe(true);
    expect(lp.total).toBe(d.intents[0]!.fixtures.length);
    expect(MAX_LIT_LIGHTS).toBe(64);
  });
  it('exposure doubles per EV and clamps', () => {
    expect(exposureOfEv(0)).toBe(BASE_EXPOSURE);
    expect(exposureOfEv(1)).toBeCloseTo(BASE_EXPOSURE * 2, 12);
    expect(exposureOfEv(99)).toBe(exposureOfEv(3));
  });
});
