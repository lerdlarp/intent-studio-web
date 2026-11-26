// Room intent (web addition, logged in spec/QUESTIONS.md "2026-11-26 room intent"): what the room is for, its base
// light (level, colour temperature, measuring height) and which suggested zones to take, as one draft.
//
// A draft comes from a provider: hard-coded for the four demo rooms (DEMO_INTENTS), the agent through the server's
// `brief` task, or the deterministic rules here (rulesDraft). Provider output is untrusted: parseRoomIntentDraft
// validates every field with zod, clamps numbers and keeps the fallback per field. applyRoomIntent turns a draft into
// intent edits; it never places fixtures (the solver does) and never overwrites a field the designer edited.
import { z } from 'zod';
import { CCT_BASE, cctFor, withDefaultCct } from './cct';
import { className, classOf } from './defaults';
import { demoRoomById, type DemoRoomName } from './fixtures/demo-rooms';
import {
  CctSchema,
  INTENT_KINDS,
  type Cct,
  type IntentKind,
  type LightingIntent,
  type SpaceClass,
  type StudioRoom,
  type TargetRange,
} from './model';

export const BRIEF_SOURCES = ['demo', 'ai', 'rules', 'designer'] as const;
export type BriefSource = (typeof BRIEF_SOURCES)[number];
export const MAX_BRIEF_LEVEL = 200;
export const MAX_MEASURED_AT = 20;
export const MAX_NOTE = 280;
export const MAX_PURPOSE = 60;
export const MAX_ZONE_PICKS = 16;

/** Measuring heights the brief offers (ft). */
export const MEASURED_AT: readonly { height: number; label: string }[] = [
  { height: 0, label: 'floor level' },
  { height: 2.5, label: 'table height' },
  { height: 3, label: 'counter height' },
];
export const measuredAtLabel = (h: number): string =>
  MEASURED_AT.find((m) => Math.abs(m.height - h) < 1e-6)?.label ?? `${Math.round(h * 10) / 10} ft`;

/** Purposes offered per space class; the first is the rules default. */
export const ROOM_PURPOSES: Readonly<Record<SpaceClass, readonly string[]>> = {
  OpenOffice: ['focused desk work', 'collaborative work', 'hot desking'],
  Office: ['focused desk work', 'meetings and calls', 'reading and writing'],
  Conference: ['meetings and video calls', 'presentations', 'workshops'],
  Classroom: ['teaching and learning', 'exams', 'group work'],
  Cafeteria: ['social dining', 'quick service', 'events'],
  Lobby: ['welcoming arrivals', 'waiting', 'wayfinding'],
  Corridor: ['moving through', 'wayfinding'],
  DataHall: ['equipment maintenance', 'monitoring'],
  Retail: ['showing merchandise', 'browsing', 'checkout'],
  Restroom: ['grooming', 'cleaning'],
  Storage: ['finding stock', 'loading'],
  BreakRoom: ['relaxing', 'social breaks', 'quick meals'],
  Other: ['general use'],
};

export const CCT_WORDS: Readonly<Record<Cct, string>> = {
  2700: 'very warm',
  3000: 'warm',
  3500: 'neutral warm',
  4000: 'neutral',
  5000: 'cool',
};

export interface RoomBrief {
  /** Free text the room type shows as (room.spaceType, or the class name). */
  spaceType: string;
  purpose: string;
  cct: Cct;
  /** Base light average (fc). */
  level: number;
  /** Base light measuring height (ft). */
  measuredAt: number;
  /** One or two sentences from whoever drafted it. */
  note: string;
  source: BriefSource;
}

/** One suggested zone the draft takes (or leaves as a suggestion). Matched by kind and label words. */
export interface ZonePick {
  kind: IntentKind;
  /** Words of the suggestion's label to match (case-insensitive); empty = the first suggestion of the kind. */
  match: string;
  /** New label; empty keeps the suggestion's. */
  label: string;
  /** Target average (fc); KeepDim: the maximum. null keeps the suggested target. */
  level: number | null;
  accept: boolean;
}

export interface RoomIntentDraft {
  brief: RoomBrief;
  zones: ZonePick[];
}

