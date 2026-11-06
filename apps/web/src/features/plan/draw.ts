// Plan canvas painter. Draws one frame of the plan into a 2D context already scaled to CSS pixels.
import {
  area,
  footprint,
  intentInkColor,
  targetStatus,
  wallDirection,
  type IntentEstimate,
  type LightingIntent,
  type P2,
  type RoomDesign,
  type TargetStatus,
} from '@intent-studio/core';
import { STATUS_GLYPH } from '../../state/display';
import type { Units } from '../../state/store';
import { fixtureShape, intentAnchor } from './hit';
import type { PlanHeatLayer } from './heat';
import { toScreen, type View } from './view';

export interface Palette {
  bg: string;
  panel: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  ok: string;
  under: string;
  over: string;
}

export const FALLBACK_PALETTE: Palette = {
  bg: '#f6f7f9',
  panel: '#ffffff',
  ink: '#1d2330',
  muted: '#5d6675',
  line: '#dde1e7',
  accent: '#2259c0',
  ok: '#17733d',
  under: '#9a4706',
  over: '#b42318',
};

/** Work in progress shown over the plan. */
export type Draft =
  | { kind: 'rect'; color: string; a: P2; b: P2 }
  | { kind: 'polygon'; color: string; points: P2[]; cursor: P2 | null }
  | null;

export interface Hover {
  wallIndex?: number | null;
  objectIndex?: number | null;
}

export interface FrameInput {
  design: RoomDesign;
  view: View;
  width: number;
  height: number;
  palette: Palette;
  units: Units;
  estimates: Readonly<Record<string, IntentEstimate>>;
  selectedIntentId: string | null;
  selectedFixtureId: string | null;
  /** Heat layers with their bitmaps (null = overlay off). */
  heat: readonly { layer: PlanHeatLayer; image: CanvasImageSource }[] | null;
  draft: Draft;
  hover: Hover | null;
  /** A fixture being dragged, drawn at `center`. */
  dragging: { intentId: string; fixtureId: string; center: P2; snapped?: boolean } | null;
  /** Hidden by default in the editor; exports can retain labels. Selected zones always show their label. */
  showLabels?: boolean;
}

const alpha = (hex: string, a: number): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

