// The selected intent's editor (PLAN §1 UI / Phase 3 "Inspector"): label, target, plane, product, behaviour knobs,
// hand-tuned state, the estimate line and the solver trace. Every number is typed and shown in display units and
// converted back to feet / footcandles before it reaches the store; the store sanitises and clamps again.
import { useMemo } from 'react';
import {
  BAR_HEIGHT,
  formatGrouped,
  format0,
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
import { studio, useStudio } from '../../state/instance';
import { illuminanceUnit, length } from '../../state/display';
import {
  illuminanceInput,
  integerInput,
  lengthInput,
  parseIlluminance,
  parseInteger,
  parseLength,
} from '../../state/inputs';
import { DENSITY_MAX, DENSITY_MIN, productCatalog, type BehaviorPatch, type Units } from '../../state/store';
import { SelectField, TextField } from './fields';
import { findOption, productOptions } from './productOptions';
import { quantityShortfall } from './hints';
import { Icon } from '../shell/Icon';

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

function Section({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
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

function TargetFields({ intent, units, average = true }: { intent: LightingIntent; units: Units; average?: boolean }) {
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
  return (
    <Section
      title="Light level"
      extra={
        intent.targetEdited ? (
          <button type="button" className="link" onClick={() => resetTarget(intent.id)}>
            Reset to suggested
          </button>
        ) : null
      }
    >
      {average && bound('average', 'Average')}
      <details className="editor-disclosure" data-testid="target-bounds">
        <summary>
          Limits{' '}
          <span className="muted small">
            {[
              intent.target.minimum != null ? `Minimum ${illuminanceInput(intent.target.minimum, units)} ${unit}` : '',
              intent.target.maximum != null
                ? `Average ceiling ${illuminanceInput(intent.target.maximum, units)} ${unit}`
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
      {intent.targetReason && (
        <details className="editor-disclosure">
          <summary>Why this target</summary>
          <p className="muted small reason">{intent.targetReason}</p>
        </details>
      )}
    </Section>
  );
}

function PlaneFields({ intent, room, units }: { intent: LightingIntent; room: StudioRoom; units: Units }) {
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

/** The zone's luminaire: a preview with the native select over it ("Change"). */
export function ProductChoice({ intent, room }: { intent: LightingIntent; room: StudioRoom }) {
  // the open project's library (uploaded IES products; plus the demo catalogue in the demo project)
  const project = useStudio((s) => s.project);
  const projectProducts = useStudio((s) => s.projectProducts);
  const catalog = useMemo(() => productCatalog({ project, projectProducts }), [project, projectProducts]);
  const opts = useMemo(() => productOptions(room, intent, catalog), [room, intent, catalog]);
  const value = opts.chosenKey ?? '';
  const picked = value ? findOption(opts, value) : undefined;
  const reason = picked ? `Your choice · ${picked.reason}` : opts.automaticReason;
  const product = picked?.product ?? opts.automatic;
  return (
    <>
      <div className="product-choice">
        <div className="product-preview" data-testid="product-preview">
          <span className={`luminaire-symbol${product.isRound ? ' round' : ''}`} aria-hidden="true">
            <span />
          </span>
          <div className="grow">
            <strong>{product.label.replace(/\s*·\s*[\d,]+\s*lm\s*$/i, '')}</strong>
            <span className="muted small">
              {product.ies ? 'Uploaded IES' : product.isGeneric ? 'Built-in product' : 'Project product'}
            </span>
          </div>
          <span className="product-specs small">
            {formatGrouped(product.lumens)} lm
            <span aria-hidden="true"> · </span>
            {format0(product.watts)} W · {format0(product.beamAngle)}°
          </span>
          <span className="product-change" aria-hidden="true">
            Change ⌄
          </span>
        </div>
        <SelectField
          label="Luminaire"
          testId="product"
          value={value}
          onChange={(key) =>
            studio.getState().setProduct(intent.id, key === '' ? null : (findOption(opts, key)?.product ?? null))
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
        </SelectField>
      </div>
      <details className="product-reason">
        <summary>Product details</summary>
        <p className="muted small" data-testid="product-reason">
          {reason}
        </p>
      </details>
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

function ProductField({ intent, room }: { intent: LightingIntent; room: StudioRoom }) {
  return (
    <div className="product-picker">
      <ProductChoice intent={intent} room={room} />
      <CctField intent={intent} />
    </div>
  );
}

function BehaviorFields({ intent, units }: { intent: LightingIntent; units: Units }) {
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
  const shortfall = quantityShortfall(intent);
  return (
    <Section title="Layout">
      <TextField
        label="Quantity"
        testId="behavior-quantity"
        inputMode="numeric"
        value={integerInput(b.quantity)}
        placeholder="automatic"
        hint={shortfall && <span data-testid="quantity-shortfall">{shortfall}</span>}
        onCommit={(text) => {
          const v = parseInteger(text);
          if (v === undefined || v === 0) return 'Type a whole number from 1, or leave it empty.';
          set({ quantity: v });
          return null;
        }}
      />

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
        <label htmlFor={`density-${intent.id}`}>Fixture density</label>
        <span className="field-control">
          <input
            id={`density-${intent.id}`}
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
      <details className="editor-disclosure" data-testid="placement-settings">
        <summary>Placement</summary>
        {optionalLength('mountingHeight', 'Mounting height', 'automatic')}
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
      </details>
    </Section>
  );
}

export function IntentEditor({
  intent,
  room,
  units,
  onManageProducts,
  estimate,
  compact = false,
}: {
  intent: LightingIntent;
  room: StudioRoom;
  units: Units;
  /** Opens the project's product library (IES upload). */
  onManageProducts?: () => void;
  estimate?: React.ReactNode;
  /** In the zone card: product, average target and estimate live on the card itself. */
  compact?: boolean;
}) {
  const { setLabel, releaseHandTuned } = studio.getState();
  const pinned = intent.fixtures.filter((f) => f.pinned).length;
  const tuned = intent.handTuned || pinned > 0;
  return (
    <div className="intent-editor" data-testid="intent-editor" aria-label={`Edit ${intent.label}`} role="group">
      <TextField
        label="Zone name"
        testId="intent-label"
        className="zone-name-field"
        inputMode="text"
        maxLength={40}
        value={intent.label}
        onCommit={(text) => {
          if (text.trim() === '') return 'A label cannot be empty.';
          setLabel(intent.id, text);
          return null;
        }}
      />
      {intent.kind !== 'KeepDim' && compact && <CctField intent={intent} label="Color temperature (this zone)" />}
      {intent.kind !== 'KeepDim' && !compact && (
        <Section title="Product">
          <ProductField intent={intent} room={room} />
          {onManageProducts && (
            <button type="button" className="product-manage" onClick={onManageProducts} data-testid="manage-products">
              <Icon name="add" /> Import IES
            </button>
          )}
        </Section>
      )}
      <TargetFields intent={intent} units={units} average={!compact} />
      {estimate}
      {tuned && (
        <div className="row hand-tuned">
          <span className="tag" data-testid="inspector-hand-tuned">
            Manual layout{pinned > 0 ? ` · ${pinned} pinned` : ''}
          </span>
          <button
            type="button"
            title="Replaces manual moves and removals with a regenerated layout"
            onClick={() => releaseHandTuned(intent.id)}
          >
            Regenerate layout
          </button>
        </div>
      )}
      <BehaviorFields intent={intent} units={units} />
      <details className="editor-disclosure" data-testid="workplane-settings">
        <summary>
          Calculation plane{' '}
          <span className="muted small">
            {intent.plane.kind === 'Vertical'
              ? `Wall \u00b7 ${length(intent.plane.bottom, units)}\u2013${length(intent.plane.top, units)}`
              : `${intent.plane.kind} \u00b7 ${length(intent.plane.height, units)}`}
          </span>
        </summary>
        <PlaneFields intent={intent} room={room} units={units} />
      </details>
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
    </div>
  );
}
