// Designer-made intents: paint input (a region, a wall, an object or a point) → a new accepted intent whose label,
// target and plane come from the core defaults exactly as core builds suggestions (`makeSuggestion`) or interpreter
// intents (`forTarget`). Also the defensive check of interpreted intents from the server (AI output is untrusted).
import {
  INTENT_KINDS,
  area,
  defaultTarget,
  forTarget,
  footprint,
  intentKey,
  makeSuggestion,
  nearestWall,
  newIntentId,
  rect,
  washRun,
  type IntentKind,
  type LightingIntent,
  type P2,
  type StudioRoom,
} from '@intent-studio/core';

/** What the designer painted. Exactly one of the shapes. */
export type PaintTarget =
  | { region: readonly P2[] }
  | { wallIndex: number }
  | { objectIndex: number }
  | { point: P2 };

/** Kinds painted as an area (rect / polygon). The others are clicked: a wall (wash) or an object / point. */
export const AREA_KINDS: ReadonlySet<IntentKind> = new Set(['Task', 'Ambient', 'CeilingGlow', 'Path', 'KeepDim', 'FeaturePendant']);
/** Half side (ft) of the square region a point click makes for an area kind. */
export const POINT_PATCH_HALF = 2;
/** Smallest painted area (ft²) that makes an intent. */
export const MIN_REGION_AREA = 1;
/** At most this many intents from one describe. */
export const MAX_DESCRIBED = 12;

const finiteP = (p: P2 | undefined): p is P2 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const copy = (pts: readonly P2[]): P2[] => pts.map((p) => ({ x: p.x, y: p.y }));
const validWall = (room: StudioRoom, w: number): boolean => Number.isInteger(w) && w >= 0 && w < room.walls.length;
const validObject = (room: StudioRoom, o: number): boolean => Number.isInteger(o) && o >= 0 && o < room.objects.length;

/** Ambient average the seeds pass to accents (`makeSuggestion`'s ambientAverage). */
const ambientAverage = (room: StudioRoom, kind: IntentKind): number | null =>
  kind === 'Accent' ? defaultTarget(room, 'Ambient', null, null).target.average : null;

const made = (room: StudioRoom, kind: IntentKind, region: readonly P2[], wall: number | null, obj: number | null) =>
  makeSuggestion(room, kind, region, wall, obj, ambientAverage(room, kind));

function build(room: StudioRoom, kind: IntentKind, t: PaintTarget): LightingIntent | null {
  if ('wallIndex' in t) {
    if (!validWall(room, t.wallIndex)) return null;
    if (kind === 'WallWash') return made(room, kind, washRun(room, t.wallIndex), t.wallIndex, null);
    if (kind === 'KeepDim') return forTarget(room, kind, [t.wallIndex], [])[0] ?? null;
    return null;
  }
  if ('objectIndex' in t) {
    if (!validObject(room, t.objectIndex)) return null;
    const viaCore = kind === 'CeilingGlow' || kind === 'Path' ? undefined : forTarget(room, kind, [], [t.objectIndex])[0];
    if (viaCore) return viaCore;
    if (kind === 'WallWash') return null; // not a face object: click the wall instead
    const o = room.objects[t.objectIndex]!;
    return made(room, kind, kind === 'Accent' ? [o.center] : footprint(o), null, t.objectIndex);
  }
  if ('point' in t) {
    const p = t.point;
    if (!finiteP(p)) return null;
    if (kind === 'Accent') return made(room, kind, [{ ...p }], null, null);
    if (kind === 'WallWash') {
      const w = nearestWall(room, p);
      return w === null ? null : build(room, kind, { wallIndex: w });
    }
    const h = POINT_PATCH_HALF;
    return made(room, kind, rect({ x: p.x - h, y: p.y - h }, { x: p.x + h, y: p.y + h }), null, null);
  }
  const region = t.region;
  if (!region.every(finiteP) || region.length === 0) return null;
  if (kind === 'Accent') return build(room, kind, { point: region.length === 1 ? region[0]! : centre(region) });
  if (kind === 'WallWash') {
    if (region.length === 2) return made(room, kind, copy(region), null, null);
    return build(room, kind, { point: centre(region) });
  }
  if (region.length < 3) return region.length === 1 ? build(room, kind, { point: region[0]! }) : null;
  if (area(region) < MIN_REGION_AREA) return null;
  return made(room, kind, copy(region), null, null);
}

const centre = (pts: readonly P2[]): P2 => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
};

const freshId = (taken: ReadonlySet<string>): string => {
  let id = newIntentId();
  while (taken.has(id)) id = newIntentId();
  return id;
};

/**
 * A new accepted intent (isSuggestion false, no fixtures) from what the designer painted, or null when the input
 * cannot make one (no floor, a wall index out of range, a degenerate region, a wall for a kind that is not a wash…).
 */
export function paintedIntent(
  room: StudioRoom,
  kind: IntentKind,
  target: PaintTarget,
  takenIds: ReadonlySet<string> = new Set(),
): LightingIntent | null {
  const floor0 = room.floor[0];
  if (!floor0 || floor0.length < 3 || !INTENT_KINDS.includes(kind)) return null;
  const i = build(room, kind, target);
  if (!i) return null;
  i.isSuggestion = false;
  i.handTuned = false;
  i.fixtures = [];
  i.trace = [];
  if (takenIds.has(i.id)) i.id = freshId(takenIds);
  return i;
}

/**
 * Untrusted interpreted intents (already shape-checked by zod) → intents safe to add: indices in range, finite
 * region, no fixtures/product/trace from outside, fresh ids, duplicates of existing accepted intents dropped.
 */
export function acceptInterpreted(
  room: StudioRoom,
  incoming: readonly LightingIntent[],
  existing: readonly LightingIntent[],
): LightingIntent[] {
  const taken = new Set(existing.map((i) => i.id));
  const keys = new Set(existing.filter((i) => !i.isSuggestion).map(intentKey));
  const out: LightingIntent[] = [];
  for (const raw of incoming) {
    if (out.length >= MAX_DESCRIBED) break;
    if (!INTENT_KINDS.includes(raw.kind) || !raw.region.every(finiteP)) continue;
    const i: LightingIntent = structuredClone(raw);
    if (i.wallIndex !== null && !validWall(room, i.wallIndex)) i.wallIndex = null;
    if (i.objectIndex !== null && !validObject(room, i.objectIndex)) i.objectIndex = null;
    i.label = i.label.trim().slice(0, 40);
    i.targetReason = i.targetReason.slice(0, 90);
    i.isSuggestion = false;
    i.handTuned = false;
    i.targetEdited = false;
    i.fixtures = [];
    i.product = null;
    i.trace = [];
    const key = intentKey(i);
    if (keys.has(key)) continue;
    keys.add(key);
    if (taken.has(i.id) || i.id.length > 64) i.id = freshId(taken);
    taken.add(i.id);
    out.push(i);
  }
  return out;
}
