// Under the plan: what is selected (intent / fixture), its estimate, hand-tuned state and the density knob, plus the
// heatmap legend. The full per-intent editor is the inspector; this is the plan's quick access.
import { heatRamp, intentInkName } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { STATUS_GLYPH, STATUS_TEXT, estimateLine, length, statusOf } from '../../state/display';
import { DENSITY_MAX, DENSITY_MIN } from '../../state/store';

export function SelectionBar() {
  const design = useStudio((s) => s.design);
  const id = useStudio((s) => s.selectedIntentId);
  const fid = useStudio((s) => s.selectedFixtureId);
  const units = useStudio((s) => s.units);
  const estimates = useStudio((s) => s.estimates);
  if (!design) return null;
  const { select, setBehavior, releaseHandTuned } = studio.getState();
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
            <>
              <span className="tag" data-testid="hand-tuned">
                hand-tuned
              </span>
              <button type="button" className="link" onClick={() => releaseHandTuned(intent.id)}>
                Release hand-tuned
              </button>
            </>
          )}
          {!intent.isSuggestion && (
            <label className="field-inline">
              <span>Density</span>
              <input
                type="range"
                aria-label="Density"
                min={DENSITY_MIN}
                max={DENSITY_MAX}
                step={0.1}
                value={intent.behavior.density}
                onChange={(ev) => setBehavior(intent.id, { density: Number(ev.target.value) })}
              />
              <output className="small">{intent.behavior.density.toFixed(1)}</output>
            </label>
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
