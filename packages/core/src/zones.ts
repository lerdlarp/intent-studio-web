// Zone planner (spec/zones.md): one measuring zone per non-suggestion intent on its plane, plus floor, ceiling and
// wall surfaces. `zoneShape` also feeds the quick estimate's sampling (estimate.md §6).
import { area, distance, dot, rect, sub } from './geometry';
import { wallName } from './defaults';
import { wallFor } from './workplane';
import { wallDirection, wallLength, type LightingIntent, type P2, type RoomDesign } from './model';

export const MAX_ZONES_PER_ROOM = 64;
export const PATCH_WIDTH = 3;
/** Declared in the reference, never enforced there; the calc worker may use it as a guard. */
export const MAX_GRID_POINTS = 100_000;

/** The measured surface of an intent. Vertical shapes use from/to/bottom/top/inward; others polygon/height. */
export interface ZoneShape {
  kind: 'Horizontal' | 'Vertical' | 'Ceiling';
  polygon: P2[];
  height: number;
  from: P2;
  to: P2;
  bottom: number;
  top: number;
  inward: P2;
}

export interface ZoneTarget {
  min?: number;
  avg?: number;
  max?: number;
}

/** Zone record (web version of the reference's calculation zone). */
export interface Zone {
  id: string;
  label: string;
  kind: 'horizontal' | 'ceiling' | 'vertical';
  polygon?: P2[];
  height?: number;
  from?: P2;
  to?: P2;
  bottom?: number;
  top?: number;
  spacing: number;
  target?: ZoneTarget;
}

// ---- §1 shape ----------------------------------------------------------------------------------------------------

export function zoneShape(design: RoomDesign, intent: LightingIntent): ZoneShape | null {
  const room = design.room;
  const plane = intent.plane;
  const region = intent.region;
  if (plane.kind === 'Vertical') {
    const w = wallFor(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex);
    if (w === null) return null;
    const wall = room.walls[w]!;
    const len = wallLength(wall);
    const dir = wallDirection(wall);
    const tOf = (p: P2): number => dot(sub(p, wall.start), dir);
    let t0: number;
    let t1: number;
    if (region.length === 0) {
      t0 = 0;
      t1 = len;
    } else if (region.length === 1 || intent.kind === 'Accent') {
      let s = 0;
      for (const p of region) s += tOf(p);
      const c = s / region.length;
      t0 = c - PATCH_WIDTH / 2;
      t1 = c + PATCH_WIDTH / 2;
    } else {
      t0 = Infinity;
      t1 = -Infinity;
      for (const p of region) {
        const t = tOf(p);
        t0 = Math.min(t0, t);
        t1 = Math.max(t1, t);
      }
    }
    t0 = Math.min(Math.max(t0, 0), len);
    t1 = Math.min(Math.max(t1, 0), len);
    if (t1 - t0 < PATCH_WIDTH) {
      const mid = (t0 + t1) / 2;
      t0 = Math.max(0, mid - PATCH_WIDTH / 2);
      t1 = Math.min(len, t0 + PATCH_WIDTH);
      t0 = Math.max(0, t1 - PATCH_WIDTH);
    }
    const top = plane.top > plane.bottom ? plane.top : wall.top > 0 ? wall.top : room.ceilingHeight;
    return {
      kind: 'Vertical',
      polygon: [],
      height: plane.bottom,
      from: { x: wall.start.x + dir.x * t0, y: wall.start.y + dir.y * t0 },
      to: { x: wall.start.x + dir.x * t1, y: wall.start.y + dir.y * t1 },
      bottom: plane.bottom,
      top,
      inward: { x: wall.inward.x, y: wall.inward.y },
    };
  }
  let polygon: P2[];
  if (region.length >= 3) polygon = region.map((p) => ({ x: p.x, y: p.y }));
  else if (region.length === 0) polygon = (room.floor[0] ?? []).map((p) => ({ x: p.x, y: p.y }));
  else if (region.length === 1) {
    const c = region[0] as P2;
    const h = PATCH_WIDTH / 2;
    polygon = rect({ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y + h });
  } else {
    const a = region[0] as P2;
    const b = region[1] as P2;
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const half = Math.max(PATCH_WIDTH / 2, distance(a, b) / 2);
    polygon = rect({ x: c.x - half, y: c.y - half }, { x: c.x + half, y: c.y + half });
  }
  if (polygon.length < 3) return null;
  return {
    kind: plane.kind,
    polygon,
    height: plane.height,
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    bottom: plane.bottom,
    top: plane.top,
    inward: { x: 0, y: 0 },
  };
}

// ---- §2 zones ----------------------------------------------------------------------------------------------------

/** Grid spacing (ft) of an intent zone by polygon area. */
export const intentSpacing = (a: number): number => (a < 100 ? 1 : a <= 1500 ? 2 : 3);

function targetOf(intent: LightingIntent): ZoneTarget | undefined {
  const t = intent.target;
  if (t.minimum === null && t.average === null && t.maximum === null) return undefined;
  const out: ZoneTarget = {};
  if (t.minimum !== null) out.min = t.minimum;
  if (t.average !== null) out.avg = t.average;
  if (t.maximum !== null) out.max = t.maximum;
  return out;
}

export function zones(design: RoomDesign, surfaces = true): Zone[] {
  const room = design.room;
  const out: Zone[] = [];
  for (const intent of design.intents) {
    if (intent.isSuggestion) continue;
    const s = zoneShape(design, intent);
    if (!s) continue;
    const base = { id: intent.id, label: `Intent · ${intent.label}` };
    const target = targetOf(intent);
    const zone: Zone =
      s.kind === 'Vertical'
        ? { ...base, kind: 'vertical', from: s.from, to: s.to, bottom: s.bottom, top: s.top, spacing: 1 }
        : {
            ...base,
            kind: s.kind === 'Ceiling' ? 'ceiling' : 'horizontal',
            polygon: s.polygon,
            height: s.height,
            spacing: intentSpacing(area(s.polygon)),
          };
    if (target) zone.target = target;
    out.push(zone);
  }
  const floor = room.floor[0];
  if (surfaces && floor && floor.length >= 3) {
    const spacing = area(floor) > 2000 ? 3 : 2;
    let budget = MAX_ZONES_PER_ROOM - out.length;
    const add = (z: Zone): void => {
      if (budget > 0) {
        out.push(z);
        budget--;
      }
    };
    const poly = (): P2[] => floor.map((p) => ({ x: p.x, y: p.y }));
    add({ id: 'surface:floor', label: 'Surface · Floor', kind: 'horizontal', polygon: poly(), height: 0, spacing });
    add({
      id: 'surface:ceiling',
      label: 'Surface · Ceiling',
      kind: 'ceiling',
      polygon: poly(),
      height: room.ceilingHeight,
      spacing,
    });
    room.walls.forEach((w, i) =>
      add({
        id: `surface:wall:${i}`,
        label: `Surface · ${wallName(room, i)}`,
        kind: 'vertical',
        from: { x: w.start.x, y: w.start.y },
        to: { x: w.end.x, y: w.end.y },
        bottom: 0,
        top: w.top > 0 ? w.top : room.ceilingHeight,
        spacing,
      }),
    );
  }
  return out.length > MAX_ZONES_PER_ROOM ? out.slice(0, MAX_ZONES_PER_ROOM) : out;
}
