import { describe, expect, it } from 'vitest';
import {
  angleDeg,
  area,
  bounds,
  cafeteria,
  ceilingAt,
  centroid,
  closestOnSegment,
  contains,
  createRoom,
  cross,
  distanceToSegment,
  dot,
  footprint,
  heading,
  inRoom,
  inflate,
  lerp,
  lobby,
  orientedRect,
  overlapArea,
  p2,
  perp,
  polygonDistance,
  projectOn,
  rect,
  segmentsCross,
  signedArea,
  unit,
  zoneAt,
  type P2,
  type RoomObjectInfo,
} from '../src/index';

const Square: P2[] = [p2(0, 0), p2(10, 0), p2(10, 10), p2(0, 10)];
const CW: P2[] = [...Square].reverse();
const L: P2[] = [p2(0, 0), p2(10, 0), p2(10, 4), p2(4, 4), p2(4, 10), p2(0, 10)];
const close = (a: P2, b: P2, eps = 1e-9) => {
  expect(a.x).toBeCloseTo(b.x, -Math.log10(eps));
  expect(a.y).toBeCloseTo(b.y, -Math.log10(eps));
};
const obj = (center: P2, length: number, width: number): RoomObjectInfo => ({
  name: 'o',
  kind: 'desk',
  center,
  length,
  width,
  orientation: 0,
  top: 2.5,
  bottom: 0,
});

describe('geometry: vectors', () => {
  it('dot / cross', () => {
    expect(dot(p2(1, 2), p2(3, 4))).toBe(11);
    expect(cross(p2(1, 0), p2(0, 1))).toBe(1);
  });
  it('unit of zero', () => expect(unit(p2(0, 0))).toEqual({ x: 1, y: 0 }));
  it('unit', () => expect(unit(p2(3, 4))).toEqual({ x: 0.6, y: 0.8 }));
  it('perp', () => expect(perp(p2(1, 0))).toEqual({ x: -0, y: 1 }));
  it('perp value', () => {
    const v = perp(p2(1, 0));
    expect(v.x === 0 && v.y === 1).toBe(true);
  });
  it('angleDeg', () => expect(angleDeg(p2(0, -1))).toBe(-90));
  it('angleDeg range includes 180', () => expect(angleDeg(p2(-1, 0))).toBe(180));
  it('heading uses plain cos/sin', () => {
    expect(heading(90).x).toBe(Math.cos(Math.PI / 2));
    expect(heading(90).y).toBe(1);
    expect(heading(0)).toEqual({ x: 1, y: 0 });
  });
  it('lerp', () => expect(lerp(p2(0, 0), p2(10, 4), 0.5)).toEqual({ x: 5, y: 2 }));
});

describe('geometry: polygon measures', () => {
  it('area of square', () => expect(area(Square)).toBeCloseTo(100, 9));
  it('centroid of square', () => close(centroid(Square), p2(5, 5)));
  it('contains interior', () => expect(contains(Square, p2(5, 5))).toBe(true));
  it('boundary point is inside', () => expect(contains(Square, p2(10, 5))).toBe(true));
  it('outside right', () => expect(contains(Square, p2(10.5, 5))).toBe(false));
  it('outside left', () => expect(contains(Square, p2(-1, 5))).toBe(false));
  it('clockwise area', () => expect(area(CW)).toBe(100));
  it('clockwise contains', () => expect(contains(CW, p2(2, 2))).toBe(true));
  it('signed area sign', () => {
    expect(signedArea(Square)).toBe(100);
    expect(signedArea(CW)).toBe(-100);
  });
  it('signed area of < 3 points', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([p2(1, 1), p2(2, 3)])).toBe(0);
  });
  it('concave L area', () => expect(area(L)).toBe(64));
  it('concave contains (arm)', () => {
    expect(contains(L, p2(2, 8))).toBe(true);
    expect(contains(L, p2(8, 2))).toBe(true);
  });
  it('concave notch outside', () => expect(contains(L, p2(8, 8))).toBe(false));
  it('L centroid', () => close(centroid(L), p2(3.875, 3.875)));
  it('centroid of empty / degenerate', () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
    expect(centroid([p2(0, 0), p2(2, 4)])).toEqual({ x: 1, y: 2 });
  });
  it('contains with < 3 points', () => expect(contains([p2(0, 0), p2(1, 1)], p2(0, 0))).toBe(false));
});

