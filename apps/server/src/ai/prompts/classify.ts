// `classify`: object names/dimensions → a kind from the fixed set. Host data in a host block, names are data.
import { z } from 'zod';
import { OBJECT_KINDS, RULE_SENTENCE, hostBlock, line, objects, prop, number, text, type Json } from '@intent-studio/core';

export const CLASSIFY_TASK = 'studio-classify';
export const MAX_CLASSIFY_OBJECTS = 100;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const ClassifyObjectSchema = z.object({
  index: z.number().int().min(0),
  name: z.string().max(400),
  length: z.number().finite().optional(),
  width: z.number().finite().optional(),
  top: z.number().finite().nullable().optional(),
  bottom: z.number().finite().nullable().optional(),
  /** The client's own regex guess; used as the per-object fallback when present and valid. */
  fallbackKind: z.enum(OBJECT_KINDS).optional(),
});
export type ClassifyObject = z.infer<typeof ClassifyObjectSchema>;

export const CLASSIFY_INSTRUCTIONS = [
  'You are the lighting-design agent inside the Intent Studio window.',
  'The host block lists objects found in a 3D room, each with an index, a name and its size in feet.',
  'Decide what kind of thing each object is, for lighting design.',
  `Reply with JSON only, no prose and no code fence: an array of {"index", "kind"} where kind is exactly one of ${OBJECT_KINDS.join(', ')}.`,
  'Use other when no kind fits or you are unsure. Answer for every index you were given and invent none.',
  RULE_SENTENCE,
].join('\n');

export const classifySystemPrompt = (): string => CLASSIFY_INSTRUCTIONS;

export function classifyPayload(objs: readonly ClassifyObject[]) {
  return {
    objects: objs.slice(0, MAX_CLASSIFY_OBJECTS).map((o) => ({
      index: o.index,
      name: line(o.name, 60),
      lengthFt: o.length ?? null,
      widthFt: o.width ?? null,
      topFt: o.top ?? null,
      bottomFt: o.bottom ?? null,
    })),
  };
}

export const classifyUserMessage = (objs: readonly ClassifyObject[]): string =>
  `${hostBlock(CLASSIFY_TASK, classifyPayload(objs))}\nReply with the JSON array only.`;

/** Name regexes, first match wins (used when the client sends no fallbackKind). */
const NAME_RULES: readonly [ObjectKind, RegExp][] = [
  ['reception', /\breception\b|front desk|check-?in/i],
  ['island', /\bisland\b/i],
  ['bar', /\bbar\b|bar ?top/i],
  ['counter', /\bcounter|worktop|servery/i],
  ['desk', /\bdesk|workstation|work ?bench/i],
  ['table', /\btables?\b|\bconference\b/i],
  ['cabinet', /cabinet|cupboard|shelv|shelf|bookcase|locker|wardrobe|credenza/i],
  ['seating', /chair|sofa|couch|bench|stool|seat|booth|banquette|lounge/i],
  ['artwork', /art ?work|painting|picture|poster|canvas|frame|mural|photo/i],
  ['signage', /\bsign(age)?\b|logo|wayfinding|banner/i],
  ['mirror', /mirror/i],
  ['screen', /\bscreen|projector|\btv\b|television|whiteboard|monitor/i],
  ['display', /display|vitrine|showcase|cabinet display/i],
  ['door', /\bdoors?\b|doorway/i],
  ['appliance', /fridge|refrigerator|oven|microwave|dishwasher|vending|printer|copier|appliance|coffee/i],
];

/** Deterministic fallback for one object: the client's `fallbackKind`, else the name table, else `other`. */
export function fallbackKindOf(o: Pick<ClassifyObject, 'name' | 'fallbackKind'>): ObjectKind {
  if (o.fallbackKind) return o.fallbackKind;
  for (const [kind, re] of NAME_RULES) if (re.test(o.name)) return kind;
  return 'other';
}

export type ClassifyResult = { index: number; kind: ObjectKind }[];

export const fallbackClassify = (objs: readonly ClassifyObject[]): ClassifyResult =>
  objs.map((o) => ({ index: o.index, kind: fallbackKindOf(o) }));

const ReplyItem = z.object({ index: z.number().int(), kind: z.enum(OBJECT_KINDS) });

/**
 * Parse a classify reply: per-object result (reply kind where valid for a sent index, else the fallback). `usable` is
 * false when no item could be used.
 */
export function parseClassify(
  reply: string,
  objs: readonly ClassifyObject[],
): { result: { index: number; kind: ObjectKind }[]; usable: boolean } {
  const sent = objs.slice(0, MAX_CLASSIFY_OBJECTS);
  const got = new Map<number, ObjectKind>();
  for (const item of objects(reply)) {
    const idx = number(prop(item, 'index', 'id', 'object'));
    const kindWord = text(prop(item, 'kind', 'type') as Json | undefined);
    const parsed = ReplyItem.safeParse({ index: idx, kind: kindWord?.trim().toLowerCase() });
    if (!parsed.success || !sent.some((o) => o.index === parsed.data.index) || got.has(parsed.data.index)) continue;
    got.set(parsed.data.index, parsed.data.kind);
  }
  return {
    result: objs.map((o) => ({ index: o.index, kind: got.get(o.index) ?? fallbackKindOf(o) })),
    usable: got.size > 0,
  };
}
