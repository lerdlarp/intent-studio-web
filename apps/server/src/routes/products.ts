import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StudioProductSchema, newUuid, productFromIes, type StudioProduct } from '@intent-studio/core';
import type { Ctx } from '../app';
import { HttpError, IdParams, nowIso, notFound, parse } from '../util';
import { parseIesBlob } from './assets';

// A product is either described by hand (`product` with a label) or built from an uploaded IES asset: the server
// parses the file with core ies.ts (`productFromIes`), stores the parsed photometry on the product (`product.ies`) and
// applies any hand-given fields on top (label, lumens, watts, …; never `ies` or `productId`).
const Overrides = StudioProductSchema.omit({ productId: true, ies: true })
  .partial()
  .extend({ label: z.string().trim().min(1).max(200).optional() });
const Body = z
  .object({
    product: Overrides.optional(),
    iesAssetId: z.string().min(1).nullable().optional(),
  })
  .refine((b) => !!b.iesAssetId || !!b.product?.label, { message: 'a product label or an iesAssetId is required' });

interface Row {
  id: string;
  project_id: string;
  name: string;
  data_json: string;
  ies_asset_id: string | null;
  created_at: string;
}
function storedProduct(json: string): StudioProduct {
  const raw: unknown = JSON.parse(json);
  const p = StudioProductSchema.safeParse(raw);
  if (p.success) return p.data;
  // a row written before ies.ts (opaque ies placeholder): keep the product, drop the unreadable photometry
  const { ies: _drop, ...rest } = (raw ?? {}) as Record<string, unknown>;
  return StudioProductSchema.parse(rest);
}

const view = (r: Row) => ({
  id: r.id,
  projectId: r.project_id,
  product: storedProduct(r.data_json),
  iesAssetId: r.ies_asset_id,
  createdAt: r.created_at,
});

export function productRoutes(app: FastifyInstance, { db, blobs }: Ctx): void {
  const projectExists = (id: string): void => {
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id)) throw notFound('project');
  };

  app.get('/api/projects/:id/products', async (req) => {
    const { id } = parse(IdParams, req.params);
    projectExists(id);
    return (db.prepare('SELECT * FROM products WHERE project_id = ? ORDER BY created_at, id').all(id) as Row[]).map(view);
  });

  app.post('/api/projects/:id/products', async (req, reply) => {
    const { id: projectId } = parse(IdParams, req.params);
    projectExists(projectId);
    const body = parse(Body, req.body);
    let base: StudioProduct | null = null;
    if (body.iesAssetId) {
      const a = db.prepare('SELECT kind, sha256, size, name FROM assets WHERE id = ?').get(body.iesAssetId) as
        | { kind: string; sha256: string; size: number; name: string }
        | undefined;
      if (!a || a.kind !== 'ies') throw new HttpError(422, 'iesAssetId must be an uploaded IES asset');
      if (!blobs.has(a.sha256)) throw new HttpError(422, 'the IES asset file is missing');
      const parsed = parseIesBlob(blobs, a.sha256, a.size);
      if (!parsed.ok) throw new HttpError(422, `not a readable IES LM-63 file: ${parsed.error}`);
      base = productFromIes(parsed.data, a.name);
    }
    const id = newUuid();
    const product = StudioProductSchema.parse({ ...(base ?? {}), ...(body.product ?? {}), productId: id });
    db.prepare('INSERT INTO products (id, project_id, name, data_json, ies_asset_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, projectId, product.label, JSON.stringify(product), body.iesAssetId ?? null, nowIso(),
    );
    return reply.code(201).send(view(db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Row));
  });

  app.delete('/api/projects/:id/products/:productId', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { productId } = parse(z.object({ productId: z.string().min(1).max(64) }), req.params);
    const res = db.prepare('DELETE FROM products WHERE id = ? AND project_id = ?').run(productId, id);
    if (res.changes === 0) throw notFound('product');
    return reply.code(204).send();
  });
}
