import { describe, expect, it } from 'vitest';
import {
  STUDIO_TOOLS,
  office,
  p2,
  productOf,
  roomBounds,
  seed,
  solveAll,
  type RoomDesign,
} from '@intent-studio/core';
import { planHeat, WALL_STRIP_DEPTH } from './heat';
import { clickTarget, dragRect, fixtureShape, hitFixture, hitIntent, hitObject, hitWall, intentAnchor, toolForKey, toolMode, TOOL_KEYS } from './hit';
import { fitView, panBy, toPlan, toScreen, wheelFactor, zoomAt } from './view';
import { HEAT_ALPHA, niceLength, placeLabels } from './draw';

function solvedOffice(): RoomDesign {
  const room = office();
  const d: RoomDesign = { room, intents: seed(room).map((i) => ({ ...i, isSuggestion: false })), removedExisting: [], calculation: null, revision: 0 };
  solveAll(d);
  return d;
}

describe('view transform', () => {
  it('plan +Y is screen up; toPlan inverts toScreen', () => {
    const v = { scale: 10, ox: 50, oy: 300 };
    expect(toScreen(v, p2(0, 0))).toEqual(p2(50, 300));
    expect(toScreen(v, p2(1, 2))).toEqual(p2(60, 280)); // north is up
    const s = p2(123.5, 77.25);
    const back = toScreen(v, toPlan(v, s));
    expect(back.x).toBeCloseTo(s.x, 9);
    expect(back.y).toBeCloseTo(s.y, 9);
  });

  it('fit centres the room bounds with padding', () => {
    const b = roomBounds(office()); // 36 × 24
    const v = fitView(b, 800, 600, 20);
    expect(v.scale).toBeCloseTo(760 / 36, 9);
    const c = toScreen(v, p2(18, 12));
    expect(c.x).toBeCloseTo(400, 9);
    expect(c.y).toBeCloseTo(300, 9);
    expect(toScreen(v, p2(0, 24)).y).toBeGreaterThan(0);
  });

  it('zoom keeps the point under the cursor fixed; pan offsets', () => {
    const v = { scale: 10, ox: 0, oy: 500 };
    const at = p2(200, 100);
    const before = toPlan(v, at);
    const z = zoomAt(v, 2, at);
    expect(z.scale).toBe(20);
    const after = toPlan(z, at);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAt(v, 1e9, at).scale).toBe(400); // clamped
    expect(panBy(v, 5, -3)).toEqual({ scale: 10, ox: 5, oy: 497 });
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1, 12);
  });

  it('scale bar picks 1-2-5 lengths', () => {
    expect(niceLength(7.3)).toBe(5);
    expect(niceLength(19)).toBe(10);
    expect(niceLength(0.3)).toBe(0.2);
  });
});

describe('tools', () => {
  it('V selects, 1–8 pick the kinds in numeric order', () => {
    expect(toolForKey('v')).toBe('Select');
    expect(toolForKey('3')).toBe('WallWash');
    expect(toolForKey('8')).toBe('KeepDim');
    expect(toolForKey('9')).toBeNull();
    expect(STUDIO_TOOLS.map((t) => TOOL_KEYS[t])).toEqual(['V', '1', '2', '3', '4', '5', '6', '7', '8']);
    expect(STUDIO_TOOLS.map(toolMode)).toEqual(['select', 'area', 'area', 'wall', 'point', 'point', 'area', 'area', 'area']);
  });

  it('wash clicks hit a wall (or a face object on it); point tools hit objects or fall back to the point', () => {
    const room = office();
    expect(clickTarget(room, 'WallWash', p2(35.8, 5), 0.5)).toEqual({ wallIndex: 1 });
    expect(clickTarget(room, 'WallWash', p2(18, 12), 0.5)).toBeNull();
    expect(clickTarget(room, 'WallWash', p2(10, 23.85), 0.5)).toEqual({ objectIndex: 6 }); // the artwork
    expect(clickTarget(room, 'Accent', p2(10, 23.8), 0.5)).toEqual({ objectIndex: 6 });
    expect(clickTarget(room, 'FeaturePendant', p2(28, 17), 0.5)).toEqual({ objectIndex: 3 });
    expect(clickTarget(room, 'Accent', p2(18, 20), 0.5)).toEqual({ point: p2(18, 20) });
    expect(hitWall(room, p2(18, 0.2), 0.5)).toBe(0);
    expect(hitObject(room, p2(9, 12.75))).toBe(0);
  });

  it('drag rect is CCW and rejects slivers', () => {
    expect(dragRect(p2(5, 5), p2(1, 2))).toEqual([p2(1, 2), p2(5, 2), p2(5, 5), p2(1, 5)]);
    expect(dragRect(p2(0, 0), p2(0.2, 9))).toBeNull();
  });
});

