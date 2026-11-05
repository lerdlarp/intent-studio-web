import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EMPTY_UUID, LightingIntentSchema, StudioRoomSchema, UuidSchema, newUuid, type StudioRoom } from '@intent-studio/core';
import type { Ctx } from '../app';
import { DraftSuggestionsSchema, fitDraft, fitDraftSuggestions, toDraftDocument } from '../draft';
import { HttpError, IdParams, nowIso, notFound, parse } from '../util';

const RoomBody = z.object({ room: StudioRoomSchema, sourceAssetId: z.string().min(1).nullable().optional() });
const DesignBody = z.object({
  revision: z.number().int().min(0),
  intents: z.array(LightingIntentSchema),
  removedExisting: z.array(UuidSchema).default([]),
  /** Optional: source of the open suggestions and the agent's rationale per suggestion id (kept across reloads). */
  suggestions: DraftSuggestionsSchema.nullable().optional(),
});

interface RoomRow {
  id: string;
  project_id: string;
  label: string;
  room_json: string;
  source_asset_id: string | null;
  created_at: string;
  updated_at: string;
}
interface DesignRow {
  room_id: string;
  intents_json: string;
  revision: number;
  updated_at: string;
}

const roomView = (r: RoomRow) => ({
  id: r.id,
  projectId: r.project_id,
  label: r.label,
  room: JSON.parse(r.room_json) as StudioRoom,
  sourceAssetId: r.source_asset_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function roomRoutes(app: FastifyInstance, { db }: Ctx): void {
  const getRoom = (id: string): RoomRow => {
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
    if (!r) throw notFound('room');
    return r;
  };
  const checkAsset = (assetId: string | null | undefined): void => {
    if (assetId && !db.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId)) throw new HttpError(422, 'unknown sourceAssetId');
  };

  app.get('/api/projects/:id/rooms', async (req) => {
    const { id } = parse(IdParams, req.params);
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id)) throw notFound('project');
    return (db.prepare('SELECT * FROM rooms WHERE project_id = ? ORDER BY created_at, id').all(id) as RoomRow[]).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      label: r.label,
      sourceAssetId: r.source_asset_id,
      updatedAt: r.updated_at,
    }));
  });

  app.post('/api/projects/:id/rooms', async (req, reply) => {
    const { id: projectId } = parse(IdParams, req.params);
    const body = parse(RoomBody, req.body);
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw notFound('project');
    checkAsset(body.sourceAssetId);
    const id = body.room.id === EMPTY_UUID ? newUuid() : body.room.id.toLowerCase();
    if (db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) throw new HttpError(409, 'room id already exists');
    const room: StudioRoom = { ...body.room, id };
    const t = nowIso();
    db.prepare(
      'INSERT INTO rooms (id, project_id, label, room_json, source_asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, projectId, room.label, JSON.stringify(room), body.sourceAssetId ?? null, t, t);
    return reply.code(201).send(roomView(getRoom(id)));
  });

  app.get('/api/rooms/:id', async (req) => roomView(getRoom(parse(IdParams, req.params).id)));

  app.put('/api/rooms/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const cur = getRoom(id);
    const body = parse(RoomBody, req.body);
    checkAsset(body.sourceAssetId);
    const room: StudioRoom = { ...body.room, id };
    db.prepare('UPDATE rooms SET label = ?, room_json = ?, source_asset_id = ?, updated_at = ? WHERE id = ?').run(
      room.label,
      JSON.stringify(room),
      body.sourceAssetId === undefined ? cur.source_asset_id : body.sourceAssetId,
      nowIso(),
      id,
    );
    return roomView(getRoom(id));
  });

  app.delete('/api/rooms/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    getRoom(id);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    return reply.code(204).send();
  });

  // ---- design -----------------------------------------------------------------------------------------------
  const loadDesign = (roomId: string) => {
    const room = JSON.parse(getRoom(roomId).room_json) as StudioRoom;
    const row = db.prepare('SELECT * FROM designs WHERE room_id = ?').get(roomId) as DesignRow | undefined;
    if (!row) return { roomId, revision: 0, intents: [], removedExisting: [], suggestions: null, updatedAt: null };
    let doc: unknown = null;
    try {
      doc = JSON.parse(row.intents_json);
    } catch {
      /* unreadable stored text: treated as an empty design */
    }
    const fit = fitDraft(doc, room);
    const removed = (doc as { removedExisting?: unknown } | null)?.removedExisting;
    const known = new Set(room.existing.map((e) => e.id));
    const removedExisting = Array.isArray(removed) ? removed.filter((x): x is string => typeof x === 'string' && known.has(x)) : [];
    const suggestions = fitDraftSuggestions(doc, fit.intents);
    return { roomId, revision: row.revision, intents: fit.intents, removedExisting, suggestions, updatedAt: row.updated_at };
  };

  app.get('/api/rooms/:id/design', async (req) => loadDesign(parse(IdParams, req.params).id));

  app.put('/api/rooms/:id/design', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const room = JSON.parse(getRoom(id).room_json) as StudioRoom;
    const body = parse(DesignBody, req.body);
    // sanitise through the same path as loading, so what is stored is already fitted and slim
    const fit = fitDraft(toDraftDocument(body.intents), room);
    const doc = { ...toDraftDocument(fit.intents, body.suggestions), removedExisting: body.removedExisting };
    const json = JSON.stringify(doc);
    const t = nowIso();
    const write = db.transaction((): number | null => {
      const row = db.prepare('SELECT revision FROM designs WHERE room_id = ?').get(id) as { revision: number } | undefined;
      const current = row?.revision ?? 0;
      if (current !== body.revision) return null;
      if (!row) db.prepare('INSERT INTO designs (room_id, intents_json, revision, updated_at) VALUES (?, ?, 1, ?)').run(id, json, t);
      else db.prepare('UPDATE designs SET intents_json = ?, revision = revision + 1, updated_at = ? WHERE room_id = ?').run(json, t, id);
      return current + 1;
    });
    const revision = write();
    if (revision === null) {
      const row = db.prepare('SELECT revision FROM designs WHERE room_id = ?').get(id) as { revision: number } | undefined;
      return reply.code(409).send({ error: 'stale revision', revision: row?.revision ?? 0 });
    }
    return { roomId: id, revision, updatedAt: t };
  });
}
