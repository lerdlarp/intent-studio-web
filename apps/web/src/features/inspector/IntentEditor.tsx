// The selected intent's editor (PLAN §1 UI / Phase 3 "Inspector"): label, target, plane, product, behaviour knobs,
// hand-tuned state, the estimate line and the solver trace. Every number is typed and shown in display units and
// converted back to feet / footcandles before it reaches the store; the store sanitises and clamps again.
import {
  BAR_HEIGHT,
  CCT_VALUES,
  COUNTER_HEIGHT,
  DESK_HEIGHT,
  PATTERNS,
  PLANE_KINDS,
  type IntentKind,
  type LightingIntent,
  type PlaneKind,
  type StudioRoom,
  type TargetRange,
} from '@intent-studio/core';
import { studio } from '../../state/instance';
import { illuminanceUnit, length } from '../../state/display';
import {
  illuminanceInput,
  integerInput,
  lengthInput,
  parseIlluminance,
  parseInteger,
  parseLength,
} from '../../state/inputs';
import { DENSITY_MAX, DENSITY_MIN, type BehaviorPatch, type Units } from '../../state/store';
import { SelectField, TextField } from './fields';

const AREA_KINDS: readonly IntentKind[] = ['Task', 'Ambient', 'Path', 'FeaturePendant'];
const AIMED_KINDS: readonly IntentKind[] = ['WallWash', 'Accent'];
const PLANE_NAMES: Readonly<Record<PlaneKind, string>> = {
  Horizontal: 'Horizontal',
  Vertical: 'Vertical (wall)',
  Ceiling: 'Ceiling',
};
const PATTERN_NAMES: Readonly<Record<(typeof PATTERNS)[number], string>> = {
  grid: 'Grid',
  staggered: 'Staggered',
  rows: 'Rows',
  perimeter: 'Perimeter',
};
const PRESETS: readonly { name: string; height: number }[] = [
  { name: 'Desk', height: DESK_HEIGHT },
  { name: 'Counter', height: COUNTER_HEIGHT },
  { name: 'Bar', height: BAR_HEIGHT },
  { name: 'Floor', height: 0 },
];

const LENGTH_HELP: Readonly<Record<Units, string>> = { imperial: 'e.g. 2\'-6" or 2.5', metric: 'metres, e.g. 0.76' };
const BAD_LENGTH = (u: Units) =>
  u === 'imperial' ? 'Type feet-inches like 2\'-6" or feet like 2.5.' : 'Type metres, like 0.76.';

export function Section({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <fieldset className="editor-section">
      <legend>
        {title}
        {extra}
      </legend>
      {children}
    </fieldset>
  );
}

export function TargetFields({
  intent,
  units,
  average = true,
  flat = false,
  lead,
}: {
  intent: LightingIntent;
  units: Units;
  average?: boolean;
  /** Shown first in the section (the zone's level presets). */
  lead?: React.ReactNode;
  /** Limits shown open (zone card settings tab). */
  flat?: boolean;
}) {
  const { setTarget, resetTarget } = studio.getState();
  const unit = illuminanceUnit(units);
  const bound = (key: keyof TargetRange, label: string) => (
    <TextField
      key={`${key}-${units}`}
      label={label}
      testId={`target-${key}`}
      value={illuminanceInput(intent.target[key], units)}
      placeholder="none"
      suffix={unit}
      onCommit={(text) => {
        const v = parseIlluminance(text, units);
        if (v === undefined) return 'Type a number, or leave it empty for no bound.';
        return setTarget(intent.id, { ...intent.target, [key]: v }) ? null : 'Keep min ≤ avg ≤ max (0–200 fc).';
      }}
    />
  );
  const reset = intent.targetEdited ? (
    <button type="button" className="link" onClick={() => resetTarget(intent.id)}>
      Reset to suggested
    </button>
  ) : null;
  const why = intent.targetReason && (
    <details className="editor-disclosure why">
      <summary>Why this target</summary>
      <p className="muted small reason">{intent.targetReason}</p>
    </details>
  );
  // the zone's settings: the three numbers side by side, labels above, nothing folded
  if (flat)
    return (
      <Section title="Target" extra={reset}>
        {lead}
        <div className="field-grid three" data-testid="target-bounds">
          {average && bound('average', 'Average')}
          {bound('minimum', 'Min')}
          {bound('maximum', 'Max average')}
        </div>
        {why}
      </Section>
    );
  return (
    <Section title="Light level" extra={reset}>
      {lead}
      {average && bound('average', 'Average')}
      <details className="editor-disclosure" data-testid="target-bounds">
        <summary>
          Limits{' '}
          <span className="muted small">
            {[
              intent.target.minimum != null ? `Minimum ${illuminanceInput(intent.target.minimum, units)} ${unit}` : '',
              intent.target.maximum != null
                ? `Max average ${illuminanceInput(intent.target.maximum, units)} ${unit}`
                : '',
            ]
              .filter(Boolean)
              .join(' \u00b7 ')}
          </span>
        </summary>
        <div className="field-grid two">
          {bound('minimum', 'Minimum')}
          {bound('maximum', 'Maximum average')}
        </div>
      </details>
      {why}
    </Section>
  );
}

