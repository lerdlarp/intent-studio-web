// Per-kind layout generators, mounting, settling, ceiling-grid snapping and keep-dim helpers (spec/solver-layouts.md).
import { roundHalfEven } from '../format';
import {
  add,
  angleDeg,
  area as polyArea,
  bounds,
  ceilingAt,
  centroid,
  contains,
  cross,
  distance,
  dot,
  footprint,
  heading,
  inflate,
  inRoom,
  lerp,
  norm,
  perp,
  polygonDistance,
  scale,
  signedArea,
  sub,
  unit,
  zoneAt,
} from '../geometry';
import { newUuid, wallDirection, wallLength, type LightingIntent, type P2, type StudioFixture } from '../model';
import { roomBounds } from '../model';
import { wallName } from '../defaults';
import { feetInches } from '../units';
import { surfaceHeight, wallFor, kindOf } from '../workplane';
import { zoneShape } from '../zones';
import {
  D0,
  D1,
  D2,
  F1,
  clamp,
  ctxDensity,
  isCove,
  isLinear,
  isPendant,
  want,
  type Ctx,
} from './context';
import { overlapsWallWash } from './fixture-overlap';

export interface Point {
  p: P2;
  orientation: number;
}
export interface LayoutResult {
  fixtures: StudioFixture[];
  how: string;
}

function fixture(ctx: Ctx, center: P2, orientation: number, mount: string, height: number, tilt = 0): StudioFixture {
  return {
    id: newUuid(),
    intentId: ctx.intent.id,
    center: { x: center.x, y: center.y },
    orientation,
    mount,
    height,
    tilt,
    output: 1,
    pinned: false,
  };
}

const inKeep = (ctx: Ctx, p: P2): boolean => ctx.keeps.some((k) => contains(k.zone, p));
const inTaskRegion = (ctx: Ctx, p: P2): boolean => ctx.taskRegions.some((region) => contains(region, p));

// §1 Dispatch ----------------------------------------------------------------------------------------------------------

export function layout(ctx: Ctx, factor: number, pinnedCount: number): LayoutResult {
  switch (ctx.intent.kind) {
    case 'Ambient':
    case 'Task':
    case 'Path':
      return areaLayout(ctx, factor, pinnedCount);
    case 'WallWash':
      return washLayout(ctx, factor);
    case 'Accent':
      return accentLayout(ctx, factor);
    case 'FeaturePendant':
      return pendantLayout(ctx, factor);
    case 'CeilingGlow':
      return glowLayout(ctx, factor);
    default:
      return { fixtures: [], how: '' };
  }
}

// §2 Area intents --------------------------------------------------------------------------------------------------------