describe('geometry: rectangles', () => {
  it('rect normalises corners', () => {
    const r = rect(p2(5, 4), p2(1, 1));
    expect(r).toEqual([p2(1, 1), p2(5, 1), p2(5, 4), p2(1, 4)]);
    expect(area(r)).toBe(12);
  });
  it('oriented rect at 90°', () => {
    const o = orientedRect(p2(10, 10), 6, 2, 90);
    const b = bounds(o);
    expect(b.max.x - b.min.x).toBeCloseTo(2, 9);
    expect(b.max.y - b.min.y).toBeCloseTo(6, 9);
    expect(area(o)).toBeCloseTo(12, 9);
    expect(centroid(o).x).toBeCloseTo(10, 9);
    [p2(11, 7), p2(11, 13), p2(9, 13), p2(9, 7)].forEach((v, i) => close(o[i] as P2, v));
    expect(signedArea(o)).toBeGreaterThan(0);
  });
  it('footprint = orientedRect of the object', () =>
    expect(footprint(obj(p2(3, 3), 2, 2))).toEqual(orientedRect(p2(3, 3), 2, 2, 0)));
});

describe('geometry: inflate', () => {
  it('inflate grows', () => {
    const g = inflate(Square, 1.5);
    expect(g).toEqual([p2(-1.5, -1.5), p2(11.5, -1.5), p2(11.5, 11.5), p2(-1.5, 11.5)]);
    expect(area(g)).toBeCloseTo(169, 6);
    expect(bounds(g).min.x).toBeCloseTo(-1.5, 9);
    expect(bounds(g).max.y).toBeCloseTo(11.5, 9);
  });
  it('inflate shrinks', () => {
    const s = inflate(Square, -2);
    expect(s).toEqual([p2(2, 2), p2(8, 2), p2(8, 8), p2(2, 8)]);
    expect(area(s)).toBeCloseTo(36, 6);
  });
  it('inflate ignores winding', () => expect(area(inflate(CW, 1.5))).toBeCloseTo(169, 6));
  it('inflate collapses, not inverts', () => expect(inflate(Square, -20)).toEqual([p2(5, 5)]));
  it('inflate collapse at exact width', () => expect(inflate(Square, -5)).toEqual([p2(5, 5)]));
  it('inflate tiny d', () => {
    const c = inflate(Square, 1e-10);
    expect(c).toEqual(Square);
    expect(c).not.toBe(Square);
  });
  it('inflate < 3 points', () => expect(inflate([p2(0, 0), p2(1, 0)], 1)).toEqual([p2(0, 0), p2(1, 0)]));
  it('inflate L keeps vertex count', () => expect(inflate(L, 0.5)).toHaveLength(6));
});

