// Defaults: space classes, targets, labels, wall names, clusters, aisles (spec/defaults.md).
import { format0_1, roundHalfEven } from './format';
import {
  angleDeg,
  area,
  bounds,
  centroid,
  contains,
  distance,
  footprint,
  inflate,
  polygonDistance,
  rect,
  zoneAt,
} from './geometry';
import {
  targetRange,
  type IntentKind,
  type P2,
  type RoomObjectInfo,
  type SpaceClass,
  type StudioRoom,
  type TargetRange,
} from './model';
import { isSurfaceKind, kindOf, resolve, wallFor } from './workplane';

// ---- §1 classFromWords ---------------------------------------------------------------------------------------

// Reference \b is Unicode-aware; JS \b is not, so use lookaround boundaries (patterns start/end with word chars).
const BEFORE = '(?<![\\p{L}\\p{N}_\\p{M}])';
const AFTER = '(?![\\p{L}\\p{N}_\\p{M}])';
const classPattern = (body: string): RegExp => new RegExp(`${BEFORE}(?:${body})${AFTER}`, 'iu');

/** Classification patterns, tested in this order; the first match anywhere wins. */
export const CLASS_PATTERNS: readonly (readonly [SpaceClass, RegExp])[] = [
  ['DataHall', classPattern('data\\s*(?:hall|center|centre|room)|server|computer\\s+room|mdf|idf|telecom')],
  ['Cafeteria', classPattern('cafeteria|dining|canteen|restaurant|servery|cafe|caf[eé]|food\\s+court')],
  ['Lobby', classPattern('lobby|entry|entrance|vestibule|foyer|atrium|reception\\s+area|reception')],
  ['Corridor', classPattern('corridor|hallway|hall|passage|circulation|stair(?:s|well)?|elevator\\s+lobby')],
  ['Conference', classPattern('conference|meeting|boardroom|board\\s+room|huddle')],
  ['Classroom', classPattern('classroom|lecture|training|seminar|school')],
  ['OpenOffice', classPattern('open[\\s-]+(?:plan\\s+)?office|bullpen|open\\s+workspace')],
  ['Office', classPattern('office|workroom|workspace|studio')],
  ['Retail', classPattern('retail|store|showroom|shop|sales\\s+floor')],
  ['Restroom', classPattern('restroom|toilet|lavatory|wc|bathroom')],
  ['Storage', classPattern('storage|closet|janitor|mechanical|electrical|utility|supply')],
  ['BreakRoom', classPattern('break\\s*room|lounge|kitchenette|pantry|breakout')],
];

export function classFromWords(text: string | null | undefined): SpaceClass | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  for (const [cls, re] of CLASS_PATTERNS) if (re.test(text)) return cls;
  return null;
}

// ---- §2 class of a room --------------------------------------------------------------------------------------

export function classOf(room: StudioRoom): SpaceClass {
  const fromType = classFromWords(room.spaceType);
  if (fromType !== null) return fromType;
  const fromLabel = classFromWords(room.label);
  if (fromLabel !== null) return fromLabel;
  const n = new Map<string, number>();
  for (const o of room.objects) n.set(kindOf(o), (n.get(kindOf(o)) ?? 0) + 1);
  const c = (k: string): number => n.get(k) ?? 0;
  if (c('desk') >= 3) return 'OpenOffice';
  if (c('desk') >= 1) return 'Office';
  if (c('reception') >= 1) return 'Lobby';
  if (c('cabinet') >= 4 && c('desk') === 0) return 'DataHall';
  if (c('table') >= 6) return 'Cafeteria';
  if (c('table') >= 1) return 'Conference';
  if (c('seating') >= 2) return 'BreakRoom';
  return 'Other';
}

const CLASS_NAMES: Readonly<Record<SpaceClass, string>> = {
  OpenOffice: 'open office',
  Office: 'office',
  Conference: 'conference room',
  Classroom: 'classroom',
  Cafeteria: 'cafeteria',
  Lobby: 'lobby',
  Corridor: 'corridor',
  DataHall: 'data hall',
  Retail: 'retail',
  Restroom: 'restroom',
  Storage: 'storage room',
  BreakRoom: 'break room',
  Other: 'room',
};
export const className = (cls: SpaceClass): string => CLASS_NAMES[cls];

/** room.spaceType trimmed (as typed) when set, else the class name. */
export function spaceType(room: StudioRoom): string {
  return room.spaceType.trim() !== '' ? room.spaceType.trim() : className(classOf(room));
}

