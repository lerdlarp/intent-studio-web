// The inspector (PLAN §1 UI, Phase 3): room panel (area, ceiling, watts and LPD estimates), suggestions with Accept /
// Dismiss / Accept all, and the accepted intents. The selected intent (shared with the plan and the 3D view) expands
// into its editor. Phase 4: "Suggest a design" (agent proposal, rules fallback) in the room panel; the suggestions
// group names its source ("Agent" / "Rules") and shows the agent's rationale per suggestion.
import { floorArea, intentInkColor, intentInkName } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { STATUS_GLYPH, STATUS_TEXT, area, estimateLine, length, lpd, statusOf, targetText, watts } from '../../state/display';
import { IntentEditor } from './IntentEditor';
import './inspector.css';

export function Inspector({ onManageProducts }: { onManageProducts?: () => void } = {}) {
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const pw = useStudio((s) => s.power);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const advising = useStudio((s) => s.advising);
  const selectedId = useStudio((s) => s.selectedIntentId);
  const proposing = useStudio((s) => s.proposing);
  const source = useStudio((s) => s.suggestionSource);
  const rationale = useStudio((s) => s.rationale);
  if (!design) return null;
  const { accept, acceptAll, dismiss, removeIntent, select, suggestDesign } = studio.getState();
  const suggestions = design.intents.filter((i) => i.isSuggestion);
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const room = design.room;

  return (
    <aside className="panel inspector" aria-label="Inspector">
      <section aria-labelledby="room-h">
        <h2 id="room-h">{room.label || 'Room'}</h2>
        <dl className="facts">
          <dt>Area</dt>
          <dd>{area(floorArea(room), units)}</dd>
          <dt>Ceiling</dt>
          <dd>{length(room.ceilingHeight, units)}</dd>
          <dt>Power</dt>
          <dd data-testid="room-power">
            {pw ? (
              <>
                {watts(pw.watts)} · {lpd(pw.lpd, units)} <span className="tag">estimate</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </dl>
        <button type="button" onClick={() => void suggestDesign()} disabled={proposing} data-testid="suggest-design">
          {proposing ? 'Asking the agent…' : 'Suggest a design'}
        </button>
      </section>

      <section aria-labelledby="sugg-h">
        <div className="row spread">
          <h3 id="sugg-h">
            Suggestions ({suggestions.length})
            {source && suggestions.length > 0 && (
              <span className="tag source-tag" data-testid="suggestion-source" title={source === 'ai' ? 'Proposed by the agent' : 'From the built-in rules'}>
                {source === 'ai' ? 'Agent' : 'Rules'}
              </span>
            )}
          </h3>
          {suggestions.length > 0 && (
            <button type="button" className="primary" onClick={acceptAll}>
              Accept all
            </button>
          )}
        </div>
        {suggestions.length === 0 ? (
          <p className="muted small">No open suggestions.</p>
        ) : (
          <ul className="intent-list">
            {suggestions.map((i) => (
              <li key={i.id} className={`intent suggestion${i.id === selectedId ? ' selected' : ''}`} data-testid="suggestion">
                <span className="ink" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                <div className="grow">
                  <div>{i.label}</div>
                  <div className="muted small">
                    {intentInkName(i.kind)} · {targetText(i.target, units)}
                    {i.behavior.cct !== undefined && ` · ${i.behavior.cct} K`}
                  </div>
                  {rationale[i.id] && (
                    <div className="small rationale" data-testid="suggestion-rationale">
                      {rationale[i.id]}
                    </div>
                  )}
                </div>
                <div className="btn-group">
                  <button type="button" onClick={() => accept(i.id)} aria-label={`Accept ${i.label}`}>
                    Accept
                  </button>
                  <button type="button" onClick={() => dismiss(i.id)} aria-label={`Dismiss ${i.label}`}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="intents-h">
        <h3 id="intents-h">
          Intents ({accepted.length}){advising && <span className="muted small"> · asking the agent…</span>}
        </h3>
        {accepted.length === 0 ? (
          <p className="muted small">Accept a suggestion to place fixtures.</p>
        ) : (
          <ul className="intent-list">
            {accepted.map((i) => {
              const e = estimates[i.id];
              const status = e ? statusOf(i.target, e) : null;
              const open = i.id === selectedId;
              return (
                <li key={i.id} className={`intent${open ? ' selected' : ''}`} data-testid="intent">
                  <span className="ink" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                  <div className="grow">
                    <div className="row spread nowrap-row">
                      <button
                        type="button"
                        className="intent-title"
                        aria-expanded={open}
                        aria-controls={open ? `editor-${i.id}` : undefined}
                        onClick={() => select(open ? null : i.id)}
                      >
                        <span className="chev" aria-hidden="true">
                          {open ? '▾' : '▸'}
                        </span>
                        {i.label}
                        <span className="sr-only">{open ? ' (selected, collapse)' : ' (select and edit)'}</span>
                      </button>
                      <button type="button" className="link" onClick={() => removeIntent(i.id)} aria-label={`Remove ${i.label}`}>
                        Remove
                      </button>
                    </div>
                    <div className="muted small">
                      {intentInkName(i.kind)} · {i.fixtures.length} fixture{i.fixtures.length === 1 ? '' : 's'} · target{' '}
                      {targetText(i.target, units)}
                    </div>
                    <div className={`estimate${stale ? ' stale' : ''}`} data-testid="estimate">
                      {e && status ? (
                        <>
                          <span
                            className={`glyph glyph-${status.toLowerCase()}`}
                            title={STATUS_TEXT[status]}
                            aria-label={STATUS_TEXT[status]}
                            data-testid="status-glyph"
                            data-status={status}
                          >
                            {STATUS_GLYPH[status]}
                          </span>{' '}
                          <span className="tag">estimate</span>{' '}
                          <span className="nowrap" title="average · minimum · maximum · uniformity (min / avg)">
                            {estimateLine(e, units)}
                          </span>
                          {open && <span className={`status-text small glyph-${status.toLowerCase()}`}> {STATUS_TEXT[status]}</span>}
                        </>
                      ) : (
                        <span className="muted">estimating…</span>
                      )}
                    </div>
                    {open && (
                      <div id={`editor-${i.id}`}>
                        <IntentEditor key={`${i.id}:${units}`} intent={i} room={room} units={units} onManageProducts={onManageProducts} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="muted small disclaimer">All illuminance and power values are estimates, not a compliance check.</p>
    </aside>
  );
}
