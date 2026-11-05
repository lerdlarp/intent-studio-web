import { describe, expect, it } from 'vitest';
import { createFixture, createIntent, createProduct, createRoom, demoRoom, type RoomDesign, type StudioRoom } from '@intent-studio/core';
import { describeDesign, describeFixtures, describePatch, describeWall, planToThree, rotYOfDeg, threeToPlan, wallRects } from './describe';
import { intentPose, presetPose, roomExtent, wallPose } from './camera';
import { designHeat } from './heat';

const box = (w = 20, d = 10, h = 9): StudioRoom =>
  createRoom({
    ceilingHeight: h,
    floor: [[{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }]],
    walls: [
      { index: 0, start: { x: 0, y: 0 }, end: { x: w, y: 0 }, inward: { x: 0, y: 1 }, top: 0, openings: [] },
      { index: 1, start: { x: w, y: 0 }, end: { x: w, y: d }, inward: { x: -1, y: 0 }, top: 0, openings: [] },
      { index: 2, start: { x: w, y: d }, end: { x: 0, y: d }, inward: { x: 0, y: -1 }, top: 0, openings: [] },
      { index: 3, start: { x: 0, y: d }, end: { x: 0, y: 0 }, inward: { x: 1, y: 0 }, top: 0, openings: [] },
    ],
  });
const designOf = (room: StudioRoom, intents: RoomDesign['intents'] = []): RoomDesign => ({ room, intents, removedExisting: [], calculation: null, revision: 1 });

describe('axis mapping', () => {
  it('plan (x, y, z-up) → three (x, z, −y) and back', () => {
    expect(planToThree(3, 4, 5)).toEqual([3, 5, -4]);
    expect(threeToPlan([3, 5, -4])).toEqual({ x: 3, y: 4, z: 5 });
  });
  it('plan heading → rotation about Y keeps direction', () => {
    const a = rotYOfDeg(30);
    // three rotation about +Y maps +x to (cos, 0, −sin); plan direction (cos30, sin30) maps to the same
    expect([Math.cos(a), -Math.sin(a)]).toEqual([Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)]);
  });
});

