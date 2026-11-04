// Offline interpreter: free text → lighting intents (handoff/spec/interpreter.md). Pure and deterministic apart from
// fresh intent ids. Everything funnels into `forTarget`, which the AI interpret codec also calls.
import { clusters, defaultLabel, defaultTarget, wallName } from './defaults';
import { format0_1, roundHalfEven } from './format';
import { add, bounds, centroid, dot, footprint, heading, inflate, perp, rect, scale, sub, unit } from './geometry';
import {
  createIntent,
  roomBounds,
  targetRange,
  wallDirection,
  wallLength,
  type IntentKind,
  type LightingIntent,
  type P2,
  type RoomObjectInfo,
  type StudioRoom,
  type TargetRange,
  type WallInfo,
} from './model';
import { seed } from './suggestions';
import { LUX_PER_FOOTCANDLE } from './units';
import { faceMidpoint, inferPlane, isFaceKind, isSurfaceKind, kindOf, wallFor } from './workplane';

/** At most this many intents of one kind from one `forTarget` call. */
export const MAX_PER_CLAUSE = 6;

// ---- regex helpers ------------------------------------------------------------------------------------------------

// The reference `\b` is Unicode-aware; build it from lookarounds (see PROGRESS decisions / defaults.md).
const W = '[\\p{L}\\p{N}_\\p{M}]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const re = (body: string, flags = 'iu'): RegExp => new RegExp(body.replace(/\\b/g, B), flags);

// ---- §1 kind keywords ---------------------------------------------------------------------------------------------

/** Kind keyword patterns in tie-break order. */
export const KIND_PATTERNS: readonly (readonly [IntentKind, RegExp])[] = [
  [
    'KeepDim',
    re(
      "\\bkeep\\b.{0,30}\\bdim\\b|\\bdim(med|mer|ly|ming)?\\b|\\bglare\\b|\\bno\\s+light\\b|\\bdon'?t\\s+(over)?light\\b|\\bnot\\s+too\\s+bright\\b|\\bdarker\\b",
    ),
  ],
  ['WallWash', re('\\bwash(es|ed|ing)?\\b|\\bgraz(e|es|ed|ing)\\b')],
  ['Accent', re('\\baccent(s|ed|ing)?\\b|\\bhighlight(s|ed|ing)?\\b|\\bspot(light|lit|lights)?\\b|\\bpicture\\s+light')],
  ['FeaturePendant', re('\\bpendants?\\b|\\bchandeliers?\\b|\\bhanging\\b')],
  ['CeilingGlow', re('\\bcove(s)?\\b|\\bglow(s|ing)?\\b|\\bindirect\\b|\\buplight\\w*\\b|\\bhalo\\b|\\bsoffit\\s+light')],
  ['Path', re('\\bpath(way|ways|s)?\\b|\\bwalkways?\\b|\\bcirculation\\b|\\bwayfinding\\b|\\broute\\b')],
  ['Task', re('\\btask(s)?\\b|\\bwork\\s*light\\w*|\\bdesk\\s+light\\w*|\\blight\\s+the\\s+desks?\\b|\\bread(ing)?\\b')],
  [
    'Ambient',
    re('\\bambient\\b|\\bgeneral\\b|\\boverall\\b|\\bwhole\\s+room\\b|\\bentire\\s+room\\b|\\bfill\\s+light\\w*|\\bbase\\s+light\\w*'),
  ],
];

/** Kinds named in the text, in the order they first appear (ties keep table order). */
export function kindsIn(text: string): IntentKind[] {
  const hits: { at: number; kind: IntentKind }[] = [];
  for (const [kind, pattern] of KIND_PATTERNS) {
    const m = pattern.exec(text);
    if (m) hits.push({ at: m.index, kind });
  }
  // Array.prototype.sort is stable.
  return hits.sort((a, b) => a.at - b.at).map((h) => h.kind);
}

// ---- §2 phrase patterns -------------------------------------------------------------------------------------------

