// Shared parts of the open zone in the Zones step: the target slider, level presets, the luminaire and count lines,
// the status block and the zone's settings (one scroll). Edits go through the same store actions as before; every
// estimated illuminance number is labelled an estimate.
import { useMemo, useState } from 'react';
import {
  productOf,
  type IntentEstimate,
  type IntentKind,
  type LightingIntent,
  type StudioRoom,
  type StudioProduct,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { illuminanceUnit, illuminanceValue } from '../../state/display';
import { quantityShortfall } from '../inspector/hints';
import { fixtureTypes, typeOfIntent } from '../schedule/fixtureTypes';
import { productCatalog, type Units } from '../../state/store';
import { BehaviorFields, CctField, PlaneFields, Section, TargetFields } from '../inspector/IntentEditor';
import { TextField } from '../inspector/fields';
import { estimateStatus } from '../inspector/estimateStatus';
import { findOption, productOptions } from '../inspector/productOptions';
import './zone.css';

/** Average-level presets per kind, in footcandles (targets for the estimate, not recommendations). Every kind uses
 * the same three words, so the slider caption always reads soft, comfortable or bright. */
export const LEVEL_PRESETS: Readonly<Partial<Record<IntentKind, readonly [string, number][]>>> = {
  Task: [
    ['Soft', 20],
    ['Comfortable', 30],
    ['Bright', 50],
  ],
  Ambient: [
    ['Soft', 10],
    ['Comfortable', 20],
    ['Bright', 30],
  ],
  WallWash: [
    ['Soft', 10],
    ['Comfortable', 20],
    ['Bright', 30],
  ],
  Accent: [
    ['Soft', 30],
    ['Comfortable', 60],
    ['Bright', 100],
  ],
  FeaturePendant: [
    ['Soft', 10],
    ['Comfortable', 20],
    ['Bright', 30],
  ],
  CeilingGlow: [
    ['Soft', 5],
    ['Comfortable', 10],
    ['Bright', 20],
  ],
  Path: [
    ['Soft', 1],
    ['Comfortable', 2],
    ['Bright', 5],
  ],
};

/** The preset word nearest a level (by ratio), e.g. 24 fc on an Ambient zone reads "Comfortable". */
export function levelWord(presets: readonly (readonly [string, number])[], fc: number): string | null {
  let best: string | null = null;
  let dist = Infinity;
  for (const [name, v] of presets) {
    const d = Math.abs(Math.log(Math.max(fc, 1e-3) / v));
    if (d < dist) [best, dist] = [name, d];
  }
  return best;
}

/** The slider's span for a kind: half the softest preset to 1.5× the brightest (0–200 fc), widened to the target. */
export function sliderRange(
  presets: readonly (readonly [string, number])[],
  average: number | null,
): { min: number; max: number; step: number } {
  const lo = presets[0]?.[1] ?? 10;
  const hi = presets[presets.length - 1]?.[1] ?? 30;
  const step = lo < 5 ? 0.5 : 1;
  const snap = (v: number) => Math.round(v / step) * step;
  let min = Math.max(step, snap(lo / 2));
  let max = Math.min(200, snap(hi * 1.5));
  if (average != null) [min, max] = [Math.min(min, average), Math.max(max, average)];
  return { min, max, step };
}

/** Light reads on a ratio scale, so the slider is logarithmic: equal travel is an equal ratio, and the presets spread
 * out instead of bunching at the soft end. `at` maps footcandles to 0–1; `value` maps back, snapped to the step. */
export function sliderScale(min: number, max: number, step: number) {
  const span = Math.log(max / min);
  const at = (v: number) => Math.min(1, Math.max(0, Math.log(Math.max(v, min) / min) / span));
  const value = (t: number) => Math.min(max, Math.max(min, Math.round((min * Math.exp(span * t)) / step) * step));
  return { at, value };
}

/** Sets a zone's average target, widening its limits when they would no longer hold. */
export function setAverage(intent: LightingIntent, v: number): boolean {
  const { setTarget } = studio.getState();
  const t = intent.target;
  if (setTarget(intent.id, { ...t, average: v })) return true;
  return setTarget(intent.id, {
    ...t,
    average: v,
    minimum: t.minimum != null ? Math.min(t.minimum, v) : null,
    maximum: t.maximum != null ? Math.max(t.maximum, v) : null,
  });
}

/** "1,200 lm · 12 W · 60° beam · IES" for the chosen (or automatic) luminaire. */
export function specLine(p: StudioProduct): string {
  const parts = [`${Math.round(p.lumens).toLocaleString('en-US')} lm`];
  if (p.watts > 0) parts.push(`${Math.round(p.watts * 10) / 10} W`);
  parts.push(`${Math.round(p.beamAngle)}° beam`);
  if (p.ies) parts.push('IES');
  return parts.join(' · ');
}

/**
 * The zone's target as one slider: drag (or arrow keys) to set the average; the caption names the level in words.
 * The track shades the target band and marks the estimated average, so the gap reads at a glance. With an automatic
 * count the layout re-solves as it moves, so the count follows the target.
 */
const STEPS = 1000;

export function TargetSlider({
  intent,
  units,
  estimate,
}: {
  intent: LightingIntent;
  units: Units;
  estimate?: IntentEstimate;
}) {
  const presets = LEVEL_PRESETS[intent.kind] ?? [];
  const avg = intent.target.average;
  const [drag, setDrag] = useState<number | null>(null);
  const { min, max, step } = sliderRange(presets, avg);
  const value = drag ?? avg ?? presets[1]?.[1] ?? (min + max) / 2;
  const unit = illuminanceUnit(units);
  const word = avg == null && drag == null ? 'No target yet' : levelWord(presets, value);
  // positions match the thumb's travel: half a thumb in from each end
  const scale = sliderScale(min, max, step);
  const frac = scale.at;
  const pct = (v: number) => `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${frac(v).toFixed(4)})`;
  const lo = intent.target.minimum ?? (avg != null ? avg * 0.9 : null);
  const hi = intent.target.maximum ?? (avg != null ? avg * 1.25 : null);
  const id = `target-${intent.id}`;
  const end = () => setDrag(null);
  const move = (v: number) => {
    if (v === value) return;
    setDrag(v);
    setAverage(intent, v);
  };
  return (
    <div className="target-slider" data-testid="target-slider">
      <div className="target-caption">
        <label htmlFor={id} className="target-word" data-testid="target-word">
          {word}
        </label>
        <span className="target-value">
          {avg == null && drag == null ? 'drag to set' : `${illuminanceValue(value, units)} ${unit} target`}
        </span>
      </div>
      <div className="target-track">
        <span className="rail" aria-hidden="true" />
        {drag == null && lo != null && hi != null && (
          <span
            className="band"
            aria-hidden="true"
            style={{
              left: pct(lo),
              width: `calc((100% - var(--thumb)) * ${(frac(Math.min(hi, max)) - frac(lo)).toFixed(4)})`,
            }}
          />
        )}
        {presets.map(([name, fc]) => (
          <span key={name} className="tick" aria-hidden="true" style={{ left: pct(fc) }} />
        ))}
        {estimate && <span className="est" style={{ left: pct(estimate.average) }} aria-hidden="true" />}
        <input
          id={id}
          type="range"
          min={0}
          max={STEPS}
          step={1}
          value={Math.round(frac(value) * STEPS)}
          aria-valuetext={`${word ?? ''}, ${illuminanceValue(value, units)} ${unit} average target`}
          onChange={(e) => move(scale.value(Number(e.target.value) / STEPS))}
          onKeyDown={(e) => {
            // keys move by one step of light, not one step of travel
            const next =
              e.key === 'ArrowUp' || e.key === 'ArrowRight'
                ? value + step
                : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
                  ? value - step
                  : e.key === 'Home'
                    ? min
                    : e.key === 'End'
                      ? max
                      : null;
            if (next == null) return;
            e.preventDefault();
            move(Math.min(max, Math.max(min, Math.round(next / step) * step)));
          }}
          onPointerUp={end}
          onKeyUp={end}
          onBlur={end}
        />
      </div>
      <div className="target-ticks" aria-hidden="true">
        {presets.map(([name, fc]) => (
          <span key={name} style={{ left: pct(fc) }}>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Level presets as one segmented row (More settings). */
export function LevelPresets({ intent, units }: { intent: LightingIntent; units: Units }) {
  const presets = LEVEL_PRESETS[intent.kind] ?? [];
  const avg = intent.target.average;
  const unit = illuminanceUnit(units);
  const preset = presets.find(([, fc]) => avg != null && Math.abs(avg - fc) < 1e-6);
  if (presets.length === 0) return null;
  return (
    <span className="seg" role="group" aria-label="Light level">
      {presets.map(([name, fc]) => (
        <button
          key={name}
          type="button"
          aria-pressed={preset?.[0] === name}
          onClick={() => setAverage(intent, fc)}
          title={`${name}: ${illuminanceValue(fc, units)} ${unit} average`}
        >
          {name}
        </button>
      ))}
    </span>
  );
}

/** The zone's luminaire type tag, or nothing before the zone has fixtures. */
function TypeTag({ intent }: { intent: LightingIntent }) {
  const design = useStudio((s) => s.design);
  const types = useMemo(() => (design ? fixtureTypes(design) : []), [design]);
  const type = typeOfIntent(types, intent.id);
  return type ? (
    <span className="type-tag" title={`Type ${type.tag}`}>
      {type.tag}
    </span>
  ) : null;
}

/**
 * Luminaire and count on one line: "[A] 8 × Troffer". The count follows the target unless the designer fixed it;
 * then a link hands it back. Pinned or hand-moved fixtures show a regenerate link.
 */
export function FixtureLine({ intent, room }: { intent: LightingIntent; room: StudioRoom }) {
  const { setBehavior, releaseHandTuned } = studio.getState();
  const product = productOf(room, intent);
  const q = intent.behavior.quantity;
  const n = intent.fixtures.length;
  const pinned = intent.fixtures.filter((f) => f.pinned).length;
  const shortfall = quantityShortfall(intent);
  return (
    <>
      <p className="fixture-line">
        <TypeTag intent={intent} />
        <span className="fixture-what">
          <output aria-live="polite" aria-label="Fixtures" className="fixture-count">
            {n}
          </output>{' '}
          × {product.label}
        </span>
      </p>
      {/* a hand-tuned layout keeps its fixtures, so the count only follows once it is regenerated (line below) */}
      {(q != null || !intent.handTuned) && (
        <p className="step-sec-text muted">
          {q == null ? (
            'Count follows the target.'
          ) : (
            <>
              Count fixed at {q} by you.{' '}
              <button type="button" className="link" onClick={() => setBehavior(intent.id, { quantity: null })}>
                Back to auto
              </button>
            </>
          )}
        </p>
      )}
      {shortfall && (
        <p className="step-sec-text muted" data-testid="quantity-shortfall">
          {shortfall}
        </p>
      )}
      {(intent.handTuned || pinned > 0) && (
        <p className="step-sec-text hand-tuned">
          <span data-testid="hand-tuned">
            Manual layout{pinned > 0 ? ` · ${pinned} pinned` : ''}
            {intent.handTuned && q == null ? ', so the count stays put' : ''}
          </span>{' '}
          <button type="button" className="link" onClick={() => releaseHandTuned(intent.id)}>
            Regenerate layout
          </button>
        </p>
      )}
    </>
  );
}

/** The count stepper (More settings): − n + fixtures, with a way back to the automatic count. */
function CountStepper({ intent }: { intent: LightingIntent }) {
  const { setBehavior } = studio.getState();
  const q = intent.behavior.quantity;
  const n = q ?? intent.fixtures.length;
  const shortfall = quantityShortfall(intent);
  return (
    <>
      <div className="count-row" role="group" aria-label="Fixture count">
        <span className="stepper">
          <button
            type="button"
            aria-label="One fewer fixture"
            disabled={n <= 1}
            onClick={() => setBehavior(intent.id, { quantity: Math.max(1, n - 1) })}
          >
            −
          </button>
          <output aria-live="polite" aria-label="Fixtures">
            {n}
          </output>
          <button
            type="button"
            aria-label="One more fixture"
            onClick={() => setBehavior(intent.id, { quantity: n + 1 })}
          >
            +
          </button>
        </span>
        <span className="muted">
          {n === 1 ? 'fixture' : 'fixtures'} · {q == null ? 'automatic' : 'fixed by you'}
        </span>
        {q != null && (
          <button type="button" className="link" onClick={() => setBehavior(intent.id, { quantity: null })}>
            Back to auto
          </button>
        )}
      </div>
      {shortfall && (
        <p className="step-sec-text muted" data-testid="quantity-shortfall">
          {shortfall}
        </p>
      )}
    </>
  );
}

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
}: {
  intent: LightingIntent;
  estimate?: IntentEstimate;
  units: Units;
  stale: boolean;
}) {
  const feedback = estimate ? estimateStatus(intent.target, estimate) : null;
  const avg = intent.target.average;
  const unit = illuminanceUnit(units);
  return (
    <div
      className={`zone-card-status${feedback?.status ? ` is-${feedback.status.toLowerCase()}` : ''}`}
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
  // one scroll, the precise version of the open zone: level, luminaire, count, then plane and the rarely touched details
  return (
    <div className="zone-settings" data-testid="intent-editor" role="group" aria-label={`Settings for ${intent.label}`}>
      {status}
      <TargetFields
        intent={intent}
        units={units}
        average
        flat
        lead={keepDim ? undefined : <LevelPresets intent={intent} units={units} />}
      />
      {!keepDim && (
        <Section title="Luminaire">
          <div className="lum-row">
            <TypeTag intent={intent} />
            <LuminaireSelect intent={intent} room={room} />
          </div>
          <p className="step-sec-text muted">{specLine(productOf(room, intent))}</p>
          <CctField intent={intent} label="Color temperature (this zone)" />
          <ProductReason intent={intent} room={room} />
        </Section>
      )}
      <BehaviorFields
        intent={intent}
        units={units}
        flat
        lead={keepDim ? undefined : <CountStepper intent={intent} />}
      />
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
