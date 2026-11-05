import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StudioProductSchema, newUuid, type StudioProduct } from '@intent-studio/core';
import type { Ctx } from '../app';
import { HttpError, IdParams, nowIso, notFound, parse } from '../util';

// Parsed IES photometry arrives with ies.ts in core; for now store the raw asset reference + product metadata.
const Body = z.object({
  product: StudioProductSchema.partial({ productId: true }).extend({ label: z.string().trim().min(1).max(200) }),
  iesAssetId: z.string().min(1).nullable().optional(),
});

interface Row {
  id: string;
  project_id: string;
  name: string;
  data_json: string;
  ies_asset_id: string | null;
  created_at: string;
}
const view = (r: Row) => ({
  id: r.id,
  projectId: r.project_id,
  product: JSON.parse(r.data_json) as StudioProduct,
  iesAssetId: r.ies_asset_id,
  createdAt: r.created_at,
});

export function productRoutes(app: FastifyInstance, { db }: Ctx): void {
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
    if (body.iesAssetId) {
      const a = db.prepare('SELECT kind FROM assets WHERE id = ?').get(body.iesAssetId) as { kind: string } | undefined;
      if (!a || a.kind !== 'ies') throw new HttpError(422, 'iesAssetId must be an uploaded IES asset');
    }
    const id = newUuid();
    const product = StudioProductSchema.parse({ ...body.product, productId: id });
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
