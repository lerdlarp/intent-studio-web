import { useEffect, useRef } from 'react';
import {
  floorArea,
  intentInkColor,
  intentInkName,
  type IntentEstimate,
  type LightingIntent,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import type { Units } from '../../state/store';
import {
  STATUS_GLYPH,
  area,
  illuminanceUnit,
  illuminanceValue,
  length,
  lpd,
  targetText,
  watts,
} from '../../state/display';
import { Icon } from '../shell/Icon';
import { estimateStatus } from './estimateStatus';
import './inspector.css';

function ZoneEstimate({
  intent,
  estimate,
  units,
  detailed = false,
  stale,
}: {
  intent: LightingIntent;
  estimate?: IntentEstimate;
  units: Units;
  detailed?: boolean;
  stale: boolean;
}) {
  const feedback = estimate ? estimateStatus(intent.target, estimate) : null;
  return (
    <div className={`zone-estimate${detailed ? ' detailed' : ''}${stale ? ' stale' : ''}`} data-testid="estimate">
      {estimate && feedback ? (
        <>
          {detailed ? (
            <>
              <div className="row spread">
                <span className="muted small">Estimated light level</span>
                <span
                  className={`estimate-status${feedback.status ? ` glyph-${feedback.status.toLowerCase()}` : ''}`}
                  data-testid="status-glyph"
                  data-status={feedback.status ?? 'Unset'}
                >
                  {feedback.status && <span aria-hidden="true">{STATUS_GLYPH[feedback.status]} </span>}
                  {feedback.text}
                </span>
              </div>
              <dl className="estimate-values">
                <div>
                  <dt>Average</dt>
                  <dd>
                    {illuminanceValue(estimate.average, units)} <span>{illuminanceUnit(units)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Minimum</dt>
                  <dd>
                    {illuminanceValue(estimate.minimum, units)} <span>{illuminanceUnit(units)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Maximum</dt>
                  <dd>
                    {illuminanceValue(estimate.maximum, units)} <span>{illuminanceUnit(units)}</span>
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <span>
                {illuminanceValue(estimate.average, units)}
                {intent.target.average != null && ` / ${illuminanceValue(intent.target.average, units)}`}{' '}
                {illuminanceUnit(units)} <span className="muted">avg · estimate</span>
              </span>
              <span
                className={`zone-status-text${feedback.status ? ` glyph-${feedback.status.toLowerCase()}` : ''}`}
                data-testid="status-glyph"
                data-status={feedback.status ?? 'Unset'}
              >
                {feedback.status && <span aria-hidden="true">{STATUS_GLYPH[feedback.status]} </span>}
                {feedback.text}
              </span>
            </>
          )}
        </>
      ) : (
        <span className="muted small">Estimating…</span>
      )}
    </div>
  );
}

export function Inspector() {
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const power = useStudio((s) => s.power);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const selectedId = useStudio((s) => s.selectedIntentId);
  const proposing = useStudio((s) => s.proposing);
  const source = useStudio((s) => s.suggestionSource);
  const rationale = useStudio((s) => s.rationale);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [selectedId]);
  if (!design) return null;
  const { accept, acceptAll, dismiss, select, suggestDesign } = studio.getState();
  const suggestions = design.intents.filter((i) => i.isSuggestion);
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const room = design.room;
  return (
    <aside
      ref={panel}
      className="panel inspector"
      aria-label="Inspector"
      data-testid="inspector"
      data-zone-count={accepted.length}
    >
      <div className="inspector-toolbar">
        <h2>Lighting</h2>
      </div>
      {
        <>
          <section aria-labelledby="zones-h" className="zones-overview">
            <div className="row spread">
              <h3 id="zones-h">
                Zones <span className="count">{accepted.length}</span>
              </h3>
              <span className="muted small">{accepted.reduce((sum, i) => sum + i.fixtures.length, 0)} fixtures</span>
            </div>
            {accepted.length ? (
              <ul className="zone-list">
                {accepted.map((i) => (
                  <li key={i.id} data-testid="zone-row">
                    <button
                      type="button"
                      className="zone-row"
                      onClick={() => select(selectedId === i.id ? null : i.id)}
                      aria-current={selectedId === i.id ? 'true' : undefined}
                    >
                      <span className="zone-swatch" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                      <span className="grow">
                        <strong>{i.label}</strong>
                        <span className="zone-row-meta">
                          {intentInkName(i.kind)} · {i.fixtures.length} fixture{i.fixtures.length === 1 ? '' : 's'}
                        </span>
                        <ZoneEstimate intent={i} estimate={estimates[i.id]} units={units} stale={stale} />
                      </span>
                      <span className="zone-open" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Draw a zone on the plan or start with a suggestion.</p>
            )}
          </section>
          {suggestions.length > 0 && (
            <section className="suggestions-section" aria-labelledby="suggestions-h">
              <details className="suggestions-disclosure" open>
                <summary id="suggestions-h">
                  Suggestions <span className="count">{suggestions.length}</span>
                  {source && (
                    <span className="tag source-tag" data-testid="suggestion-source">
                      {source === 'ai' ? 'Agent' : 'Rules'}
                    </span>
                  )}
                </summary>
                <button type="button" className="accept-all" onClick={acceptAll}>
                  Accept all
                </button>
                <ul className="suggestion-list">
                  {suggestions.map((i) => (
                    <li key={i.id} className="suggestion" data-testid="suggestion">
                      <span className="zone-swatch" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                      <div className="grow">
                        <strong>{i.label}</strong>
                        <div className="muted small">
                          {intentInkName(i.kind)} · {targetText(i.target, units)}
                        </div>
                        {rationale[i.id] && (
                          <details className="suggestion-reason">
                            <summary>Why this zone</summary>
                            <p className="small" data-testid="suggestion-rationale">
                              {rationale[i.id]}
                            </p>
                          </details>
                        )}
                      </div>
                      <div className="suggestion-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => accept(i.id)}
                          aria-label={`Accept ${i.label}`}
                          title="Accept suggestion"
                        >
                          <Icon name="check" />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => dismiss(i.id)}
                          aria-label={`Dismiss ${i.label}`}
                          title="Dismiss suggestion"
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
          <button
            type="button"
            className="suggest-design"
            onClick={() => void suggestDesign()}
            disabled={proposing}
            data-testid="suggest-design"
          >
            <Icon name="spark" />
            {proposing ? 'Generating…' : 'Suggest a design'}
          </button>
          <details className="room-details">
            <summary>
              Room details <span className="muted small">{area(floorArea(room), units)}</span>
            </summary>
            <dl className="facts">
              <dt>Room</dt>
              <dd>{room.label || 'Room'}</dd>
              <dt>Ceiling</dt>
              <dd>{length(room.ceilingHeight, units)}</dd>
              <dt>Power</dt>
              <dd data-testid="room-power">
                {power ? (
                  <>
                    {watts(power.watts)} · {lpd(power.lpd, units)} <span className="tag">estimate</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </details>
        </>
      }
      <p className="muted small disclaimer">Estimates only · Not a compliance check.</p>
    </aside>
  );
}