export function areaLayout(ctx: Ctx, factor: number, pinnedCount: number): LayoutResult {
  const { intent, design, product } = ctx;
  const room = design.room;
  const floor0 = room.floor[0];
  const region = intent.region.length >= 3 ? intent.region : floor0 ? floor0 : intent.region;
  if (region.length < 3) return { fixtures: [], how: 'no region to light' };
  const area = Math.max(polyArea(region), 1);
  const c = centroid(region);
  const plane = intent.plane.kind === 'Horizontal' ? intent.plane.height : 0;
  const mountH = mounting(ctx, c, null).height - plane;
  const w = want(intent);

  const { min: lo, max: hi } = roomBounds(room);
  const rl = Math.max(hi.x - lo.x, 1);
  const rw = Math.max(hi.y - lo.y, 1);
  const rcr = (5 * Math.max(mountH, 1) * (rl + rw)) / (rl * rw);
  const cu = clamp(0.72 - 0.035 * rcr, 0.45, 0.7);
  const lumen = Math.ceil((w * area) / (Math.max(product.lumens, 1) * cu * 0.85));
  const density = ctxDensity(ctx);
  const quantity = intent.behavior.quantity;
  let n = quantity !== null ? quantity : Math.ceil((lumen * factor) / (density * density));
  n = clamp(n - pinnedCount, 1, 300);
  const maxSpacing = 1.3 * Math.max(mountH, 2);

  let how: string;
  if (quantity !== null) how = `quantity fixed at ${quantity}`;
  else {
    how = `lumen method for ${F1(w)} fc over ${D0(area)} ft² (CU ${D2(cu)}, LLF 0.85) gives ${lumen}`;
    if (density !== 1) how += `, density ${D1(density)}`;
  }
  const pattern =
    intent.behavior.pattern !== null
      ? intent.behavior.pattern.toLowerCase()
      : intent.kind === 'Path' || isLinear(product)
        ? 'rows'
        : 'grid';

  let points: Point[];
  if (intent.kind === 'Path') points = pathPoints(region, n, maxSpacing, ctx);
  else if (pattern === 'perimeter') points = perimeterPoints(region, n);
  else if (pattern === 'rows') points = rowPoints(region, n, maxSpacing, product.length);
  else points = gridPoints(region, n, maxSpacing, pattern === 'staggered');

  if (quantity !== null && points.length > n) {
    points = thin(
      points.filter((pt) => inRoom(room, pt.p) && !inKeep(ctx, pt.p)),
      Math.max(n, 1),
    );
  }
  let fixtures = points.map((pt) => {
    const m = mounting(ctx, pt.p, null);
    return fixture(ctx, pt.p, pt.orientation, m.mount, m.height);
  });
  fixtures = alignToGrid(ctx, fixtures);
  if (pattern !== 'grid' && intent.kind !== 'Path') how += `, ${pattern} pattern`;
  return { fixtures, how };
}

export function gridPoints(region: readonly P2[], n: number, maxSpacing: number, staggered: boolean): Point[] {
  const { min: lo, max: hi } = bounds(region);
  const w = Math.max(hi.x - lo.x, 0.5);
  const h = Math.max(hi.y - lo.y, 0.5);
  let fill = clamp(polyArea(region) / (w * h), 0.15, 1);
  const orientation = w >= h ? 0 : 90;
  let best: Point[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    let nbox = Math.ceil(n / fill);
    nbox = Math.max(nbox, Math.ceil(w / maxSpacing) * Math.ceil(h / maxSpacing));
    nbox = Math.min(nbox, 600);
    const [cols, rows] = factorGrid(nbox, w, h, maxSpacing);
    const sx = w / cols;
    const sy = h / rows;
    const pts: Point[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const fx = staggered && cols > 1 ? i + (j % 2 === 0 ? 0.25 : 0.75) : i + 0.5;
        const p = { x: lo.x + fx * sx, y: lo.y + (j + 0.5) * sy };
        if (contains(region, p)) pts.push({ p, orientation });
      }
    }
    if (best.length === 0 || Math.abs(pts.length - n) < Math.abs(best.length - n)) best = pts;
    if (pts.length >= n || (fill >= 0.999 && pts.length > 0)) break;
    fill = Math.max(0.15, fill * 0.85);
  }
  if (best.length === 0) return [{ p: centroid(region), orientation }];
  return best;
}

export function factorGrid(count: number, w: number, h: number, maxSpacing: number): [number, number] {
  let best: [number, number] = [1, Math.max(1, count)];
  let bestCost = Infinity;
  const top = Math.max(1, count);
  for (let cols = 1; cols <= top; cols++) {
    const rows = Math.ceil(count / cols);
    const sx = w / cols;
    const sy = h / rows;
    let cost = cols * rows - count + 4 * Math.abs(Math.log(sx / sy));
    const mx = Math.max(sx, sy);
    if (mx > maxSpacing) cost += 50 * (mx / maxSpacing - 1);
    if (cost < bestCost) {
      bestCost = cost;
      best = [cols, rows];
    }
  }
  return best;
}

