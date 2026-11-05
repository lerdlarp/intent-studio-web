// Scene → plan coordinate mapping (the import boundary of PLAN §3 "Room extraction").
//
// Source scenes are in source units with an up axis (glTF: metres, +Y up, right-handed). Internally the extractor
// works in *plan metres*; the StudioRoom it emits is in *plan feet*. The mapping is a proper rotation (determinant
// +1, no mirror), so a loop that is counter-clockwise seen from above in the scene stays counter-clockwise in plan:
//
//   up = 'y' (glTF, most OBJ/FBX):  plan.x =  X,  plan.y = −Z,  elevation = Y
//   up = 'z' (CAD-style exports):   plan.x =  X,  plan.y =  Y,  elevation = Z
//
// glTF's −Z is "forward", so plan +Y (north) is the scene's forward direction. Plan X/Y keep the scene origin (no
// offset), so the UI can overlay the extracted room on the 3D model with `planToScene`. Elevations in the StudioRoom
// are measured from that room's floor level (`ExtractedRoom.floorElevation`, plan metres).
import { FEET_PER_METER } from '@intent-studio/core';

export type UpAxis = 'y' | 'z';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Scene-space point (source units already scaled to metres) → plan metres {x, y, z = elevation}. */
export function sceneToPlan(v: Vec3, up: UpAxis = 'y'): Vec3 {
  return up === 'y' ? { x: v.x, y: -v.z, z: v.y } : { x: v.x, y: v.y, z: v.z };
}

/** Inverse of `sceneToPlan` (plan metres → scene metres). */
export function planToScene(p: Vec3, up: UpAxis = 'y'): Vec3 {
  return up === 'y' ? { x: p.x, y: p.z, z: -p.y } : { x: p.x, y: p.y, z: p.z };
}

/** Metres → feet (core's 3.28084). */
export const m2ft = (m: number): number => m * FEET_PER_METER;
/** Feet → metres. */
export const ft2m = (ft: number): number => ft / FEET_PER_METER;
