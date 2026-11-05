import { describe, expect, it } from 'vitest';
import {
  cafeteria,
  createRoom,
  dataHall,
  footprint,
  inflate,
  lobby,
  office,
  rect,
  type P2,
  type RoomObjectInfo,
  type StudioRoom,
  type WallInfo,
} from '../src/index';
import {
  faceMidpoint,
  inferPlane,
  nearestWall,
  resolve,
  surfaceHeight,
  wallFor,
} from '../src/workplane';

const pt = (x: number, y: number): P2 => ({ x, y });
const Square: P2[] = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];
const obj = (init: Partial<RoomObjectInfo> & { kind: string }): RoomObjectInfo => ({
  name: '',
  center: pt(0, 0),
  length: 3,
  width: 2,
  orientation: 0,
  top: 2.5,
  bottom: 0,
  ...init,
});
const mk = (label: string, objects: RoomObjectInfo[] = [], extra: Partial<StudioRoom> = {}): StudioRoom =>
  createRoom({ label, floor: [Square], objects, ...extra });
const wall = (start: P2, end: P2, inward: P2, top: number): WallInfo => ({ index: 0, start, end, inward, top, openings: [] });
const sum = (p: ReturnType<typeof inferPlane>): [string, number, number, number, string] => [p.kind, p.height, p.bottom, p.top, p.reason];

describe('workplane inference', () => {
  const o = office();
  it('desk task at desk height', () => {
    const p = inferPlane(o, 'Task', inflate(footprint(o.objects[0] as RoomObjectInfo), 1.5));
    expect(sum(p)).toEqual(['Horizontal', 2.5, 0, 0, 'Desk top, 2′-6″, from Desk cluster A']);
    expect(p.inferred).toBe(true);
  });
  it('counter task at counter height', () => {
    const c = cafeteria();
    const p = inferPlane(c, 'Task', inflate(footprint(c.objects[0] as RoomObjectInfo), 1.5));
    expect(p.height).toBe(3);
    expect(p.reason).toBe('Counter top, 3′-0″, from Servery counter');
  });
  it('bar is three and a half', () => {
    const bar = obj({ name: 'Bar', kind: 'bar', center: pt(5, 5), length: 8, width: 2, top: null });
    const p = inferPlane(mk('Lounge', [bar]), 'Task', inflate(footprint(bar), 1));
    expect(p.height).toBe(3.5);
    expect(p.reason).toBe('Bar top, 3′-6″, from Bar');
  });
  it('ambient planes', () => {
    expect(sum(inferPlane(lobby(), 'Ambient', lobby().floor[0] as P2[]))).toEqual(['Horizontal', 0, 0, 0, 'Floor level · lobby circulation']);
    expect(inferPlane(dataHall(), 'Ambient', []).reason).toBe('Floor level · data hall circulation');
    expect(sum(inferPlane(o, 'Ambient', []))).toEqual(['Horizontal', 2.5, 0, 0, 'Work plane, 2′-6″ · open office']);
    expect(inferPlane(cafeteria(), 'Ambient', []).reason).toBe('Table height, 2′-6″ · cafeteria dining');
    expect(inferPlane(mk('Room 12'), 'Ambient', []).reason).toBe('Work plane, 2′-6″ · room');
  });
  it('wall wash vertical with rule in reason', () => {
    const w = o.walls[2]!;
    expect(sum(inferPlane(o, 'WallWash', [w.start, w.end], 2))).toEqual([
      'Vertical',
      2,
      2,
      8,
      'North wall, 2′-0″ to 8′-0″ (clear of the base and the ceiling edge)',
    ]);
  });
  it('wash on a short wall / unknown top', () => {
    const short = mk('Closet', [], { ceilingHeight: 4.5, walls: [wall(pt(0, 0), pt(10, 0), pt(0, 1), 4.5)] });
    const p = inferPlane(short, 'WallWash', [pt(0, 0), pt(10, 0)], 0);
    expect(sum(p)).toEqual(['Vertical', 0, 0, 4.5, 'South wall, 0 to 4′-6″']);
    const unk = mk('Closet', [], { ceilingHeight: 9, walls: [wall(pt(0, 0), pt(10, 0), pt(0, 1), 0)] });
    expect(sum(inferPlane(unk, 'WallWash', [pt(0, 0), pt(10, 0)], 0))).toEqual([
      'Vertical',
      2,
      2,
      8,
      'South wall, 2′-0″ to 8′-0″ (clear of the base and the ceiling edge)',
    ]);
  });
  it('accent on artwork face', () => {
    const brand = o.objects[6] as RoomObjectInfo;
    expect(faceMidpoint(o, brand)).toEqual(pt(10, 23.75));
    expect(sum(inferPlane(o, 'Accent', [pt(10, 23.75)], null, 6))).toEqual(['Vertical', 3, 3, 7, 'Brand wall face, 3′-0″ to 7′-0″']);
  });
  it('accent without known heights / too short', () => {
    const mural = obj({ name: 'Mural', kind: 'artwork', center: pt(5, 9.9), length: 6, width: 0.2, top: null, bottom: null });
    expect(sum(inferPlane(mk('Gallery', [mural]), 'Accent', [pt(5, 9.8)], null, 0))).toEqual([
      'Vertical',
      3,
      3,
      7,
      'Mural face, 3′-0″ to 7′-0″ (its height is not known)',
    ]);
    const short = { ...mural, bottom: 5, top: 5.2 };
    expect(inferPlane(mk('Gallery', [short]), 'Accent', [pt(5, 9.8)], null, 0).reason).toMatch(/\(its height is not known\)$/);
  });
  it('accent on a display table is horizontal', () => {
    const t = obj({ name: 'Display table', kind: 'table', center: pt(5, 5), length: 4, width: 3 });
    expect(sum(inferPlane(mk('Showroom', [t]), 'Accent', [pt(5, 5)]))).toEqual(['Horizontal', 2.5, 0, 0, 'Display table top, 2′-6″']);
  });
  it('accent near a wall / far from walls', () => {
    expect(sum(inferPlane(o, 'Accent', [pt(18, 23)]))).toEqual(['Vertical', 3, 3, 7, 'North wall face, 3′-0″ to 7′-0″']);
    const far = inferPlane(o, 'Accent', [pt(18, 12)]);
    expect([far.kind, far.height, far.reason]).toEqual(['Horizontal', 2.5, 'Work plane, 2′-6″ · open office']);
  });
  it('ceiling glow', () => {
    const c = cafeteria();
    expect(sum(inferPlane(c, 'CeilingGlow', (c.ceilingZones[1]?.loops[0] ?? []) as P2[]))).toEqual([
      'Ceiling',
      12,
      0,
      0,
      'Raised ceiling at 12′-0″, facing down',
    ]);
    expect(sum(inferPlane(o, 'CeilingGlow', o.floor[0] as P2[]))).toEqual(['Ceiling', 9, 0, 0, 'Main ceiling at 9′-0″, facing down']);
    expect(sum(inferPlane(lobby(), 'CeilingGlow', rect(pt(6, 21), pt(34, 28))))).toEqual([
      'Ceiling',
      10,
      0,
      0,
      'Soffit at 10′-0″, facing down',
    ]);
  });
  it('path / keep dim', () => {
    const p = inferPlane(lobby(), 'Path', [pt(0, 0), pt(5, 0), pt(5, 4)]);
    expect([p.height, p.reason]).toEqual([0, 'Floor level · path of travel']);
    expect(inferPlane(lobby(), 'KeepDim', lobby().floor[0] as P2[]).height).toBe(0);
    expect(inferPlane(o, 'KeepDim', o.floor[0] as P2[]).height).toBe(2.5);
  });
  it('feature pendant', () => {
    const l = lobby();
    const p = inferPlane(l, 'FeaturePendant', footprint(l.objects[0] as RoomObjectInfo));
    expect([p.height, p.reason]).toEqual([3, 'Reception top, 3′-0″, under Reception desk']);
    const none = inferPlane(o, 'FeaturePendant', rect(pt(0, 0), pt(1, 1)));
    expect(none.height).toBe(2.5);
    expect(none.reason).toBe('Work plane, 2′-6″ · open office');
  });
  it('task without furniture / data hall task', () => {
    const t = inferPlane(o, 'Task', rect(pt(0, 20), pt(2, 22)));
    expect([t.height, t.reason]).toEqual([2.5, 'Task height, 2′-6″ (no furniture under it)']);
    const d = inferPlane(dataHall(), 'Task', rect(pt(0, 0), pt(30, 30)));
    expect([d.height, d.reason]).toEqual([0, 'Floor level · aisle']);
  });
});

