import path from 'node:path';

export const ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export interface ServerConfig {
  dbPath: string;
  blobDir: string;
  sceneMaxBytes: number;
  iesMaxBytes: number;
  aiTimeoutMs: number;
  aiBudgetPerMinute: number;
  aiRetryDelayMs: number;
  model: string;
  apiKey: string | null;
}

const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

/** Env → config. Unset values take defaults under `./data`. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.DATA_DIR ?? path.resolve('data');
  const model = env.AI_MODEL ?? DEFAULT_MODEL;
  return {
    dbPath: env.DB_PATH ?? path.join(dataDir, 'studio.db'),
    blobDir: env.BLOB_DIR ?? path.join(dataDir, 'blobs'),
    sceneMaxBytes: num(env.SCENE_MAX_BYTES, 200 * 1024 * 1024),
    iesMaxBytes: num(env.IES_MAX_BYTES, 1024 * 1024),
    aiTimeoutMs: num(env.AI_TIMEOUT_MS, 20_000),
    aiBudgetPerMinute: num(env.AI_BUDGET_PER_MIN, 30),
    aiRetryDelayMs: num(env.AI_RETRY_DELAY_MS, 400),
    model: (ALLOWED_MODELS as readonly string[]).includes(model) ? model : DEFAULT_MODEL,
    apiKey: env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim() !== '' ? env.ANTHROPIC_API_KEY : null,
  };
}