const CLAUSE_SPLIT = re('[,;.\\n]+|\\s+(?:and|then|plus|also|but)\\s+|\\s*&\\s*|\\s*\\+\\s*', 'giu');
const LEVEL = re('(\\d+(?:\\.\\d+)?)\\s*(fc|foot[\\s-]*candles?|lux|lx)\\b');
const LEVEL_ALL = re('(\\d+(?:\\.\\d+)?)\\s*(fc|foot[\\s-]*candles?|lux|lx)\\b', 'giu');
const COMPASS = re(
  '\\b(north[\\s-]?east|north[\\s-]?west|south[\\s-]?east|south[\\s-]?west|north|south|east|west)(?:ern)?\\b',
  'giu',
);
const WINDOW_WALL = re('\\bwindow(s|ed)?\\s+wall|\\bglaz\\w*|\\bglass\\s+wall|\\bstorefront');
const DOOR_WALL = re('\\b(entry|entrance|door)\\s+wall');
const LONG_WALL = re('\\blong(est)?\\s+wall');
const ALL_WALLS = re('\\bwalls\\b|\\ball\\s+wall|\\bevery\\s+wall');
const WORD = /[a-z]+|\d+/giu;

const isWindowOpening = (kind: string): boolean => {
  const k = kind.toLowerCase();
  return k.includes('window') || k.includes('glaz') || k.includes('storefront');
};
const isDoorOpening = (kind: string): boolean => kind.toLowerCase().includes('door');
const hasWindow = (w: WallInfo): boolean => w.openings.some((o) => isWindowOpening(o.kind));
const hasDoor = (w: WallInfo): boolean => w.openings.some((o) => isDoorOpening(o.kind));

// ---- §3 tokens, stop words, synonyms ------------------------------------------------------------------------------

/** Word tokens, lower-cased and singularised ("desks" → "desk"; "glass", "its", "bus" stay). */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) {
    const t = m[0].toLowerCase();
    out.push(t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
  }
  return out;
}

export const STOP_WORDS: ReadonlySet<string> = new Set(
  `the a an of to on in at for with and it its is are be my our this that these those wall light lighting lit room area
zone keep make put add give wash accent highlight task dim dimmed ambient cove glow path pathway pendant general overall
bright brighter more less some all every each entire whole please over above under near by from up down side left right
back front floor ceiling new illuminate spot spotlight feature so too not no dont need want like use set around north
south east west northern southern eastern western northeast northwest southeast southwest window door entry entrance
longest long glare work reading read`
    .split(/\s+/)
    .filter((w) => w !== ''),
);
const isStop = (t: string): boolean => STOP_WORDS.has(t.toLowerCase());

export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  desk: ['workstation', 'desk'],
  table: ['table'],
  counter: ['counter', 'servery', 'serving', 'buffet'],
  reception: ['reception'],
  island: ['island'],
  bar: ['bar'],
  artwork: ['art', 'artwork', 'painting', 'picture', 'mural', 'logo', 'brand'],
  display: ['display', 'case', 'showcase'],
  signage: ['sign', 'signage', 'menu', 'board'],
  screen: ['screen', 'tv', 'monitor', 'projector', 'display'],
  mirror: ['mirror'],
  cabinet: ['rack', 'cabinet', 'server'],
  seating: ['sofa', 'couch', 'lounge', 'chair', 'seating'],
};

/** Token set of a room object: name tokens minus stop words, plus its kind and the kind's synonyms. */
export function objectTokens(o: RoomObjectInfo): Set<string> {
  const set = new Set(tokens(o.name ?? '').filter((t) => !isStop(t)));
  const k = kindOf(o);
  if (k !== '') set.add(k);
  for (const s of Object.prototype.hasOwnProperty.call(SYNONYMS, k) ? (SYNONYMS[k] ?? []) : []) set.add(s);
  return set;
}

/** Name words of a clause (levels removed, stop words and stray single letters dropped). */
export function nameWords(clause: string): Set<string> {
  const toks = tokens(clause.replace(LEVEL_ALL, ' '));
  const out = new Set<string>();
  toks.forEach((t, i) => {
    if (isStop(t)) return;
    if (t.length === 1 && (i === 0 || isStop(toks[i - 1] as string))) return;
    out.add(t);
  });
  return out;
}

