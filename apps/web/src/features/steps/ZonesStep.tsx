// Step 3, Zones: the room's base light plus the zones that need more (or less) light, each measured at its own height.
// The list shows estimate vs target; the selected zone reads as a sentence with its level, luminaire and count, and a
// miss offers one-tap fixes. Suggestions wait dashed until added; "Add zone" picks a kind and draws on the plan.
import { useMemo, useState } from 'react';
import {
  MEASURED_AT,
  STUDIO_TOOLS,
  floorArea,
  intentInkColor,
  intentInkName,
  productOf,
  toolToKind,
  type IntentKind,
  type LightingIntent,
  type StudioProduct,
  type StudioTool,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { illuminanceInput, parseIlluminance } from '../../state/inputs';
import { area, illuminanceUnit, illuminanceValue, length, lpd, targetText, watts } from '../../state/display';
import type { Units } from '../../state/store';
import { ZoneMeter } from '../inspector/Inspector';
import { quantityShortfall } from '../inspector/hints';
import { TextField } from '../inspector/fields';
import { estimateStatus } from '../inspector/estimateStatus';
import { KeyboardPaint } from '../plan/PlanText';
import { toolLabel } from '../plan/hit';
import { Icon } from '../shell/Icon';
import {
  LEVEL_PRESETS,
  LuminaireSelect,
  PLAIN,
  Settings,
  ZoneStatus,
  overrides,
  useProductOptions,
} from '../zone/ZoneCard';
import { fixtureTypes, typeOfIntent } from '../schedule/fixtureTypes';
import { zoneFixes } from './fixes';
import { StepSection } from './Section';

export const KIND_INFO: Readonly<Record<IntentKind, string>> = {
  Task: 'A work surface that needs more light, like desks or a counter',
  Ambient: 'Even light over an area',
  WallWash: 'Light a wall evenly, for art, menus or brand walls',
  Accent: 'Pick out an object or a feature',
  FeaturePendant: 'Decorative pendants over a table or desk',
  CeilingGlow: 'Indirect glow from a cove or a raised ceiling',
  Path: 'Low guiding light along a route',
  KeepDim: 'Keep an area dim, like the screen end of a room',
};

const ADD_TOOLS = STUDIO_TOOLS.filter((t): t is Exclude<StudioTool, 'Select'> => t !== 'Select');

function planeText(intent: LightingIntent, units: Units): string {
  const p = intent.plane;
  if (p.kind === 'Horizontal') {
    const named = MEASURED_AT.find((m) => Math.abs(m.height - p.height) < 1e-6);
    return `at ${named ? named.label : length(p.height, units)}`;
  }
  if (p.kind === 'Vertical') return 'on the wall';
  return 'on the ceiling';
}

/** "1,200 lm · 12 W · 60° beam · IES" for the chosen (or automatic) luminaire. */
export function specLine(p: StudioProduct): string {
  const parts = [`${Math.round(p.lumens).toLocaleString('en-US')} lm`];
  if (p.watts > 0) parts.push(`${Math.round(p.watts * 10) / 10} W`);
  parts.push(`${Math.round(p.beamAngle)}° beam`);
  if (p.ies) parts.push('IES');
  return parts.join(' · ');
}

function ZoneSentence({ intent }: { intent: LightingIntent }) {
  const design = useStudio((s) => s.design)!;
  const estimate = useStudio((s) => s.estimates[intent.id]);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const types = useMemo(() => fixtureTypes(design), [design]);
  const opts = useProductOptions(intent, design.room);
  const [more, setMore] = useState(false);
  const { setTarget, setBehavior, setProduct, removeIntent, select, releaseHandTuned } = studio.getState();
  const type = typeOfIntent(types, intent.id);
  const unit = illuminanceUnit(units);
  const presets = LEVEL_PRESETS[intent.kind] ?? [];
  const avg = intent.target.average;
  const q = intent.behavior.quantity;
  const n = intent.fixtures.length;
  const keepDim = intent.kind === 'KeepDim';
  const feedback = estimate ? estimateStatus(intent.target, estimate) : null;
  const product = productOf(design.room, intent);
  const fixes = zoneFixes(intent, estimate, opts, product);
  const hidden = overrides(intent);
  const pinned = intent.fixtures.filter((f) => f.pinned).length;
  const shortfall = quantityShortfall(intent);
  const preset = presets.find(([, fc]) => avg != null && Math.abs(avg - fc) < 1e-6);

  const setAverage = (v: number): boolean => {
    const t = intent.target;
    if (setTarget(intent.id, { ...t, average: v })) return true;
    return setTarget(intent.id, {
      ...t,
      average: v,
      minimum: t.minimum != null ? Math.min(t.minimum, v) : null,
      maximum: t.maximum != null ? Math.max(t.maximum, v) : null,
    });
  };

  return (
    <article
      className="zone-sentence"
      aria-label={`Zone ${intent.label}`}
      data-testid="intent"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !(e.target instanceof HTMLSelectElement)) {
          e.stopPropagation();
          if (more) setMore(false);
          else select(null);
        }
      }}
    >
      {more ? (
        <>
          <button type="button" className="link" onClick={() => setMore(false)}>
            ‹ Back to zone
          </button>
          <Settings
            intent={intent}
            room={design.room}
            units={units}
            status={<ZoneStatus intent={intent} estimate={estimate} units={units} stale={stale} compact />}
          />
        </>
      ) : (
        <>
          <StepSection id={`${intent.id}-target`} title="Target" hint={keepDim ? 'Upper limit' : undefined}>
            {keepDim ? (
              <p className="step-sec-text">Keep it below {targetText(intent.target, units)}.</p>
            ) : (
              <div className="target-row">
                <span className="seg" role="group" aria-label="Light level">
                  {presets.map(([name, fc]) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={preset?.[0] === name}
                      onClick={() => setAverage(fc)}
                      title={`${name}: ${illuminanceValue(fc, units)} ${unit} average`}
                    >
                      {name}
                    </button>
                  ))}
                </span>
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
              </div>
            )}
          </StepSection>

          {!keepDim && (
            <StepSection id={`${intent.id}-lum`} title="Luminaire">
              <div className="lum-row">
                {type && (
                  <span className="type-tag" title={`Type ${type.tag}`}>
                    {type.tag}
                  </span>
                )}
                <LuminaireSelect intent={intent} room={design.room} />
              </div>
              <p className="step-sec-text muted">{specLine(product)}</p>
            </StepSection>
          )}

          {!keepDim && (
            <StepSection id={`${intent.id}-count`} title="Count" hint={q == null ? 'Automatic' : 'Fixed by you'}>
              <div className="count-row" role="group" aria-label="Fixture count">
                <span className="stepper">
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
                </span>
                <span className="muted">{(q ?? n) === 1 ? 'fixture' : 'fixtures'}</span>
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
              {(intent.handTuned || pinned > 0) && (
                <p className="step-sec-text hand-tuned">
                  <span data-testid="hand-tuned">Manual layout{pinned > 0 ? ` · ${pinned} pinned` : ''}</span>{' '}
                  <button type="button" className="link" onClick={() => releaseHandTuned(intent.id)}>
                    Regenerate layout
                  </button>
                </p>
              )}
            </StepSection>
          )}

          <div className="zone-result">
            <ZoneStatus intent={intent} estimate={estimate} units={units} stale={stale} />

            {feedback && (feedback.status === 'Under' || feedback.status === 'Over') && fixes.length > 0 && (
              <div
                className="fix-chips"
                role="group"
                aria-label={`Fix: ${PLAIN[feedback.text] ?? feedback.text}`}
                data-testid="zone-fixes"
              >
                {fixes.map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    onClick={() =>
                      f.kind === 'quantity'
                        ? setBehavior(intent.id, { quantity: f.quantity })
                        : setProduct(intent.id, f.product)
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <footer className="row spread zone-sentence-foot">
            <button type="button" className="link" onClick={() => setMore(true)}>
              More settings
              {hidden > 0 && <span className="override-dot" title={`${hidden} changed from automatic`} />}
            </button>
            <button
              type="button"
              className="link danger"
              onClick={() => removeIntent(intent.id)}
              data-testid="delete-zone"
            >
              Delete zone
            </button>
          </footer>
        </>
      )}
    </article>
  );
}

function AddZone({ onClose }: { onClose: () => void }) {
  const tool = useStudio((s) => s.tool);
  const { setTool } = studio.getState();
  return (
    <div className="add-zone" data-testid="add-zone">
      <ul className="kind-list" role="group" aria-label="Zone kinds">
        {ADD_TOOLS.map((t) => {
          const k = toolToKind(t)!;
          return (
            <li key={t}>
              <button
                type="button"
                className={tool === t ? 'on' : undefined}
                onClick={() => setTool(tool === t ? 'Select' : t)}
                aria-label={`Paint ${toolLabel(t)}`}
                aria-pressed={tool === t}
              >
                <span className="zone-swatch" style={{ background: intentInkColor(k) }} aria-hidden="true" />
                <span>
                  <strong>{toolLabel(t)}</strong>
                  <span className="muted small"> {KIND_INFO[k]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {tool !== 'Select' && <KeyboardPaint />}
      <button
        type="button"
        className="link"
        onClick={() => {
          setTool('Select');
          onClose();
        }}
      >
        {tool !== 'Select' ? 'Cancel drawing' : 'Close'}
      </button>
    </div>
  );
}

export function ZonesStep() {
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
  const tool = useStudio((s) => s.tool);
  const [adding, setAdding] = useState(false);
  if (!design) return null;
  const { accept, acceptAll, dismiss, select, setHover, suggestDesign, removeIntent } = studio.getState();
  const accepted = design.intents.filter((i) => !i.isSuggestion);
  const suggestions = design.intents.filter((i) => i.isSuggestion);
  const selected = accepted.find((i) => i.id === selectedId);
  const hover = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(id),
    onBlur: () => setHover(null),
  });
  return (
    <div className="step-body" data-testid="inspector" data-zone-count={accepted.length}>
      {/* the step's own title already says Zones, so the list only carries its count and Add */}
      <section aria-label="Zones in this room">
        <div className="side-subhead">
          <span className="muted small" data-testid="zone-count">
            {accepted.length === 0 ? 'None yet' : `${accepted.length} in this room`}
          </span>
          {!adding && tool === 'Select' && (
            <button type="button" className="link" onClick={() => setAdding(true)} data-testid="add-zone-open">
              <Icon name="add" /> Add
            </button>
          )}
        </div>
        {(adding || tool !== 'Select') && <AddZone onClose={() => setAdding(false)} />}
        {accepted.length ? (
          <ul className="zone-list">
            {accepted.map((i) => (
              <li
                key={i.id}
                data-testid="zone-row"
                className={
                  [hoverId === i.id && 'hot', selected?.id === i.id && 'open'].filter(Boolean).join(' ') || undefined
                }
              >
                <button
                  type="button"
                  className="zone-row"
                  onClick={() => select(selectedId === i.id ? null : i.id)}
                  aria-current={selectedId === i.id ? 'true' : undefined}
                  aria-keyshortcuts="Delete"
                  onKeyDown={(e) => {
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                      e.preventDefault();
                      removeIntent(i.id);
                    }
                  }}
                  {...hover(i.id)}
                >
                  <span className="zone-swatch" style={{ background: intentInkColor(i.kind) }} aria-hidden="true" />
                  {selected?.id === i.id ? (
                    // open: the row is the zone's one title, with its kind and height under it
                    <>
                      <span className="zone-name open-name">
                        {i.label}
                        <span className="zone-sub">
                          {intentInkName(i.kind)} · measured {planeText(i, units)}
                        </span>
                        <span className="sr-only">
                          , {i.fixtures.length} fixture{i.fixtures.length === 1 ? '' : 's'}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="zone-name">
                        {i.label}
                        <span className="muted small"> {planeText(i, units)}</span>
                        <span className="sr-only">
                          , {intentInkName(i.kind)} · {i.fixtures.length} fixture{i.fixtures.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      <ZoneMeter intent={i} estimate={estimates[i.id]} units={units} stale={stale} />
                    </>
                  )}
                </button>
                {selected?.id === i.id && (
                  <>
                    <button
                      type="button"
                      className="icon-button zone-close"
                      onClick={() => select(null)}
                      aria-label="Close zone"
                      data-testid="all-zones"
                    >
                      <Icon name="close" />
                    </button>
                    <ZoneSentence key={i.id} intent={i} />
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small empty-zones">No zones yet. Add one, or take a suggestion below.</p>
        )}
      </section>

      <section className="suggestions-section" aria-labelledby="suggestions-h">
        <div className="side-subhead">
          <h3 id="suggestions-h">
            Suggested <span className="count">{suggestions.length}</span>
            {source && suggestions.length > 0 && (
              <span className="tag source-tag" data-testid="suggestion-source">
                {source === 'ai' ? 'Agent' : 'Rules'}
              </span>
            )}
          </h3>
          {suggestions.length > 1 && (
            <button type="button" className="link accept-all" onClick={acceptAll}>
              Accept all
            </button>
          )}
        </div>
        {suggestions.length > 0 && (
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
                <span
                  className="zone-swatch dashed"
                  style={{ borderColor: intentInkColor(i.kind) }}
                  aria-hidden="true"
                />
                <span className="zone-name">
                  {i.label}
                  <span className="muted small"> {targetText(i.target, units)}</span>
                  {rationale[i.id] && (
                    <span className="sr-only" data-testid="suggestion-rationale">
                      {rationale[i.id]}
                    </span>
                  )}
                </span>
                <button type="button" className="small" onClick={() => accept(i.id)} aria-label={`Add ${i.label}`}>
                  Add
                </button>
                <button
                  type="button"
                  className="link small"
                  onClick={() => dismiss(i.id)}
                  aria-label={`Skip ${i.label}`}
                >
                  Skip
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="link suggest-design"
          onClick={() => void suggestDesign()}
          disabled={proposing}
          data-testid="suggest-design"
        >
          <Icon name="spark" /> {proposing ? 'Suggesting…' : 'Suggest more'}
        </button>
      </section>

      <p className="muted small step-foot-note" data-testid="room-power">
        {area(floorArea(design.room), units)}
        {power && (
          <>
            {' '}
            · {watts(power.watts)} · {lpd(power.lpd, units)}
          </>
        )}{' '}
        · estimate
      </p>
    </div>
  );
}
