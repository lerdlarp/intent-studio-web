import { describe, expect, it } from 'vitest';
import { CALC_LABEL, calculate, office, productOf, seed, solveAll, type RoomDesign } from '@intent-studio/core';
import { isStale, ledgerRows } from './ledgerRows';
import { calcHeatLayers, heatZoneOf } from './heat';
import { WALL_STRIP_DEPTH, planHeatFromCalc } from '../plan/heat';
import { calcDesignHeat } from '../room3d/heat';

function solvedOffice(revision = 3): RoomDesign {
  const room = office();
  const d: RoomDesign = {
    room,
    intents: seed(room).map((i) => ({ ...i, isSuggestion: false })),
    removedExisting: [],
    calculation: null,
    revision,
  };
  solveAll(d);
  return d;
}

describe('ledger rows', () => {
  const d = solvedOffice();
  const r = calculate(d, { productOf });
  it('one row per zone with status for targeted intent zones only', () => {
    const rows = ledgerRows(r);
    expect(rows).toHaveLength(r.zones.length);
    const surfaces = rows.filter((x) => x.isSurface);
    expect(surfaces.length).toBeGreaterThan(0);
    for (const s of surfaces) expect(s.status).toBeNull();
    const ambient = d.intents.find((i) => i.kind === 'Ambient')!;
    const amb = rows.find((x) => x.zoneId === ambient.id)!;
    expect(amb.target).not.toBeNull();
    expect(['Under', 'Meets', 'Over']).toContain(amb.status);
    expect(ledgerRows(null)).toEqual([]);
  });
  it('stale when the design revision moved past the calculation', () => {
    expect(r.label).toBe(CALC_LABEL);
    expect(isStale(r, 3)).toBe(false);
    expect(isStale(r, 4)).toBe(true);
    expect(isStale(null, 9)).toBe(false);
  });
  it('heat adapter: one raster per zone with the zone values', () => {
    const layers = calcHeatLayers(r, { pixelsPerFoot: 2 });
    expect(layers).toHaveLength(r.zones.length);
    for (const l of layers) {
      expect(l.raster.width).toBeGreaterThan(0);
      expect(l.raster.pixels.some((p) => p > 0)).toBe(true);
    }
    expect(calcHeatLayers(r, { surfaces: false }).every((l) => !l.zoneId.startsWith('surface:'))).toBe(true);
    const g = r.zones[0]!;
    expect(heatZoneOf(g).points[0]!.value).toBe(g.values[0]);
  });
});

describe('full-calc heat in the plan and the 3D view', () => {
  const d = solvedOffice();
  const r = calculate(d, { productOf });
  it('plan layers: one per intent zone (surfaces left out), wall zones laid flat as a strip', () => {
    const layers = planHeatFromCalc(r, 2);
    const intentZones = r.zones.filter((z) => !z.zoneId.startsWith('surface:') && z.points.length > 0);
    expect(layers.map((l) => l.intentId)).toEqual(intentZones.map((z) => z.zoneId));
    for (const l of layers) expect(l.raster.pixels.some((p) => p > 0)).toBe(true);
    const wall = intentZones.find((z) => z.kind === 'vertical');
    if (wall) {
      const l = layers.find((x) => x.intentId === wall.zoneId)!;
      expect(Math.hypot(l.vEnd.x - l.origin.x, l.vEnd.y - l.origin.y)).toBeCloseTo(WALL_STRIP_DEPTH, 9);
    }
  });
  it('3D heat: per intent zone, memoized per result', () => {
    const h = calcDesignHeat(r);
    expect([...h.keys()]).toEqual(planHeatFromCalc(r, 2).map((l) => l.intentId));
    expect(calcDesignHeat(r)).toBe(h);
  });
});
