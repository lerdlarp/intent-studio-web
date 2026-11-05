// Results ledger: one row per calculated zone (zone, avg, min, max, target, status) with a stale marker when the
// design changed after the calculation. Every number is labelled an estimate. Presentational: the caller owns the run.
import { CALC_LABEL, formatFixed2, type CalcResult } from '@intent-studio/core';
import type { Units } from '../../state/store';
import { STATUS_GLYPH, STATUS_TEXT, illuminanceUnit, illuminanceValue, targetText } from '../../state/display';
import { isStale, ledgerRows } from './ledger';
import './ledger.css';

export interface LedgerProps {
  result: CalcResult | null;
  /** Current design revision; the ledger is stale when it is past `result.revision`. */
  designRevision: number;
  units: Units;
  running?: boolean;
  /** 0..1 while running. */
  progress?: number;
  error?: string | null;
  onRun?: () => void;
  onCancel?: () => void;
  /** Show floor/ceiling/wall surfaces (default true). */
  showSurfaces?: boolean;
}

export function Ledger({ result, designRevision, units, running = false, progress = 0, error = null, onRun, onCancel, showSurfaces = true }: LedgerProps) {
  const stale = isStale(result, designRevision);
  const rows = ledgerRows(result).filter((r) => showSurfaces || !r.isSurface);
  const v = (fc: number) => illuminanceValue(fc, units);
  const unit = illuminanceUnit(units);
  return (
    <section className="panel ledger" aria-label="Calculation results" data-testid="ledger">
      <div className="row spread">
        <h2 className="ledger-title">Results</h2>
        <div className="btn-group">
          {running ? (
            <button type="button" onClick={onCancel} data-testid="calc-cancel">
              Cancel
            </button>
          ) : (
            <button type="button" className="primary" onClick={onRun} disabled={!onRun} data-testid="calc-run">
              {result ? 'Recalculate' : 'Calculate'}
            </button>
          )}
        </div>
      </div>
      <p className="muted small">
        <span className="tag">estimate</span> {CALC_LABEL}. Not a compliance calculation.
      </p>
      {running && (
        <progress className="ledger-progress" max={1} value={progress} aria-label="Calculation progress">
          {Math.round(progress * 100)}%
        </progress>
      )}
      {error && (
        <p className="ledger-error" role="alert">
          The calculation failed: {error}
        </p>
      )}
      {stale && (
        <p className="ledger-stale" role="status" data-testid="calc-stale">
          Out of date — the design changed after this calculation (revision {result!.revision}, now {designRevision}).
        </p>
      )}
      {result?.aborted && <p className="muted small">The calculation was cancelled; showing the zones it finished.</p>}
      {rows.length === 0 ? (
        !running && <p className="muted small">No calculation yet.</p>
      ) : (
        <table className={`ledger-table${stale ? ' is-stale' : ''}`}>
          <thead>
            <tr>
              <th scope="col">Zone</th>
              <th scope="col" className="num">Avg</th>
              <th scope="col" className="num">Min</th>
              <th scope="col" className="num">Max</th>
              <th scope="col" className="num">U</th>
              <th scope="col">Target</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.zoneId} data-testid="ledger-row" className={r.isSurface ? 'surface' : 'intent'}>
                <th scope="row">{r.label}</th>
                <td className="num">{v(r.avg)}</td>
                <td className="num">{v(r.min)}</td>
                <td className="num">{v(r.max)}</td>
                <td className="num">{formatFixed2(r.U)}</td>
                <td>{r.target ? targetText(r.target, units) : '—'}</td>
                <td className={r.status ? `status status-${r.status.toLowerCase()}` : 'status'}>
                  {r.status ? (
                    <span title={STATUS_TEXT[r.status]}>
                      {STATUS_GLYPH[r.status]} {STATUS_TEXT[r.status]}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="muted small">
                Illuminance in {unit}, estimated point by point at each zone's grid spacing ({result?.pointCount ?? 0} points).
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
