// Pure camera presets for the 3D view (three space: feet, Y up, plan south = +Z, plan east = +X).
import { roomBounds, zoneShape, type LightingIntent, type RoomDesign } from '@intent-studio/core';
import { planToThree, type V3 } from './describe';

export interface CameraPose {
  position: V3;
  target: V3;
}
export type PresetName = 'default' | 'top' | 'eye';

export const EYE_HEIGHT = 5.5;
export const DEFAULT_ELEVATION_DEG = 35;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export interface RoomExtent {
  center: V3;
  width: number;
  depth: number;
  height: number;
  radius: number;
}
export function roomExtent(design: RoomDesign): RoomExtent {
  const b = roomBounds(design.room);
  const width = b.max.x - b.min.x;
  const depth = b.max.y - b.min.y;
  const height = design.room.ceilingHeight;
  const center = planToThree((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, height / 2);
  return { center, width, depth, height, radius: Math.sqrt(width * width + depth * depth + height * height) / 2 };
}

/** Camera at `elevationDeg` above the horizon, looking at `target` from the given azimuth (plan degrees, 0 = east). */
function orbit(target: V3, distance: number, elevationDeg: number, azimuthDeg: number): CameraPose {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const h = Math.cos(el) * distance;
  // plan direction (cos az, sin az) → three (x, -z)
  return { target, position: add(target, [Math.cos(az) * h, Math.sin(el) * distance, -Math.sin(az) * h]) };
}

export function presetPose(design: RoomDesign, name: PresetName): CameraPose {
  const e = roomExtent(design);
  switch (name) {
    case 'default':
      // south-east of the room, 35° above the horizon (plan azimuth −45° = south-east)
      return orbit(e.center, e.radius * 2.9, DEFAULT_ELEVATION_DEG, -45);
    case 'top': {
      const target: V3 = [e.center[0], 0, e.center[2]];
      // a hair off vertical keeps OrbitControls' up vector well defined; north is up on screen
      return { target, position: [target[0], Math.max(e.width, e.depth, 1) * 1.7 + e.height, target[2] + 0.01] };
    }
    case 'eye': {
      const target: V3 = [e.center[0], EYE_HEIGHT, e.center[2]];
      // stand toward the south side, look north
      return { target, position: [target[0], EYE_HEIGHT, target[2] + Math.max(e.depth * 0.38, 1)] };
    }
  }
}

/** Stand inside, facing wall `index` (looks at its middle at eye level). */
export function wallPose(design: RoomDesign, index: number): CameraPose | null {
  const wall = design.room.walls[index];
  if (!wall) return null;
  const top = wall.top > 0 ? wall.top : design.room.ceilingHeight;
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const e = roomExtent(design);
  const dist = Math.min(Math.max(len * 0.9, 7), Math.max(e.radius * 1.2, 7));
  const target = planToThree(mx, my, Math.min(EYE_HEIGHT, top * 0.6));
  const position = planToThree(mx + wall.inward.x * dist, my + wall.inward.y * dist, EYE_HEIGHT);
  return { target, position };
}

/** Look at an intent's measured surface from the south-east, 40° up. */
export function intentPose(design: RoomDesign, intent: LightingIntent): CameraPose | null {
  const s = zoneShape(design, intent);
  if (!s) return null;
  let cx: number, cy: number, cz: number, size: number;
  if (s.kind === 'Vertical') {
    cx = (s.from.x + s.to.x) / 2;
    cy = (s.from.y + s.to.y) / 2;
    cz = (s.bottom + s.top) / 2;
    size = Math.max(Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), s.top - s.bottom);
    const target = planToThree(cx, cy, cz);
    const dist = Math.max(size * 1.6, 9);
    return { target, position: planToThree(cx + s.inward.x * dist * 0.9, cy + s.inward.y * dist * 0.9, cz + dist * 0.35) };
  }
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of s.polygon) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  cx = (x0 + x1) / 2;
  cy = (y0 + y1) / 2;
  cz = s.height;
  size = Math.max(x1 - x0, y1 - y0);
  return orbit(planToThree(cx, cy, cz), Math.max(size * 1.8, 10), 40, -45);
}
