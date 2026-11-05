import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newUuid } from '@intent-studio/core';
import type { Ctx } from '../app';
import { IdParams, nowIso, notFound, parse } from '../util';

const Body = z.object({ name: z.string().trim().min(1).max(200) });

interface Row {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
const view = (r: Row) => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at });

export function projectRoutes(app: FastifyInstance, { db }: Ctx): void {
  app.get('/api/projects', async () =>
    (db.prepare('SELECT * FROM projects ORDER BY created_at, id').all() as Row[]).map(view),
  );

  app.post('/api/projects', async (req, reply) => {
    const { name } = parse(Body, req.body);
    const id = newUuid();
    const t = nowIso();
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, t, t);
    return reply.code(201).send(view({ id, name, created_at: t, updated_at: t }));
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw notFound('project');
    return view(r);
  });

  app.put('/api/projects/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { name } = parse(Body, req.body);
    const t = nowIso();
    const res = db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, t, id);
    if (res.changes === 0) throw notFound('project');
    return view(db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const res = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (res.changes === 0) throw notFound('project');
    return reply.code(204).send();
  });
}
