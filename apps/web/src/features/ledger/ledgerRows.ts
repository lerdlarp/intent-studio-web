// Results ledger rows from a full calculation (core calc.ts). Pure; display formatting happens in Ledger.tsx.
import { targetStatus, type CalcResult, type TargetRange, type TargetStatus, type ZoneGrid } from '@intent-studio/core';

export interface LedgerRow {
  zoneId: string;
  label: string;
  /** Intent zones carry a target; surfaces do not. */
  isSurface: boolean;
  avg: number;
  min: number;
  max: number;
  U: number;
  points: number;
  target: TargetRange | null;
  /** null when the zone has no target (surfaces, unlit intents without bounds). */
  status: TargetStatus | null;
}

export const zoneTargetRange = (g: Pick<ZoneGrid, 'target'>): TargetRange | null =>
  g.target ? { minimum: g.target.min ?? null, average: g.target.avg ?? null, maximum: g.target.max ?? null } : null;

export function ledgerRows(result: CalcResult | null): LedgerRow[] {
  if (!result) return [];
  return result.zones.map((g) => {
    const target = zoneTargetRange(g);
    return {
      zoneId: g.zoneId,
      label: g.label,
      isSurface: g.zoneId.startsWith('surface:'),
      avg: g.avg,
      min: g.min,
      max: g.max,
      U: g.U,
      points: g.points.length,
      target,
      status: target ? targetStatus(target, g.avg) : null,
    };
  });
}

/** The calculation is out of date when the design changed after it started. */
export const isStale = (result: Pick<CalcResult, 'revision'> | null, designRevision: number): boolean =>
  result !== null && designRevision > result.revision;
