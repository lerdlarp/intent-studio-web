// The Intent Studio domain model (spec/model.md): zod schemas are the single source of truth for the wire format;
// TS types are inferred from them. Units: feet and footcandles. Plan X/Y with +Y north, Z up from the floor.
//
// Schemas fill model defaults for missing fields (so a parsed draft or AI payload gets e.g. labelSuggested = true),
// and strip unknown properties (so golden's derived `length` / `direction` are ignored).
import { z } from 'zod';
import { format0 } from './format';

/** Version of the persisted design document format. */
export const SCHEMA_VERSION = 1 as const;

const finite = () => z.number().finite();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UuidSchema = z.string().regex(UUID_RE, 'expected a uuid (8-4-4-4-12 hex)');
export type Uuid = z.infer<typeof UuidSchema>;
/** The all-zero uuid (the default room id). */
export const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------------------------------------------
// §1 P2

export const P2Schema = z.object({ x: finite(), y: finite() });
/** Plan point / 2-D vector in feet. */
export type P2 = z.infer<typeof P2Schema>;
export const p2 = (x: number, y: number): P2 => ({ x, y });
/** Value equality (both coordinates exactly equal). */
export const p2Equals = (a: P2, b: P2): boolean => a.x === b.x && a.y === b.y;
/** Derived √(x² + y²) (golden writes it as `length`). */
export const p2Length = (a: P2): number => Math.sqrt(a.x * a.x + a.y * a.y);

/** 3-D point (calculation snapshots). */
export const P3Schema = z.object({ x: finite(), y: finite(), z: finite() });
export type P3 = z.infer<typeof P3Schema>;

// ---------------------------------------------------------------------------------------------------------------
// §2 Enumerations

/** Intent kinds in numeric order 0..7 (the order matters). */
export const INTENT_KINDS = [
  'Task',
  'Ambient',
  'WallWash',
  'Accent',
  'FeaturePendant',
  'CeilingGlow',
  'Path',
  'KeepDim',
] as const;
export const IntentKindSchema = z.enum(INTENT_KINDS);
export type IntentKind = z.infer<typeof IntentKindSchema>;
/** Numeric value of a kind (0..7). */
export const intentKindIndex = (kind: IntentKind): number => INTENT_KINDS.indexOf(kind);

/** Display name and ink colour per kind (`IntentInk`). */
export const INTENT_INK: Readonly<Record<IntentKind, { readonly name: string; readonly color: string }>> = {
  Task: { name: 'Task', color: '#E08A1E' },
  Ambient: { name: 'Ambient', color: '#3B82C4' },
  WallWash: { name: 'Wall wash', color: '#8B5CD6' },
  Accent: { name: 'Accent', color: '#D94C7A' },
  FeaturePendant: { name: 'Feature pendants', color: '#1F9E8F' },
  CeilingGlow: { name: 'Ceiling glow', color: '#C9A227' },
  Path: { name: 'Path', color: '#5E9E3A' },
  KeepDim: { name: 'Keep dim', color: '#6B7280' },
};
export const intentInkName = (kind: IntentKind): string => INTENT_INK[kind].name;
export const intentInkColor = (kind: IntentKind): string => INTENT_INK[kind].color;

/** Plane kinds in numeric order (golden writes plane.kind as 0/1/2). */
export const PLANE_KINDS = ['Horizontal', 'Vertical', 'Ceiling'] as const;
export const PlaneKindSchema = z.enum(PLANE_KINDS);
export type PlaneKind = z.infer<typeof PlaneKindSchema>;

/** Space classes in declaration order. Display names live in defaults.ts. */
export const SPACE_CLASSES = [
  'Other',
  'Office',
  'OpenOffice',
  'Conference',
  'Classroom',
  'Cafeteria',
  'Lobby',
  'Corridor',
  'DataHall',
  'Retail',
  'Restroom',
  'Storage',
  'BreakRoom',
] as const;
export const SpaceClassSchema = z.enum(SPACE_CLASSES);
export type SpaceClass = z.infer<typeof SpaceClassSchema>;