// ---- §4 level -----------------------------------------------------------------------------------------------------

/** Footcandles requested in the clause (lux converted), rounded to 0.1, when 0 < fc ≤ 200. */
export function levelIn(clause: string): number | null {
  const m = LEVEL.exec(clause);
  if (!m) return null;
  const value = Number(m[1]);
  const unitText = m[2] as string;
  const fc = unitText[0] === 'l' || unitText[0] === 'L' ? value / LUX_PER_FOOTCANDLE : value;
  return fc > 0 && fc <= 200 ? roundHalfEven(fc, 1) : null;
}

/** Target/reason for an explicit level. */
export function levelTarget(kind: IntentKind, fc: number): { target: TargetRange; reason: string } {
  const target =
    kind === 'KeepDim'
      ? targetRange(null, null, fc)
      : targetRange(roundHalfEven(fc * 0.7, 1), fc, roundHalfEven(fc * 1.5, 1));
  return { target, reason: `Requested ${format0_1(fc)} fc` };
}

// ---- §5 walls -----------------------------------------------------------------------------------------------------

/** Wall indices named by compass words, in text order. */
export function wallsNamed(room: StudioRoom, text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(COMPASS)) {
    const word = m[1] as string;
    const name = (word.charAt(0).toUpperCase() + word.slice(1).replace(/[\s-]/g, '').toLowerCase()) + ' wall';
    const lower = name.toLowerCase();
    for (let i = 0; i < room.walls.length; i++) {
      if (wallName(room, i).toLowerCase().startsWith(lower) && !out.includes(i)) out.push(i);
    }
  }
  return out;
}

function clauseWalls(room: StudioRoom, clause: string): number[] {
  const list: number[] = [...wallsNamed(room, clause)];
  if (WINDOW_WALL.test(clause)) room.walls.forEach((w, i) => hasWindow(w) && list.push(i));
  if (DOOR_WALL.test(clause)) room.walls.forEach((w, i) => hasDoor(w) && list.push(i));
  if (LONG_WALL.test(clause) && room.walls.length > 0) {
    let best = 0;
    for (let i = 1; i < room.walls.length; i++)
      if (wallLength(room.walls[i] as WallInfo) > wallLength(room.walls[best] as WallInfo)) best = i;
    list.push(best);
  }
  if (list.length === 0 && ALL_WALLS.test(clause)) {
    const open = room.walls.map((w, i) => ({ w, i })).filter(({ w }) => wallLength(w) >= 6);
    const plain = open.filter(({ w }) => !hasWindow(w));
    for (const { i } of (plain.length > 0 ? plain : open).slice(0, 4)) list.push(i);
  }
  return list.filter((v, k) => list.indexOf(v) === k);
}

// ---- §6 objects ---------------------------------------------------------------------------------------------------

function acceptedBy(kinds: readonly IntentKind[], o: RoomObjectInfo): boolean {
  if (kinds.length === 0) return true;
  const k = kindOf(o);
  return kinds.some((kind) => {
    switch (kind) {
      case 'Task':
      case 'FeaturePendant':
        return isSurfaceKind(k);
      case 'WallWash':
        return isFaceKind(k);
      case 'Accent':
        return isFaceKind(k) || isSurfaceKind(k) || o.top !== null;
      default:
        return true;
    }
  });
}

function clauseObjects(room: StudioRoom, clause: string, kinds: readonly IntentKind[]): number[] {
  const words = nameWords(clause);
  if (words.size === 0) return [];
  let best = 0;
  const scored: { i: number; score: number }[] = [];
  room.objects.forEach((o, i) => {
    if (!acceptedBy(kinds, o)) return;
    const set = objectTokens(o);
    let score = 0;
    for (const w of words) if (set.has(w)) score++;
    if (score > 0) {
      scored.push({ i, score });
      best = Math.max(best, score);
    }
  });
  return scored.filter((s) => s.score === best).map((s) => s.i);
}

export interface Targets {
  walls: number[];
  objects: number[];
  level: number | null;
}

