// Pure room → mesh descriptors for the 3D view (no three, no DOM). Units are feet. Plan (x, y, z-up) maps to three
// (x, z, -y) — the same rotation as packages/scene/src/axes.ts `planToScene` with up = 'y' (scene metres → feet only).
import {
  ceilingAt,
  heading,
  intentInkColor,
  isSurfaceKind,
  kindOf,
  nearestWall,
  productOf,
  surfaceHeight,
  zoneShape,
  type ExistingFixture,
  type LightingIntent,
  type P2,
  type RoomDesign,
  type StudioRoom,
  type WallInfo,
  type WallOpening,
} from '@intent-studio/core';
import { planToScene } from '@intent-studio/scene/src/axes';

export type V3 = readonly [number, number, number];

/** Plan point (feet, z up) → three position (feet, Y up). Delegates to the shared scene axis mapping. */
export function planToThree(x: number, y: number, z = 0): V3 {
  const s = planToScene({ x, y, z }, 'y');
  return [s.x, s.y, s.z];
}
/** Three position → plan {x, y, z}. */
export const threeToPlan = (p: V3): { x: number; y: number; z: number } => ({ x: p[0], y: -p[2], z: p[1] });
/** Plan heading (degrees CCW from +x seen from above) → three rotation about +Y (radians). */
export const rotYOfDeg = (deg: number): number => (deg * Math.PI) / 180;

export const WALL_THICKNESS = 0.4;
const EPS = 1e-6;

// ---- walls -----------------------------------------------------------------------------------------------------

export interface WallRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Solid rectangles (along-wall u, up v) of a wall `len × height` once its openings are cut out. */
export function wallRects(len: number, height: number, openings: readonly WallOpening[]): WallRect[] {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const ops = openings
    .map((o) => ({
      from: clamp(Math.min(o.from, o.to), 0, len),
      to: clamp(Math.max(o.from, o.to), 0, len),
      bottom: clamp(Math.min(o.bottom, o.top), 0, height),
      top: clamp(Math.max(o.bottom, o.top), 0, height),
    }))
    .filter((o) => o.to - o.from > EPS && o.top - o.bottom > EPS);
  const xs = [...new Set([0, len, ...ops.flatMap((o) => [o.from, o.to])])].sort((a, b) => a - b);
  interface Span {
    a: number;
    b: number;
    solid: [number, number][];
  }
  const spans: Span[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] as number;
    const b = xs[i + 1] as number;
    if (b - a <= EPS) continue;
    const mid = (a + b) / 2;
    const cuts = ops
      .filter((o) => o.from <= mid && mid < o.to)
      .map((o) => [o.bottom, o.top] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    const solid: [number, number][] = [];
    let cursor = 0;
    for (const [lo, hi] of cuts) {
      if (lo > cursor + EPS) solid.push([cursor, lo]);
      cursor = Math.max(cursor, hi);
    }
    if (height - cursor > EPS) solid.push([cursor, height]);
    const prev = spans[spans.length - 1];
    const same =
      prev !== undefined &&
      prev.solid.length === solid.length &&
      prev.solid.every(
        (s, k) =>
          Math.abs(s[0] - (solid[k] as [number, number])[0]) < EPS &&
          Math.abs(s[1] - (solid[k] as [number, number])[1]) < EPS,
      );
    if (same && prev) prev.b = b;
    else spans.push({ a, b, solid });
  }
  return spans.flatMap((s) => s.solid.map(([v0, v1]) => ({ u0: s.a, u1: s.b, v0, v1 })));
}

export interface WallPiece {
  center: V3;
  /** Box size along the wall, up, and through the wall. */
  size: V3;
  rotY: number;
}
export interface WallDesc {
  index: number;
  /** Midpoint of the wall at mid height (three space), used for the camera cutaway test. */
  mid: V3;
  /** Inward normal in three space (horizontal). */
  inward: V3;
  length: number;
  height: number;
  openings: number;
  pieces: WallPiece[];
}

