// The selected zone's actions on the plan: a small pop-up beside the zone's name. A suggestion offers Add zone and
// Dismiss; a zone offers Edit (from another step), Snap, Merge and Delete, and with a fixture picked, its position and
// Remove fixture (SelectionBar). It sits right of the label, flips left near the edge, and drops below when neither
// side fits; Escape inside it clears the selection.
import { useLayoutEffect, useRef, useState } from 'react';
import { studio, useStudio } from '../../state/instance';
import { Icon } from '../shell/Icon';
import { goTo } from '../steps/StepPanel';
import type { PlacedLabel } from './draw';
import { SelectionBar } from './SelectionBar';

const GAP = 8;
const EDGE = 8;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Top-left of a `pop`-sized box beside `label` inside a `width × height` canvas (all CSS px). */
export function popPosition(
  label: Box,
  pop: { w: number; h: number },
  width: number,
  height: number,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const right = label.x + label.w / 2 + GAP;
  const left = label.x - label.w / 2 - GAP - pop.w;
  const beside = (x: number) => ({ left: x, top: clamp(label.y - pop.h / 2, EDGE, height - pop.h - EDGE) });
  if (right + pop.w <= width - EDGE) return beside(right);
  if (left >= EDGE) return beside(left);
  const x = clamp(label.x - pop.w / 2, EDGE, Math.max(EDGE, width - pop.w - EDGE));
  const below = label.y + label.h / 2 + GAP;
  return { left: x, top: below + pop.h <= height - EDGE ? below : Math.max(EDGE, label.y - label.h / 2 - GAP - pop.h) };
}

export function ZoneActions({ label, width, height }: { label: PlacedLabel | null; width: number; height: number }) {
  const design = useStudio((s) => s.design);
  const id = useStudio((s) => s.selectedIntentId);
  const fid = useStudio((s) => s.selectedFixtureId);
  const step = useStudio((s) => s.step);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const intent = design?.intents.find((i) => i.id === id);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !label) return;
    const next = popPosition(label, { w: el.offsetWidth, h: el.offsetHeight }, width, height);
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  });

  if (!design || !intent) return null;
  const { accept, dismiss, removeIntent, select } = studio.getState();

  const suggestion = intent.isSuggestion;
  return (
    <div
      ref={ref}
      className={`zone-pop${label ? '' : ' docked'}`}
      role="toolbar"
      aria-label={`${suggestion ? 'Suggested zone' : 'Zone'} ${intent.label}`}
      data-testid="zone-actions"
      style={label ? (pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }) : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        select(null);
      }}
    >
      {suggestion ? (
        <>
          <span className="zone-pop-tag">Suggested</span>
          <button type="button" className="primary small" onClick={() => accept(intent.id)} data-testid="pop-add">
            <Icon name="add" /> Add zone
          </button>
          <button
            type="button"
            className="selection-action"
            aria-label={`Dismiss ${intent.label}`}
            onClick={() => dismiss(intent.id)}
            data-testid="pop-delete"
          >
            Dismiss
          </button>
        </>
      ) : (
        <>
          {step !== 'zones' && (
            <button type="button" className="selection-action" onClick={() => goTo('zones')} data-testid="pop-edit">
              Edit
            </button>
          )}
          <SnapToggle intentId={intent.id} />
          <SelectionBar />
          {!fid && (
            <button
              type="button"
              className="selection-action danger"
              aria-label={`Delete zone ${intent.label}`}
              title="Delete zone (Delete)"
              onClick={() => removeIntent(intent.id)}
              data-testid="pop-delete"
            >
              <Icon name="trash" /> Delete
            </button>
          )}
        </>
      )}
    </div>
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
      className="snap-toggle selection-action"
      aria-pressed={grid ? on : false}
      disabled={!grid}
      title={grid ? `Snap ${intent.label} fixtures to the ceiling grid` : 'This room has no ceiling grid'}
      onClick={() => studio.getState().setBehavior(intent.id, { alignToCeilingGrid: !on })}
      data-testid="snap-grid"
    >
      <Icon name="grid" /> Snap to grid
    </button>
  );
}