// ---- §3 default targets --------------------------------------------------------------------------------------

export interface DefaultTarget {
  target: TargetRange;
  reason: string;
}
const tr = (min: number | null, avg: number | null, max: number | null, reason: string): DefaultTarget => ({
  target: targetRange(min, avg, max),
  reason,
});

export function defaultTarget(
  room: StudioRoom,
  kind: IntentKind,
  objectIndex?: number | null,
  ambientAverage?: number | null,
): DefaultTarget {
  const cls = classOf(room);
  const obj =
    objectIndex !== undefined && objectIndex !== null && objectIndex >= 0 && objectIndex < room.objects.length
      ? (room.objects[objectIndex] as RoomObjectInfo)
      : null;
  switch (kind) {
    case 'Ambient':
      switch (cls) {
        case 'Cafeteria':
          return tr(10, 15, 25, 'Cafeteria dining ambient, IES 10–25 fc at table height');
        case 'Lobby':
        case 'Corridor':
          return tr(5, 10, 20, 'Lobby and circulation ambient, 5–20 fc on the floor');
        case 'DataHall':
          return tr(20, 30, 50, 'Data hall aisle, 20–50 fc on the floor');
        case 'Classroom':
          return tr(20, 30, 50, 'Classroom ambient, IES 20–50 fc');
        case 'Retail':
          return tr(15, 25, 40, 'Retail ambient, 15–40 fc');
        case 'Restroom':
        case 'BreakRoom':
          return tr(10, 15, 30, 'Support space ambient, 10–30 fc');
        case 'Storage':
          return tr(5, 10, 20, 'Storage ambient, 5–20 fc');
        default:
          return tr(10, 20, 35, 'Office ambient, IES 10–35 fc at the work plane');
      }
    case 'Task': {
      const k = obj ? kindOf(obj) : '';
      if (cls === 'DataHall') return tr(20, 30, 50, 'Data hall cold aisle, 20–50 fc on the floor');
      if (k === 'desk' && cls === 'Classroom') return tr(30, 50, 75, 'Classroom desk, IES 30–75 fc');
      if (k === 'counter' || k === 'island')
        return tr(25, 40, 60, cls === 'Cafeteria' ? 'Servery counter, 25–60 fc' : 'Counter task, 25–60 fc');
      if (k === 'reception') return tr(20, 30, 50, 'Reception desk task, 20–50 fc');
      if (k === 'bar') return tr(15, 25, 40, 'Bar counter, 15–40 fc');
      if (k === 'table' && cls === 'Cafeteria') return tr(10, 20, 35, 'Dining table, 10–35 fc');
      if (k === 'table' && cls === 'Conference') return tr(20, 30, 50, 'Conference table, IES 20–50 fc');
      return tr(20, 30, 50, k === 'desk' ? 'Office desk task, IES 20–50 fc' : 'Office task, IES 20–50 fc');
    }
    case 'WallWash':
      return tr(15, 25, 45, 'Wall wash, 15–45 fc vertical');
    case 'Accent':
      if (ambientAverage !== undefined && ambientAverage !== null && ambientAverage > 0)
        return tr(
          null,
          roundHalfEven(ambientAverage * 3, 1),
          null,
          `3× the surrounding ambient (${format0_1(ambientAverage)} fc)`,
        );
      return tr(30, 50, 80, 'Accent, 30–80 fc (no surrounding ambient yet)');
    case 'FeaturePendant':
      return tr(15, 25, 40, 'Feature pendants over a table, 15–40 fc');
    case 'CeilingGlow':
      return tr(5, 10, 20, 'Ceiling glow, 5–20 fc on the ceiling');
    case 'Path':
      return tr(1, 3, 10, 'Path of travel, 1–10 fc');
    case 'KeepDim':
      return tr(null, null, 5, 'Keep dim: nothing brighter than 5 fc');
  }
}

// ---- §4 name helpers -----------------------------------------------------------------------------------------

export function surfaceWord(kind: string): string {
  switch (kind) {
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
      return 'Object';
  }
}

/** Capital letter A + clamp(ordinal, 0, 25). */
export const letter = (ordinal: number): string => String.fromCharCode(65 + Math.min(25, Math.max(0, ordinal)));

export const capitalize = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