// ---- hard-coded demo intents ---------------------------------------------------------------------------------

const pick = (kind: IntentKind, match: string, label: string, level: number | null, accept = true): ZonePick => ({
  kind,
  match,
  label,
  level,
  accept,
});

/** Hand-written room intents for the demo rooms (no model call). */
export const DEMO_INTENTS: Readonly<Record<DemoRoomName, RoomIntentDraft>> = {
  Office: {
    brief: {
      spaceType: 'open office',
      purpose: 'focused desk work',
      cct: 4000,
      level: 20,
      measuredAt: 2.5,
      note: 'Desks sit in three clusters, so task light goes over each cluster and the base stays lower. The screen end is kept dim to keep glare off the display.',
      source: 'demo',
    },
    zones: [
      pick('Task', 'desk cluster a', 'Desk cluster A', 30),
      pick('Task', 'desk cluster b', 'Desk cluster B', 30),
      pick('Task', 'desk cluster c', 'Desk cluster C', 30),
      pick('Task', 'meeting table', 'Meeting table', 30),
      pick('WallWash', 'brand wall', 'Brand wall', 25),
      pick('KeepDim', 'screen', 'Screen end', 5),
      pick('Accent', 'brand wall', '', null, false),
    ],
  },
  Cafeteria: {
    brief: {
      spaceType: 'cafeteria',
      purpose: 'social dining',
      cct: 3000,
      level: 15,
      measuredAt: 2.5,
      note: 'The servery needs more light than the tables. Pendants over the tables and a glow in the raised ceiling keep the dining area calm and warm.',
      source: 'demo',
    },
    zones: [
      pick('Task', 'servery counter', 'Servery counter', 40),
      pick('WallWash', 'menu', 'Menu wall', 25),
      pick('FeaturePendant', 'table', 'Table pendants', 25),
      pick('CeilingGlow', 'cove', 'Raised ceiling', 10),
      pick('Accent', 'menu', '', null, false),
    ],
  },
  Lobby: {
    brief: {
      spaceType: 'lobby',
      purpose: 'welcoming arrivals',
      cct: 3000,
      level: 10,
      measuredAt: 0,
      note: 'Visitors look for the reception desk first, so it gets the most light. The feature wall is washed to draw the eye from the doors, and the entry path stays readable at night.',
      source: 'demo',
    },
    zones: [
      pick('Task', 'reception', 'Reception desk', 30),
      pick('WallWash', 'feature wall', 'Feature wall', 25),
      pick('FeaturePendant', 'reception', 'Reception pendants', 25),
      pick('Path', 'entry', 'Entry path', 3),
      pick('Accent', 'feature wall', '', null, false),
    ],
  },
  DataHall: {
    brief: {
      spaceType: 'data hall',
      purpose: 'equipment maintenance',
      cct: 4000,
      level: 30,
      measuredAt: 0,
      note: 'Technicians read labels on both faces of the racks, so light runs along each aisle at floor level rather than over the cabinets.',
      source: 'demo',
    },
    zones: [pick('Task', 'aisle 1', 'Aisle 1', 30), pick('Task', 'aisle 2', 'Aisle 2', 30), pick('Task', 'aisle 3', 'Aisle 3', 30)],
  },
};

const DEMO_ORDER: readonly DemoRoomName[] = ['Office', 'Cafeteria', 'Lobby', 'DataHall'];

/** The hard-coded draft when the room is one of the demo rooms (by id), else null. */
export function demoDraft(room: StudioRoom): RoomIntentDraft | null {
  const demo = demoRoomById(room.id);
  if (!demo) return null;
  for (const name of DEMO_ORDER) {
    const d = DEMO_INTENTS[name];
    if (d.brief.spaceType === demo.spaceType) return clone(d);
  }
  return null;
}

const clone = (d: RoomIntentDraft): RoomIntentDraft => ({ brief: { ...d.brief }, zones: d.zones.map((z) => ({ ...z })) });

// ---- rules ---------------------------------------------------------------------------------------------------

