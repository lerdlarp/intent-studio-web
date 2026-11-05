// Workplane inference (spec/workplane.md). Pure; iteration is always in index order with the stated tie-breaks.
import { className, classOf, wallName } from './defaults';
import {
  ceilingAt,
  centroid,
  contains,
  distanceToSegment,
  footprint,
  heading,
  overlapArea,
  perp,
  polygonDistance,
  unit,
  zoneAt,
  dot,
  lerp,
  add,
  scale,
  sub,
} from './geometry';
import { roundHalfEven } from './format';
import {
  FACE_KINDS,
  SURFACE_KINDS,
  wallDirection,
  type IntentKind,
  type P2,
  type RoomObjectInfo,
  type SpaceClass,
  type StudioRoom,
  type Workplane,
} from './model';
import { feetInches } from './units';

export const DESK_HEIGHT = 2.5;
export const COUNTER_HEIGHT = 3;
export const BAR_HEIGHT = 3.5;

/** Trimmed, lower-cased object kind ("" when null/absent). */
export const kindOf = (o: RoomObjectInfo): string => (o.kind ?? '').trim().toLowerCase();

const isSurfaceKind = (k: string): boolean => (SURFACE_KINDS as readonly string[]).includes(k);
const isFaceKind = (k: string): boolean => (FACE_KINDS as readonly string[]).includes(k);
export { isSurfaceKind, isFaceKind };

/** Height of a work surface: top snapped to the inch when 1..4.5, else by kind. */
export function surfaceHeight(o: RoomObjectInfo): number {
  if (o.top !== null && o.top >= 1 && o.top <= 4.5) return roundHalfEven(o.top * 12) / 12;
  const k = kindOf(o);
  if (k === 'counter' || k === 'reception' || k === 'island') return COUNTER_HEIGHT;
  if (k === 'bar') return BAR_HEIGHT;
  return DESK_HEIGHT;
}

/** Plane-reason variant of surfaceWord (falls back to "Surface"). */
export function planeSurfaceWord(o: RoomObjectInfo): string {
  switch (kindOf(o)) {
    case 'desk':
      return 'Desk';
    case 'table':
      return 'Table';
    case 'counter':
      return 'Counter';
    case 'reception':
      return 'Reception';
    case 'island':
      return 'Island';
    case 'bar':
      return 'Bar';
    default:
      return 'Surface';
  }
}

type Accept = (o: RoomObjectInfo) => boolean;

/** Which objects an intent kind can be painted over; null = no acceptor. */
export function accepts(kind: IntentKind): Accept | null {
  switch (kind) {
    case 'Task':
    case 'FeaturePendant':
    case 'CeilingGlow':
      return (o) => isSurfaceKind(kindOf(o));
    case 'WallWash':
      return (o) => isFaceKind(kindOf(o));
    case 'KeepDim':
      return (o) => kindOf(o) === 'screen' || kindOf(o) === 'display';
    case 'Accent':
      return (o) => isFaceKind(kindOf(o)) || isSurfaceKind(kindOf(o)) || o.top !== null;
    default:
      return null;
  }
}