/** Walls, objects and level a clause names. */
export function findTargets(room: StudioRoom, clause: string, kinds: readonly IntentKind[]): Targets {
  return { walls: clauseWalls(room, clause), objects: clauseObjects(room, clause, kinds), level: levelIn(clause) };
}
const isAny = (t: Targets): boolean => t.walls.length > 0 || t.objects.length > 0;

// ---- §7 interpret -------------------------------------------------------------------------------------------------

const NEEDS_TARGET: readonly IntentKind[] = ['WallWash', 'Accent', 'KeepDim', 'Task', 'FeaturePendant'];

interface Piece {
  text: string;
  sep: string;
}
function split(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(CLAUSE_SPLIT)) {
    out.push({ text: text.slice(last, m.index).trim(), sep: m[0] });
    last = (m.index ?? 0) + m[0].length;
  }
  out.push({ text: text.slice(last).trim(), sep: '' });
  return out.filter((p) => p.text !== '');
}

/** The merged clauses `interpret` reads (a clause naming only kinds joins the next clause naming a target). */
export function clauses(room: StudioRoom, text: string): string[] {
  const pieces = split(text);
  const out: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    let clause = (pieces[i] as Piece).text;
    while (i + 1 < pieces.length) {
      const ks = kindsIn(clause);
      if (ks.length === 0 || !ks.every((k) => NEEDS_TARGET.includes(k))) break;
      if (isAny(findTargets(room, clause, []))) break;
      if (/[,;.\n]/.test((pieces[i] as Piece).sep)) break;
      const next = pieces[i + 1] as Piece;
      if (!isAny(findTargets(room, next.text, []))) break;
      clause = clause + ' ' + next.text;
      i++;
    }
    out.push(clause);
  }
  return out;
}

function defaultKinds(room: StudioRoom, t: Targets): IntentKind[] {
  if (t.objects.length > 0) {
    const k = kindOf(room.objects[t.objects[0] as number] as RoomObjectInfo);
    if (isFaceKind(k) && k !== 'screen') return ['Accent'];
    if (k === 'screen') return ['KeepDim'];
    if (isSurfaceKind(k)) return ['Task'];
    return [];
  }
  return t.walls.length > 0 ? ['WallWash'] : [];
}

/** Duplicate-suppression key of an interpreted intent. */
export function intentKey(i: LightingIntent): string {
  const n = i.region.length;
  const cx = n === 0 ? 0 : i.region.reduce((s, p) => s + p.x, 0) / n;
  const cy = n === 0 ? 0 : i.region.reduce((s, p) => s + p.y, 0) / n;
  return `${i.kind}|${i.wallIndex ?? ''}|${i.objectIndex ?? ''}|${roundHalfEven(cx)}|${roundHalfEven(cy)}`;
}

const hasFloor = (room: StudioRoom): boolean => (room.floor[0]?.length ?? 0) > 0;

/** Free text → intents for one room (offline). */
export function interpret(room: StudioRoom, text: string | null | undefined): LightingIntent[] {
  if (text === null || text === undefined || text.trim() === '' || !hasFloor(room)) return [];
  const out: LightingIntent[] = [];
  const seen = new Set<string>();
  let last: IntentKind[] = [];
  for (const clause of clauses(room, text)) {
    let kinds = kindsIn(clause);
    if (kinds.length === 0) {
      const probe = findTargets(room, clause, last);
      if (!isAny(probe)) continue;
      kinds = last.length > 0 ? last : defaultKinds(room, probe);
      if (kinds.length === 0) continue;
    }
    const targets = findTargets(room, clause, kinds);
    for (const kind of kinds) {
      for (const intent of forTarget(room, kind, targets.walls, targets.objects, targets.level)) {
        const key = intentKey(intent);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(intent);
      }
    }
    last = kinds;
  }
  return out;
}

// ---- §8 forTarget -------------------------------------------------------------------------------------------------

const copy = (pts: readonly P2[]): P2[] => pts.map((p) => ({ x: p.x, y: p.y }));