export function describeWall(room: StudioRoom, wall: WallInfo, k: number): WallDesc {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  const dir: P2 = length > EPS ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const height = wall.top > 0 ? wall.top : room.ceilingHeight;
  const rotY = Math.atan2(dir.y, dir.x);
  const pieces = wallRects(length, height, wall.openings).map((r) => {
    const u = (r.u0 + r.u1) / 2;
    // The box sits behind the wall line: its inner face is flush with the room boundary.
    const px = wall.start.x + dir.x * u - wall.inward.x * (WALL_THICKNESS / 2);
    const py = wall.start.y + dir.y * u - wall.inward.y * (WALL_THICKNESS / 2);
    return {
      center: planToThree(px, py, (r.v0 + r.v1) / 2),
      size: [r.u1 - r.u0, r.v1 - r.v0, WALL_THICKNESS] as V3,
      rotY,
    };
  });
  return {
    index: wall.index ?? k,
    mid: planToThree((wall.start.x + wall.end.x) / 2, (wall.start.y + wall.end.y) / 2, height / 2),
    inward: planToThree(wall.inward.x, wall.inward.y, 0),
    length,
    height,
    openings: wall.openings.length,
    pieces,
  };
}

// ---- floor, ceiling --------------------------------------------------------------------------------------------

export interface FlatDesc {
  outer: P2[];
  holes: P2[][];
  /** Three-space Y. */
  y: number;
}
export interface CeilingDesc extends FlatDesc {
  isMain: boolean;
}

export function describeFloor(room: StudioRoom): FlatDesc | null {
  const outer = room.floor[0];
  if (!outer || outer.length < 3) return null;
  return { outer, holes: room.floor.slice(1).filter((l) => l.length >= 3), y: 0 };
}

export function describeCeiling(room: StudioRoom): CeilingDesc[] {
  const zones = room.ceilingZones.filter((z) => (z.loops[0]?.length ?? 0) >= 3);
  if (zones.length === 0) {
    const f = describeFloor(room);
    return f ? [{ ...f, y: room.ceilingHeight, isMain: true }] : [];
  }
  return zones.map((z) => ({
    outer: z.loops[0] as P2[],
    holes: z.loops.slice(1).filter((l) => l.length >= 3),
    y: z.height,
    isMain: z.isMain,
  }));
}

// ---- objects ---------------------------------------------------------------------------------------------------

export interface BoxDesc {
  name: string;
  center: V3;
  size: V3;
  rotY: number;
}
export function describeObjects(room: StudioRoom): BoxDesc[] {
  return room.objects.map((o) => {
    const bottom = o.bottom ?? 0;
    const top = Math.max(o.top ?? (isSurfaceKind(kindOf(o)) ? surfaceHeight(o) : bottom + 3), bottom + 0.05);
    const c = { x: o.center.x, y: o.center.y };
    return {
      name: o.name,
      center: planToThree(c.x, c.y, (bottom + top) / 2),
      size: [Math.max(o.length, 0.05), top - bottom, Math.max(o.width, 0.05)] as V3,
      rotY: rotYOfDeg(o.orientation),
    };
  });
}

// ---- fixtures --------------------------------------------------------------------------------------------------

export type FixtureShape = 'round' | 'linear' | 'pendant' | 'wall';
export interface FixtureDesc {
  id: string;
  intentId: string | null;
  shape: FixtureShape;
  existing: boolean;
  color: string;
  /** Body centre (three space). */
  center: V3;
  /** round/pendant: [diameter, thickness, diameter]; linear/wall: [length, thickness, width] (x along rotY). */
  size: V3;
  rotY: number;
  tiltDeg: number;
  /** Pendants: cord from the ceiling (top) to the body. */
  cord: { top: V3; bottom: V3 } | null;
}

interface FixtureLike {
  id: string;
  center: P2;
  orientation: number;
  mount: string;
  height: number;
  tilt?: number;
}
interface Dims {
  length: number;
  width: number;
  isRound: boolean;
}

const clampDim = (x: number, lo: number, hi: number, dflt: number) =>
  Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;