export function cleanName(o: RoomObjectInfo): string {
  const name = o.name ?? '';
  const cut = name.indexOf(':');
  const head = cut >= 0 ? name.slice(0, cut) : name;
  const cleaned = head.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  return capitalize(cleaned === '' ? surfaceWord(kindOf(o)) : cleaned);
}

// ---- §5 wall names -------------------------------------------------------------------------------------------

const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'] as const;

function baseWallName(room: StudioRoom, i: number): string {
  const w = room.walls[i]!;
  const deg = angleDeg({ x: -w.inward.x, y: -w.inward.y });
  const a = ((deg % 360) + 360) % 360;
  const sector = roundHalfEven(a / 45) % 8;
  return `${COMPASS[sector]!} wall`;
}

export function wallName(room: StudioRoom, wallIndex: number): string {
  if (wallIndex < 0 || wallIndex >= room.walls.length) return `Wall ${wallIndex + 1}`;
  const base = baseWallName(room, wallIndex);
  let total = 0;
  let pos = 0;
  for (let i = 0; i < room.walls.length; i++) {
    if (baseWallName(room, i) !== base) continue;
    total++;
    if (i <= wallIndex) pos++;
  }
  return total === 1 ? base : `${base} ${pos}`;
}

// ---- §7 clusters and aisles ----------------------------------------------------------------------------------

export interface Cluster {
  group: string;
  ordinal: number;
  /** Original object indices. */
  objects: number[];
  region: P2[];
  center: P2;
}

export const CLUSTER_MERGE_DISTANCE = 3;

export function clusters(room: StudioRoom): Cluster[] {
  const groups = new Map<string, number[]>();
  room.objects.forEach((o, i) => {
    const k = kindOf(o);
    if (!isSurfaceKind(k)) return;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const out: Cluster[] = [];
  for (const [group, items] of groups) {
    const fps = items.map((i) => footprint(room.objects[i] as RoomObjectInfo));
    const parent = items.map((_, i) => i);
    const find = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r] as number;
      return r;
    };
    for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++)
        if (polygonDistance(fps[a] as P2[], fps[b] as P2[]) <= CLUSTER_MERGE_DISTANCE) {
          const ra = find(a);
          const rb = find(b);
          if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
        }
    const comps = new Map<number, number[]>();
    for (let a = 0; a < items.length; a++) {
      const r = find(a);
      const c = comps.get(r);
      if (c) c.push(a);
      else comps.set(r, [a]);
    }
    const built = [...comps.values()]
      .sort((p, q) => (p[0] as number) - (q[0] as number))
      .map((members) => {
        const pts = members.flatMap((m) => fps[m] as P2[]);
        const center: P2 = {
          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        };
        const region =
          members.length === 1
            ? inflate(fps[members[0] as number] as P2[], 1.5)
            : inflate(rect(bounds(pts).min, bounds(pts).max), 1.5);
        return { members, center, region };
      });
    built.sort(
      (p, q) =>
        -roundHalfEven(p.center.y / 3) - -roundHalfEven(q.center.y / 3) || p.center.x - q.center.x,
    );
    built.forEach((b, ordinal) =>
      out.push({
        group,
        ordinal,
        objects: b.members.map((m) => items[m] as number),
        region: b.region,
        center: b.center,
      }),
    );
  }
  return out;
}

export const clusterOf = (room: StudioRoom, objectIndex: number): Cluster | null =>
  clusters(room).find((c) => c.objects.includes(objectIndex)) ?? null;