const baseOf = (intents: readonly LightingIntent[]): LightingIntent | undefined =>
  intents.find((i) => i.kind === 'Ambient' && !i.isSuggestion) ?? intents.find((i) => i.kind === 'Ambient');

/** Deterministic brief from the room class and its base (Ambient) intent; takes no zones. */
export function rulesDraft(room: StudioRoom, intents: readonly LightingIntent[]): RoomIntentDraft {
  const cls = classOf(room);
  const base = baseOf(intents);
  const cct = base?.behavior.cct ?? cctFor(cls, 'Ambient') ?? CCT_BASE[cls];
  const level = base?.target.average ?? 15;
  const measuredAt = base?.plane.kind === 'Horizontal' ? base.plane.height : 2.5;
  const purpose = ROOM_PURPOSES[cls][0] ?? 'general use';
  return {
    brief: {
      spaceType: room.spaceType.trim() || className(cls),
      purpose,
      cct,
      level,
      measuredAt,
      note: `Drafted from the room type. Add zones for anything that needs more or less light than ${level} fc.`,
      source: 'rules',
    },
    zones: [],
  };
}

// ---- untrusted input -----------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- strips control characters from untrusted text
const line = (s: string, max: number): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const num = z.number().finite();

const PickInput = z.object({
  kind: z.enum(INTENT_KINDS as unknown as [IntentKind, ...IntentKind[]]),
  match: z.string().default(''),
  label: z.string().default(''),
  level: num.nullable().default(null),
  accept: z.boolean().default(true),
});

/**
 * Validates an untrusted draft field by field: anything missing, mistyped or out of range keeps the fallback's value;
 * numbers are clamped; text is one line and capped. Returns the draft and the fields that came from the fallback.
 */
export function parseRoomIntentDraft(
  value: unknown,
  fallback: RoomIntentDraft,
  source: BriefSource,
): { draft: RoomIntentDraft; fromFallback: string[] } {
  const fromFallback: string[] = [];
  const obj = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const b =
    typeof obj.brief === 'object' && obj.brief !== null && !Array.isArray(obj.brief) ? (obj.brief as Record<string, unknown>) : {};
  const field = <T>(name: string, schema: z.ZodType<T>, fb: T): T => {
    const r = schema.safeParse(b[name]);
    if (r.success) return r.data;
    fromFallback.push(name);
    return fb;
  };
  const f = fallback.brief;
  const text = (name: string, max: number, fb: string): string => {
    const v = field(name, z.string(), fb);
    const t = line(v, max);
    if (t === '' && fb !== '') {
      if (!fromFallback.includes(name)) fromFallback.push(name);
      return fb;
    }
    return t;
  };
  const brief: RoomBrief = {
    spaceType: text('spaceType', MAX_PURPOSE, f.spaceType),
    purpose: text('purpose', MAX_PURPOSE, f.purpose),
    cct: field('cct', CctSchema, f.cct),
    level: clampNum(field('level', num, f.level), 0, MAX_BRIEF_LEVEL),
    measuredAt: clampNum(field('measuredAt', num, f.measuredAt), 0, MAX_MEASURED_AT),
    note: text('note', MAX_NOTE, f.note),
    source,
  };
  let zones = fallback.zones;
  if (Array.isArray(obj.zones)) {
    const ok: ZonePick[] = [];
    for (const row of obj.zones.slice(0, MAX_ZONE_PICKS)) {
      const r = PickInput.safeParse(row);
      if (!r.success) continue;
      ok.push({
        kind: r.data.kind,
        match: line(r.data.match, 60).toLowerCase(),
        label: line(r.data.label, 60),
        level: r.data.level === null ? null : clampNum(r.data.level, 0, MAX_BRIEF_LEVEL),
        accept: r.data.accept,
      });
    }
    zones = ok;
  } else fromFallback.push('zones');
  return { draft: { brief, zones }, fromFallback };
}

