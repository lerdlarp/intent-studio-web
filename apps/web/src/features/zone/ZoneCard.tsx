// The selected zone's card, floating beside the zone on the plan: status, light level, luminaire type and fixture
// count up front; everything else under "More settings". Edits go through the same store actions as the inspector.
import { useMemo, useState } from 'react';

/** "More settings" stays open across zones for the session once the designer opens it. */
let moreOpen = false;
import { intentInkColor, intentInkName, type IntentKind, type LightingIntent } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { illuminanceInput, parseIlluminance } from '../../state/inputs';
import { illuminanceUnit, illuminanceValue } from '../../state/display';
import { IntentEditor, ProductChoice } from '../inspector/IntentEditor';
import { TextField } from '../inspector/fields';
import { estimateStatus } from '../inspector/estimateStatus';
import { cctSuggestion, fixtureTypes, typeOfIntent } from '../schedule/fixtureTypes';
import { Icon } from '../shell/Icon';
import './zone.css';

/** Average-level presets per kind, in footcandles (estimate targets, not recommendations). */
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

/** Hidden settings that differ from automatic, so "More settings" can show a dot. */
function overrides(i: LightingIntent): number {
  const b = i.behavior;
  return [
    b.pattern != null,
    b.density !== 1,
    b.mountingHeight != null,
    b.wallOffset != null,
    b.aimAngle != null,
    i.target.minimum != null && i.targetEdited,
    i.target.maximum != null && i.targetEdited,
  ].filter(Boolean).length;
}

export interface CardPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

const CARD_W = 272;
const GAP = 12;

/** Beside the zone's screen box: right when it fits, else left, else pinned to the right edge; clamped vertically. */
export function placeCard(
  box: { x: number; y: number; w: number; h: number },
  surface: { w: number; h: number },
): CardPlacement {
  const right = box.x + box.w + GAP;
  const left = box.x - GAP - CARD_W;
  const x = right + CARD_W <= surface.w - 8 ? right : left >= 8 ? left : surface.w - CARD_W - 8;
  // prefer the zone's top edge, but lift the card so at least 420 px (or the whole surface) stays visible
  const y = Math.max(8, Math.min(box.y, surface.h - 8 - 420));
  return { left: Math.max(8, x), top: y, maxHeight: Math.max(160, surface.h - y - 8) };
}

export function ZoneCard({ intent, placement }: { intent: LightingIntent; placement: CardPlacement }) {
  const design = useStudio((s) => s.design);
  const estimate = useStudio((s) => s.estimates[intent.id]);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const types = useMemo(() => (design ? fixtureTypes(design) : []), [design]);
  const [more, setMore] = useState(moreOpen);
  if (!design) return null;
  const { select, setTarget, setBehavior, removeIntent } = studio.getState();
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const type = typeOfIntent(types, intent.id);
  const suggestedCct = intent.kind === 'KeepDim' ? null : cctSuggestion(design, intent);
  const unit = illuminanceUnit(units);
  const feedback = estimate ? estimateStatus(intent.target, estimate) : null;
  const presets = LEVEL_PRESETS[intent.kind] ?? [];
  const avg = intent.target.average;
  const hidden = overrides(intent);
  const q = intent.behavior.quantity;
  const n = intent.fixtures.length;

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
    >
      <header className="zone-card-head">
        <span className="zone-swatch" style={{ background: intentInkColor(intent.kind) }} aria-hidden="true" />
        <select aria-label="Zone to edit" value={intent.id} onChange={(e) => select(e.target.value)}>
          {accepted.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label || intentInkName(i.kind)}
            </option>
          ))}
        </select>
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
      <p className="zone-card-kind muted small">
        {intentInkName(intent.kind)} · {n} fixture{n === 1 ? '' : 's'}
      </p>

      <div
        className={`zone-card-status${feedback?.status ? ` is-${feedback.status.toLowerCase()}` : ''}${stale ? ' stale' : ''}`}
        data-testid="estimate"
        role="status"
      >
        {estimate && feedback ? (
          <>
            <strong data-testid="status-glyph" data-status={feedback.status ?? 'Unset'}>
              {feedback.text}
            </strong>
            <span>
              Average {illuminanceValue(estimate.average, units)}
              {avg != null && ` / ${illuminanceValue(avg, units)}`} {unit} · Minimum{' '}
              {illuminanceValue(estimate.minimum, units)}
              {intent.target.minimum != null && ` / ${illuminanceValue(intent.target.minimum, units)}`} {unit}
            </span>
            <span className="muted">{stale ? 'Updating estimate…' : 'Estimate'}</span>
          </>
        ) : (
          <span className="muted">Estimating…</span>
        )}
      </div>

      {intent.kind !== 'KeepDim' && (
        <>
          <fieldset className="zone-card-field">
            <legend>
              Luminaire{' '}
              {type && (
                <span className="type-tag" title={`Type ${type.tag}`}>
                  {type.tag}
                </span>
              )}
            </legend>
            <ProductChoice intent={intent} room={design.room} />
            {type && (
              <p className="muted small zone-card-cct">
                {type.cct} K on type {type.tag}
                {type.zones.length > 1 && ` · shared by ${type.zones.length} zones`}
              </p>
            )}
            {suggestedCct !== null && type && (
              <div className="cct-suggestion small" data-testid="cct-suggestion">
                <span>Zone suggests {suggestedCct} K</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => type.zones.forEach((z) => setBehavior(z.id, { cct: suggestedCct }))}
                >
                  Use on {type.tag}
                </button>
                {type.zones.length > 1 && (
                  <button type="button" className="link" onClick={() => setBehavior(intent.id, { cct: suggestedCct })}>
                    New type
                  </button>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="zone-card-field">
            <legend>Light level</legend>
            {presets.length > 0 && (
              <div className="chip-group" role="group" aria-label="Light level presets">
                {presets.map(([name, fc]) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={avg != null && Math.abs(avg - fc) < 1e-6}
                    onClick={() => setAverage(fc)}
                  >
                    {name} <span className="muted">{Math.round(Number(illuminanceValue(fc, units).replace(/,/g, '')))}</span>
                  </button>
                ))}
              </div>
            )}
            <TextField
              key={`avg-${units}`}
              label="Average"
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
          </fieldset>

          <fieldset className="zone-card-field">
            <legend>Fixtures</legend>
            <div className="chip-group" role="group" aria-label="Fixture count">
              <button type="button" aria-pressed={q == null} onClick={() => setBehavior(intent.id, { quantity: null })}>
                Auto{q == null ? ` (${n})` : ''}
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
          </fieldset>
        </>
      )}

      <details
        className="zone-card-more"
        open={more}
        onToggle={(e) => {
          moreOpen = e.currentTarget.open;
          setMore(moreOpen);
        }}
      >
        <summary>
          More settings
          {hidden > 0 && (
            <span
              className="override-dot"
              aria-label={`${hidden} changed`}
              title={`${hidden} changed from automatic`}
            />
          )}
        </summary>
        <IntentEditor key={intent.id} intent={intent} room={design.room} units={units} compact />
        <button
          type="button"
          className="delete-zone"
          onClick={() => removeIntent(intent.id)}
          aria-label={`Remove ${intent.label}`}
        >
          <Icon name="trash" /> Delete zone
        </button>
      </details>
    </article>
  );
}
