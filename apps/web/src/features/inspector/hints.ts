// Inspector hint texts (pure).
import type { LightingIntent } from '@intent-studio/core';

/**
 * A fixed quantity can place fewer fixtures than requested (points inside keep-dim zones are dropped — core
 * behaviour, traced as "kept N out of keep-dim zones"): say so next to the field.
 */
export function quantityShortfall(intent: LightingIntent): string | undefined {
  const q = intent.behavior.quantity;
  const n = intent.fixtures.length;
  if (q === null || n >= q) return undefined;
  const keepDim = intent.trace.some((t) => /keep-dim/i.test(t));
  return `${q} requested · ${n} placed${keepDim ? ' (keep-dim zones)' : ''}`;
}
