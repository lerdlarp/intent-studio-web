// Under the plan: what is selected (intent / fixture), its estimate and hand-tuned / pinned tags, plus the heatmap
// legend. Editing (density, release hand-tuned, …) lives in the inspector.
import { heatRamp, intentInkName } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { STATUS_GLYPH, STATUS_TEXT, estimateLine, length, statusOf } from '../../state/display';

export function SelectionBar() {
  const design = useStudio((s) => s.design);
  const id = useStudio((s) => s.selectedIntentId);
  const fid = useStudio((s) => s.selectedFixtureId);
  const units = useStudio((s) => s.units);
  const estimates = useStudio((s) => s.estimates);
  if (!design) return null;
  const { select } = studio.getState();
  const intent = id ? design.intents.find((i) => i.id === id) : undefined;
  const fixture = intent && fid ? intent.fixtures.find((f) => f.id === fid) : undefined;
  const e = intent ? estimates[intent.id] : undefined;
  const status = intent && e ? statusOf(intent.target, e) : null;

  return (
    <div className="plan-selection" aria-label="Plan selection" role="group">
      <label className="field-inline">
        <span>Selected</span>
        <select aria-label="Selected intent" value={intent?.id ?? ''} onChange={(ev) => select(ev.target.value || null)}>
          <option value="">Nothing</option>
          {design.intents.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label || intentInkName(i.kind)}
              {i.isSuggestion ? ' (suggestion)' : ''}
            </option>
          ))}
        </select>
      </label>
      {intent && (
        <>
          <span className="muted small">
            {intentInkName(intent.kind)} · {intent.fixtures.length} fixture{intent.fixtures.length === 1 ? '' : 's'}
          </span>
          {e && status && (
            <span className="small" data-testid="selection-estimate">
              <span className={`glyph glyph-${status.toLowerCase()}`} aria-label={STATUS_TEXT[status]} title={STATUS_TEXT[status]}>
                {STATUS_GLYPH[status]}
              </span>{' '}
              <span className="tag">estimate</span> {estimateLine(e, units)}
            </span>
          )}
          {intent.handTuned && (
            <span className="tag" data-testid="hand-tuned">
              hand-tuned
            </span>
          )}
        </>
      )}
      {fixture && (
        <span className="small" data-testid="fixture-info">
          Fixture at {length(fixture.center.x, units)}, {length(fixture.center.y, units)}
          {fixture.pinned && (
            <>
              {' '}
              <span className="tag">pinned</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

export function HeatLegend() {
  const stops = heatRamp()
    .map((s) => `rgb(${s.color.join(',')}) ${(s.position * 100).toFixed(1)}%`)
    .join(', ');
  return (
    <div className="heat-legend small" role="note" aria-label="Heatmap legend">
      <span className="tag">estimate</span>
      <span className="ramp" style={{ background: `linear-gradient(90deg, ${stops})` }} aria-hidden="true" />
      <span>Each zone from half its minimum (blue) to its maximum (red). Quick estimate, not a calculation.</span>
    </div>
  );
}
