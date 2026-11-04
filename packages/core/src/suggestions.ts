// Suggestions (seeding) — handoff/spec/suggestions.md.
// Clusters, aisles and aisle numbers live in defaults.ts (shared with labels); this module ranks the seeds.
import { aisles, classOf, clusters, defaultLabel, defaultTarget, type Cluster } from './defaults';
import {
  add,
  area,
  bounds,
  centroid,
  distance,
  distanceToSegment,
  dot,
  footprint,
  heading,
  inflate,
  inRoom,
  overlapArea,
  perp,
  rect,
  scale,
  sub,
  unit,
  type Polygon,
} from './geometry';
import {
  createIntent,
  defaultBehavior,
  roomBounds,
  wallDirection,
  wallLength,
  type IntentKind,
  type LightingIntent,
  type P2,
  type RoomObjectInfo,
  type SpaceClass,
  type StudioRoom,
  type WallInfo,
} from './model';
import { faceMidpoint, inferPlane, kindOf, wallFor } from './workplane';

// ---- §1 constants ----------------------------------------------------------------------------------------------

export const MAX_SUGGESTIONS = 8;
export const CLUSTER_REGION_INFLATE = 1.5;
export const TASK_CLUSTER_CAP = 4;
export const AISLE_CAP = 3;
export const PENDANT_CLUSTER_CAP = 2;
export const CAFETERIA_TABLE_MINIMUM = 4;
export const GLOW_RAISE = 0.5;
export const ACCENT_CAP = 2;
export const SCREEN_CAP = 2;
export const KEEP_DIM_DEPTH = 5;
export const KEEP_DIM_END_ALLOWANCE = 0.5;
export const WASH_WALL_MIN_LENGTH = 6;
export const PATH_BAND_HALF_WIDTH = 2;
export const FEATURE_WALL_REACH = 1.5;

export const SCORES = {
  ambient: 100,
  task: (i: number): number => 90 - 3 * i,
  aisle: (i: number): number => 88 - 3 * i,
  wash: 80,
  glow: 75,
  accent: (k: number): number => 70 - 2 * k,
  keepDim: 65,
  tablePendants: 62,
  featurePendant: 60,
  path: 50,
} as const;

const PENDANT_GROUPS = new Set(['reception', 'island', 'bar']);
const ACCENT_KINDS = new Set(['artwork', 'display', 'signage']);
const FEATURE_KINDS = new Set(['artwork', 'signage', 'display', 'mirror']);

// ---- helpers ---------------------------------------------------------------------------------------------------

/** `Rect(Bounds(pts).min, Bounds(pts).max)`. */
export function rectOf(pts: readonly P2[]): Polygon {
  const b = bounds(pts);
  return rect(b.min, b.max);
}

/** Whether a cluster of `group` gets a task suggestion in a room of class `cls`. */
export function taskWanted(cls: SpaceClass, group: string): boolean {
  switch (group) {
    case 'desk':
    case 'counter':
    case 'reception':
    case 'island':
    case 'bar':
      return cls !== 'DataHall';
    case 'table':
      return ['Office', 'OpenOffice', 'Conference', 'Classroom', 'Other', 'BreakRoom', 'Retail'].includes(cls);
    default:
      return false;
  }
}

/** True unless the class is DataHall, Storage or Restroom. */
export const washWanted = (cls: SpaceClass): boolean => cls !== 'DataHall' && cls !== 'Storage' && cls !== 'Restroom';

