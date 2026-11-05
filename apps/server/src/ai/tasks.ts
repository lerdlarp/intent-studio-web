// The four AI tasks (PLAN §4) as plain functions over the runner, so the HTTP route and the eval script
// (scripts/eval) run exactly the same code. Each takes an already-validated body.
import { z } from 'zod';
import {
  IntentAdviceSchema,
  LightingIntentSchema,
  StudioRoomSchema,
  adviseSystemPrompt,
  adviseUserMessage,
  advise,
  interpret,
  interpretSystemPrompt,
  interpretUserMessage,
  parseAdvice,
  parseInterpret,
  objects,
  type IntentAdvice,
  type LightingIntent,
} from '@intent-studio/core';
import type { AiResponse, AiRunner } from './run';
import {
  ClassifyObjectSchema,
  MAX_CLASSIFY_OBJECTS,
  classifySystemPrompt,
  classifyUserMessage,
  fallbackClassify,
  parseClassify,
  type ClassifyResult,
} from './prompts/classify';
import { ProposeInputIntent, fallbackPropose, parsePropose, proposeSystemPrompt, proposeUserMessage } from './prompts/propose';

const Common = { projectId: z.string().min(1).max(64).optional() };
export const AdviseBody = z.object({ ...Common, room: StudioRoomSchema, intents: z.array(LightingIntentSchema).max(500) });
export const InterpretBody = z.object({ ...Common, room: StudioRoomSchema, text: z.string().max(4000) });
export const ClassifyBody = z.object({ ...Common, objects: z.array(ClassifyObjectSchema).min(1).max(MAX_CLASSIFY_OBJECTS) });
export const ProposeBody = z.object({ ...Common, room: StudioRoomSchema, intents: z.array(ProposeInputIntent).max(200).default([]) });

export type AdviseBody = z.infer<typeof AdviseBody>;
export type InterpretBody = z.infer<typeof InterpretBody>;
export type ClassifyBody = z.infer<typeof ClassifyBody>;
export type ProposeBody = z.infer<typeof ProposeBody>;

export function adviseTask(ai: AiRunner, b: AdviseBody): Promise<AiResponse<IntentAdvice[]>> {
  const defaults = advise(b.room, b.intents);
  return ai.run({
    task: 'advise',
    projectId: b.projectId ?? null,
    system: adviseSystemPrompt(),
    user: adviseUserMessage(b.room, b.intents, defaults),
    maxTokens: 4096,
    parse: (reply) => (objects(reply).length === 0 ? null : z.array(IntentAdviceSchema).parse(parseAdvice(reply, b.room, b.intents, defaults))),
    fallback: () => defaults,
  });
}

export function interpretTask(ai: AiRunner, b: InterpretBody): Promise<AiResponse<LightingIntent[]>> {
  return ai.run({
    task: 'interpret',
    projectId: b.projectId ?? null,
    system: interpretSystemPrompt(),
    user: interpretUserMessage(b.room, b.text),
    maxTokens: 2048,
    parse: (reply) => {
      const r = parseInterpret(reply, b.room);
      return r.length === 0 ? null : r;
    },
    fallback: () => interpret(b.room, b.text),
  });
}

export function classifyTask(ai: AiRunner, b: ClassifyBody): Promise<AiResponse<ClassifyResult>> {
  return ai.run({
    task: 'classify',
    projectId: b.projectId ?? null,
    system: classifySystemPrompt(),
    user: classifyUserMessage(b.objects),
    maxTokens: 4096,
    parse: (reply) => {
      const r = parseClassify(reply, b.objects);
      return r.usable ? r.result : null;
    },
    fallback: () => fallbackClassify(b.objects),
  });
}

export function proposeTask(ai: AiRunner, b: ProposeBody): Promise<AiResponse<LightingIntent[]>> {
  return ai.run({
    task: 'propose',
    projectId: b.projectId ?? null,
    system: proposeSystemPrompt(),
    user: proposeUserMessage(b.room, b.intents),
    maxTokens: 4096,
    parse: (reply) => {
      const r = parsePropose(reply, b.room);
      return r.length === 0 ? null : r;
    },
    fallback: () => fallbackPropose(b.room),
  });
}
