// Golden data loader (tests only — uses node:fs). Maps golden quirks into model types:
// plane.kind 0/1/2 → "Horizontal" | "Vertical" | "Ceiling"; derived `length` / `direction` props are dropped by the
// zod schemas; null fixtures/trace (seeds) → []; derived room fields (spaceClass, …) are split off.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  LightingIntentSchema,
  PLANE_KINDS,
  StudioRoomSchema,
  WorkplaneSchema,
  type IntentEstimate,
  type LightingIntent,
  type P2,
  type StudioRoom,
  type TargetRange,
  type Workplane,
} from '../../src/index';

export const GOLDEN_ROOMS = ['Office', 'Cafeteria', 'Lobby', 'DataHall'] as const;
export type GoldenRoomName = (typeof GOLDEN_ROOMS)[number];

const GOLDEN_DIR = fileURLToPath(new URL('../../../../handoff/golden/', import.meta.url));

export function readGoldenFile<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(GOLDEN_DIR + file, 'utf8')) as T;
}

// ---- raw golden shapes (as dumped) ------------------------------------------------------------------------------

export interface GoldenPlane {
  kind: 0 | 1 | 2;
  height: number;
  bottom: number;
  top: number;
  inferred: boolean;
  reason: string;
}
export interface GoldenFixture {
  center: P2;
  orientation: number;
  mount: string;
  height: number;
  tilt: number;
  output: number;
  pinned: boolean;
}
export interface GoldenProduct {
  family: string;
  label: string;
  lumens: number;
  watts: number;
  beamAngle: number;
  isGeneric: boolean;
}
export interface GoldenIntent {
  index: number;
  kind: string;
  label: string;
  region: P2[];
  wallIndex: number | null;
  objectIndex: number | null;
  target: TargetRange;
  targetReason: string;
  plane: GoldenPlane;
  behavior: Record<string, unknown>;
  isSuggestion: boolean;
  product: GoldenProduct | null;
  fixtures: GoldenFixture[] | null;
  trace: string[] | null;
}
export interface GoldenCluster {
  group: string;
  ordinal: number;
  objects: number[];
  region: P2[];
}
export interface GoldenRoomRaw {
  spaceClass: string;
  spaceTypeWords: string;
  wallNames: string[];
  clusters: GoldenCluster[];
  [key: string]: unknown;
}
export interface GoldenAdvice {
  index: number;
  label: string;
  target: TargetRange;
  plane: GoldenPlane;
  reason: string;
}
export interface GoldenSolved {
  intent: GoldenIntent;
  estimate: IntentEstimate;
}
export interface GoldenProbe {
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  fc: number;
}
export interface GoldenInterpret {
  text: string;
  intents: GoldenIntent[];
}
export interface GoldenRoomFile {
  source: string;
  units: string;
  room: GoldenRoomRaw;
  seeds: GoldenIntent[];
  fallbackAdvice: GoldenAdvice[];
  solved: GoldenSolved[];
  power: { watts: number; lpdWPerFt2: number; floorAreaFt2: number };
  probes: GoldenProbe[];
  interpret: GoldenInterpret[];
}
export interface GoldenMisc {
  exponents: { beam: number; n: number }[];
  genericPackages: (GoldenProduct & {
    description: string;
    length: number;
    width: number;
    isRound: boolean;
    uplightShare: number;
    asymmetric: boolean;
    nominal: boolean;
  })[];
  feetInches: { feet: number; text: string }[];
  classFromWords: { text: string; cls: string }[];
}

const cache = new Map<string, unknown>();
function cached<T>(file: string): T {
  if (!cache.has(file)) cache.set(file, readGoldenFile(file));
  return cache.get(file) as T;
}
/** Raw golden file for a demo room (cached; do not mutate). */
export const loadGolden = (name: GoldenRoomName): GoldenRoomFile => cached<GoldenRoomFile>(`${name}.json`);
export const loadMisc = (): GoldenMisc => cached<GoldenMisc>('misc.json');

// ---- mapping into model types -------------------------------------------------------------------------------------

/** Golden room → StudioRoom (derived fields and `length`/`direction` dropped). */
export const goldenRoom = (name: GoldenRoomName): StudioRoom => StudioRoomSchema.parse(loadGolden(name).room);

/** The derived room fields golden carries (spaceClass, spaceTypeWords, wallNames, clusters). */
export interface GoldenRoomDerived {
  spaceClass: string;
  spaceTypeWords: string;
  wallNames: string[];
  clusters: GoldenCluster[];
}
export function goldenRoomDerived(name: GoldenRoomName): GoldenRoomDerived {
  const r = loadGolden(name).room;
  return { spaceClass: r.spaceClass, spaceTypeWords: r.spaceTypeWords, wallNames: r.wallNames, clusters: r.clusters };
}

export function goldenPlane(p: GoldenPlane): Workplane {
  const kind = PLANE_KINDS[p.kind];
  if (kind === undefined) throw new Error(`bad golden plane kind ${String(p.kind)}`);
  return WorkplaneSchema.parse({ ...p, kind });
}

const hexIndex = (i: number, width: number): string => i.toString(16).padStart(width, '0');

/**
 * Golden intent → LightingIntent. Ids are synthetic (golden has none): intent `0000000{index}`, fixtures
 * `00000000-0000-4000-8000-{index}`. `product` is set to null — use `raw.product` (a projection) for comparisons.
 */
export function goldenIntent(raw: GoldenIntent): LightingIntent {
  const id = hexIndex(raw.index, 8);
  return LightingIntentSchema.parse({
    id,
    kind: raw.kind,
    label: raw.label,
    region: raw.region,
    wallIndex: raw.wallIndex,
    objectIndex: raw.objectIndex,
    target: raw.target,
    targetReason: raw.targetReason,
    plane: goldenPlane(raw.plane),
    behavior: raw.behavior,
    isSuggestion: raw.isSuggestion,
    product: null,
    fixtures: (raw.fixtures ?? []).map((f, i) => ({
      ...f,
      id: `00000000-0000-4000-8000-${hexIndex(i, 12)}`,
      intentId: id,
    })),
    trace: raw.trace ?? [],
  });
}