describe('geometry: segments', () => {
  it('distance to segment, perpendicular', () => expect(distanceToSegment(p2(5, 3), p2(0, 0), p2(10, 0))).toBe(3));
  it('distance to segment, beyond end', () => expect(distanceToSegment(p2(13, 4), p2(0, 0), p2(10, 0))).toBe(5));
  it('closest on segment', () => {
    const c = closestOnSegment(p2(4, 7), p2(0, 0), p2(10, 0));
    expect(c.point).toEqual({ x: 4, y: 0 });
    expect(c.t).toBe(0.4);
  });
  it('closest clamps before start', () => {
    const c = closestOnSegment(p2(-5, 1), p2(0, 0), p2(10, 0));
    expect(c.t).toBe(0);
    expect(c.point).toEqual({ x: 0, y: 0 });
  });
  it('zero-length segment', () => {
    const c = closestOnSegment(p2(1, 1), p2(0, 0), p2(0, 0));
    expect(c.t).toBe(0);
    expect(c.point).toEqual({ x: 0, y: 0 });
  });
  it('segmentsCross is strict', () => {
    expect(segmentsCross(p2(0, 0), p2(2, 2), p2(0, 2), p2(2, 0))).toBe(true);
    expect(segmentsCross(p2(0, 0), p2(2, 0), p2(2, 0), p2(2, 2))).toBe(false); // shared endpoint
    expect(segmentsCross(p2(0, 0), p2(2, 0), p2(1, 0), p2(3, 0))).toBe(false); // collinear overlap
  });
  it('projectOn', () => expect(projectOn(p2(0, 0), p2(1, 0), p2(3, 2))).toEqual({ along: 3, across: 2 }));
});

describe('geometry: bounds', () => {
  it('bounds of nothing', () => expect(bounds([])).toEqual({ min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }));
  it('bounds of two points', () =>
    expect(bounds([p2(3, -2), p2(-1, 8)])).toEqual({ min: { x: -1, y: -2 }, max: { x: 3, y: 8 } }));
});

describe('geometry: polygonDistance / overlapArea', () => {
  it('polygon distance overlap', () => expect(polygonDistance(Square, rect(p2(5, 5), p2(15, 15)))).toBe(0));
  it('polygon distance apart', () => expect(polygonDistance(Square, rect(p2(13, 0), p2(15, 10)))).toBe(3));
  it('polygon distance empty', () => expect(polygonDistance([], Square)).toBe(Number.MAX_VALUE));
  it('polygon distance of points (closed 1-point loops)', () =>
    expect(polygonDistance([p2(0, 0)], [p2(3, 4)])).toBe(5));
  it('overlap area full', () => expect(overlapArea(Square, rect(p2(2, 2), p2(4, 4)))).toBe(4));
  it('overlap area half', () => expect(overlapArea(Square, rect(p2(8, 0), p2(12, 10)))).toBe(20));
  it('overlap with < 3 points', () => expect(overlapArea(Square, [p2(1, 1)])).toBe(0));
  it('overlap: test fixture', () => {
    const region = rect(p2(0, 0), p2(8, 5));
    expect(overlapArea(region, footprint(obj(p2(3, 3), 2, 2)))).toBeCloseTo(4, 9);
    expect(overlapArea(region, footprint(obj(p2(6, 3), 4, 3)))).toBeCloseTo(12, 9);
  });
});

describe('geometry: room / ceiling queries', () => {
  const room = createRoom({ floor: [Square, [p2(4, 4), p2(6, 4), p2(6, 6), p2(4, 6)]] });
  it('in room, excludes holes', () => expect(inRoom(room, p2(2, 2))).toBe(true));
  it('inside the column', () => expect(inRoom(room, p2(5, 5))).toBe(false));
  it('outside room', () => expect(inRoom(room, p2(20, 5))).toBe(false));
  it('on the hole edge counts as room', () => expect(inRoom(room, p2(4, 5))).toBe(true));
  it('room without floor', () => expect(inRoom(createRoom({ floor: [] }), p2(0, 0))).toBe(false));
  it('ceiling under raised cloud', () => expect(ceilingAt(cafeteria(), p2(24, 16))).toBe(12));
  it('main ceiling', () => expect(ceilingAt(cafeteria(), p2(3, 3))).toBe(10));
  it('lobby soffit', () => expect(ceilingAt(lobby(), p2(20, 24))).toBe(10));
  it('lobby main', () => expect(ceilingAt(lobby(), p2(20, 14))).toBe(14));
  it('lobby vestibule', () => expect(ceilingAt(lobby(), p2(20, 2))).toBe(9));
  it('zoneAt under main', () => expect(zoneAt(cafeteria(), p2(3, 3))).toBeNull());
});