/** The accepted object with the most overlap/nearness to the region, or null. */
export function objectUnder(room: StudioRoom, region: readonly P2[], accept: Accept): number | null {
  let best: number | null = null;
  let bestScore = 0;
  for (let i = 0; i < room.objects.length; i++) {
    const o = room.objects[i] as RoomObjectInfo;
    if (!accept(o)) continue;
    const fp = footprint(o);
    let score: number;
    if (region.length >= 3) {
      score = overlapArea(region, fp, 12);
    } else {
      const reach = region.length === 1 ? 1.0 : 1.5;
      let d: number;
      if (region.length === 1) {
        const p = region[0] as P2;
        d = contains(fp, p) ? 0 : polygonDistance(fp, [p]);
      } else {
        const a = region[0] as P2;
        const b = region[1] as P2;
        d = contains(fp, a) || contains(fp, b) ? 0 : polygonDistance(fp, [a, b]);
      }
      if (d > reach) continue;
      score = (reach + 0.01 - d) * (isFaceKind(kindOf(o)) ? 2 : 1);
    }
    if (score > bestScore + 1e-9) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

export interface Resolved {
  index: number;
  object: RoomObjectInfo;
}

/** Explicit in-range objectIndex wins for any kind; otherwise the accepted object under the region. */
export function resolve(
  room: StudioRoom,
  kind: IntentKind,
  region: readonly P2[],
  objectIndex?: number | null,
): Resolved | null {
  if (objectIndex !== undefined && objectIndex !== null && objectIndex >= 0 && objectIndex < room.objects.length) {
    return { index: objectIndex, object: room.objects[objectIndex] as RoomObjectInfo };
  }
  const acc = accepts(kind);
  if (acc === null || region.length === 0) return null;
  const i = objectUnder(room, region, acc);
  return i === null ? null : { index: i, object: room.objects[i] as RoomObjectInfo };
}

/** Wall index an intent lights, or null. */
export function wallFor(
  room: StudioRoom,
  kind: IntentKind,
  region: readonly P2[],
  wallIndex?: number | null,
  objectIndex?: number | null,
): number | null {
  if (room.walls.length === 0) return null;
  if (wallIndex !== undefined && wallIndex !== null && wallIndex >= 0 && wallIndex < room.walls.length)
    return wallIndex;
  let at: P2;
  let dir: P2 | null = null;
  if (objectIndex !== undefined && objectIndex !== null && objectIndex >= 0 && objectIndex < room.objects.length) {
    const o = room.objects[objectIndex] as RoomObjectInfo;
    at = o.center;
    dir = heading(o.orientation);
  } else if (region.length >= 2) {
    const a = region[0] as P2;
    const b = region[1] as P2;
    at = lerp(a, b, 0.5);
    dir = unit(sub(b, a));
  } else if (region.length === 1) {
    at = region[0] as P2;
  } else {
    return null;
  }
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < room.walls.length; i++) {
    const w = room.walls[i]!;
    let d = distanceToSegment(at, w.start, w.end);
    if (dir !== null && kind === 'WallWash' && Math.abs(dot(dir, wallDirection(w))) < 0.5) d += 5;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Nearest wall within reach; ties go to the later wall. */
export function nearestWall(room: StudioRoom, p: P2, reach = Infinity): number | null {
  let best: number | null = null;
  let bestD = reach;
  for (let i = 0; i < room.walls.length; i++) {
    const w = room.walls[i]!;
    const d = distanceToSegment(p, w.start, w.end);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** Midpoint of the room-facing face of a wall-hung object. */
export function faceMidpoint(room: StudioRoom, o: RoomObjectInfo): P2 {
  const c = room.floor[0] && room.floor[0].length > 0 ? centroid(room.floor[0]) : o.center;
  const u = heading(o.orientation);
  let n = perp(u);
  if (dot(n, sub(c, o.center)) < 0) n = scale(n, -1);
  return add(o.center, scale(n, o.width / 2));
}

const plane = (kind: Workplane['kind'], height: number, bottom: number, top: number, reason: string): Workplane => ({
  kind,
  height,
  bottom,
  top,
  inferred: true,
  reason,
});
const floorPlane = (reason: string): Workplane => plane('Horizontal', 0, 0, 0, reason);

/** Default measurement plane of a space class. */
export function ambientPlane(cls: SpaceClass): Workplane {
  switch (cls) {
    case 'Lobby':
    case 'Corridor':
    case 'DataHall':
      return floorPlane(`Floor level · ${className(cls)} circulation`);
    case 'Cafeteria':
      return plane('Horizontal', 2.5, 0, 0, `Table height, ${feetInches(2.5)} · cafeteria dining`);
    default:
      return plane('Horizontal', 2.5, 0, 0, `Work plane, ${feetInches(2.5)} · ${className(cls)}`);
  }
}

/** Infer the workplane for an intent. */
export function inferPlane(
  room: StudioRoom,
  kind: IntentKind,
  region: readonly P2[],
  wallIndex?: number | null,
  objectIndex?: number | null,
): Workplane {
  const cls = classOf(room);
  const found = resolve(room, kind, region, objectIndex);
  switch (kind) {
    case 'Ambient':
    case 'KeepDim':
      return ambientPlane(cls);
    case 'Task': {
      if (cls === 'DataHall') return floorPlane('Floor level · aisle');
      if (found) {
        const h = surfaceHeight(found.object);
        return plane(
          'Horizontal',
          h,
          0,
          0,
          `${planeSurfaceWord(found.object)} top, ${feetInches(h)}, from ${found.object.name}`,
        );
      }
      return plane('Horizontal', 2.5, 0, 0, `Task height, ${feetInches(2.5)} (no furniture under it)`);
    }
    case 'FeaturePendant': {
      if (found) {
        const h = surfaceHeight(found.object);
        return plane(
          'Horizontal',
          h,
          0,
          0,
          `${planeSurfaceWord(found.object)} top, ${feetInches(h)}, under ${found.object.name}`,
        );
      }
      return ambientPlane(cls);
    }
    case 'Path':
      return floorPlane('Floor level · path of travel');
    case 'CeilingGlow': {
      const floor0 = room.floor[0];
      const c = region.length >= 3 ? centroid(region) : floor0 && floor0.length > 0 ? centroid(floor0) : centroid(region);
      const zone = zoneAt(room, c);
      const h = ceilingAt(room, c);
      const what = zone === null ? 'Main ceiling' : zone.height > room.ceilingHeight ? 'Raised ceiling' : 'Soffit';
      return plane('Ceiling', h, 0, 0, `${what} at ${feetInches(h)}, facing down`);
    }
    case 'WallWash': {
      const w = wallFor(room, 'WallWash', region, wallIndex, objectIndex);
      if (w === null) return ambientPlane(cls);
      const name = wallName(room, w);
      const wall = room.walls[w]!;
      const top = wall.top > 0 ? wall.top : room.ceilingHeight;
      if (top - 1 > 4) {
        return plane(
          'Vertical',
          2,
          2,
          top - 1,
          `${name}, ${feetInches(2)} to ${feetInches(top - 1)} (clear of the base and the ceiling edge)`,
        );
      }
      return plane('Vertical', 0, 0, top, `${name}, 0 to ${feetInches(top)}`);
    }
    case 'Accent': {
      if (found) {
        const o = found.object;
        if (isFaceKind(kindOf(o))) {
          let bottom = o.bottom ?? 3;
          let top = o.top ?? 7;
          let known = o.bottom !== null && o.top !== null;
          if (top - bottom < 0.5) {
            bottom = 3;
            top = 7;
            known = false;
          }
          return plane(
            'Vertical',
            bottom,
            bottom,
            top,
            known
              ? `${o.name} face, ${feetInches(bottom)} to ${feetInches(top)}`
              : `${o.name} face, ${feetInches(3)} to ${feetInches(7)} (its height is not known)`,
          );
        }
        const h = surfaceHeight(o);
        return plane('Horizontal', h, 0, 0, `${o.name} top, ${feetInches(h)}`);
      }
      const p = region[0] ?? { x: 0, y: 0 };
      const wi = wallIndex !== undefined && wallIndex !== null ? wallIndex : nearestWall(room, p, 1.5);
      if (wi !== null && wi >= 0 && wi < room.walls.length) {
        return plane('Vertical', 3, 3, 7, `${wallName(room, wi)} face, ${feetInches(3)} to ${feetInches(7)}`);
      }
      return ambientPlane(cls);
    }
  }
}
