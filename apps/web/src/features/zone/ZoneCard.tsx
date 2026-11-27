// Shared parts of the open zone in the Zones step: level presets, the luminaire select, the status block and the
// zone's settings (one scroll). Edits go through the same store actions as before; every illuminance number is an
// estimate.
import { useMemo } from 'react';
import {
  type IntentEstimate,
  type IntentKind,
  type LightingIntent,
  type StudioRoom,
  type TargetRange,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { illuminanceUnit, illuminanceValue } from '../../state/display';
import { productCatalog, type Units } from '../../state/store';
import { BehaviorFields, CctField, PlaneFields, Section, TargetFields } from '../inspector/IntentEditor';
import { TextField } from '../inspector/fields';
import { estimateStatus } from '../inspector/estimateStatus';
import { findOption, productOptions } from '../inspector/productOptions';
import './zone.css';

/** Average-level presets per kind, in footcandles (targets for the estimate, not recommendations). */
export const LEVEL_PRESETS: Readonly<Partial<Record<IntentKind, readonly [string, number][]>>> = {
  Task: [
    ['Soft', 20],
    ['Work', 30],
    ['Detail', 50],
  ],
  Ambient: [
    ['Soft', 10],
    ['Comfortable', 20],
    ['Bright', 30],
  ],
  WallWash: [
    ['Soft', 10],
    ['Even', 20],
    ['Bright', 30],
  ],
  Accent: [
    ['Subtle', 30],
    ['Feature', 60],
    ['Dramatic', 100],
  ],
  FeaturePendant: [
    ['Soft', 10],
    ['Comfortable', 20],
    ['Bright', 30],
  ],
  CeilingGlow: [
    ['Soft', 5],
    ['Glow', 10],
    ['Bright', 20],
  ],
  Path: [
    ['Night', 1],
    ['Guide', 2],
    ['Clear', 5],
  ],
};

/** Plain-language status for the card (the list keeps the short text). */
export const PLAIN: Readonly<Record<string, string>> = {
  'Meets target': 'Looks right',
  'Below minimum': 'Some spots too dark',
  'Below average target': 'Too dark overall',
  'Above average ceiling': 'Brighter than needed',
  'No target set': 'No target set',
};

/** Hidden settings that differ from automatic, so Settings can show a dot. */
export function overrides(i: LightingIntent): number {
  const b = i.behavior;
  return [
    b.pattern != null,
    b.density !== 1,
    b.mountingHeight != null,
    b.wallOffset != null,
    b.aimAngle != null,
  ].filter(Boolean).length;
}

/** A bar from 0 to a nice maximum: the target band shaded, the estimated minimum and average marked. */
function LevelBar({ target, estimate }: { target: TargetRange; estimate: IntentEstimate }) {
  const top = Math.max(estimate.average * 1.4, (target.maximum ?? 0) * 1.1, (target.average ?? 0) * 1.5, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / top) * 100))}%`;
  const lo = target.minimum ?? (target.average != null ? target.average * 0.9 : null);
  const hi = target.maximum ?? (target.average != null ? target.average * 1.25 : null);
  return (
    <div className="level-bar" aria-hidden="true">
      {lo != null && hi != null && (
        <span className="band" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
      )}
      {target.average != null && <span className="goal" style={{ left: pct(target.average) }} />}
      <span className="min" style={{ left: pct(estimate.minimum) }} />
      <span className="avg" style={{ left: pct(estimate.average) }} />
    </div>
  );
}

export function useProductOptions(intent: LightingIntent, room: StudioRoom) {
  const project = useStudio((s) => s.project);
  const projectProducts = useStudio((s) => s.projectProducts);
  const catalog = useMemo(() => productCatalog({ project, projectProducts }), [project, projectProducts]);
  return useMemo(() => productOptions(room, intent, catalog), [room, intent, catalog]);
}

export function LuminaireSelect({ intent, room }: { intent: LightingIntent; room: StudioRoom }) {
  const opts = useProductOptions(intent, room);
  return (
    <span className="lum-select">
      <label className="sr-only" htmlFor={`lum-${intent.id}`}>
        Luminaire
      </label>
      <select
        id={`lum-${intent.id}`}
        data-testid="product"
        value={opts.chosenKey ?? ''}
        onChange={(e) =>
          studio
            .getState()
            .setProduct(intent.id, e.target.value === '' ? null : (findOption(opts, e.target.value)?.product ?? null))
        }
      >
        <option value="">Automatic · {opts.automatic.label}</option>
        {opts.groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.product.label}
                {o.best ? ' (best fit)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </span>
  );
}

function ProductReason({ intent, room }: { intent: LightingIntent; room: StudioRoom }) {
  const opts = useProductOptions(intent, room);
  const picked = opts.chosenKey ? findOption(opts, opts.chosenKey) : undefined;
  return (
    <details className="product-reason">
      <summary>Why this luminaire</summary>
      <p className="muted small" data-testid="product-reason">
        {picked ? `Your choice · ${picked.reason}` : opts.automaticReason}
      </p>
    </details>
  );
}

export function ZoneStatus({
  intent,
  estimate,
  units,
  stale,
  compact = false,
}: {
  intent: LightingIntent;
  estimate?: IntentEstimate;
  units: Units;
  stale: boolean;
  compact?: boolean;
}) {
  const feedback = estimate ? estimateStatus(intent.target, estimate) : null;
  const avg = intent.target.average;
  const unit = illuminanceUnit(units);
  return (
    <div
      className={`zone-card-status${compact ? ' compact' : ''}${feedback?.status ? ` is-${feedback.status.toLowerCase()}` : ''}`}
      data-testid="estimate"
      role="status"
    >
      {estimate && feedback ? (
        <>
          <div className="row spread">
            <strong data-testid="status-glyph" data-status={feedback.status ?? 'Unset'}>
              {PLAIN[feedback.text] ?? feedback.text}
              <span className="sr-only"> ({feedback.text})</span>
            </strong>
            <span className="muted small">{stale ? 'Updating…' : 'Estimate'}</span>
          </div>
          {!compact && <LevelBar target={intent.target} estimate={estimate} />}
          <span className="small status-numbers">
            Average {illuminanceValue(estimate.average, units)}
            {avg != null && <span className="muted"> / {illuminanceValue(avg, units)}</span>} · Minimum{' '}
            {illuminanceValue(estimate.minimum, units)}
            {intent.target.minimum != null && (
              <span className="muted"> / {illuminanceValue(intent.target.minimum, units)}</span>
            )}{' '}
            {unit}
          </span>
        </>
      ) : (
        <span className="muted">Estimating…</span>
      )}
    </div>
  );
}

export function Settings({
  intent,
  room,
  units,
  status,
}: {
  intent: LightingIntent;
  room: StudioRoom;
  units: Units;
  status: React.ReactNode;
}) {
  const { setLabel } = studio.getState();
  const keepDim = intent.kind === 'KeepDim';
  // one scroll, most-used first: level, count, then the measuring plane and the rarely touched details
  return (
    <div className="zone-settings" data-testid="intent-editor" role="group" aria-label={`Settings for ${intent.label}`}>
      {status}
      <TargetFields intent={intent} units={units} average flat />
      <BehaviorFields intent={intent} units={units} flat />
      <Section title="Measuring plane">
        <PlaneFields intent={intent} room={room} units={units} />
      </Section>
      <Section title="Name">
        <TextField
          label="Zone name"
          className="label-hidden"
          testId="intent-label"
          inputMode="text"
          maxLength={40}
          value={intent.label}
          onCommit={(text) => {
            if (text.trim() === '') return 'A label cannot be empty.';
            setLabel(intent.id, text);
            return null;
          }}
        />
      </Section>
      {!keepDim && (
        <Section title="Colour and luminaire">
          <CctField intent={intent} label="Color temperature (this zone)" />
          <ProductReason intent={intent} room={room} />
        </Section>
      )}
      {intent.trace.length > 0 && (
        <Section title="Why this layout">
          <details className="trace">
            <summary>{intent.trace.length} solver notes</summary>
            <ol className="small">
              {intent.trace.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ol>
          </details>
        </Section>
      )}
    </div>
  );
}
