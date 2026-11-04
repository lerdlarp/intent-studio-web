// Plan geometry in feet (spec/geometry.md). Pure functions; polygons are implicitly closed and either winding.
import type { CeilingZoneInfo, P2, RoomObjectInfo, StudioRoom } from './model';

export const EPS = 1e-9;
/** Boundary tolerance used by contains / onBoundary. */
export const BOUNDARY_EPS = 1e-7;

export type Polygon = P2[];
export interface Bounds {
  min: P2;
  max: P2;
}

// §1 Vector helpers (and the P2 operations of model.md §1)

export const add = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: P2, k: number): P2 => ({ x: a.x * k, y: a.y * k });
/** |v|. */
export const norm = (v: P2): number => Math.sqrt(v.x * v.x + v.y * v.y);
export const dot = (a: P2, b: P2): number => a.x * b.x + a.y * b.y;
/** Positive when b is counter-clockwise of a. */
export const cross = (a: P2, b: P2): number => a.x * b.y - a.y * b.x;
export const distance = (a: P2, b: P2): number => norm(sub(a, b));
/** v / |v|; (1, 0) when |v| < 1e-9. */
export function unit(v: P2): P2 {
  const l = norm(v);
  return l < EPS ? { x: 1, y: 0 } : { x: v.x / l, y: v.y / l };
}
/** v rotated +90° (to the left). */
export const perp = (v: P2): P2 => ({ x: -v.y, y: v.x });
export const lerp = (a: P2, b: P2, t: number): P2 => add(a, scale(sub(b, a), t));
/** Unit vector `deg` degrees CCW from +X (plain floating cos/sin). */
export function heading(deg: number): P2 {
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}
/** atan2(v.y, v.x) in degrees, (−180, 180]. */
export const angleDeg = (v: P2): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;

// §2 Polygon measures

/** Shoelace; positive for CCW; 0 for < 3 points. */
export function signedArea(poly: readonly P2[]): number {
  const n = poly.length;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[j] as P2;
    const b = poly[i] as P2;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
export const area = (poly: readonly P2[]): number => Math.abs(signedArea(poly));

export function centroid(poly: readonly P2[]): P2 {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  const A = signedArea(poly);
  if (Math.abs(A) < EPS) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[j] as P2;
    const b = poly[i] as P2;
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Point in polygon; boundary (within 1e-7) counts as inside; false for < 3 vertices. */
export function contains(poly: readonly P2[], p: P2): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i] as P2;
    const b = poly[j] as P2;
    if (distanceToSegment(p, a, b) < BOUNDARY_EPS) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when p is within 1e-7 of any edge. */
export function onBoundary(poly: readonly P2[], p: P2): boolean {
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (distanceToSegment(p, poly[i] as P2, poly[j] as P2) < BOUNDARY_EPS) return true;
  }
  return false;
}

// §3 Rectangles

/** Axis-aligned rectangle from two corners, CCW from lower-left. */
export function rect(a: P2, b: P2): Polygon {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Rectangle of `length` along `orientationDeg` and `width` across, CCW for positive sizes. */
export function orientedRect(center: P2, length: number, width: number, orientationDeg: number): Polygon {
  const u = heading(orientationDeg);
  const v = perp(u);
  const hl = length / 2;
  const hw = width / 2;
  const at = (su: number, sv: number): P2 => add(add(center, scale(u, su)), scale(v, sv));
  return [at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw)];
}

export const footprint = (o: RoomObjectInfo): Polygon => orientedRect(o.center, o.length, o.width, o.orientation);

// §4 inflate

/** Miter offset: d > 0 grows, d < 0 shrinks; a collapsing shrink returns [centroid(poly)]. */
export function inflate(poly: readonly P2[], d: number): Polygon {
  const n = poly.length;
  if (n < 3 || Math.abs(d) < EPS) return poly.map((p) => ({ x: p.x, y: p.y }));
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const at = (i: number): P2 => poly[((i % n) + n) % n] as P2;
  const normals: P2[] = [];
  for (let i = 0; i < n; i++) {
    const e = sub(at(i + 1), at(i));
    const len = norm(e);
    normals.push(len < EPS ? { x: 0, y: 0 } : scale({ x: e.y, y: -e.x }, sign / len));
  }
  const result: Polygon = [];
  for (let i = 0; i < n; i++) {
    const prev = normals[(i - 1 + n) % n] as P2;
    const next = normals[i] as P2;
    const bis = add(prev, next);
    const denom = 1 + dot(prev, next);
    if (denom < 1e-6) {
      result.push(add(at(i), scale(next, d)));
    } else {
      let move = scale(bis, d / denom);
      const ml = norm(move);
      const cap = 3 * Math.abs(d);
      if (ml > cap) move = scale(move, cap / ml);
      result.push(add(at(i), move));
    }
  }
  if (d < 0) {
    let flipped = false;
    for (let i = 0; i < n && !flipped; i++) {
      const before = sub(at(i + 1), at(i));
      const after = sub(result[(i + 1) % n] as P2, result[i] as P2);
      if (dot(before, after) < -1e-9) flipped = true;
    }
    if (area(result) < 1e-6 || signedArea(result) * sign < 0 || flipped) return [centroid(poly)];
  }
  return result;
}