/** The cluster member whose centre is nearest the region centroid; ties keep the lowest index. */
export function closestTo(room: StudioRoom, cluster: Pick<Cluster, 'objects' | 'region'>): number {
  const c = centroid(cluster.region);
  let best = cluster.objects[0] as number;
  let bestD = Infinity;
  for (const i of cluster.objects) {
    const d = distance((room.objects[i] as RoomObjectInfo).center, c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ---- §4 wall wash ----------------------------------------------------------------------------------------------

export const isDoorOpening = (kind: string): boolean => kind.toLowerCase().includes('door');
export const isWindowOpening = (kind: string): boolean => {
  const k = kind.toLowerCase();
  return k.includes('window') || k.includes('glaz');
};

/** Indices of artwork/signage/display/mirror objects whose centre is < 1.5 ft from the wall segment. */
export function featureObjects(room: StudioRoom, wall: WallInfo): number[] {
  const out: number[] = [];
  room.objects.forEach((o, i) => {
    if (FEATURE_KINDS.has(kindOf(o)) && distanceToSegment(o.center, wall.start, wall.end) < FEATURE_WALL_REACH)
      out.push(i);
  });
  return out;
}

/** Wash score of a wall (usable length, +100 for features, +15 when it faces a door wall). */
export function washScore(room: StudioRoom, wallIndex: number): number {
  const wall = room.walls[wallIndex] as WallInfo;
  const entry = room.walls.filter((w) => w.openings.some((o) => isDoorOpening(o.kind))).map((w) => w.inward);
  let score = wallLength(wall);
  for (const o of wall.openings) score -= Math.abs(o.to - o.from);
  if (featureObjects(room, wall).length > 0) score += 100;
  if (entry.some((e) => dot(e, wall.inward) < -0.8)) score += 15;
  return score;
}

/** The wall to wash, or null. */
export function pickWashWall(room: StudioRoom): number | null {
  if (room.walls.length === 0) return null;
  const all: number[] = [];
  room.walls.forEach((w, i) => {
    if (wallLength(w) >= WASH_WALL_MIN_LENGTH) all.push(i);
  });
  if (all.length === 0) return null;
  const windowless = all.filter((i) => !(room.walls[i] as WallInfo).openings.some((o) => isWindowOpening(o.kind)));
  const pool = windowless.length > 0 ? windowless : all;
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const i of pool) {
    const s = washScore(room, i);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/** Two-point wash run along a wall, trimmed to its feature objects (± 1 ft) when sensible. */
export function washRun(room: StudioRoom, wallIndex: number): P2[] {
  const wall = room.walls[wallIndex] as WallInfo;
  const d = wallDirection(wall);
  const len = wallLength(wall);
  let t0 = 0;
  let t1 = len;
  const features = featureObjects(room, wall);
  if (features.length > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of features)
      for (const c of footprint(room.objects[i] as RoomObjectInfo)) {
        const t = dot(sub(c, wall.start), d);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    t0 = Math.max(0, lo - 1);
    t1 = Math.min(len, hi + 1);
    if (t1 - t0 < 3 || t1 - t0 > 0.9 * len) {
      t0 = 0;
      t1 = len;
    }
  }
  return [add(wall.start, scale(d, t0)), add(wall.start, scale(d, t1))];
}

// ---- §6 keep-dim -----------------------------------------------------------------------------------------------

const objectEquals = (a: RoomObjectInfo, b: RoomObjectInfo): boolean =>
  a.name === b.name &&
  a.kind === b.kind &&
  a.center.x === b.center.x &&
  a.center.y === b.center.y &&
  a.length === b.length &&
  a.width === b.width &&
  a.orientation === b.orientation &&
  a.top === b.top &&
  a.bottom === b.bottom;

/** The region 5 ft into the room in front of a screen, 0.5 ft past each end. */
export function keepDimRegion(room: StudioRoom, screen: RoomObjectInfo): Polygon {
  const index = room.objects.findIndex((o) => objectEquals(o, screen));
  const wi = index >= 0 ? wallFor(room, 'KeepDim', [], null, index) : null;
  let inward: P2;
  if (wi !== null) inward = (room.walls[wi] as WallInfo).inward;
  else {
    const floor0 = room.floor[0];
    const c = floor0 && floor0.length > 0 ? centroid(floor0) : screen.center;
    inward = unit(sub(c, screen.center));
  }
  let u = heading(screen.orientation);
  if (screen.length < screen.width) u = perp(u);
  const half = Math.max(screen.length, screen.width) / 2 + KEEP_DIM_END_ALLOWANCE;
  const a = sub(screen.center, scale(u, half));
  const b = add(screen.center, scale(u, half));
  const depth = scale(inward, KEEP_DIM_DEPTH);
  return [a, b, add(b, depth), add(a, depth)];
}

// ---- §7 path ---------------------------------------------------------------------------------------------------

/** A 4 ft band along the room's long axis with the least furniture overlap, or null. */
export function pathRegion(room: StudioRoom): Polygon | null {
  const { min: lo, max: hi } = roomBounds(room);
  const w = hi.x - lo.x;
  const h = hi.y - lo.y;
  if (w < 6 || h < 6) return null;
  const alongX = w >= h;
  const span = alongX ? h : w;
  const base = alongX ? lo.y : lo.x;
  const centre = base + span / 2;
  const hw = PATH_BAND_HALF_WIDTH;
  let best = Infinity;
  let bestRect: Polygon | null = null;
  for (let k = 0; k <= 8; k++) {
    const c = base + hw + ((span - 2 * hw) * k) / 8;
    const r = alongX
      ? rect({ x: lo.x + hw, y: c - hw }, { x: hi.x - hw, y: c + hw })
      : rect({ x: c - hw, y: lo.y + hw }, { x: c + hw, y: hi.y - hw });
    if (!inRoom(room, centroid(r))) continue;
    let overlap = 0;
    for (const o of room.objects) if (o.top === null || o.top > 1) overlap += overlapArea(r, footprint(o), 6);
    const cost = overlap + Math.abs(c - centre) * 0.01;
    if (cost < best - 1e-9) {
      best = cost;
      bestRect = r;
    }
  }
  return bestRect;
}

// ---- §3 seed ---------------------------------------------------------------------------------------------------

/** A suggested intent with defaults-derived label, target and plane. */
export function makeSuggestion(
  room: StudioRoom,
  kind: IntentKind,
  region: readonly P2[],
  wallIndex: number | null,
  objectIndex: number | null,
  ambientAverage: number | null = null,
): LightingIntent {
  const t = defaultTarget(room, kind, objectIndex, ambientAverage);
  return createIntent({
    kind,
    label: defaultLabel(room, kind, region, wallIndex, objectIndex),
    labelSuggested: true,
    region: region.map((p) => ({ x: p.x, y: p.y })),
    wallIndex,
    objectIndex,
    target: t.target,
    targetReason: t.reason,
    plane: inferPlane(room, kind, region, wallIndex, objectIndex),
    behavior: defaultBehavior(),
    isSuggestion: true,
  });
}

/** Scored suggestions in insertion order (before ranking); exposed for tests. */
export function scoredSuggestions(room: StudioRoom): { score: number; intent: LightingIntent }[] {
  const floor0 = room.floor[0];
  if (!floor0 || floor0.length < 3) return [];
  const cls = classOf(room);
  const scored: { score: number; intent: LightingIntent }[] = [];
  const push = (score: number, intent: LightingIntent): void => {
    scored.push({ score, intent });
  };

  // 3. ambient
  const ambient = makeSuggestion(room, 'Ambient', floor0, null, null);
  push(SCORES.ambient, ambient);
  const ambientAverage = ambient.target.average;

  // 4. tasks over clusters
  const cl = clusters(room);
  const tasks = cl
    .filter((c) => taskWanted(cls, c.group))
    .map((c) => ({ c, a: area(c.region) }))
    .sort((p, q) => q.a - p.a)
    .map((x) => x.c);
  for (let i = 0; i < Math.min(tasks.length, TASK_CLUSTER_CAP); i++) {
    const c = tasks[i] as Cluster;
    const obj = c.objects.length === 1 ? (c.objects[0] as number) : closestTo(room, c);
    push(SCORES.task(i), makeSuggestion(room, 'Task', c.region, null, obj));
  }

  // 5. data-hall aisles
  if (cls === 'DataHall') {
    const list = aisles(room);
    for (let i = 0; i < Math.min(list.length, AISLE_CAP); i++)
      push(SCORES.aisle(i), makeSuggestion(room, 'Task', list[i] as P2[], null, null));
  }

  // 6. feature pendants over reception / island / bar clusters
  for (const c of cl.filter((x) => PENDANT_GROUPS.has(x.group)).slice(0, PENDANT_CLUSTER_CAP)) {
    const single = c.objects.length === 1;
    const obj = single ? (c.objects[0] as number) : closestTo(room, c);
    const region = single ? footprint(room.objects[obj] as RoomObjectInfo) : inflate(c.region, -CLUSTER_REGION_INFLATE);
    push(SCORES.featurePendant, makeSuggestion(room, 'FeaturePendant', region, null, obj));
  }

  // 7. cafeteria table pendants
  if (cls === 'Cafeteria') {
    const tables = cl.filter((c) => c.group === 'table').flatMap((c) => c.objects);
    if (tables.length >= CAFETERIA_TABLE_MINIMUM) {
      const pts = tables.flatMap((i) => footprint(room.objects[i] as RoomObjectInfo));
      push(SCORES.tablePendants, makeSuggestion(room, 'FeaturePendant', inflate(rectOf(pts), 0.5), null, null));
    }
  }

  // 8. wall wash
  if (washWanted(cls)) {
    const w = pickWashWall(room);
    if (w !== null) push(SCORES.wash, makeSuggestion(room, 'WallWash', washRun(room, w), w, null));
  }

  // 9. ceiling glow
  for (const z of room.ceilingZones) {
    if (z.isMain || z.height <= room.ceilingHeight + GLOW_RAISE || z.loops.length === 0) continue;
    push(SCORES.glow, makeSuggestion(room, 'CeilingGlow', z.loops[0] as P2[], null, null));
  }

  // 10. accents
  const accents = room.objects
    .map((o, i) => ({ o, i }))
    .filter((x) => ACCENT_KINDS.has(kindOf(x.o)))
    .sort((p, q) => q.o.length - p.o.length)
    .slice(0, ACCENT_CAP);
  accents.forEach((x, k) =>
    push(SCORES.accent(k), makeSuggestion(room, 'Accent', [faceMidpoint(room, x.o)], null, x.i, ambientAverage)),
  );

  // 11. keep-dim in front of screens
  const screens = room.objects
    .map((o, i) => ({ o, i }))
    .filter((x) => kindOf(x.o) === 'screen')
    .slice(0, SCREEN_CAP);
  for (const x of screens) push(SCORES.keepDim, makeSuggestion(room, 'KeepDim', keepDimRegion(room, x.o), null, x.i));

  // 12. path
  if (cls === 'Lobby' || cls === 'Corridor') {
    const path = pathRegion(room);
    if (path !== null) push(SCORES.path, makeSuggestion(room, 'Path', path, null, null));
  }

  return scored;
}

/** Up to 8 ranked suggested intents for a room (stable by score, descending). */
export function seed(room: StudioRoom): LightingIntent[] {
  return scoredSuggestions(room)
    .map((s, order) => ({ ...s, order }))
    .sort((p, q) => q.score - p.score || p.order - q.order)
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => s.intent);
}
