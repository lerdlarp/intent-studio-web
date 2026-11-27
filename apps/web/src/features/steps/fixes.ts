// One-tap fixes for a zone that misses its target, from the estimate: a fixture count that would reach the average
// (linear in count, so it is a nudge, not a calculation the solver trusts) and a brighter or dimmer luminaire from the
// zone's own options. The solver still lays the fixtures out; every number stays an estimate.
import { productKey, type IntentEstimate, type LightingIntent, type StudioProduct } from '@intent-studio/core';
import type { ProductOptions } from '../inspector/productOptions';
import { estimateStatus } from '../inspector/estimateStatus';

export type ZoneFix =
  | { kind: 'quantity'; label: string; quantity: number }
  | { kind: 'product'; label: string; product: StudioProduct };

export function zoneFixes(
  intent: LightingIntent,
  estimate: IntentEstimate | undefined,
  opts: ProductOptions,
  current: StudioProduct,
): ZoneFix[] {
  if (!estimate || intent.kind === 'KeepDim') return [];
  const { status } = estimateStatus(intent.target, estimate);
  if (status !== 'Under' && status !== 'Over') return [];
  const out: ZoneFix[] = [];
  const n = intent.fixtures.length;
  const goal = intent.target.average ?? intent.target.minimum ?? intent.target.maximum;
  if (n > 0 && goal != null && estimate.average > 0) {
    const want = Math.max(1, Math.round((n * goal) / estimate.average));
    if (status === 'Under' && want > n)
      out.push({ kind: 'quantity', label: `Add ${want - n} fixture${want - n === 1 ? '' : 's'}`, quantity: want });
    if (status === 'Over' && want < n)
      out.push({ kind: 'quantity', label: `Remove ${n - want} fixture${n - want === 1 ? '' : 's'}`, quantity: want });
  }
  const here = productKey(current);
  const all = opts.groups.flatMap((g) => g.options).filter((o) => o.key !== here && o.product.lumens > 0);
  const pick =
    status === 'Under'
      ? all.filter((o) => o.product.lumens > current.lumens * 1.1).sort((a, b) => a.product.lumens - b.product.lumens)[0]
      : all.filter((o) => o.product.lumens < current.lumens * 0.9).sort((a, b) => b.product.lumens - a.product.lumens)[0];
  if (pick) out.push({ kind: 'product', label: status === 'Under' ? 'Brighter type' : 'Dimmer type', product: pick.product });
  return out;
}