/** Canvas tools, numeric 0..8. */
export const STUDIO_TOOLS = [
  'Select',
  'Task',
  'Ambient',
  'WallWash',
  'Accent',
  'FeaturePendant',
  'CeilingGlow',
  'Path',
  'KeepDim',
] as const;
export const StudioToolSchema = z.enum(STUDIO_TOOLS);
export type StudioTool = z.infer<typeof StudioToolSchema>;
/** Tool → kind: null for Select, else the kind numbered tool − 1. */
export function toolToKind(tool: StudioTool): IntentKind | null {
  const i = STUDIO_TOOLS.indexOf(tool);
  return i <= 0 ? null : (INTENT_KINDS[i - 1] ?? null);
}
/** Kind → tool numbered kind + 1. */
export function kindToTool(kind: IntentKind): StudioTool {
  return STUDIO_TOOLS[intentKindIndex(kind) + 1] as StudioTool;
}

export const OVERLAY_MODES = ['Design', 'Heatmap'] as const;
export const OverlayModeSchema = z.enum(OVERLAY_MODES);
export type OverlayMode = z.infer<typeof OverlayModeSchema>;
export const VIEW_MODES = ['Plan', 'Room3D'] as const;
export const ViewModeSchema = z.enum(VIEW_MODES);
export type ViewMode = z.infer<typeof ViewModeSchema>;

/** Known mount strings (`LayoutMount`). Mount fields stay free strings on the wire. */
export const MOUNTS = ['ceiling', 'pendant', 'wall', 'cove', 'feature'] as const;
export type Mount = (typeof MOUNTS)[number];
export const DEFAULT_MOUNT: Mount = 'ceiling';

/** Layout patterns for IntentBehavior.pattern. */
export const PATTERNS = ['grid', 'staggered', 'rows', 'perimeter'] as const;
export const PatternSchema = z.enum(PATTERNS);
export type Pattern = z.infer<typeof PatternSchema>;

/** Colour temperatures (K) the web version offers (PLAN §3). */
export const CCT_VALUES = [2700, 3000, 3500, 4000, 5000] as const;
export const CctSchema = z.union([z.literal(2700), z.literal(3000), z.literal(3500), z.literal(4000), z.literal(5000)]);
export type Cct = z.infer<typeof CctSchema>;

// ---------------------------------------------------------------------------------------------------------------
// §3 TargetRange

export const TargetRangeSchema = z.object({
  minimum: finite().nullable().default(null),
  average: finite().nullable().default(null),
  maximum: finite().nullable().default(null),
});
/** Footcandle range; a null bound imposes nothing. */
export type TargetRange = z.infer<typeof TargetRangeSchema>;
export const targetRange = (minimum: number | null, average: number | null, maximum: number | null): TargetRange => ({
  minimum,
  average,
  maximum,
});
export const emptyTarget = (): TargetRange => targetRange(null, null, null);
export const isEmptyTarget = (t: TargetRange): boolean =>
  t.minimum === null && t.average === null && t.maximum === null;
export const targetEquals = (a: TargetRange, b: TargetRange): boolean =>
  a.minimum === b.minimum && a.average === b.average && a.maximum === b.maximum;
/**
 * True when measured values satisfy every set bound: minimum ≥ min·0.98, average ≥ avg·0.9, and the measured
 * **average** ≤ max·1.02. Inclusive.
 */
