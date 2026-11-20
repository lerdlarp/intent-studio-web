// The selected zone's card, floating on the plan. The main view never scrolls: status, light level, luminaire and
// fixture count. Everything else lives in Settings (tabs swap in place of the main view). Edits go through the same
// store actions as before; every illuminance number is an estimate.
import { useMemo, useState } from 'react';
import {
  formatGrouped,
  format0,
  intentInkColor,
  intentInkName,
  type IntentEstimate,
  type IntentKind,
  type LightingIntent,
  type StudioRoom,
  type TargetRange,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { illuminanceInput, parseIlluminance } from '../../state/inputs';
import { illuminanceUnit, illuminanceValue } from '../../state/display';
import { productCatalog, type Units } from '../../state/store';
import { BehaviorFields, CctField, PlaneFields, TargetFields } from '../inspector/IntentEditor';
import { TextField } from '../inspector/fields';
import { estimateStatus } from '../inspector/estimateStatus';
import { findOption, productOptions } from '../inspector/productOptions';
import { cctSuggestion, fixtureTypes, typeOfIntent } from '../schedule/fixtureTypes';
import { Icon } from '../shell/Icon';
import './zone.css';

/** Average-level presets per kind, in footcandles (targets for the estimate, not recommendations). */
export const LEVEL_PRESETS: Readonly<Partial<Record<IntentKind, readonly [string, number][]>>> = {
  Task: [['Soft', 20], ['Work', 30], ['Detail', 50]],
  Ambient: [['Soft', 10], ['Comfortable', 20], ['Bright', 30]],
  WallWash: [['Soft', 10], ['Even', 20], ['Bright', 30]],
  Accent: [['Subtle', 30], ['Feature', 60], ['Dramatic', 100]],
  FeaturePendant: [['Soft', 10], ['Comfortable', 20], ['Bright', 30]],
  CeilingGlow: [['Soft', 5], ['Glow', 10], ['Bright', 20]],
  Path: [['Night', 1], ['Guide', 2], ['Clear', 5]],
};

/** Plain-language status for the card (the list keeps the short text). */
const PLAIN: Readonly<Record<string, string>> = {
  'Meets target': 'Looks right',
  'Below minimum': 'Some spots too dark',
  'Below average target': 'Too dark overall',
  'Above average ceiling': 'Brighter than needed',
  'No target set': 'No target set',
};

/** Hidden settings that differ from automatic, so Settings can show a dot. */
function overrides(i: LightingIntent): number {
  const b = i.behavior;
  return [
    b.pattern != null,
    b.density !== 1,
    b.quantity != null,
    b.mountingHeight != null,
    b.wallOffset != null,
    b.aimAngle != null,
  ].filter(Boolean).length;
}

export interface CardPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

export const CARD_W = 288;
const CARD_H = 340;
const GAP = 12;

/** Beside the zone's screen box: right when it fits, else left, else the surface's top-right corner; never past the bottom. */
export function placeCard(
  box: { x: number; y: number; w: number; h: number },
  surface: { w: number; h: number },
): CardPlacement {
  const right = box.x + box.w + GAP;
  const left = box.x - GAP - CARD_W;
  const beside = right + CARD_W <= surface.w - 8 ? right : left >= 8 ? left : null;
  const x = beside ?? surface.w - CARD_W - 8;
  const y = beside === null ? 8 : Math.max(8, Math.min(box.y, surface.h - 8 - CARD_H));
  return { left: Math.max(8, x), top: y, maxHeight: Math.max(160, surface.h - y - 8) };
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

function useProductOptions(intent: LightingIntent, room: StudioRoom) {
  const project = useStudio((s) => s.project);
  const projectProducts = useStudio((s) => s.projectProducts);
  const catalog = useMemo(() => productCatalog({ project, projectProducts }), [project, projectProducts]);
  return useMemo(() => productOptions(room, intent, catalog), [room, intent, catalog]);
}

function LuminaireSelect({ intent, room }: { intent: LightingIntent; room: StudioRoom }) {
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

function ZoneStatus({
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

export type SettingsTab = 'target' | 'layout' | 'plane' | 'details';
const TABS: readonly [SettingsTab, string][] = [
  ['target', 'Target'],
  ['layout', 'Layout'],
  ['plane', 'Plane'],
  ['details', 'Details'],
];

function Settings({
  intent,
  room,
  units,
  tab,
  onTab,
  status,
}: {
  intent: LightingIntent;
  room: StudioRoom;
  units: Units;
  status: React.ReactNode;
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
}) {
  const { setLabel, releaseHandTuned } = studio.getState();
  const pinned = intent.fixtures.filter((f) => f.pinned).length;
  const keepDim = intent.kind === 'KeepDim';
  return (
    <div className="zone-settings" data-testid="intent-editor" role="group" aria-label={`Settings for ${intent.label}`}>
      {status}
      <div className="tabs" role="tablist" aria-label="Settings">
        {TABS.map(([t, name]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)}>
            {name}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel">
        {tab === 'target' && <TargetFields intent={intent} units={units} flat />}
        {tab === 'layout' && (
          <>
            {(intent.handTuned || pinned > 0) && (
              <div className="row hand-tuned">
                <span className="tag" data-testid="inspector-hand-tuned">
                  Manual layout{pinned > 0 ? ` · ${pinned} pinned` : ''}
                </span>
                <button type="button" onClick={() => releaseHandTuned(intent.id)}>
                  Regenerate layout
                </button>
              </div>
            )}
            <BehaviorFields intent={intent} units={units} flat />
          </>
        )}
        {tab === 'plane' && <PlaneFields intent={intent} room={room} units={units} />}
        {tab === 'details' && (
          <>
            <TextField
              label="Zone name"
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
            {!keepDim && <CctField intent={intent} label="Color temperature (this zone)" />}
            {!keepDim && <ProductReason intent={intent} room={room} />}
            {intent.trace.length > 0 && (
              <details className="trace">
                <summary>Why this layout ({intent.trace.length})</summary>
                <ol className="small">
                  {intent.trace.map((t, k) => (
                    <li key={k}>{t}</li>
                  ))}
                </ol>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ZoneCard({ intent, placement }: { intent: LightingIntent; placement: CardPlacement }) {
  const design = useStudio((s) => s.design);
  const estimate = useStudio((s) => s.estimates[intent.id]);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const types = useMemo(() => (design ? fixtureTypes(design) : []), [design]);
  const [view, setView] = useState<'main' | SettingsTab>('main');
  if (!design) return null;
  const { select, setTarget, setBehavior } = studio.getState();
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const type = typeOfIntent(types, intent.id);
  const suggestedCct = intent.kind === 'KeepDim' ? null : cctSuggestion(design, intent);
  const unit = illuminanceUnit(units);
  const presets = LEVEL_PRESETS[intent.kind] ?? [];
  const avg = intent.target.average;
  const hidden = overrides(intent);
  const q = intent.behavior.quantity;
  const n = intent.fixtures.length;
  const step = avg != null && avg >= 10 ? 5 : 1;
  const keepDim = intent.kind === 'KeepDim';

  const setAverage = (v: number): boolean => {
    const t = intent.target;
    if (setTarget(intent.id, { ...t, average: v })) return true;
    // keep the designer's limits but widen them just enough to hold the new average
    return setTarget(intent.id, {
      ...t,
      average: v,
      minimum: t.minimum != null ? Math.min(t.minimum, v) : null,
      maximum: t.maximum != null ? Math.max(t.maximum, v) : null,
    });
  };

  return (
    <article
      className="zone-card"
      style={{ left: placement.left, top: placement.top, maxHeight: placement.maxHeight }}
      aria-label={`Zone ${intent.label}`}
      data-testid="intent"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !(e.target instanceof HTMLSelectElement)) {
          e.stopPropagation();
          if (view !== 'main') setView('main');
          else select(null);
        }
      }}
    >
      <header className="zone-card-head">
        {view === 'main' ? (
          <span className="zone-swatch" style={{ background: intentInkColor(intent.kind) }} aria-hidden="true" />
        ) : (
          <button type="button" className="icon-button back" onClick={() => setView('main')} aria-label="Back to zone">
            ‹
          </button>
        )}
        <select aria-label="Zone to edit" value={intent.id} onChange={(e) => select(e.target.value)}>
          {accepted.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label || intentInkName(i.kind)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button delete"
          onClick={() => studio.getState().removeIntent(intent.id)}
          aria-label="Delete this zone"
          title="Delete zone (Delete key)"
          data-testid="delete-zone"
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => select(null)}
          aria-label="Close zone card"
          data-testid="all-zones"
        >
          <Icon name="close" />
        </button>
      </header>

      {view !== 'main' ? (
        <Settings
          intent={intent}
          room={design.room}
          units={units}
          tab={view}
          onTab={setView}
          status={<ZoneStatus intent={intent} estimate={estimate} units={units} stale={stale} compact />}
        />
      ) : (
        <>
          <ZoneStatus intent={intent} estimate={estimate} units={units} stale={stale} />

          {!keepDim && (
            <>
              <div className="card-row" role="group" aria-label="Light level">
                <span className="card-label" aria-hidden="true">
                  Level
                </span>
                <div className="chip-group">
                  {presets.map(([name, fc]) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={avg != null && Math.abs(avg - fc) < 1e-6}
                      onClick={() => setAverage(fc)}
                      title={`${name}: ${illuminanceValue(fc, units)} ${unit} average`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="card-row stepper" role="group" aria-label="Average target">
                <span className="card-label" aria-hidden="true" />
                <button
                  type="button"
                  aria-label="Lower the average target"
                  disabled={avg == null || avg - step < 0}
                  onClick={() => avg != null && setAverage(Math.max(0, avg - step))}
                >
                  −
                </button>
                <TextField
                  key={`avg-${units}`}
                  label="Average"
                  className="avg-field"
                  testId="target-average"
                  value={illuminanceInput(avg, units)}
                  placeholder="none"
                  suffix={unit}
                  onCommit={(text) => {
                    const v = parseIlluminance(text, units);
                    if (v === undefined) return 'Type a number, or leave it empty for no bound.';
                    return setTarget(intent.id, { ...intent.target, average: v })
                      ? null
                      : 'Keep min ≤ avg ≤ max (0–200 fc).';
                  }}
                />
                <button
                  type="button"
                  aria-label="Raise the average target"
                  onClick={() => setAverage((avg ?? 0) + step)}
                >
                  +
                </button>
              </div>

              <div className="card-row lum" role="group" aria-label="Luminaire">
                <span className="card-label" aria-hidden="true">
                  {type ? (
                    <span className="type-tag" title={`Type ${type.tag}`}>
                      {type.tag}
                    </span>
                  ) : (
                    'Type'
                  )}
                </span>
                <div className="lum-body">
                  <LuminaireSelect intent={intent} room={design.room} />
                  {type && (
                    <span className="muted small" data-testid="product-preview">
                      {formatGrouped(type.product.lumens)} lm · {format0(type.product.watts)} W ·{' '}
                      {format0(type.product.beamAngle)}° · {type.cct} K
                      {type.zones.length > 1 && ` · ${type.zones.length} zones`}
                    </span>
                  )}
                  {suggestedCct !== null && type && (
                    <span className="cct-suggestion small" data-testid="cct-suggestion">
                      Zone suggests {suggestedCct} K
                      <button
                        type="button"
                        className="link"
                        onClick={() => type.zones.forEach((z) => setBehavior(z.id, { cct: suggestedCct }))}
                      >
                        Use on {type.tag}
                      </button>
                      {type.zones.length > 1 && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => setBehavior(intent.id, { cct: suggestedCct })}
                        >
                          New type
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="card-row" role="group" aria-label="Fixture count">
                <span className="card-label" aria-hidden="true">
                  Count
                </span>
                <div className="chip-group">
                  <button
                    type="button"
                    aria-pressed={q == null}
                    onClick={() => setBehavior(intent.id, { quantity: null })}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    aria-label="One fewer fixture"
                    disabled={(q ?? n) <= 1}
                    onClick={() => setBehavior(intent.id, { quantity: Math.max(1, (q ?? n) - 1) })}
                  >
                    −
                  </button>
                  <output aria-live="polite" aria-label="Fixtures">
                    {q ?? n}
                  </output>
                  <button
                    type="button"
                    aria-label="One more fixture"
                    onClick={() => setBehavior(intent.id, { quantity: (q ?? n) + 1 })}
                  >
                    +
                  </button>
                </div>
              </div>
            </>
          )}

          <footer className="zone-card-foot">
            <span className="muted small">
              {intentInkName(intent.kind)} · {n} fixture{n === 1 ? '' : 's'}
            </span>
            <button type="button" className="settings-button" onClick={() => setView('target')}>
              Settings <span aria-hidden="true">›</span>
              {hidden > 0 && <span className="override-dot" title={`${hidden} changed from automatic`} />}
            </button>
          </footer>
        </>
      )}
    </article>
  );
}
