import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolve a URL path to a file inside `root`; null when it escapes the root or is not a regular file. */
export function resolveStatic(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function sendFile(reply: FastifyReply, file: string, immutable: boolean): FastifyReply {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return reply
    .type(type)
    .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    .send(fs.createReadStream(file));
}

/**
 * Serve the built web app. Files under /assets/ are content-hashed (immutable cache); everything else revalidates.
 * Unknown non-API GET paths without a file extension fall back to index.html (SPA routing); /api/* keeps its JSON 404.
 */
export function registerStatic(app: FastifyInstance, staticDir: string | null): void {
  if (staticDir === null) return;
  const root = path.resolve(staticDir);
  const index = path.join(root, 'index.html');
  app.setNotFoundHandler((req, reply) => {
    const p = (req.url.split('?')[0] ?? '/') || '/';
    const isApi = p === '/api' || p.startsWith('/api/');
    if ((req.method === 'GET' || req.method === 'HEAD') && !isApi) {
      const file = resolveStatic(root, p);
      if (file) return sendFile(reply, file, p.startsWith('/assets/'));
      if (path.extname(p) === '' && fs.existsSync(index)) return sendFile(reply, index, false);
    }
    return reply.code(404).send({ error: 'not found' });
  });
}
