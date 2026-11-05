// Minimal inspector (Phase 2C): room power, suggestions with Accept / Dismiss / Accept all, accepted intents with
// status glyph and the estimate line. The full inspector lands in Phase 3.
import { useState } from 'react';
import { floorArea, intentInkColor, intentInkName, type LightingIntent } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { STATUS_GLYPH, STATUS_TEXT, area, estimateLine, length, lpd, statusOf, targetText, watts } from '../../state/display';

function LabelField({ intent }: { intent: LightingIntent }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== '' && draft !== intent.label)
      studio.getState().editIntent(intent.id, { field: 'label', value: draft.trim().slice(0, 40) });
    setDraft(null);
  };
  return (
    <label className="intent-label">
      <span className="sr-only">Label</span>
      <input
        value={draft ?? intent.label}
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}

export function Inspector() {
  const design = useStudio((s) => s.design);
  const estimates = useStudio((s) => s.estimates);
  const pw = useStudio((s) => s.power);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const advising = useStudio((s) => s.advising);
  if (!design) return null;
  const { accept, acceptAll, dismiss, removeIntent } = studio.getState();
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
      </section>

      <section aria-labelledby="sugg-h">
        <div className="row spread">
          <h3 id="sugg-h">Suggestions ({suggestions.length})</h3>
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
              <li key={i.id} className="intent suggestion" data-testid="suggestion">
                <span className="ink" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                <div className="grow">
                  <div>{i.label}</div>
                  <div className="muted small">
                    {intentInkName(i.kind)} · {targetText(i.target, units)}
                  </div>
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
              return (
                <li key={i.id} className="intent" data-testid="intent">
                  <span className="ink" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                  <div className="grow">
                    <LabelField intent={i} />
                    <div className="muted small">
                      {intentInkName(i.kind)} · {i.fixtures.length} fixture{i.fixtures.length === 1 ? '' : 's'} · target{' '}
                      {targetText(i.target, units)}
                    </div>
                    <div className={`estimate${stale ? ' stale' : ''}`} data-testid="estimate">
                      {e && status ? (
                        <>
                          <span className={`glyph glyph-${status.toLowerCase()}`} title={STATUS_TEXT[status]} aria-label={STATUS_TEXT[status]}>
                            {STATUS_GLYPH[status]}
                          </span>{' '}
                          <span className="tag">estimate</span> <span className="nowrap">{estimateLine(e, units)}</span>
                        </>
                      ) : (
                        <span className="muted">estimating…</span>
                      )}
                    </div>
                  </div>
                  <button type="button" className="link" onClick={() => removeIntent(i.id)} aria-label={`Remove ${i.label}`}>
                    Remove
                  </button>
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
