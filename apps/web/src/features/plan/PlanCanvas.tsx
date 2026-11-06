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
import {
  STUDIO_TOOLS,
  intentInkColor,
  roomBounds,
  toolToKind,
  type IntentKind,
  type P2,
  type StudioTool,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { length } from '../../state/display';
import { snapFixtureCenter, type PaintTarget } from '../../state/store';
import { Icon, type IconName } from '../shell/Icon';
import { FALLBACK_PALETTE, drawPlan, type Draft, type Hover, type Palette } from './draw';
import { planHeat, planHeatFromCalc } from './heat';
import { freshCalc } from '../../state/store';
import { KeyboardPaint } from './PlanText';
import {
  TOOL_HINT,
  TOOL_KEYS,
  clickTarget,
  dragRect,
  hitFixture,
  hitIntent,
  toolForKey,
  toolLabel,
  toolMode,
} from './hit';
import { fitView, panBy, toPlan, toScreen, wheelFactor, zoomAt, type View } from './view';
import { HeatLegend, SelectionBar } from './SelectionBar';
import { ZoneCard, placeCard } from '../zone/ZoneCard';
import './plan.css';

const TOOL_ICONS: Record<StudioTool, IconName> = {
  Select: 'select',
  Task: 'task',
  Ambient: 'ambient',
  WallWash: 'wash',
  Accent: 'accent',
  FeaturePendant: 'pendant',
  CeilingGlow: 'glow',
  Path: 'path',
  KeepDim: 'dim',
};

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

/** Screen-space bounding box of a plan polygon / segment / point. */
function screenBox(v: View, pts: readonly P2[]): { x: number; y: number; w: number; h: number } {
  const s = pts.map((p) => toScreen(v, p));
  const xs = s.map((p) => p.x);
  const ys = s.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
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
  const selectedFixtureId = useStudio((s) => s.selectedFixtureId);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [cursor, setCursor] = useState<P2 | null>(null);
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
    const layers = calc ? planHeatFromCalc(calc) : planHeat(design);
    return layers.map((layer) => ({ layer, image: rasterCanvas(layer.raster) }));
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
    drawPlan(ctx, {
      design,
      view,
      width: size.w,
      height: size.h,
      palette: readPalette(wrapRef.current),
      units,
      estimates,
      selectedIntentId,
      selectedFixtureId,
      heat,
      draft,
      hover,
      dragging,
      showLabels,
    });
  }, [
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
  ]);

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
    setCursor(p);
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIntentId && selectedFixtureId) {
      e.preventDefault();
      if (studio.getState().removeFixture(selectedIntentId, selectedFixtureId))
        setAnnounce('Fixture removed. Undo to restore it.');
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
  const selected = design.intents.find((i) => i.id === selectedIntentId && !i.isSuggestion);
  const cursorStyle = panning ? 'grabbing' : dragging ? 'move' : mode === 'select' ? 'default' : 'crosshair';

  return (
    <figure className="plan-canvas">
      <div className="plan-toolbar" role="toolbar" aria-label="Plan tools">
        <div className="btn-group" role="group" aria-label="View">
          <button
            type="button"
            aria-label="Snap to ceiling grid"
            aria-pressed={selected?.behavior.alignToCeilingGrid ?? false}
            disabled={!selected || !room.ceilingGrid}
            title={
              !room.ceilingGrid
                ? 'This room has no ceiling grid'
                : !selected
                  ? 'Select a zone to change snapping'
                  : 'Snap selected zone fixtures to ceiling grid'
            }
            onClick={() =>
              selected &&
              studio.getState().setBehavior(selected.id, { alignToCeilingGrid: !selected.behavior.alignToCeilingGrid })
            }
            data-testid="snap-grid"
          >
            <Icon name="grid" /> Snap
          </button>
          <button
            type="button"
            aria-pressed={overlay === 'heatmap'}
            onClick={() => studio.getState().setOverlay(overlay === 'heatmap' ? 'none' : 'heatmap')}
          >
            <Icon name="heat" /> Heatmap
          </button>
          <button
            type="button"
            aria-pressed={showLabels}
            onClick={() => setShowLabels((v) => !v)}
            title="Show all zone labels"
          >
            Labels
          </button>
          <button type="button" onClick={fit} title="Fit the room in view">
            <Icon name="fit" />
            <span className="sr-only">Fit</span>
          </button>
        </div>
      </div>
      <SelectionBar />
      <details className="plan-help">
        <summary title="Navigation and keyboard shortcuts">
          <Icon name="help" />
          <span>Controls</span>
        </summary>
        <p className="muted small" id="plan-hint">
          {TOOL_HINT[mode]} Wheel to zoom; middle-drag or Space-drag to pan. Select a fixture and press Delete to remove
          it. Undo with Ctrl+Z.
        </p>
      </details>
      <KeyboardPaint />
      <div className="plan-workspace">
        <div className="plan-toolrail" role="toolbar" aria-label="Paint tools">
          {STUDIO_TOOLS.map((t) => {
            const k = toolToKind(t);
            return (
              <button
                key={t}
                type="button"
                className={`tool${tool === t ? ' on' : ''}`}
                aria-label={`${k !== null ? 'Paint ' : ''}${toolLabel(t)}${k === null ? ' tool' : ''}`}
                aria-pressed={tool === t}
                aria-keyshortcuts={TOOL_KEYS[t]}
                title={`${toolLabel(t)} (${TOOL_KEYS[t]})`}
                onClick={() => setToolAndReset(t)}
              >
                <Icon
                  name={TOOL_ICONS[t]}
                  style={k ? { color: tool === t ? 'currentColor' : intentInkColor(k) } : undefined}
                />
                {k !== null && <span className="sr-only">Paint </span>}
                <span>{toolLabel(t)}</span>
                {k === null && <span className="sr-only"> tool</span>}
              </button>
            );
          })}
        </div>
        <div className="plan-surface" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label={`Plan of ${room.label || 'the room'}: ${accepted.length} intents, ${fixtures} fixtures. Tool: ${toolLabel(tool)}.`}
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
            onPointerLeave={() => setCursor(null)}
            onDoubleClick={closePolygon}
            onKeyDown={onKeyDownCanvas}
            onContextMenu={(e) => e.preventDefault()}
          />
          {view && selected && (
            <ZoneCard intent={selected} placement={placeCard(screenBox(view, selected.region), size)} />
          )}
          {view &&
            design.intents
              .filter((i) => i.isSuggestion && i.region.length > 0)
              .map((i) => {
                const b = screenBox(view, i.region);
                return (
                  // the inspector's suggestion list is the accessible path; these are pointer shortcuts
                  <div
                    key={i.id}
                    className="suggestion-pin"
                    style={{ left: b.x, top: Math.max(0, b.y - 26) }}
                    aria-hidden="true"
                  >
                    {i.label}
                    <button
                      type="button"
                      tabIndex={-1}
                      title="Accept suggestion"
                      onClick={() => studio.getState().accept(i.id)}
                    >
                      <Icon name="check" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      title="Dismiss suggestion"
                      onClick={() => studio.getState().dismiss(i.id)}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                );
              })}
          <div className="plan-status muted small">
            <span data-testid="plan-cursor" aria-hidden="true">
              {cursor ? `${length(cursor.x, units)}, ${length(cursor.y, units)}` : ''}
            </span>
            <span data-testid="plan-dims">
              Room {length(b.max.x - b.min.x, units)} × {length(b.max.y - b.min.y, units)}
            </span>
            <span className="sr-only" role="status" aria-live="polite">
              {announce}
            </span>
          </div>
        </div>
      </div>
      {overlay === 'heatmap' && <HeatLegend full={calc !== null} />}
    </figure>
  );
}
