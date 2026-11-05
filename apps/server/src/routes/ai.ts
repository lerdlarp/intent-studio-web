import type { FastifyInstance } from 'fastify';
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
} from '@intent-studio/core';
import type { Ctx } from '../app';
import { HttpError, parse } from '../util';
import {
  ClassifyObjectSchema,
  MAX_CLASSIFY_OBJECTS,
  classifySystemPrompt,
  classifyUserMessage,
  fallbackClassify,
  parseClassify,
} from '../ai/prompts/classify';
import { ProposeInputIntent, fallbackPropose, parsePropose, proposeSystemPrompt, proposeUserMessage } from '../ai/prompts/propose';

const Common = { projectId: z.string().min(1).max(64).optional() };
const Advise = z.object({ ...Common, room: StudioRoomSchema, intents: z.array(LightingIntentSchema).max(500) });
const Interpret = z.object({ ...Common, room: StudioRoomSchema, text: z.string().max(4000) });
const Classify = z.object({ ...Common, objects: z.array(ClassifyObjectSchema).min(1).max(MAX_CLASSIFY_OBJECTS) });
const Propose = z.object({ ...Common, room: StudioRoomSchema, intents: z.array(ProposeInputIntent).max(200).default([]) });

export function aiRoutes(app: FastifyInstance, { ai }: Ctx): void {
  app.post('/api/ai/:task', async (req) => {
    const { task } = parse(z.object({ task: z.string() }), req.params);
    switch (task) {
      case 'advise': {
        const b = parse(Advise, req.body);
        const defaults = advise(b.room, b.intents);
        return ai.run({
          task,
          projectId: b.projectId ?? null,
          system: adviseSystemPrompt(),
          user: adviseUserMessage(b.room, b.intents, defaults),
          maxTokens: 4096,
          parse: (reply) => (objects(reply).length === 0 ? null : z.array(IntentAdviceSchema).parse(parseAdvice(reply, b.room, b.intents, defaults))),
          fallback: () => defaults,
        });
      }
      case 'interpret': {
        const b = parse(Interpret, req.body);
        return ai.run({
          task,
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
      case 'classify': {
        const b = parse(Classify, req.body);
        return ai.run({
          task,
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
      case 'propose': {
        const b = parse(Propose, req.body);
        return ai.run({
          task,
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
      default:
        throw new HttpError(404, `unknown AI task "${task}"`);
    }
  });
}

