import { describe, expect, it } from 'vitest';
import {
  INTENT_INK,
  INTENT_KINDS,
  IntentBehaviorSchema,
  LightingIntentSchema,
  StudioProductSchema,
  StudioRoomSchema,
  behaviorEquals,
  createFixture,
  createIntent,
  createProduct,
  createRoom,
  defaultBehavior,
  emptyTarget,
  isEmptyTarget,
  kindToTool,
  newUuid,
  p2,
  p2Length,
  productInProject,
  productKey,
  roomBounds,
  targetEquals,
  targetMeets,
  targetRange,
  toolToKind,
  wallDirection,
  wallLength,
  type WallInfo,
} from '../src/index';

const wall = (start: { x: number; y: number }, end: { x: number; y: number }): WallInfo => ({
  index: 0,
  start,
  end,
  inward: { x: 0, y: 1 },
  top: 9,
  openings: [],
});

describe('model: TargetRange', () => {
  it('equality', () => expect(targetEquals(targetRange(10, 20, 35), targetRange(10, 20, 35))).toBe(true));
  it('equality with nulls', () =>
    expect(targetEquals(targetRange(null, null, 5), targetRange(null, null, 5))).toBe(true));
  it('inequality', () => expect(targetEquals(targetRange(10, 20, 35), targetRange(10, 20, null))).toBe(false));
  const r = targetRange(10, 20, 35);
  it('meets — all bounds, passes at tolerances', () => expect(targetMeets(r, 18, 9.8)).toBe(true));
  it('meets — minimum too low', () => expect(targetMeets(r, 20, 9.79)).toBe(false));
  it('meets — average too low', () => expect(targetMeets(r, 17.99, 10)).toBe(false));
  it('meets — average above max tolerance', () => expect(targetMeets(r, 35.71, 10)).toBe(false));
  it('meets — maximum uses average', () => expect(targetMeets(targetRange(null, null, 5), 5.1, 0)).toBe(true));
  it('meets — keep dim fails', () => expect(targetMeets(targetRange(null, null, 5), 5.2, 0)).toBe(false));
  it('meets — empty range', () => {
    expect(isEmptyTarget(emptyTarget())).toBe(true);
    expect(targetMeets(emptyTarget(), 0, 0)).toBe(true);
    expect(targetMeets(emptyTarget(), 1e6, -5)).toBe(true);
  });
});