function fixtureDesc(
  room: StudioRoom,
  f: FixtureLike,
  dims: Dims,
  color: string,
  intentId: string | null,
  existing: boolean,
): FixtureDesc {
  const len = clampDim(dims.length, 0.25, 12, 1);
  const wid = clampDim(dims.width, 0.25, 12, 1);
  const mount = f.mount.trim().toLowerCase();
  const ceil = ceilingAt(room, f.center);
  const base = { id: f.id, intentId, existing, color, tiltDeg: f.tilt ?? 0 };
  if (mount === 'wall') {
    const wi = nearestWall(room, f.center);
    const wall = wi === null ? null : room.walls[wi];
    const inward = wall ? wall.inward : heading(f.orientation);
    const thick = 0.25;
    const h = f.height > 0 ? f.height : 7;
    return {
      ...base,
      shape: 'wall',
      center: planToThree(f.center.x + inward.x * (thick / 2), f.center.y + inward.y * (thick / 2), h),
      size: [Math.max(len, 0.4), 0.5, thick],
      rotY: Math.atan2(inward.y, inward.x) - Math.PI / 2,
      cord: null,
    };
  }
  if (mount === 'pendant') {
    const h = f.height > 0 ? Math.min(f.height, ceil) : Math.max(ceil - 2, 0.5);
    const d = Math.min(dims.isRound ? len : Math.max(len, wid), 2.5);
    const thick = 0.45;
    return {
      ...base,
      shape: 'pendant',
      center: planToThree(f.center.x, f.center.y, h),
      size: [d, thick, dims.isRound ? d : wid],
      rotY: rotYOfDeg(f.orientation),
      cord: {
        top: planToThree(f.center.x, f.center.y, ceil),
        bottom: planToThree(f.center.x, f.center.y, h + thick / 2),
      },
    };
  }
  // ceiling / cove / feature: flush with the ceiling at the point (or at the stated height)
  const thick = 0.15;
  const h = f.height > 0 ? f.height : ceil;
  return {
    ...base,
    shape: dims.isRound ? 'round' : 'linear',
    center: planToThree(f.center.x, f.center.y, h - thick / 2),
    size: dims.isRound ? [len, thick, len] : [len, thick, wid],
    rotY: rotYOfDeg(f.orientation),
    cord: null,
  };
}

export const EXISTING_COLOR = '#9aa0a6';

export function describeFixtures(design: RoomDesign): FixtureDesc[] {
  const { room } = design;
  const removed = new Set(design.removedExisting.map((s) => s.toLowerCase()));
  const out: FixtureDesc[] = [];
  for (const e of room.existing as ExistingFixture[]) {
    if (removed.has(e.id.toLowerCase())) continue;
    out.push(fixtureDesc(room, e, e, EXISTING_COLOR, null, true));
  }
  for (const i of design.intents) {
    if (i.isSuggestion) continue;
    const p = productOf(room, i);
    const dims: Dims = { length: p?.length ?? 1, width: p?.width ?? 1, isRound: p?.isRound ?? true };
    const color = intentInkColor(i.kind);
    for (const f of i.fixtures) out.push(fixtureDesc(room, f, dims, color, i.id, false));
  }
  return out;
}

// ---- intent planes ---------------------------------------------------------------------------------------------

export interface PatchDesc {
  intentId: string;
  color: string;
  suggestion: boolean;
  kind: 'horizontal' | 'ceiling' | 'vertical';
  /** Horizontal/ceiling: plan polygon at `y` (three Y, already offset off the surface). Vertical: unused. */
  polygon: P2[];
  y: number;
  /** Vertical: four corners (three space), bottom-left, bottom-right, top-right, top-left seen from the room. */
  quad: V3[] | null;
}

const PATCH_LIFT = 0.03;

export function describePatch(design: RoomDesign, intent: LightingIntent): PatchDesc | null {
  const shape = zoneShape(design, intent);
  if (!shape) return null;
  const base = { intentId: intent.id, color: intentInkColor(intent.kind), suggestion: intent.isSuggestion };
  if (shape.kind === 'Vertical') {
    const { from, to, bottom, top, inward } = shape;
    const o = PATCH_LIFT;
    const at = (p: P2, z: number) => planToThree(p.x + inward.x * o, p.y + inward.y * o, z);
    return {
      ...base,
      kind: 'vertical',
      polygon: [],
      y: 0,
      quad: [at(from, bottom), at(to, bottom), at(to, top), at(from, top)],
    };
  }
  const ceiling = shape.kind === 'Ceiling';
  return {
    ...base,
    kind: ceiling ? 'ceiling' : 'horizontal',
    polygon: shape.polygon,
    y: shape.height + (ceiling ? -PATCH_LIFT : PATCH_LIFT),
    quad: null,
  };
}

export function describePatches(design: RoomDesign): PatchDesc[] {
  return design.intents.flatMap((i) => {
    const p = describePatch(design, i);
    return p ? [p] : [];
  });
}

// ---- whole room ------------------------------------------------------------------------------------------------

export interface RoomDesc {
  floor: FlatDesc | null;
  ceiling: CeilingDesc[];
  walls: WallDesc[];
  objects: BoxDesc[];
  fixtures: FixtureDesc[];
  patches: PatchDesc[];
}

export function describeDesign(design: RoomDesign): RoomDesc {
  const { room } = design;
  return {
    floor: describeFloor(room),
    ceiling: describeCeiling(room),
    walls: room.walls.map((w, k) => describeWall(room, w, k)),
    objects: describeObjects(room),
    fixtures: describeFixtures(design),
    patches: describePatches(design),
  };
}