describe('resolve / surfaceHeight / walls', () => {
  const mixed = mk('Mixed', [
    obj({ name: 'Small desk', kind: 'desk', center: pt(3, 3), length: 2, width: 2 }),
    obj({ name: 'Big counter', kind: 'counter', center: pt(6, 3), length: 4, width: 3, top: 3 }),
  ]);
  const region = rect(pt(0, 0), pt(8, 5));
  it('most overlap wins; explicit index wins', () => {
    expect(resolve(mixed, 'Task', region)?.index).toBe(1);
    expect(resolve(mixed, 'Task', region, 0)?.index).toBe(0);
  });
  it('explicit index any kind; no acceptor', () => {
    expect(resolve(office(), 'Ambient', [], 3)?.index).toBe(3);
    expect(resolve(office(), 'Path', office().floor[0] as P2[])).toBeNull();
  });
  it('surface height', () => {
    expect(surfaceHeight(obj({ kind: 'desk', top: 2.54 }))).toBe(2.5);
    expect(surfaceHeight(obj({ kind: 'desk', top: 5 }))).toBe(2.5);
    expect(surfaceHeight(obj({ kind: 'counter', top: null }))).toBe(3);
    expect(surfaceHeight(obj({ kind: 'bar', top: 0.5 }))).toBe(3.5);
  });
  it('nearestWall', () => {
    expect(nearestWall(office(), pt(0, 0))).toBe(3);
    expect(nearestWall(office(), pt(18, 12), 1.5)).toBeNull();
  });
  it('wallFor', () => {
    const o = office();
    expect(wallFor(o, 'WallWash', [pt(1, 2), pt(1, 22)], null)).toBe(3);
    expect(wallFor(o, 'WallWash', [], 1)).toBe(1);
    expect(wallFor(o, 'WallWash', [], null, null)).toBeNull();
  });
});