describe('model: defaults', () => {
  it('default intent', () => {
    const i = createIntent();
    expect(i.kind).toBe('Task');
    expect(i.label).toBe('');
    expect(i.labelSuggested).toBe(true);
    expect(i.region).toEqual([]);
    expect(i.target).toEqual({ minimum: null, average: null, maximum: null });
    expect(i.plane).toEqual({ kind: 'Horizontal', height: 2.5, bottom: 0, top: 0, inferred: true, reason: '' });
    expect(i.behavior).toEqual({
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
    expect(i.behavior.cct).toBeUndefined();
    expect(i.behavior.beamAngle).toBeUndefined();
    expect(i.fixtures).toEqual([]);
    expect(i.trace).toEqual([]);
    expect(i.isSuggestion).toBe(false);
    expect(i.handTuned).toBe(false);
    expect(i.targetEdited).toBe(false);
    expect(i.wallIndex).toBeNull();
    expect(i.objectIndex).toBeNull();
    expect(i.product).toBeNull();
    expect(i.id).toMatch(/^[0-9a-f]{8}$/);
  });
  it('schema fills the same defaults as createIntent', () => {
    const { id: _id, ...rest } = createIntent();
    const parsed = LightingIntentSchema.parse({ id: 'abcdef01' });
    expect({ ...parsed, id: undefined }).toEqual({ ...rest, id: undefined });
  });
  it('default fixture', () => {
    const f = createFixture();
    expect(f.mount).toBe('ceiling');
    expect(f.output).toBe(1);
    expect(f.pinned).toBe(false);
    expect(f.orientation).toBe(0);
    expect(f.height).toBe(0);
    expect(f.tilt).toBe(0);
    expect(f.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('default product', () => {
    const p = createProduct();
    expect(p.length).toBe(1);
    expect(p.width).toBe(1);
    expect(p.beamAngle).toBe(90);
    expect(p.uplightShare).toBe(0);
    expect(p.isGeneric).toBe(false);
    expect(productInProject(p)).toBe(false);
    expect(StudioProductSchema.parse({})).toEqual(p);
  });
  it('default room ceiling', () => {
    expect(createRoom().ceilingHeight).toBe(9);
    expect(StudioRoomSchema.parse({})).toEqual(createRoom());
  });
  it('random ids differ', () => expect(newUuid()).not.toBe(newUuid()));
});

describe('model: product key', () => {
  it('generic', () =>
    expect(productKey(createProduct({ family: 'volumetric', lumens: 3000 }))).toBe('generic:volumetric:3000'));
  it('generic rounding (half away from zero)', () =>
    expect(productKey(createProduct({ family: 'x', lumens: 1500.5 }))).toBe('generic:x:1501'));
  it('in project', () => {
    const p = createProduct({ productId: '8713baa4-22dc-51c2-6e01-fb595b1d00b5', family: 'downlight', lumens: 800 });
    expect(productKey(p)).toBe('8713baa4-22dc-51c2-6e01-fb595b1d00b5');
    expect(productInProject(p)).toBe(true);
  });
  it('in project, upper-case id is lower-cased', () =>
    expect(productKey(createProduct({ productId: '8713BAA4-22DC-51C2-6E01-FB595B1D00B5' }))).toBe(
      '8713baa4-22dc-51c2-6e01-fb595b1d00b5',
    ));
  it('ies is an optional opaque object', () => {
    expect(StudioProductSchema.parse({ ies: { lumens: 1000 } }).ies).toEqual({ lumens: 1000 });
    expect(StudioProductSchema.parse({}).ies).toBeUndefined();
  });
});

describe('model: walls and rooms', () => {
  it('wall derived', () => {
    const w = wall(p2(36, 24), p2(0, 24));
    expect(wallLength(w)).toBe(36);
    expect(wallDirection(w)).toEqual({ x: -1, y: 0 });
  });
  it('wall zero length', () => {
    const w = wall(p2(1, 1), p2(1, 1));
    expect(wallLength(w)).toBe(0);
    expect(wallDirection(w)).toEqual({ x: 0, y: 0 });
  });
  it('room bounds, empty floor', () =>
    expect(roomBounds(createRoom({ floor: [] }))).toEqual({ min: { x: 0, y: 0 }, max: { x: 1, y: 1 } }));
  it('room bounds', () =>
    expect(roomBounds(createRoom({ floor: [[p2(0, 0), p2(36, 0), p2(36, 24), p2(0, 24)]] }))).toEqual({
      min: { x: 0, y: 0 },
      max: { x: 36, y: 24 },
    }));
  it('P2 length (golden)', () => expect(p2Length(p2(36, 24))).toBe(43.266615305567875));
  it('schema ignores golden derived length on points', () =>
    expect(StudioRoomSchema.parse({ floor: [[{ x: 1, y: 2, length: 3 }]] }).floor[0]?.[0]).toEqual({ x: 1, y: 2 }));
});

describe('model: enums', () => {
  it('tool/kind mapping', () => {
    expect(toolToKind('Select')).toBeNull();
    expect(toolToKind('Task')).toBe('Task');
    expect(toolToKind('KeepDim')).toBe('KeepDim');
    expect(kindToTool('KeepDim')).toBe('KeepDim');
    expect(kindToTool('Task')).toBe('Task');
    for (const k of INTENT_KINDS) expect(toolToKind(kindToTool(k))).toBe(k);
  });
  it('kind order', () =>
    expect(INTENT_KINDS).toEqual([
      'Task',
      'Ambient',
      'WallWash',
      'Accent',
      'FeaturePendant',
      'CeilingGlow',
      'Path',
      'KeepDim',
    ]));
  it('ink names', () => {
    expect(INTENT_KINDS.map((k) => INTENT_INK[k].name)).toEqual([
      'Task',
      'Ambient',
      'Wall wash',
      'Accent',
      'Feature pendants',
      'Ceiling glow',
      'Path',
      'Keep dim',
    ]);
    expect(INTENT_KINDS.map((k) => INTENT_INK[k].color)).toEqual([
      '#E08A1E',
      '#3B82C4',
      '#8B5CD6',
      '#D94C7A',
      '#1F9E8F',
      '#C9A227',
      '#5E9E3A',
      '#6B7280',
    ]);
  });
});

describe('model: behaviour (web additions)', () => {
  it('accepts cct from the allowed set', () => expect(IntentBehaviorSchema.parse({ cct: 3500 }).cct).toBe(3500));
  it('rejects other cct', () => expect(IntentBehaviorSchema.safeParse({ cct: 3200 }).success).toBe(false));
  it('null cct reads as absent', () => expect(IntentBehaviorSchema.parse({ cct: null }).cct).toBeUndefined());
  it('beamAngle optional, positive', () => {
    expect(IntentBehaviorSchema.parse({ beamAngle: 40 }).beamAngle).toBe(40);
    expect(IntentBehaviorSchema.safeParse({ beamAngle: -1 }).success).toBe(false);
  });
  it('value equality', () => {
    expect(behaviorEquals(defaultBehavior(), IntentBehaviorSchema.parse({}))).toBe(true);
    expect(behaviorEquals(defaultBehavior(), { ...defaultBehavior(), density: 1.2 })).toBe(false);
    expect(behaviorEquals(defaultBehavior(), { ...defaultBehavior(), cct: 3000 })).toBe(false);
  });
  it('pattern must be a known pattern', () => {
    expect(IntentBehaviorSchema.parse({ pattern: 'rows' }).pattern).toBe('rows');
    expect(IntentBehaviorSchema.safeParse({ pattern: 'spiral' }).success).toBe(false);
  });
});