export function targetMeets(range: TargetRange, average: number, minimum: number): boolean {
  if (range.minimum !== null && !(minimum >= range.minimum * 0.98)) return false;
  if (range.average !== null && !(average >= range.average * 0.9)) return false;
  if (range.maximum !== null && !(average <= range.maximum * 1.02)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// §4 Workplane

export const WorkplaneSchema = z.object({
  kind: PlaneKindSchema,
  height: finite(),
  bottom: finite().default(0),
  top: finite().default(0),
  inferred: z.boolean().default(true),
  reason: z.string().default(''),
});
export type Workplane = z.infer<typeof WorkplaneSchema>;
/** Default plane of a new intent: {Horizontal, 2.5, 0, 0, true, ""}. */
export const defaultPlane = (): Workplane => ({
  kind: 'Horizontal',
  height: 2.5,
  bottom: 0,
  top: 0,
  inferred: true,
  reason: '',
});
export const planeEquals = (a: Workplane, b: Workplane): boolean =>
  a.kind === b.kind &&
  a.height === b.height &&
  a.bottom === b.bottom &&
  a.top === b.top &&
  a.inferred === b.inferred &&
  a.reason === b.reason;

// ---------------------------------------------------------------------------------------------------------------
// §5 IntentBehavior

export const IntentBehaviorSchema = z.object({
  /** Spacing multiplier, documented 0.6..1.6; not clamped here (consumers clamp). */
  density: finite().default(1),
  pattern: PatternSchema.nullable().default(null),
  alignToCeilingGrid: z.boolean().default(true),
  avoidCeilingDevices: z.boolean().default(true),
  wallOffset: finite().nullable().default(null),
  aimAngle: finite().nullable().default(null),
  mountingHeight: finite().nullable().default(null),
  quantity: z.number().int().nullable().default(null),
  keepDimMargin: finite().nullable().default(null),
  /** Web addition: colour temperature preference; absent = agent decides. (null on the wire reads as absent.) */
  cct: CctSchema.nullish().transform((v) => v ?? undefined),
  /** Web addition: preferred beam angle (degrees); filters/ranks products only. */
  beamAngle: finite()
    .positive()
    .nullish()
    .transform((v) => v ?? undefined),
});
export type IntentBehavior = z.infer<typeof IntentBehaviorSchema>;
export const defaultBehavior = (): IntentBehavior => ({
  density: 1,
  pattern: null,
  alignToCeilingGrid: true,
  avoidCeilingDevices: true,
  wallOffset: null,
  aimAngle: null,
  mountingHeight: null,
  quantity: null,
  keepDimMargin: null,
});
/** Value equality (optional web fields compare absent == absent). */
export const behaviorEquals = (a: IntentBehavior, b: IntentBehavior): boolean =>
  a.density === b.density &&
  a.pattern === b.pattern &&
  a.alignToCeilingGrid === b.alignToCeilingGrid &&
  a.avoidCeilingDevices === b.avoidCeilingDevices &&
  a.wallOffset === b.wallOffset &&
  a.aimAngle === b.aimAngle &&
  a.mountingHeight === b.mountingHeight &&
  a.quantity === b.quantity &&
  a.keepDimMargin === b.keepDimMargin &&
  a.cct === b.cct &&
  a.beamAngle === b.beamAngle;

// ---------------------------------------------------------------------------------------------------------------
// §6 StudioProduct, §7 ProductChoice

// TODO(ies.ts): replace with the parsed IES LM-63 schema once packages/core/src/ies.ts exists.
export const IesDataSchema = z.record(z.unknown());
export type IesData = z.infer<typeof IesDataSchema>;

export const StudioProductSchema = z.object({
  productId: UuidSchema.nullable().default(null),
  label: z.string().default(''),
  catalog: z.string().default(''),
  brand: z.string().default(''),
  description: z.string().default(''),
  family: z.string().default(''),
  lumens: finite().default(0),
  watts: finite().default(0),
  length: finite().default(1),
  width: finite().default(1),
  isRound: z.boolean().default(false),
  beamAngle: finite().default(90),
  uplightShare: finite().default(0),
  asymmetric: z.boolean().default(false),
  isGeneric: z.boolean().default(false),
  /** Web addition: parsed IES photometry for uploaded products (opaque until ies.ts lands). */
  ies: IesDataSchema.optional(),
});
export type StudioProduct = z.infer<typeof StudioProductSchema>;
export function createProduct(init: Partial<StudioProduct> = {}): StudioProduct {
  return {
    productId: null,
    label: '',
    catalog: '',
    brand: '',
    description: '',
    family: '',
    lumens: 0,
    watts: 0,
    length: 1,
    width: 1,
    isRound: false,
    beamAngle: 90,
    uplightShare: 0,
    asymmetric: false,
    isGeneric: false,
    ...init,
  };
}
/** The product is in the project when it has a productId. */
export const productInProject = (p: StudioProduct): boolean => p.productId !== null;
/** `productId` (lowercase) when in the project, else `generic:{family}:{lumens formatted "0"}`. */
export const productKey = (p: StudioProduct): string =>
  p.productId !== null ? p.productId.toLowerCase() : `generic:${p.family}:${format0(p.lumens)}`;

export const ProductChoiceSchema = z.object({
  product: StudioProductSchema,
  agentPicked: z.boolean().default(false),
  reason: z.string().default(''),
  /** Rebuilt on demand; never persisted. */
  alternatives: z.array(StudioProductSchema).default([]),
});
export type ProductChoice = z.infer<typeof ProductChoiceSchema>;

// ---------------------------------------------------------------------------------------------------------------
// §8 StudioFixture, §9 ExistingFixture

export const StudioFixtureSchema = z.object({
  id: UuidSchema,
  intentId: z.string().default(''),
  center: P2Schema.default({ x: 0, y: 0 }),
  orientation: finite().default(0),
  mount: z.string().default(DEFAULT_MOUNT),
  height: finite().default(0),
  tilt: finite().default(0),
  /** Invariant: always 1 (fixtures are never dimmed). */
  output: finite().default(1),
  pinned: z.boolean().default(false),
});
export type StudioFixture = z.infer<typeof StudioFixtureSchema>;
export function createFixture(init: Partial<StudioFixture> = {}): StudioFixture {
  return {
    id: newUuid(),
    intentId: '',
    center: { x: 0, y: 0 },
    orientation: 0,
    mount: DEFAULT_MOUNT,
    height: 0,
    tilt: 0,
    output: 1,
    pinned: false,
    ...init,
  };
}

export const ExistingFixtureSchema = z.object({
  id: UuidSchema,
  productId: UuidSchema,
  label: z.string(),
  center: P2Schema,
  orientation: finite(),
  length: finite(),
  width: finite(),
  isRound: z.boolean(),
  mount: z.string(),
  height: finite(),
  calculable: z.boolean(),
});
export type ExistingFixture = z.infer<typeof ExistingFixtureSchema>;

// ---------------------------------------------------------------------------------------------------------------
// §10 LightingIntent

export const IntentIdSchema = z.string().min(1);

export const LightingIntentSchema = z.object({
  id: IntentIdSchema,
  kind: IntentKindSchema.default('Task'),
  label: z.string().default(''),
  /** True while the label came from the agent/defaults; editing it makes it the designer's. */
  labelSuggested: z.boolean().default(true),
  /** Polygon (area kinds), 2-point wash run (WallWash) or single point (Accent). */
  region: z.array(P2Schema).default([]),
  wallIndex: z.number().int().nullable().default(null),
  objectIndex: z.number().int().nullable().default(null),
  target: TargetRangeSchema.default({}),
  targetReason: z.string().default(''),
  /** Web addition: the designer typed the target or its reason; advice never overwrites it. */
  targetEdited: z.boolean().default(false),
  plane: WorkplaneSchema.default(defaultPlane()),
  behavior: IntentBehaviorSchema.default({}),
  product: ProductChoiceSchema.nullable().default(null),
  fixtures: z.array(StudioFixtureSchema).default([]),
  isSuggestion: z.boolean().default(false),
  handTuned: z.boolean().default(false),
  trace: z.array(z.string()).default([]),
});
export type LightingIntent = z.infer<typeof LightingIntentSchema>;
export function createIntent(init: Partial<LightingIntent> = {}): LightingIntent {
  return {
    id: newIntentId(),
    kind: 'Task',
    label: '',
    labelSuggested: true,
    region: [],
    wallIndex: null,
    objectIndex: null,
    target: emptyTarget(),
    targetReason: '',
    targetEdited: false,
    plane: defaultPlane(),
    behavior: defaultBehavior(),
    product: null,
    fixtures: [],
    isSuggestion: false,
    handTuned: false,
    trace: [],
    ...init,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// §11 Room geometry records

export const RoomObjectInfoSchema = z.object({
  name: z.string(),
  /** Free text; compare after trim + lowercase. */
  kind: z.string(),
  center: P2Schema,
  /** Along `orientation`. */
  length: finite(),
  /** Across. */
  width: finite(),
  orientation: finite(),
  top: finite().nullable(),
  bottom: finite().nullable(),
});
export type RoomObjectInfo = z.infer<typeof RoomObjectInfoSchema>;

/** Surface kinds (objects with a working surface). */
export const SURFACE_KINDS = ['desk', 'table', 'counter', 'reception', 'island', 'bar'] as const;
/** Face kinds (objects seen on their face). */
export const FACE_KINDS = ['artwork', 'display', 'signage', 'mirror', 'screen'] as const;
/** Every object kind word the rules know. */
export const OBJECT_KINDS = [
  ...SURFACE_KINDS,
  ...FACE_KINDS,
  'cabinet',
  'seating',
  'door',
  'appliance',
  'other',
] as const;

export const CeilingZoneInfoSchema = z.object({
  height: finite(),
  isMain: z.boolean(),
  /** First loop = outer boundary, the rest are holes. */
  loops: z.array(z.array(P2Schema)),
});
export type CeilingZoneInfo = z.infer<typeof CeilingZoneInfoSchema>;

export const CeilingStepInfoSchema = z.object({
  start: P2Schema,
  end: P2Schema,
  lowerHeight: finite(),
  upperHeight: finite(),
});
export type CeilingStepInfo = z.infer<typeof CeilingStepInfoSchema>;

export const WallOpeningSchema = z.object({
  kind: z.string(),
  /** Distance along the wall from its start; from ≤ to. */
  from: finite(),
  to: finite(),
  bottom: finite(),
  top: finite(),
});
export type WallOpening = z.infer<typeof WallOpeningSchema>;

export const LayoutCeilingGridSchema = z.object({ origin: P2Schema, u: P2Schema, v: P2Schema });
export type LayoutCeilingGrid = z.infer<typeof LayoutCeilingGridSchema>;

export const WallInfoSchema = z.object({
  index: z.number().int(),
  start: P2Schema,
  end: P2Schema,
  /** Unit normal pointing into the room. */
  inward: P2Schema,
  /** ≤ 0 means unknown → use the room ceiling height. */
  top: finite(),
  openings: z.array(WallOpeningSchema).default([]),
});
export type WallInfo = z.infer<typeof WallInfoSchema>;
/** |end − start|. */
export const wallLength = (w: WallInfo): number => p2Length({ x: w.end.x - w.start.x, y: w.end.y - w.start.y });
/** (end − start) / max(length, 1e-9); a zero-length wall gives (0, 0) (unlike geometry `unit`). */
export function wallDirection(w: WallInfo): P2 {
  const k = 1 / Math.max(wallLength(w), 1e-9);
  return { x: (w.end.x - w.start.x) * k, y: (w.end.y - w.start.y) * k };
}

export const StudioRoomSchema = z.object({
  id: UuidSchema.default(EMPTY_UUID),
  label: z.string().default(''),
  spaceType: z.string().default(''),
  /** Loop 0 = outer boundary, others = holes. */
  floor: z.array(z.array(P2Schema)).default([]),
  walls: z.array(WallInfoSchema).default([]),
  ceilingHeight: finite().default(9),
  ceilingZones: z.array(CeilingZoneInfoSchema).default([]),
  ceilingSteps: z.array(CeilingStepInfoSchema).default([]),
  ceilingGrid: LayoutCeilingGridSchema.nullable().default(null),
  objects: z.array(RoomObjectInfoSchema).default([]),
  existing: z.array(ExistingFixtureSchema).default([]),
});
export type StudioRoom = z.infer<typeof StudioRoomSchema>;
export function createRoom(init: Partial<StudioRoom> = {}): StudioRoom {
  return {
    id: EMPTY_UUID,
    label: '',
    spaceType: '',
    floor: [],
    walls: [],
    ceilingHeight: 9,
    ceilingZones: [],
    ceilingSteps: [],
    ceilingGrid: null,
    objects: [],
    existing: [],
    ...init,
  };
}
/** Component-wise min/max over every floor point; ((0,0),(1,1)) when there are none. */
export function roomBounds(room: StudioRoom): { min: P2; max: P2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const loop of room.floor) {
    for (const p of loop) {
      any = true;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!any) return { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

// ---------------------------------------------------------------------------------------------------------------
// §12 RoomDesign and calculation snapshot

export const ZoneResultSchema = z.object({
  zoneId: z.string(),
  state: z.string(),
  outline: z.array(P3Schema),
  normal: P3Schema,
  columnSpacing: finite(),
  rowSpacing: finite(),
  points: z.array(z.object({ x: finite(), y: finite(), z: finite(), value: finite() })),
  average: finite().nullable(),
  minimum: finite().nullable(),
  maximum: finite().nullable(),
});
export type ZoneResult = z.infer<typeof ZoneResultSchema>;

export const CalculationSnapshotSchema = z.object({
  revision: z.number().int(),
  /** ISO-8601 timestamp. */
  at: z.string(),
  zones: z.record(ZoneResultSchema),
});
export type CalculationSnapshot = z.infer<typeof CalculationSnapshotSchema>;

export const RoomDesignSchema = z.object({
  room: StudioRoomSchema,
  intents: z.array(LightingIntentSchema).default([]),
  /** Existing luminaires the designer removed (a set; unique ids on the wire). */
  removedExisting: z.array(UuidSchema).default([]),
  /** Latest full calculation; never persisted in drafts. */
  calculation: CalculationSnapshotSchema.nullable().default(null),
  revision: z.number().int().default(0),
});
export type RoomDesign = z.infer<typeof RoomDesignSchema>;

/** Versioned design export document (web addition). */
export const DesignDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  design: RoomDesignSchema,
});
export type DesignDocument = z.infer<typeof DesignDocumentSchema>;

// ---------------------------------------------------------------------------------------------------------------
// §13 IntentEstimate, §14 IntentAdvice

export const IntentEstimateSchema = z.object({
  average: finite(),
  minimum: finite(),
  maximum: finite(),
  fixtures: z.number().int(),
  watts: finite(),
});
export type IntentEstimate = z.infer<typeof IntentEstimateSchema>;

export const IntentAdviceSchema = z.object({
  intentId: z.string(),
  label: z.string(),
  target: TargetRangeSchema,
  plane: WorkplaneSchema,
  /** The target reason shown under it. */
  reason: z.string(),
  /** Web addition (advise may propose a CCT). */
  cct: CctSchema.optional(),
});
export type IntentAdvice = z.infer<typeof IntentAdviceSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Ids (random, not part of the deterministic core paths)

interface CryptoLike {
  getRandomValues(a: Uint8Array): Uint8Array;
}
function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}
const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** Random v4 uuid, lowercase 8-4-4-4-12. */
export function newUuid(): string {
  const b = randomBytes(16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Intent id: 8 lowercase hex characters (first 8 of a random 128-bit id). */
export const newIntentId = (): string => hex(randomBytes(4));
