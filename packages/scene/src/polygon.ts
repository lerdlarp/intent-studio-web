// Plan polygon helpers for extraction (plan metres): Douglas–Peucker, collinear cleanup, snapping raster outlines
// onto exact wall-section segments, convex hull and oriented bounding rectangles.
import { cross, distanceToSegment, dot, signedArea, sub, type P2 } from '@intent-studio/core';

export interface Segment {
  a: P2;
  b: P2;
}

/** Open-polyline Douglas–Peucker. Keeps both ends. */
function dpOpen(pts: readonly P2[], tol: number): P2[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let best = -1;
    let bestD = tol;
    for (let k = s + 1; k < e; k++) {
      const d = distanceToSegment(pts[k] as P2, pts[s] as P2, pts[e] as P2);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** Closed-loop Douglas–Peucker (split at the vertex farthest from vertex 0), then collinear cleanup. */
export function simplifyLoop(loop: readonly P2[], tol: number): P2[] {
  if (loop.length <= 3) return [...loop];
  const p0 = loop[0] as P2;
  let far = 1;
  let farD = -1;
  loop.forEach((p, k) => {
    const d = Math.hypot(p.x - p0.x, p.y - p0.y);
    if (d > farD) {
      farD = d;
      far = k;
    }
  });
  const a = dpOpen(loop.slice(0, far + 1), tol);
  const b = dpOpen([...loop.slice(far), p0], tol);
  return removeCollinear([...a.slice(0, -1), ...b.slice(0, -1)], tol);
}

/** Drop vertices within `tol` of the line through their neighbours, and duplicate points. */
export function removeCollinear(loop: readonly P2[], tol: number): P2[] {
  let pts = [...loop];
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let k = 0; k < pts.length && pts.length > 3; k++) {
      const prev = pts[(k - 1 + pts.length) % pts.length] as P2;
      const cur = pts[k] as P2;
      const next = pts[(k + 1) % pts.length] as P2;
      const dup = Math.hypot(cur.x - next.x, cur.y - next.y) < 1e-9;
      if (dup || distanceToSegment(cur, prev, next) <= tol) {
        pts.splice(k, 1);
        changed = true;
        k--;
      }
    }
  }
  if (pts.length < 3) pts = [...loop];
  return pts;
}

/** Same loop, wound counter-clockwise (`ccw = true`) or clockwise. */
export function orient(loop: readonly P2[], ccw: boolean): P2[] {
  const isCcw = signedArea(loop) > 0;
  return isCcw === ccw ? [...loop] : [...loop].reverse();
}

/** Rotate a loop so it starts at its south-west-most vertex (min y, then min x): deterministic wall numbering. */
export function startSouthWest(loop: readonly P2[]): P2[] {
  let best = 0;
  loop.forEach((p, k) => {
    const b = loop[best] as P2;
    if (p.y < b.y - 1e-6 || (Math.abs(p.y - b.y) <= 1e-6 && p.x < b.x)) best = k;
  });
  return [...loop.slice(best), ...loop.slice(0, best)];
}

interface Line {
  p: P2;
  d: P2;
}

