import { z } from 'zod';
import type { FastifyReply } from 'fastify';

export const nowIso = (): string => new Date().toISOString();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, `${what} not found`);

/** Parse with zod; failures become a 400 with the issues. */
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, 'invalid request', { issues: r.error.issues });
  return r.data;
}

export const IdParams = z.object({ id: z.string().min(1).max(64) });

export function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...err.extra });
  const e = err as { statusCode?: number; code?: string; message?: string };
  if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message ?? 'bad request' });
  return reply.code(500).send({ error: 'internal error' });
}
