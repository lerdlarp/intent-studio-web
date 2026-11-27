// The editable plan (PLAN §1 UI, Phase 3): an HTML canvas in plan feet (+Y north up), pan / zoom / fit, paint tools
// per StudioTool, select and drag fixtures (dropping pins them), status glyphs, heatmap overlay.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { intentInkColor, roomBounds, toolToKind, type IntentKind, type P2, type StudioTool } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { length } from '../../state/display';
import { snapFixtureCenter, type PaintTarget } from '../../state/store';
import { Icon } from '../shell/Icon';
import { FALLBACK_PALETTE, drawPlan, type Draft, type Hover, type Palette } from './draw';
import { roomPlanHeat } from './heat';
import { freshCalc } from '../../state/store';
import { TOOL_HINT, clickTarget, dragRect, hitFixture, hitIntent, toolForKey, toolLabel, toolMode } from './hit';
import { fitView, panBy, toPlan, toScreen, wheelFactor, zoomAt, type View } from './view';
import { RoomHeatLegend } from './RoomHeatLegend';
import { SelectionBar } from './SelectionBar';
import { setPlanPrintRenderer } from '../export/png';
import './plan.css';

const DRAG_PX = 4;
const FIXTURE_TOL_PX = 6;
const CLICK_TOL_PX = 12;
const CLOSE_PX = 9;

type Gesture =
  | { type: 'pan'; id: number; sx: number; sy: number; view0: View; moved: boolean; click: boolean }
  | {
      type: 'fixture';
      id: number;
      intentId: string;
      fixtureId: string;
      start: P2;
      center0: P2;
      sx: number;
      sy: number;
      moved: boolean;
    }
  | { type: 'press'; id: number; kind: IntentKind; sx: number; sy: number; down: P2; rect: boolean };

const isTextField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function readPalette(el: Element | null): Palette {
  if (!el || typeof getComputedStyle !== 'function') return FALLBACK_PALETTE;
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const P = FALLBACK_PALETTE;
  return {
    canvas: v('--canvas', P.canvas),
    bg: v('--bg', P.bg),
    panel: v('--panel', P.panel),
    ink: v('--ink', P.ink),
    muted: v('--muted', P.muted),
    line: v('--line', P.line),
    accent: v('--accent', P.accent),
    ok: v('--ok', P.ok),
    under: v('--under', P.under),
    over: v('--over', P.over),
  };
}

function rasterCanvas(r: { width: number; height: number; pixels: Uint8ClampedArray }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  const ctx = c.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height), 0, 0);
  return c;
}

