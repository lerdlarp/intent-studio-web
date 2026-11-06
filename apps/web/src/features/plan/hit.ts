// Plan hit-testing and tool logic, in plan feet. Pure (no DOM).
import {
  FACE_KINDS,
  INTENT_INK,
  STUDIO_TOOLS,
  area,
  centroid,
  contains,
  distance,
  distanceToSegment,
  footprint,
  kindOf,
  nearestWall,
  orientedRect,
  productOf,
  toolToKind,
  type IntentKind,
  type LightingIntent,
  type P2,
  type RoomDesign,
  type StudioFixture,
  type StudioRoom,
  type StudioTool,
} from '@intent-studio/core';
import type { PaintTarget } from '../../state/paint';

/** Smallest drawn footprint (ft) so tiny fixtures stay visible and clickable. */
export const MIN_FOOTPRINT = 0.6;

export type FixtureShape = { kind: 'circle'; center: P2; radius: number } | { kind: 'rect'; polygon: P2[] };

/** Footprint of a fixture from its intent's product: a circle for round products, an oriented rect for linear. */
export function fixtureShape(room: StudioRoom, intent: LightingIntent, f: StudioFixture): FixtureShape {
  const p = productOf(room, intent);
  const len = Math.max(p.length, MIN_FOOTPRINT);
  const wid = Math.max(p.width, MIN_FOOTPRINT);
  if (p.isRound) return { kind: 'circle', center: f.center, radius: Math.max(len, wid) / 2 };
  return { kind: 'rect', polygon: orientedRect(f.center, len, wid, f.orientation) };
}

function distanceToShape(s: FixtureShape, p: P2): number {
  if (s.kind === 'circle') return Math.max(0, distance(s.center, p) - s.radius);
  if (contains(s.polygon, p)) return 0;
  let d = Infinity;
  for (let k = 0; k < s.polygon.length; k++)
    d = Math.min(d, distanceToSegment(p, s.polygon[k]!, s.polygon[(k + 1) % s.polygon.length]!));
  return d;
}

export interface FixtureHit {
  intentId: string;
  fixtureId: string;
}

/** The accepted intent's fixture nearest `p` within `tol` ft (fixtures drawn last win ties). */
export function hitFixture(design: RoomDesign, p: P2, tol: number): FixtureHit | null {
  let best: FixtureHit | null = null;
  let bestD = Infinity;
  for (const i of design.intents) {
    if (i.isSuggestion) continue;
    for (const f of i.fixtures) {
      const d = distanceToShape(fixtureShape(design.room, i, f), p);
      if (d <= tol && d <= bestD) {
        bestD = d;
        best = { intentId: i.id, fixtureId: f.id };
      }
    }
  }
  return best;
}

/** Smallest room object whose footprint holds `p` (or lies within `tol` ft). */
export function hitObject(
  room: StudioRoom,
  p: P2,
  tol = 0,
  accept: (kind: string) => boolean = () => true,
): number | null {
  let best: number | null = null;
  let bestA = Infinity;
  room.objects.forEach((o, k) => {
    if (!accept(kindOf(o))) return;
    const fp = footprint(o);
    const near = contains(fp, p) || fp.some((a, j) => distanceToSegment(p, a, fp[(j + 1) % fp.length]!) <= tol);
    if (!near) return;
    const a = area(fp);
    if (a < bestA) {
      bestA = a;
      best = k;
    }
  });
  return best;
}

export const hitWall = (room: StudioRoom, p: P2, tol: number): number | null => nearestWall(room, p, tol);

/** Where an intent's label and status glyph go. */
export function intentAnchor(i: LightingIntent): P2 | null {
  const r = i.region;
  if (r.length === 0) return null;
  if (r.length === 1) return r[0]!;
  if (r.length === 2) return { x: (r[0]!.x + r[1]!.x) / 2, y: (r[0]!.y + r[1]!.y) / 2 };
  return centroid(r);
}

/** The intent under `p`: points and runs within `tol`, else the smallest region containing it. */
export function hitIntent(design: RoomDesign, p: P2, tol: number, includeSuggestions = true): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const i of design.intents) {
    if (i.isSuggestion && !includeSuggestions) continue;
    const r = i.region;
    let score: number | null = null;
    if (r.length === 1) score = distance(r[0]!, p) <= tol + 0.8 ? 0 : null;
    else if (r.length === 2) score = distanceToSegment(p, r[0]!, r[1]!) <= tol + 0.5 ? 0.5 : null;
    else if (r.length >= 3 && contains(r, p)) score = 1 + area(r);
    if (score !== null && score < bestScore) {
      bestScore = score;
      best = i.id;
    }
  }
  return best;
}

// ---- tools --------------------------------------------------------------------------------------------------------

/** How a tool paints: select, an area (drag a rect / click a polygon), a wall click, or an object / point click. */
export type ToolMode = 'select' | 'area' | 'wall' | 'point';

export function toolMode(tool: StudioTool): ToolMode {
  const kind = toolToKind(tool);
  if (kind === null) return 'select';
  if (kind === 'WallWash') return 'wall';
  if (kind === 'Accent' || kind === 'FeaturePendant') return 'point';
  return 'area';
}

/** Keyboard shortcut per tool: V for Select, 1–8 for the kinds in their numeric order. */
export const TOOL_KEYS: Readonly<Record<StudioTool, string>> = Object.fromEntries(
  STUDIO_TOOLS.map((t, k) => [t, k === 0 ? 'V' : String(k)]),
) as Record<StudioTool, string>;

export function toolForKey(key: string): StudioTool | null {
  const k = key.toUpperCase();
  return (STUDIO_TOOLS.find((t) => TOOL_KEYS[t] === k) as StudioTool | undefined) ?? null;
}

export const toolLabel = (tool: StudioTool): string => {
  const kind = toolToKind(tool);
  return kind === null ? 'Select' : INTENT_INK[kind].name;
};

export const TOOL_HINT: Readonly<Record<ToolMode, string>> = {
  select: 'Click to select; drag a fixture to move (and pin) it; drag empty space to pan.',
  area: 'Drag a rectangle, or click points and double-click (or Enter) to close a polygon. Esc cancels.',
  wall: 'Click a wall (or a picture / screen on it) to wash it. Esc cancels.',
  point: 'Click an object or a point. Esc cancels.',
};

const FACE: ReadonlySet<string> = new Set(FACE_KINDS);

/** What a click with a wall / point tool paints, or null when nothing is there to paint. */
export function clickTarget(room: StudioRoom, kind: IntentKind, p: P2, tol: number): PaintTarget | null {
  if (kind === 'WallWash') {
    const face = hitObject(room, p, tol, (k) => FACE.has(k));
    if (face !== null) return { objectIndex: face };
    const w = hitWall(room, p, tol);
    return w === null ? null : { wallIndex: w };
  }
  const o = hitObject(room, p, kind === 'Accent' ? tol : 0);
  return o !== null ? { objectIndex: o } : { point: p };
}

/** Rectangle region from two drag corners (CCW), or null when too thin. */
export function dragRect(a: P2, b: P2, min = 0.5): P2[] | null {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (x1 - x0 < min || y1 - y0 < min) return null;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}
