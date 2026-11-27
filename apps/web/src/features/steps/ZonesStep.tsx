// Step 3, Zones: the room's base light plus the zones that need more (or less) light, each measured at its own height.
// The list shows estimate vs target; the selected zone is a target slider (captioned soft … bright) over one line of
// luminaire and count that follows it, and a miss offers one-tap fixes. More settings holds the exact fields. Suggestions wait dashed until added; "Add zone" picks a kind and draws on the plan.
import { useState } from 'react';
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
  type StudioTool,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { area, length, lpd, targetText, watts } from '../../state/display';
import type { Units } from '../../state/store';
import { ZoneMeter } from '../inspector/Inspector';
import { estimateStatus } from '../inspector/estimateStatus';
import { KeyboardPaint } from '../plan/PlanText';
import { toolLabel } from '../plan/hit';
import { Icon } from '../shell/Icon';
import {
  FixtureLine,
  PLAIN,
  Settings,
  TargetSlider,
  ZoneStatus,
  overrides,
  specLine,
  useProductOptions,
} from '../zone/ZoneCard';
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

export { specLine };

function ZoneSentence({ intent }: { intent: LightingIntent }) {
  const design = useStudio((s) => s.design)!;
  const estimate = useStudio((s) => s.estimates[intent.id]);
  const units = useStudio((s) => s.units);
  const stale = useStudio((s) => s.estimateRevision < s.revision);
  const opts = useProductOptions(intent, design.room);
  const [more, setMore] = useState(false);
  const { setBehavior, setProduct, removeIntent, select } = studio.getState();
  const keepDim = intent.kind === 'KeepDim';
  const feedback = estimate ? estimateStatus(intent.target, estimate) : null;
  const product = productOf(design.room, intent);
  const fixes = zoneFixes(intent, estimate, opts, product);
  const hidden = overrides(intent);

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
            status={<ZoneStatus intent={intent} estimate={estimate} units={units} stale={stale} />}
          />
        </>
      ) : (
        <>
          <StepSection id={`${intent.id}-target`} title="Target" hint={keepDim ? 'Upper limit' : undefined}>
            {keepDim ? (
              <p className="step-sec-text">Keep it below {targetText(intent.target, units)}.</p>
            ) : (
              <TargetSlider intent={intent} units={units} estimate={estimate} />
            )}
          </StepSection>

          {!keepDim && (
            <StepSection id={`${intent.id}-lum`} title="Luminaires">
              <FixtureLine intent={intent} room={design.room} />
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
