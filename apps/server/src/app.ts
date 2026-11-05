import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { configFromEnv, type ServerConfig } from './config';
import { openDb, type Db } from './db';
import { BlobStore } from './blobs';
import { AnthropicClaude, type ClaudeClient } from './ai/claude';
import { AiRunner } from './ai/run';
import { sendError } from './util';
import { projectRoutes } from './routes/projects';
import { roomRoutes } from './routes/rooms';
import { assetRoutes } from './routes/assets';
import { productRoutes } from './routes/products';
import { aiRoutes } from './routes/ai';

export interface Ctx {
  db: Db;
  config: ServerConfig;
  blobs: BlobStore;
  ai: AiRunner;
}

export interface BuildOptions {
  config?: Partial<ServerConfig>;
  /** Inject a model client (tests). `undefined` = build from config.apiKey; `null` = force offline. */
  claude?: ClaudeClient | null;
  now?: () => number;
}

export function buildApp(opts: BuildOptions = {}): FastifyInstance {
  const config: ServerConfig = { ...configFromEnv(), ...opts.config };
  const db = openDb(config.dbPath);
  const blobs = new BlobStore(config.blobDir);
  const claude =
    opts.claude !== undefined ? opts.claude : config.apiKey ? new AnthropicClaude(config.apiKey, config.model) : null;
  const ai = new AiRunner(db, config, claude, opts.now);
  const ctx: Ctx = { db, config, blobs, ai };

  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  app.register(multipart, { limits: { fileSize: Math.max(config.sceneMaxBytes, config.iesMaxBytes) + 1, files: 1, fields: 10 } });
  app.setErrorHandler((err, _req, reply) => sendError(reply, err));
  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/api/health', async () => ({ ok: true, ai: claude ? 'online' : 'offline' }));
  projectRoutes(app, ctx);
  roomRoutes(app, ctx);
  assetRoutes(app, ctx);
  productRoutes(app, ctx);
  aiRoutes(app, ctx);
  return app;
}

