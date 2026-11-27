// Step 5, Check: the room as one result. Every zone is measured at its own height with the light of every luminaire
// type in the room (core roomResult: the room lumen method, replaced by the point-by-point grid once a calculation of
// this revision has run). The worst miss links back to its zone. Every value is an estimate, not a compliance check.
import { useMemo } from 'react';
import { MEASURED_AT, productOf, roomResult, type RoomZoneResult } from '@intent-studio/core';
import { studio, useStudio } from '../../state/instance';
import { freshCalc } from '../../state/store';
import { STATUS_GLYPH, illuminanceUnit, illuminanceValue, length, lpd, targetText, watts } from '../../state/display';
import type { Units } from '../../state/store';
import { StepSection } from './Section';

const STATUS: Record<RoomZoneResult['status'], { text: string; glyph: string; cls: string }> = {
  'on-target': { text: 'On target', glyph: STATUS_GLYPH.Meets, cls: 'is-meets' },
  low: { text: 'Too dark', glyph: STATUS_GLYPH.Under, cls: 'is-under' },
  high: { text: 'Too bright', glyph: STATUS_GLYPH.Over, cls: 'is-over' },
  'no-target': { text: 'No target', glyph: '·', cls: '' },
};

function heightText(z: RoomZoneResult, units: Units): string {
  if (z.plane === 'vertical') return 'wall';
  if (z.plane === 'ceiling') return 'ceiling';
  const named = MEASURED_AT.find((m) => Math.abs(m.height - z.elevation) < 1e-6);
  return named ? `${named.label} (${length(z.elevation, units)})` : length(z.elevation, units);
}

export function CheckStep() {
  const design = useStudio((s) => s.design);
  const units = useStudio((s) => s.units);
  const calc = useStudio((s) => freshCalc(s));
  const running = useStudio((s) => s.calcRunning);
  const progress = useStudio((s) => s.calcProgress);
  const error = useStudio((s) => s.calcError);
  const stale = useStudio((s) => s.calcStale);
  const last = useStudio((s) => s.calcResult);
  const ms = useStudio((s) => s.calcMs);
  const result = useMemo(() => (design ? roomResult(design, calc, productOf) : null), [design, calc]);
  if (!design || !result) return null;
  const { calculate, cancelCalculation, select, setStep } = studio.getState();
  const unit = illuminanceUnit(units);
  const v = (x: number | null | undefined) => (x == null ? '—' : illuminanceValue(x, units));
  const worst = result.zones.find((z) => z.intentId === result.worst) ?? null;

  return (
    <div className="step-body step-secs" data-testid="ledger">
      <StepSection id="check-result" n={1} title="Result">
        <header className="verdict">
          <h3 data-testid="verdict">
            {result.withTarget === 0
              ? 'No zone has a target yet'
              : `${result.onTarget} of ${result.withTarget} zone${result.withTarget === 1 ? '' : 's'} on target`}
          </h3>
          <p className="muted small" data-testid="result-label">
            {result.calculated ? 'Full calculation' : 'Room lumen method'} · estimate
            {!result.calculated && ' (Calculate for the point-by-point grid)'}
            {result.calculated && ms !== null && (
              <span data-testid="calc-ms" data-ms={Math.round(ms)}>{`, ${Math.round(ms)} ms`}</span>
            )}
          </p>
        </header>
        {stale && last && !calc && (
          <p className="banner banner-info small" data-testid="calc-stale">
            The design changed since the last calculation. Recalculate to update the grid.
          </p>
        )}
        {error && (
          <p className="banner banner-error small" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button
            type="button"
            className="primary"
            data-testid="calc-run"
            onClick={() => (running ? cancelCalculation() : void calculate())}
          >
            {running ? `Cancel (${Math.round(progress * 100)}%)` : calc || last ? 'Recalculate' : 'Calculate'}
          </button>
        </div>
      </StepSection>

      <StepSection id="check-zones" n={2} title="Zones" hint={`${unit} · estimate`}>
        <table className={`check-table small${stale && last && !calc ? ' is-stale' : ''}`}>
          <thead>
            <tr>
              <th scope="col">Zone</th>
              <th scope="col">Avg</th>
              <th scope="col">Min</th>
              <th scope="col">Target</th>
              <th scope="col">
                <span className="sr-only">Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.zones.map((z) => {
              const st = STATUS[z.status];
              return (
                <tr
                  key={z.intentId}
                  data-testid="ledger-row"
                  className={z.intentId === result.worst ? 'worst' : undefined}
                >
                  <th scope="row">
                    {z.label}
                    <span className="muted block">{heightText(z, units)}</span>
                  </th>
                  <td>
                    {v(z.average)}
                    {z.point && z.lumen && (
                      <span className="muted block" title="Room lumen method at this height">
                        lm {v(z.lumen.average)}
                      </span>
                    )}
                    {z.source === 'quick' && (
                      <span
                        className="muted block"
                        title="Quick point estimate (no lumen-method value on a wall or ceiling)"
                      >
                        quick
                      </span>
                    )}
                  </td>
                  <td>{v(z.point?.minimum ?? z.quick?.minimum)}</td>
                  <td>{targetText(z.target, units)}</td>
                  <td className={`status ${st.cls}`} title={st.text} data-status={z.status}>
                    <span aria-hidden="true">{st.glyph}</span>
                    <span className="sr-only">{st.text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">Each zone is measured at its own height.</p>
      </StepSection>

      {worst && (
        <StepSection
          id="check-worst"
          n={3}
          title="Needs attention"
          hint="the furthest from its target"
          className="attention"
        >
          <aside className="worst" data-testid="worst">
            <p className="small">
              <strong>{worst.label}</strong> is {worst.status === 'low' ? 'darker' : 'brighter'} than its target (
              {v(worst.average)} {unit} against {targetText(worst.target, units)}).
            </p>
            <button
              type="button"
              className="link"
              onClick={() => {
                setStep('zones');
                select(worst.intentId);
              }}
            >
              Fix in Zones
            </button>
          </aside>
        </StepSection>
      )}

      <details className="method small">
        <summary>How this is calculated</summary>
        <p>{result.label}.</p>
        <p>
          Each zone is measured at its own height. The room lumen method counts every luminaire type in the room, using
          its IES lumens, beam and uplight where a file is loaded. A full calculation replaces it with a point grid over
          each zone. Not a compliance check.
        </p>
      </details>

      <p className="muted small step-foot-note">
        {result.fixtures} fixtures · {watts(result.watts)} · {lpd(result.lpd, units)} · estimate
      </p>
    </div>
  );
}