describe('hit-testing a solved design', () => {
  it('finds fixtures by footprint, intents by region', () => {
    const d = solvedOffice();
    const ambient = d.intents.find((i) => i.kind === 'Ambient')!;
    const f = ambient.fixtures[0]!;
    const hit = hitFixture(d, f.center, 0.1);
    expect(hit).not.toBeNull();
    expect(d.intents.find((i) => i.id === hit!.intentId)!.fixtures.some((x) => x.id === hit!.fixtureId)).toBe(true);
    expect(hitFixture(d, p2(-50, -50), 0.1)).toBeNull();
    const shape = fixtureShape(d.room, ambient, f);
    const p = productOf(d.room, ambient);
    expect(shape.kind).toBe(p.isRound ? 'circle' : 'rect');
    // the smallest region under the point wins: a desk task over the ambient
    const task = d.intents.find((i) => i.kind === 'Task')!;
    const hitId = hitIntent(d, intentAnchor(task)!, 0.1);
    expect(hitId).toBe(task.id);
    const wash = d.intents.find((i) => i.kind === 'WallWash')!;
    expect(hitIntent(d, p2(4, 23.9), 0.1)).toBe(wash.id);
    const accent = d.intents.find((i) => i.kind === 'Accent')!;
    expect(hitIntent(d, intentAnchor(accent)!, 0.1)).toBe(accent.id); // a point beats the run it sits on
  });
});

describe('plan heat', () => {
  it('one layer per accepted intent with fixtures; wall zones lie flat in front of the wall', () => {
    const d = solvedOffice();
    const layers = planHeat(d);
    const withFixtures = d.intents.filter((i) => i.fixtures.length > 0);
    expect(layers.map((l) => l.intentId)).toEqual(withFixtures.map((i) => i.id));
    for (const l of layers) {
      expect(l.raster.width).toBeGreaterThan(0);
      expect(l.raster.pixels.length).toBe(l.raster.width * l.raster.height * 4);
      expect(l.raster.pixels.some((v, k) => k % 4 === 3 && v === 255)).toBe(true); // something painted
    }
    const wash = d.intents.find((i) => i.kind === 'WallWash')!;
    const wl = layers.find((l) => l.intentId === wash.id)!;
    const north = d.room.walls[2]!;
    expect(wl.origin.y).toBeCloseTo(north.start.y, 6);
    expect(wl.vEnd.y).toBeCloseTo(north.start.y + north.inward.y * WALL_STRIP_DEPTH, 6);
    // the ambient raster covers the floor
    const amb = layers.find((l) => l.intentId === d.intents.find((i) => i.kind === 'Ambient')!.id)!;
    const xs = [amb.origin.x, amb.uEnd.x, amb.vEnd.x];
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(36, 6);
    // deterministic
    expect(planHeat(d).map((l) => Array.from(l.raster.pixels.slice(0, 64)))).toEqual(layers.map((l) => Array.from(l.raster.pixels.slice(0, 64))));
  });
});

describe('intent label collision pass', () => {
  const box = (id: string, x: number, y: number, priority = 0, w = 100, h = 18) => ({ id, x, y, w, h, priority });
  it('keeps non-overlapping labels where they are', () => {
    const out = placeLabels([box('a', 0, 0), box('b', 200, 0)]);
    expect(out.map((b) => [b.id, b.y, b.dy])).toEqual([
      ['a', 0, 0],
      ['b', 0, 0],
    ]);
  });
  it('nudges an overlapping lower-priority label down, then up; hides it when no slot is free', () => {
    const out = placeLabels([box('low', 10, 0, 1), box('high', 0, 0, 5)]);
    expect(out.map((b) => b.id)).toEqual(['high', 'low']);
    expect(out[1]!.dy).toBe(20);
    const crowd = placeLabels(['s', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, k) => box(id, 0, 0, k === 0 ? 9 : 0)));
    expect(crowd.map((b) => [b.id, b.dy])).toEqual([
      ['s', 0],
      ['a', 20],
      ['b', -20],
      ['c', 40],
      ['d', -40],
      ['e', 60],
      ['f', -60],
    ]); // g is hidden
  });
  it('stays inside the canvas: off-canvas slots are skipped, x is clamped', () => {
    // a label at the top edge cannot go up; the one below the wash label takes the next free slot down
    const out = placeLabels([box('wash', 300, 12, 1), box('accent', 300, 0)], 2, { width: 400, height: 300 });
    const accent = out.find((b) => b.id === 'accent')!;
    expect(accent.y - accent.h / 2).toBeGreaterThanOrEqual(0);
    expect(Math.abs(accent.y - 12)).toBeGreaterThanOrEqual(20);
    const edge = placeLabels([box('e', 390, 100)], 2, { width: 400, height: 300 })[0]!;
    expect(edge.x).toBe(350);
  });
  it('the selected (top-priority) label always stays at its anchor', () => {
    const out = placeLabels([box('a', 0, 0, 1), box('sel', 0, 0, Number.MAX_SAFE_INTEGER)]);
    expect(out.find((b) => b.id === 'sel')!.dy).toBe(0);
  });
  it('heat overlay opacity stays readable', () => {
    expect(HEAT_ALPHA).toBeCloseTo(0.75, 9);
  });
});
