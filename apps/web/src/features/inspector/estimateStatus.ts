import {
  isEmptyTarget,
  targetMeets,
  type IntentEstimate,
  type TargetRange,
  type TargetStatus,
} from '@intent-studio/core';

/** Use the model's full target rule, including the point minimum and ceiling on the average. */
export function estimateStatus(
  target: TargetRange,
  estimate: IntentEstimate,
): { status: TargetStatus | null; text: string } {
  if (isEmptyTarget(target)) return { status: null, text: 'No target set' };
  if (targetMeets(target, estimate.average, estimate.minimum)) return { status: 'Meets', text: 'Meets target' };
  if (target.minimum !== null && estimate.minimum < target.minimum * 0.98)
    return { status: 'Under', text: 'Below minimum' };
  if (target.average !== null && estimate.average < target.average * 0.9)
    return { status: 'Under', text: 'Below average target' };
  return { status: 'Over', text: 'Above average ceiling' };
}
