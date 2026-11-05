// Assemble a StudioRoom (feet) from an outline, ceiling zones, openings and objects — shared by the geometry/tag
// strategies and the manual strategy (c).
import {
  StudioRoomSchema,
  ceilingAt,
  perp,
  signedArea,
  sub,
  unit,
  type CeilingStepInfo,
  type CeilingZoneInfo,
  type P2,
  type RoomObjectInfo,
  type StudioRoom,
  type WallInfo,
  type WallOpening,
} from '@intent-studio/core';
import { orient, removeCollinear, startSouthWest } from './polygon';

export interface RoomParts {
  id?: string;
  label?: string;
  spaceType?: string;
  /** Outer floor loop, feet, any winding. */
  outline: P2[];
  /** Hole loops, feet, any winding. */
  holes?: P2[][];
  /** Main ceiling height, feet above the floor. */
  ceilingHeight: number;
  /** Non-main ceiling zones (pockets / soffits): first loop outer, rest holes. */
  pockets?: { height: number; loops: P2[][] }[];
  /** Openings per wall index (wall 0 starts at the south-west-most outline vertex, CCW). */
  openings?: (wallIndex: number, wall: WallInfo) => WallOpening[];
  objects?: RoomObjectInfo[];
}

const tidy = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};
const tidyP = (p: P2): P2 => ({ x: tidy(p.x), y: tidy(p.y) });

/** Outline normalised for the core: CCW, starting south-west, no collinear vertices, coordinates rounded to 1e-6. */
export function normaliseOutline(outline: readonly P2[]): P2[] {
  return startSouthWest(orient(removeCollinear(outline, 1e-6), true)).map(tidyP);
}

/** Build and validate a StudioRoom (throws if the result does not parse through `StudioRoomSchema`). */
export function assembleRoom(parts: RoomParts): StudioRoom {
  const outer = normaliseOutline(parts.outline);
  if (outer.length < 3 || Math.abs(signedArea(outer)) < 1e-6)
    throw new Error('Room outline needs 3+ non-collinear points');
  const holes = (parts.holes ?? []).filter((h) => h.length >= 3).map((h) => orient(h, false).map(tidyP));
  const H = parts.ceilingHeight;
  const zones: CeilingZoneInfo[] = [{ height: tidy(H), isMain: true, loops: [outer, ...holes] }];
  for (const z of parts.pockets ?? []) {
    const [o, ...hs] = z.loops;
    if (!o || o.length < 3) continue;
    zones.push({
      height: tidy(z.height),
      isMain: false,
      loops: [startSouthWest(orient(o, true)).map(tidyP), ...hs.map((h) => orient(h, false).map(tidyP))],
    });
  }
  const steps: CeilingStepInfo[] = [];
  for (const z of zones) {
    if (z.isMain) continue;
    const loop = z.loops[0] ?? [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] as P2;
      const b = loop[(i + 1) % loop.length] as P2;
      steps.push({ start: a, end: b, lowerHeight: Math.min(z.height, H), upperHeight: Math.max(z.height, H) });
    }
  }
  const draft: StudioRoom = {
    id: parts.id ?? '00000000-0000-0000-0000-000000000000',
    label: parts.label ?? '',
    spaceType: parts.spaceType ?? '',
    floor: [outer, ...holes],
    walls: [],
    ceilingHeight: tidy(H),
    ceilingZones: zones,
    ceilingSteps: steps,
    ceilingGrid: null,
    objects: parts.objects ?? [],
    existing: [],
  };
  draft.walls = outer.map((start, index) => {
    const end = outer[(index + 1) % outer.length] as P2;
    const dir = unit(sub(end, start));
    const inward = tidyP(perp(dir));
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const probe = { x: mid.x + inward.x * 0.5, y: mid.y + inward.y * 0.5 };
    const wall: WallInfo = { index, start, end, inward, top: tidy(ceilingAt(draft, probe)), openings: [] };
    wall.openings = (parts.openings?.(index, wall) ?? []).map((o) => ({
      kind: o.kind,
      from: tidy(Math.min(o.from, o.to)),
      to: tidy(Math.max(o.from, o.to)),
      bottom: tidy(o.bottom),
      top: tidy(o.top),
    }));
    return wall;
  });
  return StudioRoomSchema.parse(draft);
}

/**
 * Manual strategy (c): the designer draws the floor polygon (feet, plan, any winding) and types the ceiling
 * height (feet). Walls follow the polygon edges.
 */
export function buildManualRoom(
  polygon: readonly P2[],
  ceilingHeight: number,
  init: Omit<RoomParts, 'outline' | 'ceilingHeight'> = {},
): StudioRoom {
  if (!(ceilingHeight > 0) || !Number.isFinite(ceilingHeight)) throw new Error('Ceiling height must be positive');
  return assembleRoom({ ...init, outline: [...polygon], ceilingHeight });
}