/** Data-hall aisles (rectangles between facing cabinet rows), top of plan first. */
export function aisles(room: StudioRoom): P2[][] {
  const boxes = room.objects
    .filter((o) => kindOf(o) === 'cabinet' && Math.max(o.length, o.width) >= 6)
    .map((o) => bounds(footprint(o)));
  const found: P2[][] = [];
  for (let ai = 0; ai < boxes.length; ai++) {
    for (let bi = 0; bi < boxes.length; bi++) {
      if (ai === bi) continue;
      const a = boxes[ai]!;
      const b = boxes[bi]!;
      const gapY = b.min.y - a.max.y;
      const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      if (gapY >= 3 && gapY <= 12 && overlapX >= 4) {
        const blocked = boxes.some(
          (c, ci) =>
            ci !== ai && ci !== bi && c.min.y < b.min.y && c.max.y > a.max.y && c.min.x < a.max.x && c.max.x > a.min.x,
        );
        if (!blocked)
          found.push(
            rect(
              { x: Math.max(a.min.x, b.min.x), y: a.max.y },
              { x: Math.min(a.max.x, b.max.x), y: b.min.y },
            ),
          );
      }
      const gapX = b.min.x - a.max.x;
      const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
      if (gapX >= 3 && gapX <= 12 && overlapY >= 4) {
        const blocked = boxes.some(
          (c, ci) =>
            ci !== ai && ci !== bi && c.min.x < b.min.x && c.max.x > a.max.x && c.min.y < a.max.y && c.max.y > a.min.y,
        );
        if (!blocked)
          found.push(
            rect(
              { x: a.max.x, y: Math.max(a.min.y, b.min.y) },
              { x: b.min.x, y: Math.min(a.max.y, b.max.y) },
            ),
          );
      }
    }
  }
  const keyed = found.map((r) => ({ r, c: centroid(r) }));
  keyed.sort((p, q) => -p.c.y - -q.c.y || p.c.x - q.c.x);
  return keyed.map((k) => k.r);
}

/** 1-based data-hall aisle number under a region's centroid, 0 when none. */
export function aisleNumber(room: StudioRoom, region: readonly P2[]): number {
  if (region.length < 3 || classOf(room) !== 'DataHall') return 0;
  const at = centroid(region);
  const list = aisles(room);
  for (let i = 0; i < list.length; i++) if (distance(centroid(list[i] as P2[]), at) < 1) return i + 1;
  return 0;
}

// ---- §6 labels -----------------------------------------------------------------------------------------------

export function defaultLabel(
  room: StudioRoom,
  kind: IntentKind,
  region: readonly P2[],
  wallIndex?: number | null,
  objectIndex?: number | null,
): string {
  const cls = classOf(room);
  const found = resolve(room, kind, region, objectIndex);
  switch (kind) {
    case 'Ambient': {
      const floor = room.floor[0] ? area(room.floor[0]) : 0;
      const share = floor > 0 && region.length >= 3 ? area(region) / floor : 1;
      return share >= 0.6 ? `${capitalize(spaceType(room))} ambient` : 'Zone ambient';
    }
    case 'Task': {
      if (!found) {
        const n = aisleNumber(room, region);
        return n > 0 ? `Aisle ${n} task` : 'Task zone';
      }
      const k = kindOf(found.object);
      const cluster = isSurfaceKind(k) ? clusterOf(room, found.index) : null;
      if (k === 'desk' && cluster) return `Desk cluster ${letter(cluster.ordinal)} task`;
      if (cluster && cluster.objects.length > 1) return `${surfaceWord(k)} cluster ${letter(cluster.ordinal)} task`;
      return `${cleanName(found.object)} task`;
    }
    case 'WallWash': {
      if (found && found.object.name.trim() !== '') return `${cleanName(found.object)} wash`;
      const w = wallFor(room, 'WallWash', region, wallIndex, objectIndex);
      return w !== null ? `${wallName(room, w)} wash` : 'Wall wash';
    }
    case 'Accent':
      return found ? `${cleanName(found.object)} accent` : 'Accent';
    case 'FeaturePendant': {
      const under: number[] = [];
      if (region.length >= 3)
        room.objects.forEach((o, i) => {
          if (isSurfaceKind(kindOf(o)) && contains(region, o.center)) under.push(i);
        });
      if (found && under.length <= 1) return `${cleanName(found.object)} pendants`;
      if (under.length > 1) return `${surfaceWord(kindOf(room.objects[under[0] as number] as RoomObjectInfo))} pendants`;
      return 'Feature pendants';
    }
    case 'CeilingGlow': {
      const c = region.length >= 3 ? centroid(region) : { x: 0, y: 0 };
      const zone = zoneAt(room, c);
      const loop0 = zone?.loops[0];
      const wholeZone = zone !== null && loop0 !== undefined && area(region) >= 0.6 * area(loop0);
      if (found && !wholeZone) return `${surfaceWord(kindOf(found.object))} glow`;
      if (zone === null) return 'Ceiling glow';
      return zone.height > room.ceilingHeight ? 'Cove glow' : 'Soffit glow';
    }
    case 'Path':
      return cls === 'Lobby' ? 'Entry path' : cls === 'Corridor' ? 'Corridor path' : 'Path';
    case 'KeepDim':
      return found ? `${cleanName(found.object)} — keep dim` : 'Keep-dim zone';
  }
}

