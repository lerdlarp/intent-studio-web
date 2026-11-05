// Product switcher options for one intent: core `rank` (project products first, then the generic stand-in) grouped as
// "Project products" and "Generic", each with a reason line. Choosing one sets a designer product (setProduct);
// "Automatic" (null) lets the solver pick the package of the generic family. Pure.
import {
  genericFor,
  packagesOf,
  productInProject,
  productKey,
  productOf,
  rank,
  type LightingIntent,
  type StudioProduct,
  type StudioRoom,
} from '@intent-studio/core';

export interface ProductOption {
  key: string;
  product: StudioProduct;
  reason: string;
  /** The ranker's pick for this intent. */
  best: boolean;
}

export interface ProductGroup {
  label: 'Project products' | 'Generic';
  options: ProductOption[];
}

export interface ProductOptions {
  groups: ProductGroup[];
  /** Key of the designer's choice, or null when the choice is automatic. */
  chosenKey: string | null;
  /** What "Automatic" resolves to right now (the solver's settled package or the generic default). */
  automatic: StudioProduct;
  automaticReason: string;
}

const describeProduct = (p: StudioProduct): string =>
  `${productInProject(p) ? 'In your project' : 'Generic stand-in'} · ${p.description || p.label}`;

/** A designer choice (agentPicked false) is a fixed product; agent / solver picks count as automatic. */
export const isDesignerChoice = (i: LightingIntent): boolean => i.product !== null && !i.product.agentPicked;

export function productOptions(room: StudioRoom, intent: LightingIntent, project?: readonly StudioProduct[]): ProductOptions {
  const ranked = rank(room, intent, project);
  const bestKey = productKey(ranked.product);
  const seen = new Set<string>();
  const projectOpts: ProductOption[] = [];
  const genericOpts: ProductOption[] = [];
  const add = (p: StudioProduct) => {
    const key = productKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    const o: ProductOption = { key, product: p, reason: key === bestKey ? ranked.reason : describeProduct(p), best: key === bestKey };
    (p.isGeneric || !productInProject(p) ? genericOpts : projectOpts).push(o);
  };
  add(ranked.product);
  for (const p of ranked.alternatives) add(p);
  for (const p of packagesOf(genericFor(intent.kind, room))) add(p);
  const chosen = isDesignerChoice(intent) ? intent.product!.product : null;
  if (chosen) add(chosen);
  const familyOrder = new Map<string, number>();
  for (const o of genericOpts) if (!familyOrder.has(o.product.family)) familyOrder.set(o.product.family, familyOrder.size);
  genericOpts.sort(
    (a, b) => familyOrder.get(a.product.family)! - familyOrder.get(b.product.family)! || a.product.lumens - b.product.lumens,
  );

  const automatic = chosen ? genericFor(intent.kind, room) : productOf(room, intent);
  const automaticReason =
    !chosen && intent.product?.reason
      ? intent.product.reason
      : `${describeProduct(automatic)}; the solver steps between this family's lumen packages to land on the target`;
  const groups: ProductGroup[] = [];
  if (projectOpts.length) groups.push({ label: 'Project products', options: projectOpts });
  if (genericOpts.length) groups.push({ label: 'Generic', options: genericOpts });
  return { groups, chosenKey: chosen ? productKey(chosen) : null, automatic, automaticReason };
}

export const findOption = (o: ProductOptions, key: string): ProductOption | undefined =>
  o.groups.flatMap((g) => g.options).find((x) => x.key === key);