export function PlanCanvas() {
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const units = useStudio((s) => s.units);
  const tool = useStudio((s) => s.tool);
  const overlay = useStudio((s) => s.overlay);
  // the full calculation replaces the quick estimate while it matches the design revision
  const calc = useStudio((s) => freshCalc(s));
  const selectedIntentId = useStudio((s) => s.selectedIntentId);
  const hoverIntentId = useStudio((s) => s.hoverIntentId);
  const selectedFixtureId = useStudio((s) => s.selectedFixtureId);
  const highlightIntentIds = useStudio((s) => s.highlightIntentIds);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [showLabels] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState<{
    intentId: string;
    fixtureId: string;
    center: P2;
    snapped?: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const [announce, setAnnounce] = useState('');
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const fittedFor = useRef<string | null>(null);

  const room = design?.room ?? null;
  const mode = toolMode(tool);
  const kind = toolToKind(tool);

  // the palette follows the system theme: redraw when it flips
  const [scheme, setScheme] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setScheme((n) => n + 1);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  // the last frame drawn, so an export can redraw it on the light print palette
  const frameRef = useRef<Omit<Parameters<typeof drawPlan>[1], 'palette'> | null>(null);

  // ---- size and fit ------------------------------------------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        Math.round(r.width) === s.w && Math.round(r.height) === s.h
          ? s
          : { w: Math.round(r.width), h: Math.round(r.height) },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!room || size.w === 0 || size.h === 0) return;
    setView(fitView(roomBounds(room), size.w, size.h));
  }, [room, size.w, size.h]);

  useEffect(() => {
    if (!room || size.w === 0) return;
    const key = `${room.id}:${room.label}`;
    if (fittedFor.current === key && view) return;
    fittedFor.current = key;
    fit();
  }, [room, size.w, view, fit]);

  // ---- heat overlay ------------------------------------------------------------------------------------------------
  const heat = useMemo(() => {
    if (overlay !== 'heatmap' || !design || typeof document === 'undefined') return null;
    // the whole room on one scale, each zone at its own measuring height, drawn in elevation order
    const room = roomPlanHeat(design, calc);
    return { room, layers: room.layers.map((layer) => ({ layer, image: rasterCanvas(layer.raster) })) };
  }, [design, overlay, calc]);

  // ---- draw --------------------------------------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !design || !view || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.w * dpr);
    const H = Math.round(size.h * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const frame = {
      design,
      view,
      width: size.w,
      height: size.h,
      units,
      estimates,
      selectedIntentId,
      selectedFixtureId,
      heat: heat ? heat.layers : null,
      draft,
      hover,
      dragging,
      showLabels,
      hoverIntentId,
      highlightIntentIds,
    };
    frameRef.current = frame;
    drawPlan(ctx, { ...frame, palette: readPalette(wrapRef.current) });
  }, [
    scheme,
    design,
    view,
    size,
    units,
    estimates,
    selectedIntentId,
    selectedFixtureId,
    heat,
    draft,
    hover,
    dragging,
    showLabels,
    hoverIntentId,
    highlightIntentIds,
  ]);

  // exports (PNG, PDF) always print on the light palette, whatever the screen theme
  useEffect(
    () =>
      setPlanPrintRenderer(() => {
        const f = frameRef.current;
        if (!f || typeof document === 'undefined') return null;
        const dpr = window.devicePixelRatio || 1;
        const c = document.createElement('canvas');
        c.width = Math.round(f.width * dpr);
        c.height = Math.round(f.height * dpr);
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawPlan(ctx, { ...f, draft: null, hover: null, palette: FALLBACK_PALETTE });
        return c;
      }),
    [],
  );

  // ---- painting ----------------------------------------------------------------------------------------------------
  const paint = useCallback((k: IntentKind, target: PaintTarget) => {
    const id = studio.getState().paintIntent(k, target);
    setDraft(null);
    if (id) {
      const i = studio.getState().design?.intents.find((x) => x.id === id);
      setAnnounce(`Added ${i?.label ?? 'an intent'}.`);
      studio.getState().setTool('Select');
    } else setAnnounce(k === 'WallWash' ? 'Click on a wall to wash it.' : 'Nothing to paint there.');
  }, []);

  const closePolygon = useCallback(() => {
    if (!draft || draft.kind !== 'polygon' || !kind) return;
    if (draft.points.length >= 3) paint(kind, { region: draft.points });
    else setDraft(null);
  }, [draft, kind, paint]);

  const setToolAndReset = useCallback((t: StudioTool) => {
    studio.getState().setTool(t);
    setDraft(null);
    setHover(null);
  }, []);

  // ---- keyboard ----------------------------------------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      if (e.key === ' ') {
        if (e.target === canvasRef.current) e.preventDefault();
        space.current = true;
        return;
      }
      if (e.key === 'Escape') {
        if (gesture.current?.type === 'fixture') {
          gesture.current = null;
          setDragging(null);
        } else if (draft) setDraft(null);
        else if (studio.getState().tool !== 'Select') setToolAndReset('Select');
        return;
      }
      if (e.key === 'Enter' && draft?.kind === 'polygon') {
        e.preventDefault();
        closePolygon();
        return;
      }
      if (e.target instanceof HTMLButtonElement && e.key === 'Enter') return;
      const t = toolForKey(e.key);
      if (t) {
        e.preventDefault();
        setToolAndReset(t);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [draft, closePolygon, setToolAndReset]);

  // ---- wheel zoom (non-passive so the page does not scroll) ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      setView((v) => (v ? zoomAt(v, wheelFactor(e.deltaY, e.deltaMode), at) : v));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ---- pointer -----------------------------------------------------------------------------------------------------
  const local = (e: ReactPointerEvent): P2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!design || !view) return;
    const s = local(e);
    const p = toPlan(view, s);
    e.currentTarget.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { type: 'pan', id: e.pointerId, sx: s.x, sy: s.y, view0: view, moved: false, click: false };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === 'select' || !kind) {
      const hit = hitFixture(design, p, FIXTURE_TOL_PX / view.scale);
      if (hit) {
        studio.getState().select(hit.intentId, hit.fixtureId);
        const f = design.intents.find((i) => i.id === hit.intentId)?.fixtures.find((x) => x.id === hit.fixtureId);
        gesture.current = {
          type: 'fixture',
          id: e.pointerId,
          ...hit,
          start: p,
          center0: f ? f.center : p,
          sx: s.x,
          sy: s.y,
          moved: false,
        };
        return;
      }
      gesture.current = { type: 'pan', id: e.pointerId, sx: s.x, sy: s.y, view0: view, moved: false, click: true };
      return;
    }
    gesture.current = { type: 'press', id: e.pointerId, kind, sx: s.x, sy: s.y, down: p, rect: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!design || !view || !room) return;
    const s = local(e);
    const p = toPlan(view, s);
    const g = gesture.current;
    if (g && g.id === e.pointerId) {
      const far = Math.hypot(s.x - g.sx, s.y - g.sy) > DRAG_PX;
      if (g.type === 'pan') {
        if (far || g.moved) {
          g.moved = true;
          setPanning(true);
          setView(panBy(g.view0, s.x - g.sx, s.y - g.sy));
        }
        return;
      }
      if (g.type === 'fixture') {
        if (far || g.moved) {
          g.moved = true;
          const intent = design.intents.find((i) => i.id === g.intentId);
          const fixture = intent?.fixtures.find((f) => f.id === g.fixtureId);
          const raw = { x: g.center0.x + p.x - g.start.x, y: g.center0.y + p.y - g.start.y };
          const center = intent ? snapFixtureCenter(room, intent, raw, fixture) : raw;
          setDragging({
            intentId: g.intentId,
            fixtureId: g.fixtureId,
            center,
            snapped: Math.hypot(center.x - raw.x, center.y - raw.y) > 1e-8,
          });
        }
        return;
      }
      const canRect =
        mode === 'area' ? !(draft?.kind === 'polygon' && draft.points.length > 0) : g.kind === 'FeaturePendant';
      if ((far || g.rect) && canRect) {
        g.rect = true;
        setDraft({ kind: 'rect', color: intentInkColor(g.kind), a: g.down, b: p });
        return;
      }
    }
    if (draft?.kind === 'polygon') setDraft({ ...draft, cursor: p });
    if (mode === 'select' && !g) studio.getState().setHover(hitIntent(design, p, CLICK_TOL_PX / view.scale, false));
    if (kind && (mode === 'wall' || mode === 'point')) {
      const t = clickTarget(room, kind, p, CLICK_TOL_PX / view.scale);
      const h: Hover | null =
        t && 'wallIndex' in t
          ? { wallIndex: t.wallIndex }
          : t && 'objectIndex' in t
            ? { objectIndex: t.objectIndex }
            : null;
      setHover((old) => (old?.wallIndex === h?.wallIndex && old?.objectIndex === h?.objectIndex ? old : h));
    } else if (hover) setHover(null);
  };

  const finish = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (!design || !view || !room || cancelled) {
      setDragging(null);
      if (g.type === 'press' && g.rect) setDraft(null);
      return;
    }
    const s = local(e);
    const p = toPlan(view, s);
    if (g.type === 'pan') {
      if (g.click && !g.moved) studio.getState().select(hitIntent(design, p, CLICK_TOL_PX / view.scale));
      return;
    }
    if (g.type === 'fixture') {
      setDragging(null);
      if (g.moved) {
        const center = { x: g.center0.x + p.x - g.start.x, y: g.center0.y + p.y - g.start.y };
        if (studio.getState().moveFixture(g.intentId, g.fixtureId, center)) setAnnounce('Fixture moved and pinned.');
      }
      return;
    }
    if (g.rect) {
      const region = dragRect(g.down, p);
      if (region) paint(g.kind, { region });
      else setDraft(null);
      return;
    }
    if (mode === 'area') {
      const pts = draft?.kind === 'polygon' ? draft.points : [];
      const first = pts[0];
      if (first && pts.length >= 3) {
        const fs = toScreen(view, first);
        if (Math.hypot(fs.x - s.x, fs.y - s.y) <= CLOSE_PX) {
          paint(g.kind, { region: pts });
          return;
        }
      }
      const last = pts[pts.length - 1];
      if (last) {
        const ls = toScreen(view, last);
        if (Math.hypot(ls.x - s.x, ls.y - s.y) <= 3) return;
      }
      setDraft({ kind: 'polygon', color: intentInkColor(g.kind), points: [...pts, p], cursor: p });
      return;
    }
    const t = clickTarget(room, g.kind, p, CLICK_TOL_PX / view.scale);
    if (t) paint(g.kind, t);
    else setAnnounce(g.kind === 'WallWash' ? 'Click on a wall to wash it.' : 'Nothing to paint there.');
  };

  const onKeyDownCanvas = (e: ReactKeyboardEvent) => {
    if (!view) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIntentId) {
      e.preventDefault();
      // a selected fixture goes first; with only the zone selected, the zone goes
      if (selectedFixtureId) {
        if (studio.getState().removeFixture(selectedIntentId, selectedFixtureId))
          setAnnounce('Fixture removed. Undo to restore it.');
      } else studio.getState().removeIntent(selectedIntentId);
      return;
    }
    const step = 40;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      setView(panBy(view, m[0], m[1]));
    } else if (e.key === '+' || e.key === '=') setView(zoomAt(view, 1.25, { x: size.w / 2, y: size.h / 2 }));
    else if (e.key === '-') setView(zoomAt(view, 0.8, { x: size.w / 2, y: size.h / 2 }));
  };

  if (!design || !room) return null;
  const b = roomBounds(room);
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const fixtures = accepted.reduce((n, i) => n + i.fixtures.length, 0);
  const cursorStyle = panning ? 'grabbing' : dragging ? 'move' : mode === 'select' ? 'default' : 'crosshair';

  return (
    <figure className="plan-canvas">
      <p className="sr-only" id="plan-hint">
        {TOOL_HINT[mode]} Wheel to zoom; middle-drag or Space-drag to pan. Press Delete to remove the selected fixture,
        or the selected zone when no fixture is selected. Undo with Ctrl+Z.
      </p>
      <div className="plan-workspace">
        <div className="plan-surface" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label={`Plan of ${room.label || 'the room'}: ${accepted.length} zone${accepted.length === 1 ? '' : 's'}, ${fixtures} fixtures. Tool: ${toolLabel(tool)}.`}
            aria-describedby="plan-hint plan-summary"
            data-testid="plan-canvas"
            data-scale={view?.scale}
            data-ox={view?.ox}
            data-oy={view?.oy}
            style={{ width: size.w || '100%', height: size.h || '100%', cursor: cursorStyle }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
            onPointerLeave={() => studio.getState().setHover(null)}
            onDoubleClick={closePolygon}
            onKeyDown={onKeyDownCanvas}
            onContextMenu={(e) => e.preventDefault()}
          />
          <div className="plan-status muted small">
            <span data-testid="plan-dims">
              Room {length(b.max.x - b.min.x, units)} × {length(b.max.y - b.min.y, units)}
            </span>
            <span className="sr-only" role="status" aria-live="polite">
              {announce}
            </span>
          </div>
        </div>
      </div>
      {kind && (
        <div className="draw-hint" role="status" data-testid="draw-hint">
          {mode === 'area'
            ? `Drag to draw ${toolLabel(tool).toLowerCase()}, or click points for a polygon`
            : mode === 'wall'
              ? 'Click a wall to wash it'
              : 'Click an object or a point'}{' '}
          · Esc to cancel
        </div>
      )}
      {selectedIntentId && !kind && (
        <div className="plan-selection-float">
          <SnapToggle intentId={selectedIntentId} />
          <SelectionBar />
        </div>
      )}
      <button type="button" className="plan-fit" onClick={fit} title="Fit the room in view">
        <Icon name="fit" />
        <span className="sr-only">Fit</span>
      </button>
      {heat && <RoomHeatLegend scale={heat.room.scale} full={heat.room.full} units={units} />}
    </figure>
  );
}

/** Ceiling-grid snapping for the selected zone's fixtures (its behaviour; a dragged fixture snaps while it is on). */
function SnapToggle({ intentId }: { intentId: string }) {
  const design = useStudio((s) => s.design);
  const intent = design?.intents.find((i) => i.id === intentId && !i.isSuggestion);
  if (!design || !intent) return null;
  const grid = design.room.ceilingGrid;
  const on = intent.behavior.alignToCeilingGrid;
  return (
    <button
      type="button"
      className="snap-toggle"
      aria-label="Snap to ceiling grid"
      aria-pressed={grid ? on : false}
      disabled={!grid}
      title={grid ? `Snap ${intent.label} fixtures to the ceiling grid` : 'This room has no ceiling grid'}
      onClick={() => studio.getState().setBehavior(intent.id, { alignToCeilingGrid: !on })}
      data-testid="snap-grid"
    >
      <Icon name="grid" /> Snap
    </button>
  );
}