function rowLoop(region: readonly P2[], lo: P2, alongX: boolean, lng: number, sht: number, rows: number, perRow: number): Point[] {
  const orientation = alongX ? 0 : 90;
  const pts: Point[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < perRow; i++) {
      const u = (lng * (i + 0.5)) / perRow;
      const v = (sht * (j + 0.5)) / rows;
      const p = alongX ? { x: lo.x + u, y: lo.y + v } : { x: lo.x + v, y: lo.y + u };
      if (contains(region, p)) pts.push({ p, orientation });
    }
  }
  return pts.length > 0 ? pts : [{ p: centroid(region), orientation }];
}

function axes(region: readonly P2[]) {
  const { min: lo, max: hi } = bounds(region);
  const w = Math.max(hi.x - lo.x, 0.5);
  const h = Math.max(hi.y - lo.y, 0.5);
  const alongX = w >= h;
  return { lo, w, h, alongX, lng: alongX ? w : h, sht: alongX ? h : w };
}

export function rowPoints(region: readonly P2[], n: number, maxSpacing: number, length: number): Point[] {
  const { lo, w, h, alongX, lng, sht } = axes(region);
  const s0 = Math.sqrt((w * h) / Math.max(n, 1));
  let rows = clamp(roundHalfEven(sht / Math.max(s0, 0.5)), 1, Math.max(1, n));
  rows = Math.max(rows, Math.ceil(sht / maxSpacing));
  let perRow = Math.ceil(n / rows);
  while (perRow * length > lng * 0.98 && perRow > 1) {
    rows += 1;
    perRow = Math.ceil(n / rows);
  }
  return rowLoop(region, lo, alongX, lng, sht, rows, perRow);
}

export function perimeterPoints(region: readonly P2[], n: number): Point[] {
  let loop = inflate(region, -1.5);
  if (loop.length < 3) loop = region.map((p) => ({ x: p.x, y: p.y }));
  const m = loop.length;
  const L: number[] = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const d = distance(loop[i]!, loop[(i + 1) % m]!);
    L.push(d);
    total += d;
  }
  const count = Math.max(n, 1);
  const pts: Point[] = [];
  for (let k = 0; k < count; k++) {
    let sPos = (total * (k + 0.5)) / count;
    for (let i = 0; i < m; i++) {
      const Li = L[i]!;
      if (sPos <= Li || i === m - 1) {
        const t = Li < 1e-9 ? 0 : sPos / Li;
        const a = loop[i]!;
        const b = loop[(i + 1) % m]!;
        pts.push({ p: lerp(a, b, clamp(t, 0, 1)), orientation: angleDeg(sub(b, a)) });
        break;
      }
      sPos -= Li;
    }
  }
  return pts;
}

export function pathPoints(region: readonly P2[], n: number, maxSpacing: number, ctx: Ctx): Point[] {
  const { lo, alongX, lng, sht } = axes(region);
  const rows = Math.max(1, Math.ceil(sht / maxSpacing));
  let perRow = Math.max(Math.ceil(n / rows), Math.ceil(lng / maxSpacing));
  const q = ctx.intent.behavior.quantity;
  if (q !== null) perRow = Math.max(1, Math.ceil(q / rows));
  return rowLoop(region, lo, alongX, lng, sht, rows, perRow);
}

export function thin(points: Point[], n: number): Point[] {
  const pts = points.slice();
  while (pts.length > n) {
    let worst = Infinity;
    let at = 0;
    for (let i = 0; i < pts.length; i++) {
      let nearest = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (j !== i) nearest = Math.min(nearest, distance(pts[i]!.p, pts[j]!.p));
      }
      if (nearest <= worst + 1e-9) {
        worst = nearest;
        at = i;
      }
    }
    pts.splice(at, 1);
  }
  return pts;
}

// §3 Wall wash -----------------------------------------------------------------------------------------------------------

