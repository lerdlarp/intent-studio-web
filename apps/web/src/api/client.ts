// Typed client for the Intent Studio server (apps/server/src/routes/*). Every response is validated with the core zod
// schemas (or the small view schemas below) so the store only ever sees well-formed data.
import { z } from 'zod';
import {
  IntentAdviceSchema,
  LightingIntentSchema,
  StudioRoomSchema,
  UuidSchema,
  type IntentAdvice,
  type LightingIntent,
  type StudioRoom,
} from '@intent-studio/core';

export const ProjectViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectView = z.infer<typeof ProjectViewSchema>;

export const RoomSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  sourceAssetId: z.string().nullable(),
  updatedAt: z.string(),
});
export type RoomSummary = z.infer<typeof RoomSummarySchema>;

export const RoomViewSchema = RoomSummarySchema.extend({ room: StudioRoomSchema, createdAt: z.string() });
export type RoomView = z.infer<typeof RoomViewSchema>;

export const DesignViewSchema = z.object({
  roomId: z.string(),
  revision: z.number().int().min(0),
  intents: z.array(LightingIntentSchema),
  removedExisting: z.array(UuidSchema).default([]),
  updatedAt: z.string().nullable(),
});
export type DesignView = z.infer<typeof DesignViewSchema>;

const SavedSchema = z.object({ roomId: z.string(), revision: z.number().int(), updatedAt: z.string() });
const ConflictSchema = z.object({ error: z.string().optional(), revision: z.number().int() });

export const AssetViewSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  kind: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  createdAt: z.string(),
  deduped: z.boolean().optional(),
});
export type AssetView = z.infer<typeof AssetViewSchema>;

export type AiSource = 'ai' | 'rules';
export interface AiReply<T> {
  result: T;
  source: AiSource;
  lastIssue?: string;
}
const aiReply = <T extends z.ZodTypeAny>(result: T) =>
  z.object({ result, source: z.enum(['ai', 'rules']), lastIssue: z.string().optional() });

export type SaveResult = { ok: true; revision: number } | { ok: false; conflict: true; revision: number };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StudioApi {
  listProjects(): Promise<ProjectView[]>;
  createProject(name: string): Promise<ProjectView>;
  listRooms(projectId: string): Promise<RoomSummary[]>;
  createRoom(projectId: string, room: StudioRoom, sourceAssetId?: string | null): Promise<RoomView>;
  getRoom(roomId: string): Promise<RoomView>;
  getDesign(roomId: string): Promise<DesignView>;
  putDesign(
    roomId: string,
    body: { revision: number; intents: LightingIntent[]; removedExisting: string[] },
  ): Promise<SaveResult>;
  uploadAsset(kind: 'scene' | 'ies', file: Blob, filename: string): Promise<AssetView>;
  advise(body: { projectId?: string; room: StudioRoom; intents: LightingIntent[] }): Promise<AiReply<IntentAdvice[]>>;
  /** Free text → new intents (the server falls back to the offline interpreter). The rows are re-checked by the store. */
  interpret(body: { projectId?: string; room: StudioRoom; text: string }): Promise<AiReply<LightingIntent[]>>;
  /** "Suggest a design": whole room + the accepted intents → suggested intents (untrusted; re-checked by the store). */
  propose(body: {
    projectId?: string;
    room: StudioRoom;
    intents: { id: string; kind: string; label: string; wallIndex: number | null; objectIndex: number | null }[];
  }): Promise<AiReply<LightingIntent[]>>;
  /** Object classification; the result rows are untrusted and are checked by the scene package. */
  classify(body: { projectId?: string; objects: unknown[] }): Promise<AiReply<unknown[]>>;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const m = body.error ?? body.message;
    if (typeof m === 'string') return m;
  } catch {
    /* not JSON */
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** Build a client. `fetchImpl` is injectable for tests; `base` is '' in the browser (Vite proxies /api). */
export function createApi(fetchImpl: FetchLike = (i, init) => fetch(i, init), base = ''): StudioApi {
  const call = async <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string, init?: RequestInit): Promise<T> => {
    const res = await fetchImpl(base + path, init);
    if (!res.ok) throw new ApiError(res.status, await errorText(res));
    return schema.parse(await res.json());
  };
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    listProjects: () => call(z.array(ProjectViewSchema), '/api/projects'),
    createProject: (name) => call(ProjectViewSchema, '/api/projects', json('POST', { name })),
    listRooms: (projectId) => call(z.array(RoomSummarySchema), `/api/projects/${encodeURIComponent(projectId)}/rooms`),
    createRoom: (projectId, room, sourceAssetId = null) =>
      call(RoomViewSchema, `/api/projects/${encodeURIComponent(projectId)}/rooms`, json('POST', { room, sourceAssetId })),
    getRoom: (roomId) => call(RoomViewSchema, `/api/rooms/${encodeURIComponent(roomId)}`),
    getDesign: (roomId) => call(DesignViewSchema, `/api/rooms/${encodeURIComponent(roomId)}/design`),
    async putDesign(roomId, body) {
      const res = await fetchImpl(`${base}/api/rooms/${encodeURIComponent(roomId)}/design`, json('PUT', body));
      if (res.status === 409) {
        const c = ConflictSchema.safeParse(await res.json().catch(() => ({})));
        return { ok: false, conflict: true, revision: c.success ? c.data.revision : -1 };
      }
      if (!res.ok) throw new ApiError(res.status, await errorText(res));
      return { ok: true, revision: SavedSchema.parse(await res.json()).revision };
    },
    uploadAsset(kind, file, filename) {
      const form = new FormData();
      form.append('file', file, filename);
      return call(AssetViewSchema, `/api/assets?kind=${kind}`, { method: 'POST', body: form });
    },
    advise: (body) => call(aiReply(z.array(IntentAdviceSchema)), '/api/ai/advise', json('POST', body)),
    interpret: (body) => call(aiReply(z.array(LightingIntentSchema)), '/api/ai/interpret', json('POST', body)),
    propose: (body) => call(aiReply(z.array(LightingIntentSchema)), '/api/ai/propose', json('POST', body)),
    classify: (body) => call(aiReply(z.array(z.unknown())), '/api/ai/classify', json('POST', body)),
  };
}