export function PlaneFields({ intent, room, units }: { intent: LightingIntent; room: StudioRoom; units: Units }) {
  const { setPlane } = studio.getState();
  const plane = intent.plane;
  const lengthField = (key: 'height' | 'bottom' | 'top', label: string) => (
    <TextField
      key={`${key}-${units}`}
      label={label}
      testId={`plane-${key}`}
      value={lengthInput(plane[key], units)}
      hint={key === 'height' ? LENGTH_HELP[units] : undefined}
      onCommit={(text) => {
        const v = parseLength(text, units);
        if (v === undefined || v === null) return BAD_LENGTH(units);
        if (v > room.ceilingHeight + 1e-9) return `At most the ceiling (${length(room.ceilingHeight, units)}).`;
        setPlane(intent.id, { ...plane, [key]: v });
        return null;
      }}
    />
  );
  const changeKind = (kind: PlaneKind) => {
    if (kind === plane.kind) return;
    const h = room.ceilingHeight;
    if (kind === 'Ceiling') setPlane(intent.id, { ...plane, kind, height: h });
    else if (kind === 'Vertical')
      setPlane(intent.id, { ...plane, kind, bottom: plane.bottom, top: plane.top > plane.bottom ? plane.top : h });
    else setPlane(intent.id, { ...plane, kind, height: Math.min(plane.height, h) >= h ? DESK_HEIGHT : plane.height });
  };
  return (
    <>
      <SelectField label="Kind" testId="plane-kind" value={plane.kind} onChange={(v) => changeKind(v as PlaneKind)}>
        {PLANE_KINDS.map((k) => (
          <option key={k} value={k}>
            {PLANE_NAMES[k]}
          </option>
        ))}
      </SelectField>
      {plane.kind === 'Vertical' ? (
        <div className="field-grid two">
          {lengthField('bottom', 'Bottom')}
          {lengthField('top', 'Top')}
        </div>
      ) : (
        lengthField('height', 'Height')
      )}
      {plane.kind === 'Horizontal' && (
        <div className="presets" role="group" aria-label="Plane height presets">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={Math.abs(plane.height - p.height) < 1e-9}
              onClick={() => setPlane(intent.id, { ...plane, height: p.height })}
            >
              {p.name} {p.height > 0 ? length(p.height, units) : ''}
            </button>
          ))}
        </div>
      )}
      {plane.reason && <p className="muted small reason">{plane.reason}</p>}
    </>
  );
}

export function CctField({ intent, label = 'Color temperature' }: { intent: LightingIntent; label?: string }) {
  return (
    <SelectField
      label={label}
      testId="behavior-cct"
      value={intent.behavior.cct === undefined ? '' : String(intent.behavior.cct)}
      onChange={(v) =>
        studio
          .getState()
          .setBehavior(intent.id, { cct: v === '' ? undefined : (Number(v) as (typeof CCT_VALUES)[number]) })
      }
      hint={
        intent.behavior.cct !== undefined && (
          <span data-testid="cct-origin" data-origin={intent.cctSuggested ? 'suggested' : 'designer'}>
            {intent.cctSuggested ? 'suggested' : 'set by you'}
          </span>
        )
      }
    >
      <option value="">Automatic</option>
      {CCT_VALUES.map((k) => (
        <option key={k} value={k}>
          {k} K
        </option>
      ))}
    </SelectField>
  );
}