export const asVertical = (intent: LightingIntent): LightingIntent =>
  intent.plane.kind === 'Vertical'
    ? intent
    : {
        ...intent,
        plane: { kind: 'Vertical', height: 2, bottom: 2, top: 8, inferred: true, reason: '' },
      };

export function washLayout(ctx: Ctx, factor: number): LayoutResult {
  const { design, intent, product } = ctx;
  const room = design.room;
  const shape = room.walls.length === 0 ? null : zoneShape(design, asVertical(intent));
  if (!shape) return { fixtures: [], how: 'no wall to wash' };
  const wi = wallFor(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex);
  if (wi === null) return { fixtures: [], how: 'no wall to wash' };
  const wall = room.walls[wi]!;
  const dir = wallDirection(wall);
  const start = wall.start;
  const t0 = dot(sub(shape.from, start), dir);
  const t1 = dot(sub(shape.to, start), dir);
  const len = Math.max(t1 - t0, 1);
  const top = wall.top > 0 ? wall.top : room.ceilingHeight;
  const offset = intent.behavior.wallOffset !== null ? intent.behavior.wallOffset : clamp(top / 3, 2, 4);
  const spacing = offset * ctxDensity(ctx);
  const fewest = Math.max(1, Math.ceil(len / (1.5 * spacing)));
  const q = intent.behavior.quantity;
  let n = q !== null ? q : Math.max(fewest, roundHalfEven((len * factor) / spacing));
  n = clamp(n, 1, 300);
  const faceMid = intent.plane.kind === 'Vertical' ? (intent.plane.bottom + intent.plane.top) / 2 : top / 2;
  const toWall = angleDeg({ x: wall.inward.x * -1, y: wall.inward.y * -1 });
  const fixtures: StudioFixture[] = [];
  for (let k = 0; k < n; k++) {
    const t = t0 + (len * (k + 0.5)) / n;
    const at = add(add(start, scale(dir, t)), scale(wall.inward, offset));
    const m = mounting(ctx, at, null);
    const tilt = product.asymmetric
      ? 0
      : clamp((Math.atan2(offset, Math.max(m.height - faceMid, 1)) * 180) / Math.PI, 5, 60);
    fixtures.push(fixture(ctx, at, toWall, m.mount, m.height, tilt));
  }
  const how = `${n} along ${wallName(room, wi)}, ${F1(offset)} ft off the wall at ${D1(len / n)} ft on centre (first ${D1(len / n / 2)} ft in from each end)`;
  return { fixtures, how };
}

// §4 Accent ---------------------------------------------------------------------------------------------------------------

const validObject = (ctx: Ctx): number | null => {
  const oi = ctx.intent.objectIndex;
  return oi !== null && oi >= 0 && oi < ctx.design.room.objects.length ? oi : null;
};

