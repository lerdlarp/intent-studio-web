// Keyboard and text alternatives for the plan canvas (Phase 6 accessibility):
// - <KeyboardPaint>: while a paint tool is active, choose what to paint (whole floor, a wall, an object, the room
//   centre) from a list and press "Paint" — every tool works without a pointer.
// - <PlanSummary>: the plan as text (intents with kind, fixture count, target and estimate; fixture positions),
//   referenced by the canvas' aria-describedby, with a Select button per intent.
import { useState } from 'react';
import { intentInkName, toolToKind, wallName, type IntentKind, type StudioRoom } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import type { PaintTarget } from '../../state/store';
import { STATUS_TEXT, estimateLine, length, statusOf, targetText } from '../../state/display';
import { toolLabel } from './hit';

interface Choice {
  key: string;
  label: string;
  target: PaintTarget;
}

function choicesFor(room: StudioRoom, kind: IntentKind): Choice[] {
  const out: Choice[] = [];
  const floor = room.floor[0];
  const walls = room.walls.map((_, k) => ({ key: `w${k}`, label: wallName(room, k), target: { wallIndex: k } }));
  const objects = room.objects.map((o, k) => ({
    key: `o${k}`,
    label: `${o.name || o.kind || 'Object'} (${o.kind || 'object'})`,
    target: { objectIndex: k },
  }));
  if (kind === 'WallWash') return walls;
  if (kind === 'Accent') {
    const b = floor ?? [];
    const c = b.length
      ? { x: b.reduce((s, p) => s + p.x, 0) / b.length, y: b.reduce((s, p) => s + p.y, 0) / b.length }
      : { x: 0, y: 0 };
    return [...objects, { key: 'centre', label: 'Room centre', target: { point: c } }];
  }
  if (floor) out.push({ key: 'floor', label: 'Whole floor', target: { region: floor } });
  out.push(...objects);
  if (kind === 'KeepDim') out.push(...walls);
  return out;
}

export function KeyboardPaint() {
  const tool = useStudio((s) => s.tool);
  const room = useStudio((s) => s.design?.room ?? null);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const kind = toolToKind(tool);
  if (!room || kind === null) return null;
  const choices = choicesFor(room, kind);
  const current = choices.find((c) => c.key === pick) ?? choices[0];
  const paint = () => {
    if (!current) return;
    const id = studio.getState().paintIntent(kind, current.target);
    setNote(
      id ? `Painted ${toolLabel(tool).toLowerCase()} on ${current.label}.` : `Nothing to paint on ${current.label}.`,
    );
    if (id) studio.getState().setTool('Select');
  };
  return (
    <div
      className="keyboard-paint row small"
      role="group"
      aria-label={`Paint ${toolLabel(tool).toLowerCase()} with the keyboard`}
    >
      <label className="field-inline">
        Paint {toolLabel(tool).toLowerCase()} on
        <select
          value={current?.key ?? ''}
          onChange={(e) => setPick(e.target.value)}
          data-testid="keyboard-paint-target"
        >
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={paint} disabled={!current} data-testid="keyboard-paint">
        Paint
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {note}
      </span>
    </div>
  );
}

const MAX_FIXTURES_LISTED = 40;

export function PlanSummary() {
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const units = useStudio((s) => s.units);
  const selected = useStudio((s) => s.selectedIntentId);
  if (!design) return null;
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const open = design.intents.filter((i) => i.isSuggestion);
  const total = accepted.reduce((n, i) => n + i.fixtures.length, 0);
  return (
    <details className="plan-summary small" id="plan-summary" data-testid="plan-summary">
      <summary>
        Plan as text: {accepted.length} intent{accepted.length === 1 ? '' : 's'}, {total} fixture
        {total === 1 ? '' : 's'}
        {open.length > 0 && `, ${open.length} open suggestion${open.length === 1 ? '' : 's'}`}
      </summary>
      <ul>
        {accepted.map((i) => {
          const e = estimates[i.id];
          const status = e ? statusOf(i.target, e) : null;
          return (
            <li key={i.id}>
              <strong>{i.label}</strong> — {intentInkName(i.kind)}, {i.fixtures.length} fixture
              {i.fixtures.length === 1 ? '' : 's'}, target {targetText(i.target, units)}
              {e && status && (
                <>
                  , estimate {estimateLine(e, units)} ({STATUS_TEXT[status]})
                </>
              )}
              {i.handTuned && ', hand-tuned'}{' '}
              <button
                type="button"
                className="link"
                aria-pressed={selected === i.id}
                onClick={() => studio.getState().select(selected === i.id ? null : i.id)}
              >
                {selected === i.id ? 'Selected' : 'Select'}
                <span className="sr-only"> {i.label}</span>
              </button>
              {i.fixtures.length > 0 && (
                <ul>
                  {i.fixtures.slice(0, MAX_FIXTURES_LISTED).map((f, k) => (
                    <li key={f.id}>
                      Fixture {k + 1} at {length(f.center.x, units)}, {length(f.center.y, units)}
                      {f.pinned && ' (pinned)'}
                    </li>
                  ))}
                  {i.fixtures.length > MAX_FIXTURES_LISTED && (
                    <li>…and {i.fixtures.length - MAX_FIXTURES_LISTED} more</li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
        {open.map((i) => (
          <li key={i.id}>
            Suggestion: {i.label} — {intentInkName(i.kind)}, target {targetText(i.target, units)}
          </li>
        ))}
      </ul>
      <p className="muted">All illuminance values are estimates.</p>
    </details>
  );
}
