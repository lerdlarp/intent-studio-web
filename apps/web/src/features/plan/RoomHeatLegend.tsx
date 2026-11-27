// The room heat legend: one colour scale for every zone (0 to the room's 95th percentile), each zone measured at its
// own height. Always labelled an estimate.
import { heatRamp, type HeatScale } from '@intent-studio/core';
import { illuminanceUnit, illuminanceValue } from '../../state/display';
import type { Units } from '../../state/store';

export function RoomHeatLegend({ scale, full, units }: { scale: HeatScale; full: boolean; units: Units }) {
  const stops = heatRamp()
    .map((s) => `rgb(${s.color.join(',')}) ${(s.position * 100).toFixed(1)}%`)
    .join(', ');
  return (
    <div
      className="heat-legend room-heat small"
      role="note"
      aria-label="Heat legend"
      data-testid="heat-legend"
      data-source={full ? 'calculation' : 'quick'}
      title="Whole room, one scale. Each zone is measured at its own height."
    >
      <span className="tag">estimate</span>
      <span className="ramp-wrap">
        <span className="ramp" style={{ background: `linear-gradient(90deg, ${stops})` }} aria-hidden="true" />
        <span className="ramp-ends">
          <span>{illuminanceValue(scale.min, units)}</span>
          <span>
            {illuminanceValue(scale.max, units)} {illuminanceUnit(units)}
          </span>
        </span>
      </span>
      <span>{full ? 'Full calculation' : 'Quick estimate'}</span>
    </div>
  );
}