export function accentLayout(ctx: Ctx, factor: number): LayoutResult {
  const { design, intent } = ctx;
  const room = design.room;
  const b = intent.behavior;
  const aim = clamp(b.aimAngle ?? 30, 5, 70);
  const tanAim = Math.tan((aim * Math.PI) / 180);
  const floor0 = room.floor[0];
  const target: P2 = intent.region[0] ?? (floor0 ? centroid(floor0) : { x: 0, y: 0 });
  const plane = intent.plane;
  const wi =
    plane.kind === 'Vertical' ? wallFor(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex) : null;
  if (wi !== null) {
    const wall = room.walls[wi]!;
    const dir = wallDirection(wall);
    const start = wall.start;
    const wl = wallLength(wall);
    const t = clamp(dot(sub(target, start), dir), 0, wl);
    const mid = (plane.bottom + (plane.top > plane.bottom ? plane.top : plane.bottom + 4)) / 2;
    const ceiling = ceilingAt(room, add(add(start, scale(dir, t)), scale(wall.inward, 2)));
    const drop = Math.max(ceiling - mid, 1.5);
    const offset = b.wallOffset !== null ? b.wallOffset : clamp(drop * tanAim, 1, 6);
    const oi = validObject(ctx);
    const obj = oi === null ? null : room.objects[oi]!;
    const extentCount = obj === null ? 1 : Math.max(obj.length, obj.width) > 8 ? 2 : 1;
    const count = clamp(b.quantity !== null ? b.quantity : clamp(roundHalfEven(extentCount * factor), 1, 4), 1, 6);
    let extent = 0;
    if (obj !== null) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of footprint(obj)) {
        const d = dot(sub(c, start), dir);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      extent = hi - lo;
    }
    const spread = clamp(extent / (count + 1), 1.5, 3);
    const aimPoint = add(start, scale(dir, t));
    const fixtures: StudioFixture[] = [];
    for (let k = 0; k < count; k++) {
      const tk = count === 1 ? t : clamp(t + (k - (count - 1) / 2) * spread, 0, wl);
      const at = add(add(start, scale(dir, tk)), scale(wall.inward, offset));
      const m = mounting(ctx, at, null);
      const toTarget = sub(aimPoint, at);
      const tilt = (Math.atan2(norm(toTarget), Math.max(m.height - mid, 1)) * 180) / Math.PI;
      fixtures.push(fixture(ctx, at, angleDeg(toTarget), m.mount, m.height, tilt));
    }
    return { fixtures, how: `${count} aimed ${D0(aim)}° at the face, ${F1(offset)} ft out from the wall` };
  }
  const floorC = floor0 ? centroid(floor0) : target;
  const away = unit(sub(floorC, target));
  const ceiling = ceilingAt(room, target);
  const h = plane.kind === 'Horizontal' ? plane.height : 0;
  const drop = Math.max(ceiling - h, 1.5);
  const offset = b.wallOffset !== null ? b.wallOffset : clamp(drop * tanAim, 1, 6);
  let at = add(target, scale(away, offset));
  if (!inRoom(room, at)) at = target;
  const m = mounting(ctx, at, null);
  const tilt = (Math.atan2(distance(at, target), Math.max(m.height - h, 1)) * 180) / Math.PI;
  const f = fixture(ctx, at, angleDeg(sub(target, at)), m.mount, m.height, tilt);
  return { fixtures: [f], how: `one aimed ${D0(aim)}° at the target from ${F1(offset)} ft away` };
}

// §5 Feature pendants -----------------------------------------------------------------------------------------------------

const SURFACE = ['desk', 'table', 'counter', 'reception', 'island', 'bar'];
const LONG_RUN = ['counter', 'bar', 'island', 'reception'];

export function pendantLayout(ctx: Ctx, factor: number): LayoutResult {
  const { design, intent } = ctx;
  const room = design.room;
  const oi = validObject(ctx);
  const objs =
    oi !== null
      ? [room.objects[oi]!]
      : intent.region.length >= 3
        ? room.objects.filter((o) => SURFACE.includes(kindOf(o)) && contains(intent.region, o.center))
        : [];
  const planeH = intent.plane.kind === 'Horizontal' ? intent.plane.height : 2.5;
  const q = intent.behavior.quantity;
  const pts: { p: P2; orientation: number; top: number }[] = [];
  let how: string;
  if (objs.length > 0) {
    for (const o of objs) {
      const top = o.top === null ? planeH : surfaceHeight(o);
      let u = heading(o.orientation);
      let len = o.length;
      let wid = o.width;
      if (wid > len) {
        [len, wid] = [wid, len];
        u = perp(u);
      }
      const longRun = len >= 5 && (LONG_RUN.includes(kindOf(o)) || len / Math.max(wid, 0.1) >= 2);
      let count = longRun ? Math.max(2, roundHalfEven((len * factor) / 3.2)) : Math.max(1, roundHalfEven(factor));
      if (q !== null) count = Math.max(1, Math.ceil(q / objs.length));
      for (let k = 0; k < count; k++) {
        const off = count === 1 ? 0 : -len / 2 + (len * (k + 0.5)) / count;
        pts.push({ p: add(o.center, scale(u, off)), orientation: angleDeg(u), top });
      }
    }
    how = objs.length === 1 ? `${pts.length} over ${objs[0]!.name}` : `${pts.length} over ${objs.length} tables`;
  } else if (intent.region.length >= 3) {
    const a = polyArea(intent.region);
    const n = q !== null ? q : Math.max(1, roundHalfEven((a * factor) / 22));
    const spacing = 1.3 * Math.max(ceilingAt(room, centroid(intent.region)) - planeH, 2);
    for (const g of gridPoints(intent.region, n, spacing, false)) pts.push({ ...g, top: planeH });
    how = `${pts.length} spread evenly over ${D0(a)} ft²`;
  } else {
    return { fixtures: [], how: 'no region to hang pendants over' };
  }
  const fixtures = pts.map((pt) => {
    const m = mounting(ctx, pt.p, pt.top);
    return fixture(ctx, pt.p, pt.orientation, m.mount, m.height);
  });
  return { fixtures, how };
}

