// Room intent providers: where the room intent draft (what the room is for, the base light, which suggested zones to
// take) comes from. Providers are tried in order and the first that answers wins; every answer is untrusted and is read
// with core parseRoomIntentDraft against the deterministic rules draft, so a bad field keeps the fallback's value.
//
//   demo   → the hard-coded intent of the four demo rooms (core DEMO_INTENTS); never calls a model
//   remote → the server's `brief` task (the agent, with its own rules fallback when no key is configured)
//   rules  → core rulesDraft, always answers
//
// No provider places fixtures or computes illuminance: a draft only edits intents (applyRoomIntent) and the solver lays
// the room out. Adding a provider (another model, a project template) means adding one object to the list.
import {
  demoDraft,
  parseRoomIntentDraft,
  rulesDraft,
  type BriefSource,
  type LightingIntent,
  type RoomIntentDraft,
  type StudioRoom,
} from '@intent-studio/core';
import type { StudioApi } from '../api/client';

export interface RoomIntentContext {
  room: StudioRoom;
  intents: readonly LightingIntent[];
  projectId?: string;
}

export interface RoomIntentProvider {
  readonly source: BriefSource;
  /** null = no answer (try the next provider). May throw; a throw counts as no answer. */
  draft(ctx: RoomIntentContext): Promise<unknown>;
}

export interface DraftedIntent {
  draft: RoomIntentDraft;
  source: BriefSource;
  /** Issue text when the remote provider fell back or failed (shown as a quiet note), else null. */
  issue: string | null;
}

export const demoProvider: RoomIntentProvider = {
  source: 'demo',
  draft: async ({ room }) => demoDraft(room),
};

export const rulesProvider: RoomIntentProvider = {
  source: 'rules',
  draft: async ({ room, intents }) => rulesDraft(room, intents),
};

/** The server's agent task. Answers only when the server says the agent (not its rules) wrote the draft. */
export function remoteProvider(api: StudioApi, onIssue?: (issue: string | null) => void): RoomIntentProvider {
  return {
    source: 'ai',
    draft: async ({ room, intents, projectId }) => {
      if (!api.draftIntent) return null;
      const r = await api.draftIntent({
        room,
        intents: intents
          .filter((i) => !i.isSuggestion)
          .map((i) => ({ id: i.id, kind: i.kind, label: i.label, wallIndex: i.wallIndex, objectIndex: i.objectIndex })),
        ...(projectId ? { projectId } : {}),
      });
      onIssue?.(r.lastIssue ?? null);
      return r.source === 'ai' ? r.result : null;
    },
  };
}

/** Default chain: demo rooms use their hard-coded intent; other rooms ask the agent, then the rules. */
export const defaultProviders = (api: StudioApi, onIssue?: (issue: string | null) => void): RoomIntentProvider[] => [
  demoProvider,
  remoteProvider(api, onIssue),
  rulesProvider,
];

/** Runs the providers in order; always returns a draft (the rules draft when every provider is silent). */
export async function draftRoomIntent(providers: readonly RoomIntentProvider[], ctx: RoomIntentContext): Promise<DraftedIntent> {
  const fallback = rulesDraft(ctx.room, ctx.intents);
  let issue: string | null = null;
  for (const p of providers) {
    let value: unknown;
    try {
      value = await p.draft(ctx);
    } catch {
      if (p.source === 'ai') issue = 'The agent could not be reached, so the room intent was drafted from the room type.';
      continue;
    }
    if (value === null || value === undefined) continue;
    const { draft } = parseRoomIntentDraft(value, fallback, p.source);
    return { draft, source: p.source, issue };
  }
  return { draft: fallback, source: 'rules', issue };
}
