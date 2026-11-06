// Luminaire schedule under the plan: one row per fixture type (product + CCT), tagged A, B, C…, with the zones that
// use it. Changing a type's luminaire or CCT applies to every zone of that type. Totals are estimates.
import { useMemo, type ReactNode } from 'react';
import { CCT_VALUES, LLF, formatGrouped, format0, type Cct } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { productCatalog } from '../../state/store';
import { lpd, watts } from '../../state/display';
import { findOption, productOptions } from '../inspector/productOptions';
import { Icon } from '../shell/Icon';
import { fixtureTypes, type FixtureType } from './fixtureTypes';
import './schedule.css';

/** A tiny beam sketch from the beam angle (generic; not photometry). */
function BeamGlyph({ beam, asymmetric }: { beam: number; asymmetric: boolean }) {
  const half = Math.min(80, Math.max(8, beam / 2));
  const dx = Math.tan((half * Math.PI) / 180) * 14;
  const d = asymmetric
    ? `M12 3 L${12 - dx / 3} 19 Q12 21 ${12 + dx} 19 Z`
    : `M12 3 L${12 - dx} 19 Q12 22 ${12 + dx} 19 Z`;
  return (
    <svg className="beam-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function TypeRow({ t, selectedId }: { t: FixtureType; selectedId: string | null }) {
  const design = useStudio((s) => s.design)!;
  const project = useStudio((s) => s.project);
  const projectProducts = useStudio((s) => s.projectProducts);
  const catalog = useMemo(() => productCatalog({ project, projectProducts }), [project, projectProducts]);
  const first = design.intents.find((i) => i.id === t.zones[0]?.id);
  const opts = useMemo(
    () => (first ? productOptions(design.room, first, catalog) : null),
    [design.room, first, catalog],
  );
  const { setProduct, setBehavior, select } = studio.getState();
  const active = selectedId !== null && t.zones.some((z) => z.id === selectedId);
  const allAuto = t.zones.every((z) => z.automatic);
  return (
    <tr className={active ? 'active' : undefined} data-testid="schedule-row">
      <th scope="row">
        <span className="type-tag">{t.tag}</span>
      </th>
      <td>
        <BeamGlyph beam={t.product.beamAngle} asymmetric={t.product.asymmetric} />
      </td>
      <td className="lum">
        {opts ? (
          <select
            aria-label={`Luminaire for type ${t.tag}`}
            value={allAuto ? '' : (opts.chosenKey ?? '')}
            onChange={(e) => {
              const key = e.target.value;
              const product = key === '' ? null : (findOption(opts, key)?.product ?? null);
              for (const z of t.zones) setProduct(z.id, product);
            }}
          >
            <option value="">Automatic · {opts.automatic.label}</option>
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
        ) : (
          t.product.label
        )}
        <span className="muted small">{t.product.ies ? 'Uploaded IES' : 'Built-in'}</span>
      </td>
      <td className="num">{formatGrouped(t.product.lumens)}</td>
      <td className="num">{format0(t.product.watts)}</td>
      <td>
        <select
          aria-label={`Color temperature for type ${t.tag}`}
          value={t.cct}
          onChange={(e) => {
            const cct = Number(e.target.value) as Cct;
            for (const z of t.zones) setBehavior(z.id, { cct });
          }}
        >
          {CCT_VALUES.map((k) => (
            <option key={k} value={k}>
              {k} K
            </option>
          ))}
        </select>
      </td>
      <td className="num" title="Light loss factor (fixed in this version)">
        {LLF.toFixed(2)}
      </td>
      <td className="num">{t.count}</td>
      <td className="zones">
        {t.zones.map((z) => (
          <button
            key={z.id}
            type="button"
            className="zone-chip"
            aria-label={`Select ${z.label} (type ${t.tag})`}
            aria-pressed={selectedId === z.id}
            onClick={() => select(selectedId === z.id ? null : z.id)}
          >
            {z.label}
          </button>
        ))}
      </td>
    </tr>
  );
}

export function ScheduleDock({ onImport, results }: { onImport: () => void; results: ReactNode }) {
  const design = useStudio((s) => s.design);
  const power = useStudio((s) => s.power);
  const units = useStudio((s) => s.units);
  const selectedId = useStudio((s) => s.selectedIntentId);
  const types = useMemo(() => (design ? fixtureTypes(design) : []), [design]);
  if (!design) return null;
  const count = types.reduce((n, t) => n + t.count, 0);
  return (
    <section className="schedule-dock" aria-labelledby="schedule-h" data-testid="schedule">
      <details open>
        <summary>
          <h2 id="schedule-h">Luminaire schedule</h2>
          <span className="muted small">
            {count} fixture{count === 1 ? '' : 's'}
            {power && (
              <>
                {' '}
                · {watts(power.watts)} · {lpd(power.lpd, units)} · estimate
              </>
            )}
          </span>
        </summary>
        {types.length > 0 ? (
          <div className="schedule-scroll">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">
                    <span className="sr-only">Beam</span>
                  </th>
                  <th scope="col">Luminaire</th>
                  <th scope="col" className="num">
                    Lumens
                  </th>
                  <th scope="col" className="num">
                    Watts
                  </th>
                  <th scope="col">CCT</th>
                  <th scope="col" className="num">
                    LLF
                  </th>
                  <th scope="col" className="num">
                    Qty
                  </th>
                  <th scope="col">Zones</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <TypeRow key={t.key} t={t} selectedId={selectedId} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Accept or draw a zone to start the schedule.</p>
        )}
      </details>
      <div className="schedule-actions">
        <button type="button" onClick={onImport} data-testid="manage-products">
          <Icon name="add" /> Add IES file
        </button>
        {results}
      </div>
    </section>
  );
}