// §6 Ceiling glow -------------------------------------------------------------------------------------------------------

export function glowLayout(ctx: Ctx, factor: number): LayoutResult {
  const { design, intent } = ctx;
  const room = design.room;
  const region = intent.region;
  if (region.length < 3) return { fixtures: [], how: 'no ceiling zone to glow' };
  const sign = signedArea(region) >= 0 ? 1 : -1;
  const loop = inflate(region, -0.5);
  if (loop.length < 3) return { fixtures: [], how: 'the ceiling zone is too small for cove' };
  const zoneHeight =
    intent.plane.kind === 'Ceiling' && intent.plane.height > 0 ? intent.plane.height : ceilingAt(room, centroid(region));
  const fixtures: StudioFixture[] = [];
  const mm = loop.length;
  for (let i = 0; i < mm; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % mm]!;
    const len = distance(a, b);
    if (len < 2) continue;
    const dir = unit(sub(b, a));
    const inward = scale(perp(dir), sign);
    const full = Math.max(1, Math.floor(len / 4));
    const m = factor >= 0.999 ? full : Math.max(1, roundHalfEven(full * factor));
    const start = (len - m * 4) / 2;
    const pitch = len / m;
    const outside = sub(lerp(a, b, 0.5), scale(inward, 1.0));
    let lower = Math.min(ceilingAt(room, outside), zoneHeight - 0.5);
    if (lower >= zoneHeight - 0.4) lower = Math.min(room.ceilingHeight, zoneHeight - 0.5);
    const height = lower + 0.3;
    for (let k = 0; k < m; k++) {
      const c = m === full ? add(a, scale(dir, start + 4 * (k + 0.5))) : add(a, scale(dir, pitch * (k + 0.5)));
      fixtures.push(fixture(ctx, c, angleDeg(dir), 'cove', height));
    }
  }
  const count = fixtures.length;
  return {
    fixtures,
    how: `cove loop 0.5 ft inside the ${feetInches(zoneHeight)} ceiling edge, ${count} modules of 4 ft (${D0(count * 4)} ft)`,
  };
}

// §7 Settle ---------------------------------------------------------------------------------------------------------------