// §5 Segments

export function closestOnSegment(p: P2, a: P2, b: P2): { point: P2; t: number } {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < EPS) return { point: { x: a.x, y: a.y }, t: 0 };
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  return { point: add(a, scale(ab, t)), t };
}
export const distanceToSegment = (p: P2, a: P2, b: P2): number => distance(p, closestOnSegment(p, a, b).point);

/** Proper crossing only (touching, shared endpoints and collinear overlap are not crossings). */
export function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Coordinates of p along `direction` from `origin` and across it (positive to the left). */
export function projectOn(origin: P2, direction: P2, p: P2): { along: number; across: number } {
  const d = sub(p, origin);
  return { along: dot(d, direction), across: cross(direction, d) };
}

// §6 bounds

/** Component-wise min/max; ((0,0),(0,0)) for no points. */
export function bounds(points: readonly P2[]): Bounds {
  if (points.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

// §7 polygonDistance

/** Smallest boundary distance, 0 when overlapping or crossing, Number.MAX_VALUE when either is empty. */
export function polygonDistance(a: readonly P2[], b: readonly P2[]): number {
  if (a.length === 0 || b.length === 0) return Number.MAX_VALUE;
  if (a.length >= 3 && b.length >= 3 && (contains(a, b[0] as P2) || contains(b, a[0] as P2))) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i] as P2;
    const a1 = a[(i + 1) % a.length] as P2;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j] as P2;
      const b1 = b[(j + 1) % b.length] as P2;
      if (segmentsCross(a0, a1, b0, b1)) return 0;
      best = Math.min(
        best,
        distanceToSegment(a0, b0, b1),
        distanceToSegment(a1, b0, b1),
        distanceToSegment(b0, a0, a1),
        distanceToSegment(b1, a0, a1),
      );
    }
  }
  return best;
}

// §8 overlapArea

/** Approximate area of `shape` inside `region` by sampling a samples × samples grid over shape's bounds. */
export function overlapArea(region: readonly P2[], shape: readonly P2[], samples = 12): number {
  if (region.length < 3 || shape.length < 3) return 0;
  const { min: lo, max: hi } = bounds(shape);
  let total = 0;
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const p = {
        x: lo.x + ((i + 0.5) / samples) * (hi.x - lo.x),
        y: lo.y + ((j + 0.5) / samples) * (hi.y - lo.y),
      };
      if (!contains(shape, p)) continue;
      total++;
      if (contains(region, p)) hits++;
    }
  }
  return total === 0 ? 0 : (area(shape) * hits) / total;
}

// §9 Room / ceiling queries

function inLoops(loops: readonly (readonly P2[])[], p: P2): boolean {
  const outer = loops[0];
  if (!outer || !contains(outer, p)) return false;
  for (let k = 1; k < loops.length; k++) {
    const hole = loops[k] as P2[];
    if (contains(hole, p) && !onBoundary(hole, p)) return false;
  }
  return true;
}

/** In floor[0] and not strictly inside a hole (a hole's edge counts as room). */
export const inRoom = (room: StudioRoom, p: P2): boolean => inLoops(room.floor, p);
/** Same rule on a ceiling zone's loops. */
export const zoneContains = (zone: CeilingZoneInfo, p: P2): boolean => inLoops(zone.loops, p);

/** The last non-main ceiling zone containing p, or null (main ceiling). */
export function zoneAt(room: StudioRoom, p: P2): CeilingZoneInfo | null {
  for (let i = room.ceilingZones.length - 1; i >= 0; i--) {
    const z = room.ceilingZones[i] as CeilingZoneInfo;
    if (!z.isMain && zoneContains(z, p)) return z;
  }
  return null;
}

/** Ceiling height above p. */
export const ceilingAt = (room: StudioRoom, p: P2): number => zoneAt(room, p)?.height ?? room.ceilingHeight;