function path(ctx: CanvasRenderingContext2D, v: View, poly: readonly P2[], close = true): void {
  poly.forEach((p, k) => {
    const s = toScreen(v, p);
    if (k === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (close) ctx.closePath();
}

function floorPath(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  ctx.beginPath();
  for (const loop of f.design.room.floor) if (loop.length >= 3) path(ctx, f.view, loop);
}

/** A "nice" scale-bar length (ft) for about `px` pixels. */
export function niceLength(feetForPx: number): number {
  const steps = [1, 2, 5];
  const mag = 10 ** Math.floor(Math.log10(Math.max(feetForPx, 1e-6)));
  let best = mag;
  for (const m of [mag, mag * 10]) for (const s of steps) if (s * m <= feetForPx) best = Math.max(best, s * m);
  return best;
}

/** Heat overlay opacity: objects, walls and fixtures stay readable through it. */
export const HEAT_ALPHA = 0.75;

/** One intent label box in screen px (centre x/y, width, height); higher priority places first. */
export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}
export interface PlacedLabel extends LabelBox {
  /** Vertical nudge applied (px). */
  dy: number;
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap: number,
) => Math.abs(a.x - b.x) * 2 < a.w + b.w + gap && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap;

/**
 * Collision pass for intent labels: in priority order (ties keep input order) each label takes the first vertical
 * nudge (0, +1, −1, +2, −2, +3, −3 label heights) that clears every label already placed and stays inside `bounds`; a
 * label with no free slot is hidden. The selected intent's label (priority MAX_SAFE_INTEGER) always stays at its anchor.
 */
export function placeLabels(
  boxes: readonly LabelBox[],
  gap = 2,
  bounds: { width: number; height: number } | null = null,
): PlacedLabel[] {
  const order = boxes.map((b, k) => ({ b, k })).sort((p, q) => q.b.priority - p.b.priority || p.k - q.k);
  const placed: PlacedLabel[] = [];
  const inside = (c: LabelBox) => !bounds || (c.y - c.h / 2 >= 0 && c.y + c.h / 2 <= bounds.height);
  for (const { b: raw } of order) {
    // keep the box horizontally on the canvas
    const b =
      bounds && raw.w < bounds.width
        ? { ...raw, x: Math.min(bounds.width - raw.w / 2, Math.max(raw.w / 2, raw.x)) }
        : raw;
    const step = b.h + gap;
    const first = placed.length === 0;
    for (const n of [0, 1, -1, 2, -2, 3, -3]) {
      const c = { ...b, y: b.y + n * step, dy: n * step };
      if (first && n === 0 && raw.priority === Number.MAX_SAFE_INTEGER) {
        placed.push(c);
        break;
      }
      if (inside(c) && placed.every((p) => !overlaps(p, c, gap))) {
        placed.push(c);
        break;
      }
    }
  }
  return placed;
}

const statusColor = (p: Palette, s: TargetStatus): string => (s === 'Meets' ? p.ok : s === 'Under' ? p.under : p.over);

export function drawPlan(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const { design, view: v, palette: P } = f;
  const room = design.room;
  const px = v.scale; // px per ft
  ctx.save();
  ctx.fillStyle = P.panel;
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // floor
  floorPath(ctx, f);
  ctx.fillStyle = alpha(P.ink, 0.04);
  ctx.fill('evenodd');

  // ceiling grid, heat overlay (clipped to the floor)
  ctx.save();
  floorPath(ctx, f);
  ctx.clip('evenodd');
  const g = room.ceilingGrid;
  if (g) {
    const lu = Math.hypot(g.u.x, g.u.y);
    const lv = Math.hypot(g.v.x, g.v.y);
    if (lu * px >= 6 && lv * px >= 6) {
      const b = room.floor[0] ?? [];
      const span =
        b.reduce((m, p) => Math.max(m, Math.hypot(p.x - g.origin.x, p.y - g.origin.y)), 0) + Math.max(lu, lv);
      const nu = Math.min(400, Math.ceil(span / lu));
      const nv = Math.min(400, Math.ceil(span / lv));
      ctx.beginPath();
      for (let k = -nu; k <= nu; k++) {
        const o = { x: g.origin.x + g.u.x * k, y: g.origin.y + g.u.y * k };
        path(
          ctx,
          v,
          [
            { x: o.x - (g.v.x * span) / lv, y: o.y - (g.v.y * span) / lv },
            { x: o.x + (g.v.x * span) / lv, y: o.y + (g.v.y * span) / lv },
          ],
          false,
        );
      }
      for (let k = -nv; k <= nv; k++) {
        const o = { x: g.origin.x + g.v.x * k, y: g.origin.y + g.v.y * k };
        path(
          ctx,
          v,
          [
            { x: o.x - (g.u.x * span) / lu, y: o.y - (g.u.y * span) / lu },
            { x: o.x + (g.u.x * span) / lu, y: o.y + (g.u.y * span) / lu },
          ],
          false,
        );
      }
      ctx.strokeStyle = alpha(P.muted, 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (f.heat) {
    ctx.globalAlpha = HEAT_ALPHA;
    ctx.imageSmoothingEnabled = true;
    for (const { layer, image } of f.heat) {
      const w = layer.raster.width;
      const h = layer.raster.height;
      const o = toScreen(v, layer.origin);
      const u = toScreen(v, layer.uEnd);
      const q = toScreen(v, layer.vEnd);
      ctx.save();
      // raster pixel (c, r) → screen, composed with the caller's devicePixelRatio scale
      ctx.transform((u.x - o.x) / w, (u.y - o.y) / w, (q.x - o.x) / h, (q.y - o.y) / h, o.x, o.y);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // floor outline
  floorPath(ctx, f);
  ctx.strokeStyle = alpha(P.ink, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();

  // ceiling zones (pockets / soffits)
  ctx.setLineDash([6, 4]);
  for (const z of room.ceilingZones) {
    if (z.isMain || !z.loops[0]) continue;
    ctx.beginPath();
    path(ctx, v, z.loops[0]);
    ctx.fillStyle = alpha(P.accent, 0.05);
    ctx.fill();
    ctx.strokeStyle = alpha(P.muted, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    if (px > 8) {
      const c = toScreen(v, z.loops[0][0]!);
      ctx.fillStyle = P.muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(z.height > room.ceilingHeight ? 'raised ceiling' : 'lowered ceiling', c.x + 4, c.y + 13);
    }
  }
  ctx.setLineDash([]);

  // objects
  room.objects.forEach((o, k) => {
    const fp = footprint(o);
    ctx.beginPath();
    path(ctx, v, fp);
    const hot = f.hover?.objectIndex === k;
    ctx.fillStyle = alpha(P.muted, hot ? 0.3 : 0.14);
    ctx.fill();
    ctx.strokeStyle = hot ? P.accent : alpha(P.muted, 0.7);
    ctx.lineWidth = hot ? 2 : 1;
    ctx.stroke();
    if (o.length * px > 60 && o.width * px > 14) {
      const c = toScreen(v, o.center);
      ctx.fillStyle = P.muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.name, c.x, c.y, o.length * px - 6);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  });

  // walls with openings
  room.walls.forEach((w, k) => {
    const d = wallDirection(w);
    const at = (t: number): P2 => ({ x: w.start.x + d.x * t, y: w.start.y + d.y * t });
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    const ops = [...w.openings].sort((a, b) => a.from - b.from);
    const hot = f.hover?.wallIndex === k;
    ctx.strokeStyle = hot ? P.accent : P.ink;
    ctx.lineWidth = hot ? 6 : 4;
    ctx.beginPath();
    let t = 0;
    for (const o of ops) {
      if (o.from > t) path(ctx, v, [at(t), at(Math.min(o.from, len))], false);
      t = Math.max(t, o.to);
    }
    if (t < len) path(ctx, v, [at(t), at(len)], false);
    ctx.stroke();
    for (const o of ops) {
      const door = /door/i.test(o.kind);
      ctx.beginPath();
      path(ctx, v, [at(Math.max(0, o.from)), at(Math.min(len, o.to))], false);
      ctx.strokeStyle = door ? alpha(P.muted, 0.9) : P.accent;
      ctx.lineWidth = door ? 1 : 2;
      ctx.setLineDash(door ? [3, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // existing fixtures
  const removed = new Set(design.removedExisting);
  for (const e of room.existing) {
    const c = toScreen(v, e.center);
    const r = Math.max(3, (Math.max(e.length, e.width) * px) / 2);
    ctx.beginPath();
    if (e.isRound) ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    else ctx.rect(c.x - r, c.y - r, 2 * r, 2 * r);
    ctx.strokeStyle = alpha(P.muted, removed.has(e.id) ? 0.3 : 0.9);
    ctx.lineWidth = 1;
    ctx.setLineDash(removed.has(e.id) ? [2, 2] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // intents
  for (const i of design.intents) {
    const color = intentInkColor(i.kind);
    const sel = i.id === f.selectedIntentId;
    const r = i.region;
    ctx.setLineDash(i.isSuggestion ? [5, 4] : []);
    ctx.strokeStyle = alpha(color, i.isSuggestion ? 0.7 : 0.95);
    ctx.lineWidth = sel ? 3 : 1.5;
    if (r.length >= 3) {
      ctx.beginPath();
      path(ctx, v, r);
      ctx.fillStyle = alpha(color, f.heat ? 0.02 : i.isSuggestion ? 0.05 : sel ? 0.2 : 0.11);
      ctx.fill();
      ctx.stroke();
    } else if (r.length === 2) {
      ctx.beginPath();
      path(ctx, v, r, false);
      ctx.lineWidth = sel ? 9 : 6;
      ctx.strokeStyle = alpha(color, i.isSuggestion ? 0.35 : 0.6);
      ctx.stroke();
    } else if (r.length === 1) {
      const c = toScreen(v, r[0]!);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(6, 0.8 * px), 0, Math.PI * 2);
      ctx.fillStyle = alpha(color, 0.18);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // fixtures
  for (const i of design.intents) {
    if (i.isSuggestion) continue;
    const color = intentInkColor(i.kind);
    for (const fx of i.fixtures) {
      const drag = f.dragging && f.dragging.fixtureId === fx.id && f.dragging.intentId === i.id ? f.dragging : null;
      const fixture = drag ? { ...fx, center: drag.center } : fx;
      const shape = fixtureShape(room, i, fixture);
      ctx.beginPath();
      if (shape.kind === 'circle') {
        const c = toScreen(v, shape.center);
        ctx.arc(c.x, c.y, Math.max(3, shape.radius * px), 0, Math.PI * 2);
      } else path(ctx, v, shape.polygon);
      // a light halo keeps the outline readable on the heat colours; unpinned fixtures are see-through
      ctx.fillStyle = fx.pinned ? color : alpha(P.panel, f.heat ? 0.35 : 0.85);
      ctx.fill();
      ctx.strokeStyle = alpha(P.panel, 0.9);
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.stroke();
      const c = toScreen(v, fixture.center);
      if (fx.pinned) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = P.panel;
        ctx.fill();
      }
      if (fx.id === f.selectedFixtureId || drag) {
        ctx.beginPath();
        const rr =
          shape.kind === 'circle'
            ? Math.max(3, shape.radius * px) + 4
            : 4 +
              Math.max(...shape.polygon.map((p) => Math.hypot(p.x - fixture.center.x, p.y - fixture.center.y))) * px;
        ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  if (f.dragging?.snapped) {
    const c = toScreen(v, f.dragging.center);
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(c.x - 24, c.y);
    ctx.lineTo(c.x + 24, c.y);
    ctx.moveTo(c.x, c.y - 24);
    ctx.lineTo(c.x, c.y + 24);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // labels + status glyphs (collision pass: the selected label wins, lower-priority labels nudge or hide)
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const GW = 14;
  const LH = 18;
  const items = new Map<string, { text: string; status: TargetStatus | null; kind: LightingIntent['kind'] }>();
  const boxes: LabelBox[] = [];
  design.intents.forEach((i, k) => {
    if (i.isSuggestion || (f.showLabels === false && i.id !== f.selectedIntentId)) return;
    const a = intentAnchor(i);
    if (!a) return;
    const e = f.estimates[i.id];
    const s = toScreen(v, a);
    const w = Math.min(ctx.measureText(i.label).width, 160) + GW + 10;
    items.set(i.id, { text: i.label, status: e ? targetStatus(i.target, e.average) : null, kind: i.kind });
    const big = i.region.length >= 3 ? area(i.region) : 0;
    boxes.push({
      id: i.id,
      x: s.x,
      y: s.y - (i.region.length === 1 ? LH : 0),
      w,
      h: LH,
      priority: i.id === f.selectedIntentId ? Number.MAX_SAFE_INTEGER : big - k * 1e-6,
    });
  });
  for (const b of placeLabels(boxes, 2, { width: f.width, height: f.height })) {
    const it = items.get(b.id)!;
    const x = b.x - b.w / 2;
    const y = b.y;
    const glyph = it.status ? STATUS_GLYPH[it.status] : '…';
    ctx.fillStyle = alpha(P.panel, 0.92);
    ctx.strokeStyle = b.id === f.selectedIntentId ? P.accent : alpha(intentInkColor(it.kind), 0.8);
    ctx.lineWidth = b.id === f.selectedIntentId ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y - LH / 2, b.w, LH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = it.status ? statusColor(P, it.status) : P.muted;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(glyph, x + 5, y + 0.5);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = P.ink;
    ctx.fillText(it.text, x + 5 + GW, y + 0.5, 160);
  }
  ctx.textBaseline = 'alphabetic';

  // draft
  const d = f.draft;
  if (d) {
    ctx.strokeStyle = d.color;
    ctx.fillStyle = alpha(d.color, 0.15);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (d.kind === 'rect') {
      path(ctx, v, [d.a, { x: d.b.x, y: d.a.y }, d.b, { x: d.a.x, y: d.b.y }]);
      ctx.fill();
    } else {
      path(ctx, v, d.cursor ? [...d.points, d.cursor] : d.points, false);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (d.kind === 'polygon')
      for (const [k, p] of d.points.entries()) {
        const s = toScreen(v, p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, k === 0 ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = k === 0 ? d.color : P.panel;
        ctx.fill();
        ctx.stroke();
      }
  }

  // scale bar (display units)
  const metric = f.units === 'metric';
  const unitFt = metric ? 3.28084 : 1;
  const wantPx = 100;
  const lenUnits = niceLength(wantPx / px / unitFt);
  const barPx = lenUnits * unitFt * px;
  const bx = 14;
  const by = f.height - 16;
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by - 5);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + barPx, by);
  ctx.lineTo(bx + barPx, by - 5);
  ctx.stroke();
  ctx.fillStyle = P.ink;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`${lenUnits} ${metric ? 'm' : 'ft'}`, bx + barPx + 6, by);
  // north arrow
  ctx.fillText('N ↑', f.width - 34, 18);
  ctx.restore();
}
