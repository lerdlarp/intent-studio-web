import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import { newUuid, parseIes, productFromIes, type IesParseResult } from '@intent-studio/core';
import type { Ctx } from '../app';
import { TooLargeError, type BlobStore } from '../blobs';
import { HttpError, IdParams, nowIso, notFound, parse } from '../util';

const Query = z.object({ kind: z.enum(['scene', 'ies']) });

interface Row {
  id: string;
  sha256: string;
  kind: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
}
/** Read a stored IES blob as text (LM-63 files are ASCII; latin1 keeps any stray byte 1:1) and parse it. */
export function parseIesBlob(blobs: BlobStore, sha256: string, size: number): IesParseResult {
  return parseIes(blobs.head(sha256, size).toString('latin1'));
}

/** Summary of a parsed IES file for upload responses (the full table lives on the product). */
function iesSummary(r: Extract<IesParseResult, { ok: true }>, name: string) {
  const p = productFromIes(r.data, name);
  return {
    format: r.data.format,
    warnings: r.warnings,
    derived: r.data.derived,
    inputWatts: r.data.inputWatts,
    opening: r.data.opening,
    product: { ...p, ies: undefined },
  };
}

export const assetView = (r: Row) => ({ id: r.id, sha256: r.sha256, kind: r.kind, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at });

export function assetRoutes(app: FastifyInstance, { db, blobs, config }: Ctx): void {
  app.post('/api/assets', async (req, reply) => {
    const { kind } = parse(Query, req.query);
    if (!req.isMultipart()) throw new HttpError(415, 'multipart/form-data required');
    const max = kind === 'scene' ? config.sceneMaxBytes : config.iesMaxBytes;
    const file = await req.file();
    if (!file) throw new HttpError(400, 'no file');
    let stored: { sha256: string; size: number };
    try {
      stored = await blobs.put(file.file, max);
    } catch (e) {
      if (e instanceof TooLargeError) throw new HttpError(413, `${kind} files are limited to ${max} bytes`);
      throw e;
    }
    if (file.file.truncated) throw new HttpError(413, 'file too large');
    const existing = db.prepare('SELECT * FROM assets WHERE sha256 = ? AND kind = ?').get(stored.sha256, kind) as Row | undefined;
    const name = (file.filename || 'upload').replace(/[\\/\0]/g, '_').slice(0, 200);
    let ies: ReturnType<typeof iesSummary> | undefined;
    if (kind === 'ies') {
      const parsed = parseIesBlob(blobs, stored.sha256, stored.size);
      if (!parsed.ok) {
        // drop the blob unless another asset row already owns these bytes
        if (!db.prepare('SELECT 1 FROM assets WHERE sha256 = ?').get(stored.sha256)) fs.rmSync(blobs.pathFor(stored.sha256), { force: true });
        throw new HttpError(422, `not a readable IES LM-63 file: ${parsed.error}`);
      }
      ies = iesSummary(parsed, existing?.name ?? name);
    }
    if (existing) return reply.code(200).send({ ...assetView(existing), deduped: true, ...(ies ? { ies } : {}) });
    const id = newUuid();
    const mime = kind === 'ies' ? 'text/plain; charset=utf-8' : file.mimetype || 'application/octet-stream';
    const t = nowIso();
    db.prepare('INSERT INTO assets (id, sha256, kind, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, stored.sha256, kind, name, mime, stored.size, t,
    );
    return reply
      .code(201)
      .send({ ...assetView({ id, sha256: stored.sha256, kind, name, mime, size: stored.size, created_at: t }), deduped: false, ...(ies ? { ies } : {}) });
  });

  app.get('/api/assets/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const r = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;
    if (!r || !blobs.has(r.sha256)) throw notFound('asset');
    return reply
      .header('content-type', r.mime)
      .header('content-length', r.size)
      .header('content-disposition', `attachment; filename="${r.name.replace(/[^\w.\- ]/g, '_')}"`)
      .header('x-content-type-options', 'nosniff')
      .send(blobs.read(r.sha256));
  });

  app.get('/api/assets/:id/meta', async (req) => {
    const { id } = parse(IdParams, req.params);
    const r = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw notFound('asset');
    return assetView(r);
  });
}