// ---- apply ---------------------------------------------------------------------------------------------------

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Target for a level: the base keeps the suggested shape (min ≈ 2/3, max ≈ 5/3 of the average); KeepDim is a cap. */
export function targetForLevel(kind: IntentKind, level: number, prev: TargetRange): TargetRange {
  if (kind === 'KeepDim') return { minimum: null, average: null, maximum: round1(level) };
  const a = prev.average ?? null;
  const lo = a && prev.minimum !== null ? prev.minimum / a : 2 / 3;
  const hi = a && prev.maximum !== null ? prev.maximum / a : 5 / 3;
  return { minimum: round1(level * lo), average: round1(level), maximum: round1(level * hi) };
}

export interface AppliedIntent {
  intents: LightingIntent[];
  /** Ids of intents the draft accepted or changed, base first. */
  changed: string[];
}

/**
 * Applies a draft to the room's intents (pure; returns copies). The base Ambient intent is accepted and gets the
 * brief's level, measuring height and colour unless the designer set them; each accepted pick takes the first unused
 * suggestion of its kind whose label contains its match words and gets its label and level. Picks left unaccepted
 * stay suggestions; unmatched picks are ignored. Fixtures are untouched (the solver lays them out).
 */
export function applyRoomIntent(room: StudioRoom, intents: readonly LightingIntent[], draft: RoomIntentDraft): AppliedIntent {
  const out = intents.map((i) => structuredClone(i));
  const changed: string[] = [];
  const b = draft.brief;
  const base = baseOf(out);
  if (base) {
    base.isSuggestion = false;
    if (!base.targetEdited) {
      base.target = targetForLevel('Ambient', b.level, base.target);
      base.targetReason = `${b.level} fc for ${b.purpose} (room intent).`;
    }
    if (base.plane.inferred && base.plane.kind === 'Horizontal') base.plane = { ...base.plane, height: b.measuredAt };
    if (base.behavior.cct === undefined || base.cctSuggested) {
      base.behavior = { ...base.behavior, cct: b.cct };
      base.cctSuggested = true;
    }
    changed.push(base.id);
  }
  const used = new Set<string>(changed);
  for (const p of draft.zones) {
    if (!p.accept) continue;
    const words = p.match.trim().toLowerCase();
    const hit = out.find(
      (i) => i.isSuggestion && !used.has(i.id) && i.kind === p.kind && (words === '' || i.label.toLowerCase().includes(words)),
    );
    if (!hit) continue;
    used.add(hit.id);
    hit.isSuggestion = false;
    if (p.label !== '' && hit.labelSuggested) hit.label = p.label;
    if (p.level !== null && !hit.targetEdited) {
      hit.target = targetForLevel(hit.kind, p.level, hit.target);
      hit.targetReason = `${p.level} fc from the room intent.`;
    }
    Object.assign(hit, withDefaultCct(room, hit));
    changed.push(hit.id);
  }
  return { intents: out, changed };
}

/** The brief read as one sentence (for plan text and exports). */
export function briefSentence(b: RoomBrief): string {
  return `This is a ${b.spaceType} for ${b.purpose}. Keep it ${CCT_WORDS[b.cct]} (${b.cct} K) at about ${b.level} fc measured at ${measuredAtLabel(b.measuredAt)}.`;
}

// ---- persistence (draft document, optional `brief` field) ----------------------------------------------------

/** Stored form of a brief: same fields, validated on save and load. */
export const RoomBriefSchema = z.object({
  spaceType: z.string().max(MAX_PURPOSE),
  purpose: z.string().max(MAX_PURPOSE),
  cct: CctSchema,
  level: z.number().finite().min(0).max(MAX_BRIEF_LEVEL),
  measuredAt: z.number().finite().min(0).max(MAX_MEASURED_AT),
  note: z.string().max(MAX_NOTE).default(''),
  source: z.enum(BRIEF_SOURCES),
});

/** The brief of a stored draft document, or null when absent or malformed. Never throws. */
export function fitDraftBrief(doc: unknown): RoomBrief | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const r = RoomBriefSchema.safeParse((doc as { brief?: unknown }).brief);
  if (!r.success) return null;
  return { ...r.data, spaceType: line(r.data.spaceType, MAX_PURPOSE), purpose: line(r.data.purpose, MAX_PURPOSE), note: line(r.data.note, MAX_NOTE) };
}
