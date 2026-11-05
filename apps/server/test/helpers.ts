import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { ServerConfig } from '../src/config';
import type { ClaudeClient, ClaudeRequest } from '../src/ai/claude';

export interface TestApp {
  app: FastifyInstance;
  dir: string;
  close(): Promise<void>;
}

export function makeApp(opts: { config?: Partial<ServerConfig>; claude?: ClaudeClient | null } = {}): TestApp {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  const app = buildApp({
    config: { dbPath: path.join(dir, 'db.sqlite'), blobDir: path.join(dir, 'blobs'), apiKey: null, aiRetryDelayMs: 1, ...opts.config },
    claude: opts.claude === undefined ? null : opts.claude,
  });
  return {
    app,
    dir,
    close: async () => {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function multipart(filename: string, content: Buffer | string, mime = 'application/octet-stream') {
  const boundary = '----studiotest' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Fake model: replies are produced by `reply`, which sees every request. */
export class FakeClaude implements ClaudeClient {
  readonly model = 'fake-model';
  calls: ClaudeRequest[] = [];
  constructor(private reply: (req: ClaudeRequest, n: number) => Promise<string> | string) {}
  async complete(req: ClaudeRequest) {
    this.calls.push(req);
    return { text: await this.reply(req, this.calls.length) };
  }
}