describe('wallRects', () => {
  it('a plain wall is one rectangle', () => {
    expect(wallRects(10, 9, [])).toEqual([{ u0: 0, u1: 10, v0: 0, v1: 9 }]);
  });
  it('a door gives left, right and a header', () => {
    const r = wallRects(10, 9, [{ kind: 'door', from: 4, to: 6, bottom: 0, top: 7 }]);
    expect(r).toHaveLength(3);
    expect(r).toContainEqual({ u0: 4, u1: 6, v0: 7, v1: 9 });
  });
  it('a window gives left, right, sill and header', () => {
    const r = wallRects(10, 9, [{ kind: 'window', from: 4, to: 6, bottom: 3, top: 6 }]);
    expect(r).toHaveLength(4);
    expect(r).toContainEqual({ u0: 4, u1: 6, v0: 0, v1: 3 });
    expect(r).toContainEqual({ u0: 4, u1: 6, v0: 6, v1: 9 });
  });
  it('the solid area equals wall area minus the openings', () => {
    const ops = [
      { kind: 'door', from: 1, to: 3, bottom: 0, top: 7 },
      { kind: 'window', from: 5, to: 8, bottom: 3, top: 6 },
    ];
    const area = wallRects(10, 9, ops).reduce((a, r) => a + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
    expect(area).toBeCloseTo(90 - 14 - 9, 9);
  });
  it('overlapping and out-of-range openings are clamped and not double-cut', () => {
    const ops = [
      { kind: 'a', from: -2, to: 3, bottom: 0, top: 7 },
      { kind: 'b', from: 2, to: 4, bottom: 0, top: 5 },
    ];
    const area = wallRects(10, 9, ops).reduce((a, r) => a + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
    expect(area).toBeCloseTo(90 - 3 * 7 - 1 * 5, 9);
  });
});

describe('describeDesign', () => {
  it('one wall desc per wall, using room height when top ≤ 0', () => {
    const room = box();
    const d = describeDesign(designOf(room));
    expect(d.walls).toHaveLength(4);
    expect(d.walls.every((w) => w.height === 9)).toBe(true);
    expect(d.floor?.outer).toHaveLength(4);
    expect(d.ceiling).toHaveLength(1);
    expect(d.ceiling[0]?.y).toBe(9);
  });
  it('wall openings add pieces; pieces sit behind the wall line, bottom flush at y=0', () => {
    const room = box();
    room.walls[0]!.openings = [{ kind: 'door', from: 8, to: 10, bottom: 0, top: 7 }];
    const w = describeWall(room, room.walls[0]!, 0);
    expect(w.pieces).toHaveLength(3);
    for (const p of w.pieces) {
      // south wall (y = 0, inward +y): boxes centred 0.2 ft outside → three z = +0.2
      expect(p.center[2]).toBeCloseTo(0.2, 9);
      expect(p.center[1] - p.size[1] / 2).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(w.inward).toEqual([0, 0, -1]);
  });
  it('objects become boxes with bottom/top heights and plan→three centres', () => {
    const room = box();
    room.objects = [{ name: 'Desk', kind: 'desk', center: { x: 5, y: 2 }, length: 6, width: 3, orientation: 90, top: 2.5, bottom: 0 }];
    const [o] = describeDesign(designOf(room)).objects;
    expect(o?.center).toEqual([5, 1.25, -2]);
    expect(o?.size).toEqual([6, 2.5, 3]);
    expect(o?.rotY).toBeCloseTo(Math.PI / 2, 9);
  });
  it('ceiling zones are described at their own heights', () => {
    const room = box();
    room.ceilingZones = [
      { height: 9, isMain: true, loops: room.floor },
      { height: 11, isMain: false, loops: [[{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }]] },
    ];
    expect(describeDesign(designOf(room)).ceiling.map((c) => c.y)).toEqual([9, 11]);
  });
});

describe('fixture placement', () => {
  const fx = (mount: string, height: number, x = 10, y = 5) => createFixture({ intentId: 'a', mount, height, center: { x, y }, orientation: 0 });
  const intent = (mount: string, height: number, round = true) =>
    createIntent({ id: 'a', kind: 'Ambient', product: { product: createProduct({ length: 2, width: 2, isRound: round }), agentPicked: false, reason: '', alternatives: [] }, fixtures: [fx(mount, height)] });

  it('ceiling mount: flat disc just under the ceiling', () => {
    const [f] = describeFixtures(designOf(box(), [intent('ceiling', 0)]));
    expect(f?.shape).toBe('round');
    expect(f!.center[0]).toBe(10);
    expect(f!.center[2]).toBe(-5);
    expect(f!.center[1] + f!.size[1] / 2).toBeCloseTo(9, 9);
  });
  it('linear products become boxes', () => {
    const [f] = describeFixtures(designOf(box(), [intent('ceiling', 0, false)]));
    expect(f?.shape).toBe('linear');
  });
  it('pendant hangs at its height on a cord to the ceiling', () => {
    const [f] = describeFixtures(designOf(box(), [intent('pendant', 7)]));
    expect(f?.shape).toBe('pendant');
    expect(f?.center[1]).toBe(7);
    expect(f?.cord?.top[1]).toBe(9);
    expect(f!.cord!.bottom[1]).toBeLessThan(7.5);
  });
  it('a pendant under a raised pocket hangs from the pocket', () => {
    const room = box();
    room.ceilingZones = [
      { height: 9, isMain: true, loops: room.floor },
      { height: 12, isMain: false, loops: [[{ x: 8, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 7 }, { x: 8, y: 7 }]] },
    ];
    const [f] = describeFixtures(designOf(room, [intent('pendant', 8)]));
    expect(f?.cord?.top[1]).toBe(12);
  });
  it('wall mount sits against the nearest wall at its height, facing inward', () => {
    const room = box();
    const i = createIntent({ id: 'a', kind: 'Accent', fixtures: [fx('wall', 7.5, 10, 0.1)] });
    const [f] = describeFixtures(designOf(room, [i]));
    expect(f?.shape).toBe('wall');
    expect(f?.center[1]).toBe(7.5);
    expect(f!.center[2]).toBeLessThanOrEqual(0); // y ≥ 0 in plan ↔ z ≤ 0 in three
  });
  it('suggestions and removed existing fixtures are skipped', () => {
    const room = box();
    const id = '11111111-1111-4111-8111-111111111111';
    room.existing = [{ id, productId: id, label: 'old', center: { x: 3, y: 3 }, orientation: 0, length: 2, width: 2, isRound: true, mount: 'ceiling', height: 9, calculable: true }];
    const sug = { ...intent('ceiling', 0), isSuggestion: true };
    expect(describeFixtures(designOf(room, [sug]))).toHaveLength(1);
    expect(describeFixtures({ ...designOf(room, [sug]), removedExisting: [id] })).toHaveLength(0);
  });
});

describe('patches, cameras and heat on the Office demo', () => {
  const room = demoRoom('Office');
  const intents = [
    createIntent({ id: 't', kind: 'Task', region: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }, { x: 2, y: 6 }], plane: { kind: 'Horizontal', height: 2.5, bottom: 0, top: 0, inferred: true, reason: '' } }),
  ];
  const design = designOf(room, intents);
  it('horizontal patch sits just above its plane height', () => {
    const p = describePatch(design, intents[0]!);
    expect(p?.kind).toBe('horizontal');
    expect(p?.y).toBeCloseTo(2.53, 9);
  });
  it('camera presets look at the room from the right side', () => {
    const e = roomExtent(design);
    const def = presetPose(design, 'default');
    expect(def.position[0]).toBeGreaterThan(e.center[0]); // east
    expect(def.position[2]).toBeGreaterThan(e.center[2]); // south (plan −y = three +z)
    const elev = Math.atan2(def.position[1] - def.target[1], Math.hypot(def.position[0] - def.target[0], def.position[2] - def.target[2]));
    expect((elev * 180) / Math.PI).toBeCloseTo(35, 5);
    expect(presetPose(design, 'eye').position[1]).toBe(5.5);
    expect(presetPose(design, 'top').position[1]).toBeGreaterThan(e.width);
  });
  it('face-wall camera is inside the room on the wall side of the centre', () => {
    const pose = wallPose(design, 0)!;
    const w = room.walls[0]!;
    const mid = planToThree((w.start.x + w.end.x) / 2, (w.start.y + w.end.y) / 2, 0);
    expect(Math.hypot(pose.target[0] - mid[0], pose.target[2] - mid[2])).toBeLessThan(1e-9);
    expect(wallPose(design, 99)).toBeNull();
    expect(intentPose(design, intents[0]!)).not.toBeNull();
  });
  it('heat: none without fixtures; memoized per design', () => {
    expect(designHeat(design).size).toBe(0);
    expect(designHeat(design)).toBe(designHeat(design));
  });
});
