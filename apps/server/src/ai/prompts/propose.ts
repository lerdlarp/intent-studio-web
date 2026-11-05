// `propose`: whole room (+ current intents) → ordered suggested intents. Host data in a host block; the model only
// names kinds and references (walls/objects), the host builds regions, targets and the solver does the layout.
import { z } from 'zod';
import {
  CCT_VALUES,
  MAX_FOOTCANDLES,
  RULE_SENTENCE,
  TARGETS_SENTENCE,
  forTarget,
  hostBlock,
  indexList,
  interpretPayload,
  kindFrom,
  line,
  number,
  objects,
  prop,
  seed,
  targetTablePrompt,
  text,
  withDefaultCct,
  type Cct,
  type LightingIntent,
  type StudioRoom,
} from '@intent-studio/core';

export const PROPOSE_TASK = 'studio-propose';
export const MAX_PROPOSALS = 8;
export const MAX_RATIONALE = 90;

export const ProposeInputIntent = z.object({
  id: z.string().min(1),
  kind: z.string().max(40),
  label: z.string().max(200).default(''),
  wallIndex: z.number().int().nullable().default(null),
  objectIndex: z.number().int().nullable().default(null),
});
export type ProposeInputIntent = z.infer<typeof ProposeInputIntent>;

export const PROPOSE_INSTRUCTIONS = [
  'You are the lighting-design agent inside the Intent Studio window.',
  'The host block describes one room (walls and objects, each with an index) and the intents the designer already has.',
  'Propose up to 8 additional lighting intents, most important first, that the designer has not covered.',
  'Reply with JSON only, no prose and no code fence: an array of {"kind", "wall", "object", "level", "cct", "reason"} where',
  'kind is one of ambient, task, wash, accent, pendant, glow, path, keepdim; wall a wall index or null; object an object',
  'index or null; level footcandles or null; cct one of ' + CCT_VALUES.join(', ') + ' or null; reason one short sentence.',
  'Use wall for a wash and object for the thing a task, pendant, accent or keep-dim intent is about. North is +Y.',
  TARGETS_SENTENCE,
  RULE_SENTENCE,
].join('\n');

export const proposeSystemPrompt = (): string => `${targetTablePrompt()}\n\n${PROPOSE_INSTRUCTIONS}`;

export function proposeUserMessage(room: StudioRoom, current: readonly ProposeInputIntent[]): string {
  const payload = {
    ...interpretPayload(room),
    intents: current.slice(0, 40).map((i) => ({
      kind: line(i.kind, 20),
      label: line(i.label, 40),
      wall: i.wallIndex,
      object: i.objectIndex,
    })),
  };
  return `${hostBlock(PROPOSE_TASK, payload)}\nReply with the JSON array only.`;
}

const ReplyItem = z.object({ cct: z.union([z.literal(2700), z.literal(3000), z.literal(3500), z.literal(4000), z.literal(5000)]) });

/** Fallback: the deterministic seed (already `isSuggestion`), each with its default CCT (marked suggested). */
export const fallbackPropose = (room: StudioRoom): LightingIntent[] => seed(room).map((i) => withDefaultCct(room, i));

/** Parse a propose reply into suggested intents (never throws; unplaceable items are dropped; max 8). */
export function parsePropose(reply: string, room: StudioRoom): LightingIntent[] {
  const out: LightingIntent[] = [];
  for (const item of objects(reply)) {
    if (out.length >= MAX_PROPOSALS) break;
    const kind = kindFrom(text(prop(item, 'kind', 'type', 'intent')));
    if (kind === null) continue;
    const walls = indexList(prop(item, 'wall', 'walls'), room.walls.length);
    const objs = indexList(prop(item, 'object', 'objects'), room.objects.length);
    const lv = number(prop(item, 'level', 'fc', 'target'));
    const level = lv !== undefined && lv > 0 && lv <= MAX_FOOTCANDLES ? lv : null;
    const reason = line(text(prop(item, 'reason', 'why', 'rationale')), MAX_RATIONALE);
    const cctRaw = number(prop(item, 'cct'));
    const cct = cctRaw !== undefined ? ReplyItem.safeParse({ cct: cctRaw }) : null;
    for (const intent of forTarget(room, kind, walls, objs, level)) {
      if (out.length >= MAX_PROPOSALS) break;
      let next: LightingIntent = { ...intent, isSuggestion: true };
      if (cct?.success) {
        next.behavior = { ...next.behavior, cct: cct.data.cct as Cct };
        next.cctSuggested = true;
      } else next = withDefaultCct(room, next);
      if (reason !== '') next.trace = [...next.trace, `Agent: ${reason}`];
      out.push(next);
    }
  }
  return out;
}
