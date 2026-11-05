// Generic luminaire families, lumen packages, per-kind defaults, the demo project and the settled-package cache
// (spec/products.md). Pure; no Node/DOM APIs.
import { format0 } from './format';
import { stableId } from './hash';
import { classOf } from './defaults';
import {
  createProduct,
  type IntentKind,
  type LightingIntent,
  type StudioProduct,
  type StudioRoom,
  type TargetRange,
} from './model';

/** Generic family ids in table order. */
export const FAMILY_IDS = [
  'volumetric',
  'troffer',
  'downlight',
  'downlight-ho',
  'wallwash',
  'accent',
  'pendant-linear',
  'pendant-can',
  'cove',
  'strip',
  'step',
] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

interface FamilyDef {
  readonly id: FamilyId;
  readonly label: string;
  readonly noun: string;
  readonly length: number;
  readonly width: number;
  readonly round: boolean;
  readonly beam: number;
  readonly up: number;
  readonly asym: boolean;
  readonly nominalIndex: number;
  readonly packages: readonly (readonly [number, number])[];
}

const FAMILIES: readonly FamilyDef[] = [
  { id: 'volumetric', label: '2×2 volumetric troffer', noun: '2×2 recessed volumetric troffer', length: 2, width: 2, round: false, beam: 120, up: 0.02, asym: false, nominalIndex: 2, packages: [[1500, 13], [2000, 17], [3000, 25], [4000, 33], [5000, 42]] },
  { id: 'troffer', label: '2×4 troffer', noun: '2×4 recessed troffer', length: 4, width: 2, round: false, beam: 120, up: 0.02, asym: false, nominalIndex: 1, packages: [[3000, 25], [4000, 33], [5000, 42], [6000, 50]] },
  { id: 'downlight', label: '6″ downlight', noun: '6 inch recessed downlight', length: 0.65, width: 0.65, round: true, beam: 60, up: 0, asym: false, nominalIndex: 1, packages: [[800, 8], [1500, 14], [2500, 23]] },
  { id: 'downlight-ho', label: '4″ high-output downlight', noun: '4 inch high-output recessed downlight', length: 0.45, width: 0.45, round: true, beam: 40, up: 0, asym: false, nominalIndex: 3, packages: [[650, 6], [1000, 9], [1800, 15], [2500, 20], [3500, 28]] },
  { id: 'wallwash', label: '6″ wall washer', noun: '6 inch recessed asymmetric wall washer', length: 0.65, width: 0.65, round: true, beam: 100, up: 0, asym: true, nominalIndex: 1, packages: [[600, 6], [1000, 10], [1500, 14], [2200, 21]] },
  { id: 'accent', label: '4″ adjustable accent', noun: '4 inch adjustable accent', length: 0.4, width: 0.4, round: true, beam: 25, up: 0, asym: false, nominalIndex: 2, packages: [[450, 5], [700, 7], [1000, 10], [1500, 15]] },
  { id: 'pendant-linear', label: '4 ft pendant linear, direct/indirect', noun: '4 ft suspended linear, 40% uplight', length: 4, width: 0.35, round: false, beam: 110, up: 0.4, asym: false, nominalIndex: 2, packages: [[2000, 17], [3000, 25], [4000, 32]] },
  { id: 'pendant-can', label: 'Pendant can', noun: 'Cylinder pendant', length: 0.8, width: 0.8, round: true, beam: 60, up: 0, asym: false, nominalIndex: 2, packages: [[600, 7], [1000, 11], [1800, 18], [2800, 28]] },
  { id: 'cove', label: 'Cove linear, per 4 ft', noun: 'Cove linear per 4 ft, all light up', length: 4, width: 0.3, round: false, beam: 180, up: 1, asym: false, nominalIndex: 1, packages: [[800, 7], [1600, 14], [2400, 21]] },
  { id: 'strip', label: '4 ft strip / linear high bay', noun: '4 ft linear strip, chain hung', length: 4, width: 0.4, round: false, beam: 110, up: 0.05, asym: false, nominalIndex: 1, packages: [[2500, 20], [4000, 30], [5500, 42]] },
  { id: 'step', label: 'Step / path light', noun: 'Low-level step or path light', length: 0.45, width: 0.3, round: false, beam: 90, up: 0, asym: false, nominalIndex: 1, packages: [[150, 2], [300, 4], [500, 6]] },
];