/** The stretch of wall a hung object covers, a foot either side. */
export function runBehind(room: StudioRoom, w: number, o: RoomObjectInfo): P2[] {
  const wall = room.walls[w] as WallInfo;
  const d = wallDirection(wall);
  const L = wallLength(wall);
  const ts = footprint(o).map((p) => dot(sub(p, wall.start), d));
  let t0 = Math.max(0, Math.min(...ts) - 1);
  let t1 = Math.min(L, Math.max(...ts) + 1);
  if (t1 - t0 < 3 || t1 - t0 > 0.9 * L) {
    t0 = 0;
    t1 = L;
  }
  return [add(wall.start, scale(d, t0)), add(wall.start, scale(d, t1))];
}

/** A 5 ft deep zone in front of a screen, along its long side. */
export function keepDimRegion(room: StudioRoom, objectIndex: number): P2[] {
  const o = room.objects[objectIndex] as RoomObjectInfo;
  const w = wallFor(room, 'KeepDim', [], null, objectIndex);
  let inward: P2;
  if (w !== null) inward = (room.walls[w] as WallInfo).inward;
  else {
    const c = hasFloor(room) ? centroid(room.floor[0] as P2[]) : o.center;
    inward = unit(sub(c, o.center));
  }
  let u = heading(o.orientation);
  if (o.length < o.width) u = perp(u);
  const half = Math.max(o.length, o.width) / 2 + 0.5;
  const a = sub(o.center, scale(u, half));
  const b = add(o.center, scale(u, half));
  return [a, b, add(b, scale(inward, 5)), add(a, scale(inward, 5))];
}

/** A 4 ft band along the room's longer axis, or null when the room is under 6 ft either way. */
export function pathBand(room: StudioRoom): P2[] | null {
  const { min: lo, max: hi } = bounds(room.floor[0] ?? []);
  const w = hi.x - lo.x;
  const h = hi.y - lo.y;
  if (w < 6 || h < 6) return null;
  const mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
  return w >= h
    ? rect({ x: lo.x + 2, y: mid.y - 2 }, { x: hi.x - 2, y: mid.y + 2 })
    : rect({ x: mid.x - 2, y: lo.y + 2 }, { x: mid.x + 2, y: hi.y - 2 });
}

/**
 * The funnel: one kind aimed at named walls/objects (and an optional level in fc) → new intents (≤ 6). Used by
 * `interpret` and by the AI interpret codec.
 */