function intersect(l1: Line, l2: Line): P2 | null {
  const den = cross(l1.d, l2.d);
  if (Math.abs(den) < Math.sin((2 * Math.PI) / 180)) return null;
  const t = cross(sub(l2.p, l1.p), l2.d) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

/**
 * Move each edge of a raster-derived loop onto the section segments that support it: segments within `tol` of the
 * edge line, within `maxAngleDeg` of its direction and overlapping it. The fitted line is the overlap-weighted mean
 * of the supporting segments; vertices are re-intersected. Edges without support stay where they are.
 */
export function snapLoop(loop: readonly P2[], segments: readonly Segment[], tol: number, maxAngleDeg = 4): P2[] {
  const n = loop.length;
  if (n < 3) return [...loop];
  const sinMax = Math.sin((maxAngleDeg * Math.PI) / 180);
  const lines: Line[] = [];
  for (let k = 0; k < n; k++) {
    const p = loop[k] as P2;
    const q = loop[(k + 1) % n] as P2;
    const L = Math.hypot(q.x - p.x, q.y - p.y);
    if (L < 1e-9) {
      lines.push({ p, d: { x: 1, y: 0 } });
      continue;
    }
    const d = { x: (q.x - p.x) / L, y: (q.y - p.y) / L };
    const nrm = { x: -d.y, y: d.x };
    let wSum = 0;
    let offSum = 0;
    let dx = 0;
    let dy = 0;
    for (const s of segments) {
      const sl = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      if (sl < 1e-6) continue;
      let sd = { x: (s.b.x - s.a.x) / sl, y: (s.b.y - s.a.y) / sl };
      if (Math.abs(cross(sd, d)) > sinMax) continue;
      if (dot(sd, d) < 0) sd = { x: -sd.x, y: -sd.y };
      const ta = dot(sub(s.a, p), d);
      const tb = dot(sub(s.b, p), d);
      const lo = Math.max(Math.min(ta, tb), 0);
      const hi = Math.min(Math.max(ta, tb), L);
      const overlap = hi - lo;
      if (overlap <= Math.min(0.01, L * 0.05)) continue;
      // Offsets of the segment at the ends of the overlap.
      const at = (t: number): number => {
        const u = (t - ta) / (tb - ta || 1);
        const x = s.a.x + (s.b.x - s.a.x) * u;
        const y = s.a.y + (s.b.y - s.a.y) * u;
        return dot({ x: x - p.x, y: y - p.y }, nrm);
      };
      const o1 = at(lo);
      const o2 = at(hi);
      if (Math.abs(o1) > tol || Math.abs(o2) > tol) continue;
      wSum += overlap;
      offSum += ((o1 + o2) / 2) * overlap;
      dx += sd.x * overlap;
      dy += sd.y * overlap;
    }
    if (wSum <= 0) {
      lines.push({ p, d });
      continue;
    }
    const dl = Math.hypot(dx, dy);
    const off = offSum / wSum;
    const mid = { x: (p.x + q.x) / 2 + nrm.x * off, y: (p.y + q.y) / 2 + nrm.y * off };
    lines.push({ p: mid, d: { x: dx / dl, y: dy / dl } });
  }
  const out: P2[] = [];
  for (let k = 0; k < n; k++) {
    const prev = lines[(k - 1 + n) % n] as Line;
    const cur = lines[k] as Line;
    const x = intersect(prev, cur);
    if (x) out.push(x);
    else {
      const v = loop[k] as P2;
      const t = dot(sub(v, cur.p), cur.d);
      out.push({ x: cur.p.x + cur.d.x * t, y: cur.p.y + cur.d.y * t });
    }
  }
  return removeCollinear(out, 1e-4);
}

/** Andrew's monotone chain; CCW, no collinear points. */
export function convexHull(points: readonly P2[]): P2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const turn = (o: P2, a: P2, b: P2): number => cross(sub(a, o), sub(b, o));
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2] as P2, lower[lower.length - 1] as P2, p) <= 1e-12)
      lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k] as P2;
    while (upper.length >= 2 && turn(upper[upper.length - 2] as P2, upper[upper.length - 1] as P2, p) <= 1e-12)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export interface OrientedRect {
  center: P2;
  /** Along `orientation` (the longer side). */
  length: number;
  width: number;
  /** Degrees CCW from +X, in [0, 180). */
  orientation: number;
}

/** Principal-axis angle (radians) of a point set in plan (PCA of the 2×2 covariance). */
export function principalAngle(points: readonly P2[]): number {
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length || 1;
  my /= points.length || 1;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

function normaliseDeg(deg: number): number {
  let d = deg % 180;
  if (d < 0) d += 180;
  const r = Math.round(d);
  if (Math.abs(d - r) < 1e-6) d = r;
  return d >= 180 ? d - 180 : d;
}

/**
 * Oriented bounding rectangle in plan. Candidates: the PCA principal axis, the world axes and every convex-hull
 * edge direction; the smallest area wins (earlier candidates win near-ties, so a clean PCA/axis answer is kept).
 * PCA alone is ambiguous for square-ish footprints, hence the hull-edge candidates (rotating calipers).
 */
export function orientedBounds(points: readonly P2[]): OrientedRect {
  const hull = convexHull(points);
  const src = hull.length >= 3 ? hull : points;
  const angles = [principalAngle(points), 0];
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k] as P2;
    const b = hull[(k + 1) % hull.length] as P2;
    angles.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  let best: { area: number; rect: OrientedRect } | null = null;
  for (const th of angles) {
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of src) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const lu = u1 - u0;
    const lv = v1 - v0;
    const area = lu * lv;
    if (best && area >= best.area * (1 - 1e-6) - 1e-12) continue;
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const center = { x: cu * ux - cv * uy, y: cu * uy + cv * ux };
    const deg = (th * 180) / Math.PI;
    const rect: OrientedRect =
      lu >= lv
        ? { center, length: lu, width: lv, orientation: normaliseDeg(deg) }
        : { center, length: lv, width: lu, orientation: normaliseDeg(deg + 90) };
    best = { area, rect };
  }
  return (best as { rect: OrientedRect }).rect;
}