function buildPackage(f: FamilyDef, lumens: number, watts: number): StudioProduct {
  const beamSuffix = f.round && f.beam > 0 && f.beam < 170 ? `, ${format0(f.beam)}° beam` : '';
  return createProduct({
    label: `${f.label} · ${format0(lumens)} lm`,
    description: `${f.noun}, ${format0(lumens)} lm, ${format0(watts)} W${beamSuffix}`,
    catalog: 'Generic',
    brand: 'Generic',
    family: f.id,
    lumens,
    watts,
    length: f.length,
    width: f.width,
    isRound: f.round,
    beamAngle: f.beam,
    uplightShare: f.up,
    asymmetric: f.asym,
    isGeneric: true,
  });
}

const PACKAGES_BY_FAMILY: ReadonlyMap<string, readonly StudioProduct[]> = new Map(
  FAMILIES.map((f) => [f.id, f.packages.map(([lm, w]) => buildPackage(f, lm, w))] as const),
);
const NOMINAL_LUMENS: ReadonlyMap<string, number> = new Map(
  FAMILIES.map((f) => [f.id, f.packages[f.nominalIndex]![0]] as const),
);

/** Case-insensitive (ordinal) family id lookup; null when not one of the eleven. */
export function familyIdOf(family: string | null | undefined): FamilyId | null {
  const lower = (family ?? '').toLowerCase();
  return (FAMILY_IDS as readonly string[]).includes(lower) ? (lower as FamilyId) : null;
}

/** The family's package products ascending by lumens; unknown/empty family → []. */
export function packages(family: string | null | undefined): readonly StudioProduct[] {
  const id = familyIdOf(family);
  return id === null ? [] : (PACKAGES_BY_FAMILY.get(id) ?? []);
}

/** The nominal package of each family (11 items, table order). */
export const all: readonly StudioProduct[] = FAMILIES.map(
  (f) => PACKAGES_BY_FAMILY.get(f.id)![f.nominalIndex]!,
);

/** Every package of every family (41 items), table order then ascending lumens. */
export const allPackages: readonly StudioProduct[] = FAMILIES.flatMap((f) => PACKAGES_BY_FAMILY.get(f.id)!);

/** Named nominal accessors. */
const nominal = (id: FamilyId): StudioProduct => all[FAMILY_IDS.indexOf(id)]!;
export const volumetric2x2 = (): StudioProduct => nominal('volumetric');
export const troffer2x4 = (): StudioProduct => nominal('troffer');
export const downlight6 = (): StudioProduct => nominal('downlight');
export const downlightHighOutput4 = (): StudioProduct => nominal('downlight-ho');
export const wallWasher6 = (): StudioProduct => nominal('wallwash');
export const accent4 = (): StudioProduct => nominal('accent');
export const pendantLinear4 = (): StudioProduct => nominal('pendant-linear');
export const pendantCan = (): StudioProduct => nominal('pendant-can');
export const coveLinear4 = (): StudioProduct => nominal('cove');
export const stripHighBay4 = (): StudioProduct => nominal('strip');
export const stepLight = (): StudioProduct => nominal('step');

/** True when the package is its family's nominal. */
export function isNominal(p: StudioProduct): boolean {
  return p.isGeneric && NOMINAL_LUMENS.get(p.family.toLowerCase()) === p.lumens;
}

/** The first nominal whose family equals the argument (case-insensitive), else null. */
export function byFamily(family: string | null | undefined): StudioProduct | null {
  const id = familyIdOf(family);
  return id === null ? null : nominal(id);
}

// ---------------------------------------------------------------------------------------------------------------
// Demo project

let projectCache: readonly StudioProduct[] | null = null;
let projectByFamily: Map<string, StudioProduct[]> | null = null;