export function forTarget(
  room: StudioRoom,
  kind: IntentKind,
  walls: readonly number[],
  objects: readonly number[],
  level?: number | null,
): LightingIntent[] {
  const floor0 = room.floor[0];
  if (!floor0 || floor0.length < 3) return [];
  const lvl = level === undefined || level === null ? null : level;
  const ambientAvg = defaultTarget(room, 'Ambient', null, null).target.average;
  const objOf = (i: number): RoomObjectInfo => room.objects[i] as RoomObjectInfo;

  const make = (region: readonly P2[], wall: number | null, obj: number | null): LightingIntent => {
    const def = defaultTarget(room, kind, obj, ambientAvg);
    const t = lvl !== null ? levelTarget(kind, lvl) : { target: def.target, reason: def.reason };
    return createIntent({
      kind,
      target: t.target,
      targetReason: t.reason,
      label: defaultLabel(room, kind, region, wall, obj),
      labelSuggested: true,
      region: copy(region),
      wallIndex: wall,
      objectIndex: obj,
      plane: inferPlane(room, kind, region, wall, obj),
    });
  };

  const fromSeeds = (): LightingIntent[] =>
    seed(room)
      .filter((s) => s.kind === kind)
      .slice(0, MAX_PER_CLAUSE)
      .map((s) => {
        const t = lvl !== null ? levelTarget(kind, lvl) : { target: { ...s.target }, reason: s.targetReason };
        return createIntent({
          kind: s.kind,
          label: s.label,
          labelSuggested: true,
          region: copy(s.region),
          wallIndex: s.wallIndex,
          objectIndex: s.objectIndex,
          plane: { ...s.plane },
          target: t.target,
          targetReason: t.reason,
          isSuggestion: false,
        });
      });

  const hasTarget = walls.length > 0 || objects.length > 0;
  const validWall = (w: number): boolean => w >= 0 && w < room.walls.length;
  const validObj = (i: number): boolean => i >= 0 && i < room.objects.length;
  const objs = objects.filter(validObj);
  const wls = walls.filter(validWall);

  switch (kind) {
    case 'Ambient': {
      if (objs.length === 0) return [make(floor0, null, null)];
      const b = bounds(objs.flatMap((i) => footprint(objOf(i))));
      const rb = roomBounds(room);
      const lo = { x: Math.max(b.min.x - 4, rb.min.x), y: Math.max(b.min.y - 4, rb.min.y) };
      const hi = { x: Math.min(b.max.x + 4, rb.max.x), y: Math.min(b.max.y + 4, rb.max.y) };
      return [make(rect(lo, hi), null, null)];
    }
    case 'Task':
    case 'FeaturePendant': {
      if (objs.length === 0) return fromSeeds();
      const out: LightingIntent[] = [];
      const hit = clusters(room)
        .filter((c) => c.objects.some((i) => objs.includes(i)))
        .slice(0, MAX_PER_CLAUSE);
      for (const c of hit) {
        const obj = c.objects.length === 1 ? (c.objects[0] as number) : (objs.find((i) => c.objects.includes(i)) as number);
        const region =
          kind === 'Task' ? c.region : c.objects.length === 1 ? footprint(objOf(obj)) : inflate(c.region, -1.5);
        out.push(make(region, null, obj));
      }
      return out;
    }
    case 'WallWash': {
      const picked: { w: number; o: number | null; run: P2[] }[] = [];
      for (const i of objs) {
        if (!isFaceKind(kindOf(objOf(i)))) continue;
        const w = wallFor(room, 'WallWash', [], null, i);
        if (w !== null) picked.push({ w, o: i, run: runBehind(room, w, objOf(i)) });
      }
      for (const w of wls) {
        if (picked.some((p) => p.w === w)) continue;
        const wall = room.walls[w] as WallInfo;
        picked.push({ w, o: null, run: [wall.start, wall.end] });
      }
      if (picked.length === 0) {
        if (hasTarget) return [];
        const seeds = fromSeeds();
        return seeds.length > 0 ? seeds : defaultWash();
      }
      return picked.slice(0, MAX_PER_CLAUSE).map((p) => make(p.run, p.w, p.o));
    }
    case 'Accent': {
      if (objs.length === 0) return fromSeeds();
      return objs.slice(0, MAX_PER_CLAUSE).map((i) => make([faceMidpoint(room, objOf(i))], null, i));
    }
    case 'KeepDim': {
      if (objs.length > 0)
        return objs.slice(0, MAX_PER_CLAUSE).map((i) => make(keepDimRegion(room, i), null, i));
      if (wls.length > 0)
        return wls.slice(0, MAX_PER_CLAUSE).map((w) => {
          const wall = room.walls[w] as WallInfo;
          const n = scale(wall.inward, 3);
          return make([wall.start, wall.end, add(wall.end, n), add(wall.start, n)], null, null);
        });
      return fromSeeds();
    }
    case 'CeilingGlow': {
      const zones = room.ceilingZones.filter((z) => !z.isMain && z.loops.length > 0);
      const raised = zones.filter((z) => z.height > room.ceilingHeight + 0.5);
      return (raised.length > 0 ? raised : zones)
        .slice(0, MAX_PER_CLAUSE)
        .map((z) => make(z.loops[0] as P2[], null, null));
    }
    case 'Path': {
      const band = pathBand(room);
      return band ? [make(band, null, null)] : [];
    }
  }

  function defaultWash(): LightingIntent[] {
    if (room.walls.length === 0) return [];
    const all = room.walls.map((w, i) => ({ w, i }));
    const plain = all.filter(({ w }) => !hasWindow(w));
    const pool = plain.length > 0 ? plain : all;
    let best = pool[0] as { w: WallInfo; i: number };
    for (const c of pool) if (wallLength(c.w) > wallLength(best.w)) best = c;
    return [make([best.w.start, best.w.end], best.i, null)];
  }
}
