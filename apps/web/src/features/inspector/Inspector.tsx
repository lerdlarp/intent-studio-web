// Right sidebar: one compact line per zone (estimate vs target at a glance) and the open suggestions. Selecting a
// zone opens its card on the plan; hovering a row highlights the zone there. Every number is an estimate.
import { useState } from 'react';
import {
  floorArea,
  intentInkColor,
  intentInkName,
  type IntentEstimate,
  type LightingIntent,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import type { Units } from '../../state/store';
import { STATUS_GLYPH, area, illuminanceUnit, illuminanceValue, lpd, targetText, watts } from '../../state/display';
import { Icon } from '../shell/Icon';
import { estimateStatus } from './estimateStatus';
import './inspector.css';

/** "21.9 / 25.0 fc" plus a status glyph; the full sentence is in the accessible text and the tooltip. */
export function ZoneMeter({ intent, estimate, units, stale }: { intent: LightingIntent; estimate?: IntentEstimate; units: Units; stale: boolean }) {
  if (!estimate) return <span className="zone-meter muted" data-testid="estimate">…</span>;
  const feedback = estimateStatus(intent.target, estimate);
  const avg = intent.target.average;
  const unit = illuminanceUnit(units);
  return (
    <span
      className={`zone-meter${stale ? ' stale' : ''}${feedback.status ? ` is-${feedback.status.toLowerCase()}` : ''}`}
      data-testid="estimate"
      title={`${feedback.text} · estimate`}
    >
      <span>
        {illuminanceValue(estimate.average, units)}
        {avg != null && <span className="muted"> / {illuminanceValue(avg, units)}</span>} <span className="unit">{unit}</span>
        <span className="sr-only"> avg · estimate</span>
      </span>
      <span className="zone-glyph" data-testid="status-glyph" data-status={feedback.status ?? 'Unset'}>
        <span aria-hidden="true">{feedback.status ? STATUS_GLYPH[feedback.status] : '·'}</span>
        <span className="sr-only">{feedback.text}</span>
      </span>
    </span>
  );
}

export function Inspector() {
  // after a row's trash is clicked, the row that slides under the pointer hides its trash until the pointer leaves it
  const [guard, setGuard] = useState<string | null>(null);
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const power = useStudio((s) => s.power);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const selectedId = useStudio((s) => s.selectedIntentId);
  const hoverId = useStudio((s) => s.hoverIntentId);
  const proposing = useStudio((s) => s.proposing);
  const source = useStudio((s) => s.suggestionSource);
  const rationale = useStudio((s) => s.rationale);
  if (!design) return null;
  const { accept, acceptAll, dismiss, select, suggestDesign, setHover, removeIntent } = studio.getState();
  const suggestions = design.intents.filter((i) => i.isSuggestion);
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const fixtures = accepted.reduce((sum, i) => sum + i.fixtures.length, 0);
  const hoverProps = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(id),
    onBlur: () => setHover(null),
  });
  return (
    <aside className="panel inspector" aria-label="Inspector" data-testid="inspector" data-zone-count={accepted.length}>
      <header className="side-head">
        <h2 id="zones-h">
          Zones <span className="count">{accepted.length}</span>
        </h2>
        <span className="muted small">
          {fixtures} fixture{fixtures === 1 ? '' : 's'}
        </span>
      </header>

      {accepted.length ? (
        <ul className="zone-list" aria-labelledby="zones-h">
          {accepted.map((i) => (
            <li
              key={i.id}
              data-testid="zone-row"
              className={[hoverId === i.id && 'hot', guard === i.id && 'guarded'].filter(Boolean).join(' ') || undefined}
              onMouseLeave={() => guard === i.id && setGuard(null)}
            >
              <button
                type="button"
                className="zone-row"
                onClick={() => select(selectedId === i.id ? null : i.id)}
                aria-current={selectedId === i.id ? 'true' : undefined}
                title={`${intentInkName(i.kind)} · ${i.fixtures.length} fixture${i.fixtures.length === 1 ? '' : 's'}`}
                onKeyDown={(e) => {
                  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
                  e.preventDefault();
                  const next = (e.currentTarget.closest('li')?.nextElementSibling ??
                    e.currentTarget.closest('li')?.previousElementSibling) as HTMLElement | null;
                  removeIntent(i.id);
                  next?.querySelector<HTMLButtonElement>('button.zone-row')?.focus();
                }}
                {...hoverProps(i.id)}
              >
                <span className="zone-swatch" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                <span className="zone-name">
                  {i.label}
                  <span className="sr-only">
                    , {intentInkName(i.kind)} · {i.fixtures.length} fixture{i.fixtures.length === 1 ? '' : 's'}
                  </span>
                </span>
                <ZoneMeter intent={i} estimate={estimates[i.id]} units={units} stale={stale} />
              </button>
              <button
                type="button"
                className="icon-button row-delete"
                onClick={(e) => {
                  const k = accepted.findIndex((x) => x.id === i.id);
                  const li = e.currentTarget.closest('li');
                  const next = (li?.nextElementSibling ?? li?.previousElementSibling) as HTMLElement | null;
                  removeIntent(i.id);
                  // keyboard activation (detail 0) keeps focus in the list; a pointer click guards the next row
                  if (e.detail === 0) next?.querySelector<HTMLButtonElement>('button.zone-row')?.focus();
                  else setGuard((accepted[k + 1] ?? accepted[k - 1])?.id ?? null);
                }}
                aria-label={`Delete ${i.label}`}
                title="Delete zone"
                {...hoverProps(i.id)}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small empty-zones">Paint a zone with a tool on the left, or ask for a suggestion.</p>
      )}

      {suggestions.length > 0 && (
        <section className="suggestions-section" aria-labelledby="suggestions-h">
          <div className="side-subhead">
            <h3 id="suggestions-h">
              Suggested <span className="count">{suggestions.length}</span>
              {source && (
                <span className="tag source-tag" data-testid="suggestion-source">
                  {source === 'ai' ? 'Agent' : 'Rules'}
                </span>
              )}
            </h3>
            <button type="button" className="link accept-all" onClick={acceptAll}>
              Accept all
            </button>
          </div>
          <ul className="suggestion-list">
            {suggestions.map((i) => (
              <li
                key={i.id}
                className={`suggestion${hoverId === i.id ? ' hot' : ''}`}
                data-testid="suggestion"
                title={rationale[i.id] ?? `${intentInkName(i.kind)} · ${targetText(i.target, units)}`}
                onMouseEnter={() => setHover(i.id)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="zone-swatch dashed" style={{ borderColor: intentInkColor(i.kind) }} aria-hidden="true" />
                <span className="zone-name">
                  {i.label}
                  <span className="muted small"> {targetText(i.target, units)}</span>
                  {rationale[i.id] && (
                    <span className="sr-only" data-testid="suggestion-rationale">
                      {rationale[i.id]}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="icon-button ok"
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
              </li>
            ))}
          </ul>
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

      <footer className="side-foot muted small">
        <span data-testid="room-power">
          {area(floorArea(design.room), units)}
          {power && (
            <>
              {' '}
              · {watts(power.watts)} · {lpd(power.lpd, units)}
            </>
          )}
        </span>
        <span className="disclaimer">Estimates only · not a compliance check</span>
      </footer>
    </aside>
  );
}