/** The 41 generic packages presented as project schedule types; computed once. Nominal first, then ascending. */
export function asProject(): readonly StudioProduct[] {
  if (projectCache === null) {
    const out: StudioProduct[] = [];
    for (const f of FAMILIES) {
      const pk = PACKAGES_BY_FAMILY.get(f.id)!;
      const nom = pk[f.nominalIndex]!;
      const ordered = [nom, ...pk.filter((p) => p !== nom)];
      for (const p of ordered) {
        out.push({
          ...p,
          productId: p === nom ? stableId(f.id) : stableId(`${f.id}:${format0(p.lumens)}`),
          isGeneric: false,
          catalog: 'DEMO-' + f.id.toUpperCase(),
          brand: 'Demo',
        });
      }
    }
    projectCache = out;
    projectByFamily = new Map();
    for (const f of FAMILIES) {
      projectByFamily.set(
        f.id,
        out.filter((p) => p.family === f.id).sort((a, b) => a.lumens - b.lumens),
      );
    }
  }
  return projectCache;
}

function demoFamily(family: string | null | undefined): readonly StudioProduct[] {
  asProject();
  const id = familyIdOf(family);
  return id === null ? [] : (projectByFamily!.get(id) ?? []);
}

/** Lumen packages standing beside a product (itself included), ascending by lumens. */
export function packagesOf(p: StudioProduct): readonly StudioProduct[] {
  if (familyIdOf(p.family) === null) return [];
  if (p.isGeneric && p.productId === null) return packages(p.family);
  if (p.productId !== null && !p.isGeneric && p.brand === 'Demo' && p.catalog.startsWith('DEMO-')) {
    return demoFamily(p.family);
  }
  return [];
}

export const isPackaged = (p: StudioProduct): boolean => packagesOf(p).length > 1;

/** The demo-project twin of a generic package (same family, |Δlumens| < 0.5), else `p`. */
export function asProjectProduct(p: StudioProduct): StudioProduct {
  const match = demoFamily(p.family).find((d) => Math.abs(d.lumens - p.lumens) < 0.5);
  return match ?? p;
}

// ---------------------------------------------------------------------------------------------------------------
// Default family per kind

/** The default generic stand-in (a nominal package) for an intent kind in a room. */
export function genericFor(kind: IntentKind, room: StudioRoom): StudioProduct {
  const cls = classOf(room);
  const open = cls === 'DataHall';
  let id: FamilyId;
  switch (kind) {
    case 'Ambient':
      id = open ? 'strip' : room.ceilingGrid !== null ? 'volumetric' : room.ceilingHeight > 12 ? 'downlight-ho' : 'downlight';
      break;
    case 'Task':
      id = open ? 'strip' : cls === 'Office' || cls === 'OpenOffice' ? 'pendant-linear' : 'downlight';
      break;
    case 'WallWash':
      id = 'wallwash';
      break;
    case 'Accent':
      id = 'accent';
      break;
    case 'FeaturePendant':
      id = 'pendant-can';
      break;
    case 'CeilingGlow':
      id = 'cove';
      break;
    case 'Path':
      id = open ? 'strip' : 'downlight-ho';
      break;
    default:
      id = 'downlight';
  }
  return nominal(id);
}

// ---------------------------------------------------------------------------------------------------------------
// Settled-package cache

const settled = new WeakMap<LightingIntent, StudioProduct>();

/** Remember the package the solver settled on (keyed by intent identity); `null`/undefined deletes. */
export function rememberPackage(intent: LightingIntent, pkg: StudioProduct | null | undefined): void {
  if (pkg) settled.set(intent, pkg);
  else settled.delete(intent);
}

/** Choice product, else the remembered package, else the generic default. */
export function productOf(room: StudioRoom, intent: LightingIntent): StudioProduct {
  return intent.product?.product ?? settled.get(intent) ?? genericFor(intent.kind, room);
}

// ---------------------------------------------------------------------------------------------------------------
// Inspector status (proposal in products.md "Ambiguities"; adopted per PROGRESS.md)

export type TargetStatus = 'Under' | 'Meets' | 'Over';

/**
 * Under if min set and avg < min·0.98 (or only an average target and avg < average·0.9); Over if max set and
 * avg > max·1.02; else Meets.
 */
export function targetStatus(target: TargetRange, average: number): TargetStatus {
  if (target.minimum !== null) {
    if (average < target.minimum * 0.98) return 'Under';
  } else if (target.average !== null && average < target.average * 0.9) return 'Under';
  if (target.maximum !== null && average > target.maximum * 1.02) return 'Over';
  return 'Meets';
}
