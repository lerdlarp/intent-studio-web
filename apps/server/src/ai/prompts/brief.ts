// `brief`: whole room (+ current intents) → a room intent draft: what the room is for, the base light (level, colour
// temperature, measuring height) and which suggested zones to take. Host data goes in a host block; the model only
// names purposes, numbers and suggestion kinds/labels. The reply is untrusted: core parseRoomIntentDraft validates it
// field by field against the fallback (the hard-coded demo intent, else the rules draft). Fixtures are never named:
// the solver lays them out.
import {
  CCT_VALUES,
  INTENT_KINDS,
  MAX_BRIEF_LEVEL,
  RULE_SENTENCE,
  demoDraft,
  hostBlock,
  interpretPayload,
  line,
  parseRoomIntentDraft,
  rulesDraft,
  seed,
  type RoomIntentDraft,
  type StudioRoom,
} from '@intent-studio/core';
import type { ProposeInputIntent } from './propose';

export const BRIEF_TASK = 'studio-brief';

export const BRIEF_INSTRUCTIONS = [
  'You are the lighting-design agent inside the Intent Studio window.',
  'The host block describes one room (walls and objects, each with an index) and the intents the designer already has,',
  'including open suggestions with their labels. Draft the room intent: what the room is for and its base light.',
  'Reply with JSON only, no prose and no code fence: {"brief": {"spaceType", "purpose", "cct", "level", "measuredAt",',
  '"note"}, "zones": [{"kind", "match", "label", "level", "accept"}]} where purpose is a short phrase (e.g. "social',
  'dining"), cct one of ' + CCT_VALUES.join(', ') + ', level the base light average in footcandles (0 to ' + MAX_BRIEF_LEVEL + '),',
  'measuredAt the measuring height in feet (0 floor, 2.5 table, 3 counter), note one or two short sentences for the',
  'designer. Each zone names an open suggestion to take: kind one of ' + INTENT_KINDS.join(', ') + ', match words of its',
  'label, label a short new label or "", level its target in footcandles or null, accept true or false.',
  'Never invent fixtures, quantities or illuminance results; the host lays out and calculates the room.',
  RULE_SENTENCE,
].join('\n');

export const briefSystemPrompt = (): string => BRIEF_INSTRUCTIONS;

export function briefUserMessage(room: StudioRoom, current: readonly ProposeInputIntent[]): string {
  const open = seed(room).map((i) => ({ kind: i.kind, label: line(i.label, 40) }));
  const payload = {
    ...interpretPayload(room),
    intents: current.slice(0, 40).map((i) => ({ kind: line(i.kind, 20), label: line(i.label, 40) })),
    suggestions: open.slice(0, 40),
  };
  return `${hostBlock(BRIEF_TASK, payload)}\nReply with the JSON object only.`;
}

/** The fallback draft: the hard-coded demo intent for a demo room, else the deterministic rules draft. */
export const fallbackBrief = (room: StudioRoom): RoomIntentDraft => demoDraft(room) ?? rulesDraft(room, seed(room));

/** First JSON object in the reply (never throws). */
function firstObject(reply: string): unknown {
  const a = reply.indexOf('{');
  const b = reply.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(reply.slice(a, b + 1)) as unknown;
  } catch {
    return null;
  }
}

/** Parse a brief reply; null when nothing in it was usable (→ the runner falls back). */
export function parseBrief(reply: string, room: StudioRoom): RoomIntentDraft | null {
  const value = firstObject(reply);
  if (value === null) return null;
  const { draft, fromFallback } = parseRoomIntentDraft(value, fallbackBrief(room), 'ai');
  const briefFields = ['spaceType', 'purpose', 'cct', 'level', 'measuredAt', 'note'];
  if (briefFields.every((f) => fromFallback.includes(f)) && fromFallback.includes('zones')) return null;
  return draft;
}
