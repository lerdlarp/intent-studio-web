import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/** Constant-time string comparison: hash both sides so length differences leak nothing and the buffers match in size. */
export function tokenMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Pulls the token out of an `Authorization: Bearer <token>` header (scheme case-insensitive). */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return m ? (m[1] as string) : null;
}

/** True for paths that need the token: everything under /api/ except the health probe. */
export function isProtectedPath(url: string): boolean {
  const p = url.split('?')[0] ?? '';
  if (p === '/api/health' || p === '/api/health/') return false;
  return p === '/api' || p.startsWith('/api/');
}

/** Optional single-token auth. No-op when `token` is null (local use). */
export function registerAuth(app: FastifyInstance, token: string | null): void {
  if (token === null) return;
  app.addHook('onRequest', async (req, reply) => {
    if (!isProtectedPath(req.url)) return;
    const given = bearerToken(req.headers.authorization);
    if (given !== null && tokenMatches(given, token)) return;
    return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
  });
}
