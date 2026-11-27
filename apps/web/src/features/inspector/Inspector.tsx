// The zone meter: a zone's estimate against its target at a glance, used by the Zones and Intent steps. Every number is
// an estimate.
import { type IntentEstimate, type LightingIntent } from '@intent-studio/core';
import type { Units } from '../../state/store';
import { STATUS_GLYPH, illuminanceUnit, illuminanceValue } from '../../state/display';
import { estimateStatus } from './estimateStatus';
import './inspector.css';

/** "21.9 / 25.0 fc" plus a status glyph; the full sentence is in the accessible text and the tooltip. */
export function ZoneMeter({
  intent,
  estimate,
  units,
  stale,
}: {
  intent: LightingIntent;
  estimate?: IntentEstimate;
  units: Units;
  stale: boolean;
}) {
  if (!estimate)
    return (
      <span className="zone-meter muted" data-testid="estimate">
        …
      </span>
    );
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
        {avg != null && <span className="muted"> / {illuminanceValue(avg, units)}</span>}{' '}
        <span className="unit">{unit}</span>
        <span className="sr-only"> avg · estimate</span>
      </span>
      <span className="zone-glyph" data-testid="status-glyph" data-status={feedback.status ?? 'Unset'}>
        <span aria-hidden="true">{feedback.status ? STATUS_GLYPH[feedback.status] : '·'}</span>
        <span className="sr-only">{feedback.text}</span>
      </span>
    </span>
  );
}