export function BehaviorFields({
  intent,
  units,
  flat = false,
  lead,
  room,
}: {
  intent: LightingIntent;
  units: Units;
  flat?: boolean;
  /** The room, for the ceiling-grid snap (zone settings only). */
  room?: StudioRoom;
  /** Shown first under Layout (the zone's count stepper). */
  lead?: React.ReactNode;
}) {
  const { setBehavior } = studio.getState();
  const b = intent.behavior;
  const set = (patch: BehaviorPatch) => setBehavior(intent.id, patch);
  const keepDim = intent.kind === 'KeepDim';
  const optionalLength = (
    key: 'mountingHeight' | 'keepDimMargin' | 'wallOffset',
    label: string,
    placeholder: string,
  ) => (
    <TextField
      key={`${key}-${units}`}
      label={label}
      testId={`behavior-${key}`}
      value={lengthInput(b[key], units)}
      placeholder={placeholder}
      onCommit={(text) => {
        const v = parseLength(text, units);
        if (v === undefined) return BAD_LENGTH(units);
        set({ [key]: v });
        return null;
      }}
    />
  );
  if (keepDim) return <Section title="Keep dim">{optionalLength('keepDimMargin', 'Margin', 'automatic')}</Section>;
  const densityText = `${b.density.toFixed(1)}×`;
  const grid = room?.ceilingGrid;
  const snap = room && (
    <label className="check-row" title={grid ? undefined : 'This room has no ceiling grid'}>
      <input
        type="checkbox"
        checked={grid ? b.alignToCeilingGrid : false}
        disabled={!grid}
        onChange={(e) => set({ alignToCeilingGrid: e.target.checked })}
        data-testid="behavior-snap"
      />
      Snap to ceiling grid
      {!grid && <span className="muted small"> · no ceiling grid in this room</span>}
    </label>
  );
  const placement = (
    <>
      {optionalLength('mountingHeight', flat ? 'Mounting' : 'Mounting height', 'automatic')}
      {AIMED_KINDS.includes(intent.kind) && (
        <>
          {optionalLength('wallOffset', 'Wall offset', 'automatic')}
          <TextField
            label="Aim"
            testId="behavior-aimAngle"
            value={integerInput(b.aimAngle === null ? null : Math.round(b.aimAngle))}
            placeholder="automatic"
            suffix="°"
            onCommit={(text) => {
              const v = parseInteger(text, true);
              if (v === undefined) return 'Type whole degrees (−90 to 90), or leave it empty.';
              set({ aimAngle: v });
              return null;
            }}
          />
        </>
      )}
    </>
  );
  const layout = (
    <Section title="Layout">
      {lead}
      {AREA_KINDS.includes(intent.kind) && (
        <SelectField
          label="Pattern"
          testId="behavior-pattern"
          value={b.pattern ?? ''}
          onChange={(v) => set({ pattern: v === '' ? null : (v as (typeof PATTERNS)[number]) })}
        >
          <option value="">Automatic</option>
          {PATTERNS.map((p) => (
            <option key={p} value={p}>
              {PATTERN_NAMES[p]}
            </option>
          ))}
        </SelectField>
      )}

      <div className="field-row density">
        <label htmlFor={`density-${intent.id}`}>{flat ? 'Density' : 'Fixture density'}</label>
        <span className="field-control">
          <input
            id={`density-${intent.id}`}
            aria-label="Fixture density"
            type="range"
            min={DENSITY_MIN}
            max={DENSITY_MAX}
            step={0.1}
            value={b.density}
            aria-valuetext={`${densityText}: ${b.density < 1 ? 'fewer, brighter' : b.density > 1 ? 'more, softer' : 'as solved'}`}
            onChange={(e) => set({ density: Number(e.target.value) })}
          />
          <output className="small" htmlFor={`density-${intent.id}`}>
            {densityText}
          </output>
        </span>
        <div className="density-direction" aria-hidden="true">
          <span>Fewer</span>
          <span>More</span>
        </div>
      </div>
      {flat ? (
        <div className="placement" data-testid="placement-settings">
          {placement}
          {snap}
        </div>
      ) : (
        <details className="editor-disclosure" data-testid="placement-settings">
          <summary>Placement</summary>
          {placement}
        </details>
      )}
    </Section>
  );
  return layout;
}
