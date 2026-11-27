// Step 4, Luminaires: the schedule. Zones that share a product and colour temperature are one type (A, B, C…). The
// selected type's fixtures are emphasised on the plan; it can be swapped, or its colour changed, everywhere at once.
// IES files go into the project library. Totals are estimates.
import { useEffect, useMemo, useState } from 'react';
import {
  CCT_VALUES,
  CCT_WORDS,
  LIGHT_LOSS_FACTOR,
  formatGrouped,
  format0,
  hasIes,
  productOf,
  roomResult,
  type Cct,
} from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { freshCalc, productCatalog } from '../../state/store';
import { lpd, watts } from '../../state/display';
import { findOption, productOptions } from '../inspector/productOptions';
import { fixtureTypes, type FixtureType } from '../schedule/fixtureTypes';
import { Icon } from '../shell/Icon';
import { StepSection } from './Section';

function TypeDetail({ type }: { type: FixtureType }) {
  const design = useStudio((s) => s.design)!;
  const project = useStudio((s) => s.project);
  const projectProducts = useStudio((s) => s.projectProducts);
  const catalog = useMemo(() => productCatalog({ project, projectProducts }), [project, projectProducts]);
  const first = design.intents.find((i) => i.id === type.zones[0]?.id);
  const opts = useMemo(
    () => (first ? productOptions(design.room, first, catalog) : null),
    [design.room, first, catalog],
  );
  const { setProduct, setBehavior, select, setStep } = studio.getState();
  const p = type.product;
  return (
    <div className="type-detail" data-testid="type-detail">
      <dl className="facts small">
        <dt>Photometry</dt>
        <dd>
          {formatGrouped(p.lumens)} lm · {format0(p.watts)} W · {format0(p.beamAngle)}° beam
          {p.uplightShare > 0 && ` · ${Math.round(p.uplightShare * 100)}% up`}{' '}
          <span className="tag">{hasIes(p) ? 'IES' : 'generic'}</span>
        </dd>
        <dt>Used in</dt>
        <dd>
          {type.zones.map((z, k) => (
            <span key={z.id}>
              {k > 0 && ', '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setStep('zones');
                  select(z.id);
                }}
              >
                {z.label}
              </button>
            </span>
          ))}
        </dd>
        <dt>Light loss factor</dt>
        <dd>{LIGHT_LOSS_FACTOR}</dd>
      </dl>
      {opts && (
        <label className="field">
          <span>Swap everywhere</span>
          <select
            data-testid="type-swap"
            value=""
            onChange={(e) => {
              const o = findOption(opts, e.target.value);
              if (o) for (const z of type.zones) setProduct(z.id, o.product);
            }}
          >
            <option value="">Choose a luminaire…</option>
            {opts.groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.product.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Colour temperature</span>
        <select
          data-testid="type-cct"
          value={type.cct}
          onChange={(e) => {
            const cct = Number(e.target.value) as Cct;
            for (const z of type.zones) setBehavior(z.id, { cct });
          }}
        >
          {CCT_VALUES.map((c) => (
            <option key={c} value={c}>
              {c} K · {CCT_WORDS[c]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function LuminairesStep({ onLibrary }: { onLibrary: () => void }) {
  const design = useStudio((s) => s.design);
  const units = useStudio((s) => s.units);
  const calc = useStudio((s) => freshCalc(s));
  const highlight = useStudio((s) => s.highlightIntentIds);
  const types = useMemo(() => (design ? fixtureTypes(design) : []), [design]);
  const result = useMemo(() => (design ? roomResult(design, calc, productOf) : null), [design, calc]);
  const [open, setOpen] = useState<string | null>(null);
  const { setHighlight } = studio.getState();
  const current = types.find((t) => t.key === open) ?? null;
  // the selected type's zones are emphasised on the plan; a type that no longer exists lets go
  useEffect(() => {
    const ids = current ? current.zones.map((z) => z.id) : null;
    const now = studio.getState().highlightIntentIds;
    if (JSON.stringify(ids) !== JSON.stringify(now)) setHighlight(ids);
  }, [current, setHighlight]);
  useEffect(() => () => studio.getState().setHighlight(null), []);
  if (!design || !result) return null;
  return (
    <div className="step-body step-secs" data-testid="schedule">
      <StepSection
        id="lum-types"
        n={1}
        title="Types"
        hint={
          types.length === 0
            ? 'None yet'
            : `${types.length} type${types.length === 1 ? '' : 's'} · open one to change it`
        }
      >
        {types.length === 0 ? (
          <p className="step-sec-text muted">
            No fixtures yet. Add zones first; the layout follows each zone's target.
          </p>
        ) : (
          <ul className="type-list">
            {types.map((t) => (
              <li key={t.key} data-testid="schedule-row" className={open === t.key ? 'on' : undefined}>
                <button
                  type="button"
                  className="type-row"
                  aria-expanded={open === t.key}
                  onClick={() => setOpen(open === t.key ? null : t.key)}
                >
                  <span className="type-tag">{t.tag}</span>
                  <span className="type-name">
                    {t.product.label}
                    <span className="muted small"> {t.cct} K</span>
                  </span>
                  <span className="type-count small">
                    {t.count} · {watts(t.watts)}
                  </span>
                </button>
                {open === t.key && <TypeDetail type={t} />}
              </li>
            ))}
          </ul>
        )}
        {highlight && <span className="sr-only">Showing this type's fixtures on the plan.</span>}
      </StepSection>

      <StepSection id="lum-library" n={2} title="Library" hint="IES files and project products">
        <button type="button" className="link" onClick={onLibrary} data-testid="manage-products">
          <Icon name="product" /> Add or manage products
        </button>
      </StepSection>

      <StepSection id="lum-totals" n={3} title="Totals" hint="estimate">
        <div className="stat-row" data-testid="schedule-totals">
          <span>
            <strong>{result.fixtures}</strong> fixtures
          </span>
          <span>
            <strong>{watts(result.watts)}</strong>
          </span>
          <span>
            <strong>{lpd(result.lpd, units)}</strong>
          </span>
        </div>
      </StepSection>
    </div>
  );
}