export function settle(
  ctx: Ctx,
  raw: readonly StudioFixture[],
  pinned: readonly StudioFixture[],
): { kept: StudioFixture[]; notes: string } {
  const p = ctx.product;
  const clear = Math.max(0.3, Math.max(p.length, p.width) * 0.4);
  const room = ctx.design.room;
  const removed = new Set(ctx.design.removedExisting);
  const devices = ctx.intent.behavior.avoidCeilingDevices
    ? room.existing.filter((e) => !removed.has(e.id)).map((e) => e.center)
    : [];
  let outside = 0;
  let dim = 0;
  let reserved = 0;
  let washCollisions = 0;
  let near = 0;
  const kept: StudioFixture[] = [];
  for (const f of raw) {
    const c = f.center;
    if (!inRoom(room, c)) outside++;
    else if (inKeep(ctx, c)) dim++;
    else if (inTaskRegion(ctx, c)) reserved++;
    else if (overlapsWallWash(f, p, ctx.wallWashFootprints)) washCollisions++;
    else if (
      pinned.some((q) => distance(q.center, c) < 1.5) ||
      kept.some((q) => distance(q.center, c) < clear) ||
      devices.some((d) => distance(d, c) < clear)
    )
      near++;
    else kept.push(f);
  }
  const parts: string[] = [];
  if (outside > 0) parts.push(`left ${outside} outside the room`);
  if (dim > 0) parts.push(`kept ${dim} out of keep-dim zones`);
  if (reserved > 0) parts.push(`reserved ${reserved} ambient positions for task lighting`);
  if (washCollisions > 0)
    parts.push(`skipped ${washCollisions} ambient positions that overlap wall-wash fixtures`);
  if (near > 0) parts.push(`dropped ${near} that collided with other fixtures`);
  return { kept, notes: parts.join(', ') };
}

// §9 Keep-dim helpers ------------------------------------------------------------------------------------------------------

export function anchor(
  ctx: Ctx,
  raw: readonly StudioFixture[],
  pinned: readonly StudioFixture[],
  notes: string,
): { placed: StudioFixture[]; notes: string } {
  const open = settle({ ...ctx, keeps: [] }, raw, pinned).kept;
  if (open.length === 0) return { placed: [], notes };
  const tail = notes !== '' ? `, ${notes}` : '';
  let best: StudioFixture | null = null;
  let bestD = Infinity;
  for (const f of open.slice(0, 12)) {
    const spot = nearestAllowed(ctx, f);
    if (spot === null) continue;
    const d = distance(spot, f.center);
    if (d < bestD) {
      bestD = d;
      best = relocated(ctx, f, spot);
    }
  }
  if (best !== null) {
    return {
      placed: [best],
      notes: `every position was inside a keep-dim margin, so one fixture moved ${F1(bestD)} ft to the nearest spot outside it${tail}`,
    };
  }
  let far = open[0]!;
  let farD = -Infinity;
  for (const f of open) {
    let d = Infinity;
    for (const k of ctx.keeps) d = Math.min(d, polygonDistance(k.intent.region, [f.center]));
    if (d > farD) {
      farD = d;
      far = f;
    }
  }
  return {
    placed: [far],
    notes: `the keep-dim margin covers everywhere this intent can be lit, so one fixture stays at the spot farthest from it and the keep-dim zone is over its maximum${tail}`,
  };
}

export function nearestAllowed(ctx: Ctx, from: StudioFixture): P2 | null {
  const region = ctx.intent.region;
  if (region.length < 3) return null;
  const room = ctx.design.room;
  const { min: lo, max: hi } = bounds(region);
  const step = Math.max(0.5, Math.sqrt(Math.max((hi.x - lo.x) * (hi.y - lo.y), 1) / 2500));
  let best: P2 | null = null;
  let bestD = Infinity;
  for (let x = lo.x + step / 2; x <= hi.x; x += step) {
    for (let y = lo.y + step / 2; y <= hi.y; y += step) {
      const p = { x, y };
      const d = distance(p, from.center);
      if (d < bestD && contains(region, p) && inRoom(room, p) && !inKeep(ctx, p) && !inTaskRegion(ctx, p)) {
        if (
          ctx.wallWashFootprints.length > 0 &&
          overlapsWallWash(relocated(ctx, from, p), ctx.product, ctx.wallWashFootprints)
        )
          continue;
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

export function relocated(ctx: Ctx, f: StudioFixture, to: P2): StudioFixture {
  const room = ctx.design.room;
  const out: StudioFixture = { ...f, center: { x: to.x, y: to.y } };
  if (Math.abs(ceilingAt(room, f.center) - ceilingAt(room, to)) >= 0.01) {
    const m = mounting(ctx, to, null);
    out.mount = m.mount;
    out.height = m.height;
  }
  return out;
}

// §10 Mounting ------------------------------------------------------------------------------------------------------------

export function mounting(ctx: Ctx, p: P2, objectTop: number | null): { mount: string; height: number } {
  const ceiling = ceilingAt(ctx.design.room, p);
  const kind = ctx.intent.kind;
  const product = ctx.product;
  if (kind === 'CeilingGlow' || (isCove(product) && kind !== 'FeaturePendant'))
    return { mount: 'cove', height: Math.max(ceiling - 0.5, 1) };
  if (kind === 'FeaturePendant' || isPendant(product)) {
    const mh = ctx.intent.behavior.mountingHeight;
    if (mh !== null) return { mount: 'pendant', height: clamp(mh, 1, ceiling) };
    if (kind === 'FeaturePendant' && objectTop !== null) {
      const top = objectTop;
      return { mount: 'pendant', height: Math.max(Math.min(ceiling - 1, top + 2.5), Math.min(top + 1, ceiling)) };
    }
    return { mount: 'pendant', height: Math.min(ceiling - 1.5, Math.max(7.5, ceiling - 4)) };
  }
  return { mount: 'ceiling', height: ceiling };
}

// §11 AlignToGrid ---------------------------------------------------------------------------------------------------------

export function alignToGrid(ctx: Ctx, fixtures: StudioFixture[]): StudioFixture[] {
  const room = ctx.design.room;
  const grid = room.ceilingGrid;
  if (grid === null || !ctx.intent.behavior.alignToCeilingGrid) return fixtures;
  const { u, v, origin } = grid;
  const det = cross(u, v);
  if (Math.abs(det) < 1e-6 || norm(u) < 0.2 || norm(v) < 0.2) return fixtures;
  const uh = unit(u);
  const vh = unit(v);
  const p = ctx.product;
  const L = p.isRound ? Math.max(p.length, p.width) : p.length;
  const W = p.isRound ? Math.max(p.length, p.width) : p.width;
  const out: StudioFixture[] = [];
  for (const f of fixtures) {
    if (f.mount !== 'ceiling' || zoneAt(room, f.center) !== null) {
      out.push(f);
      continue;
    }
    const dir = heading(f.orientation);
    const pp = perp(dir);
    const extU = Math.abs(dot(uh, dir)) * L + Math.abs(dot(uh, pp)) * W;
    const extV = Math.abs(dot(vh, dir)) * L + Math.abs(dot(vh, pp)) * W;
    const kU = Math.max(1, roundHalfEven(extU / norm(u)));
    const kV = Math.max(1, roundHalfEven(extV / norm(v)));
    const d = sub(f.center, origin);
    let a = cross(d, v) / det;
    let b = cross(u, d) / det;
    a = roundHalfEven(a - kU / 2) + kU / 2;
    b = roundHalfEven(b - kV / 2) + kV / 2;
    const snapped = add(add(origin, scale(u, a)), scale(v, b));
    if (!inRoom(room, snapped) || inKeep(ctx, snapped) || inTaskRegion(ctx, snapped)) {
      out.push(f);
      continue;
    }
    out.push({ ...f, center: snapped, orientation: angleDeg(u) + (Math.abs(dot(uh, dir)) >= 0.5 ? 0 : 90) });
  }
  const kept: StudioFixture[] = [];
  for (const f of out) {
    if (kept.some((k) => distance(k.center, f.center) < 0.3 && Math.abs(k.height - f.height) < 0.5)) continue;
    kept.push(f);
  }
  return kept;
}
