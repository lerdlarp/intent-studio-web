import { AI_ISSUES, OFFLINE_ISSUE, type AiIssue } from '@intent-studio/core';
import type { Db } from '../db';
import type { ServerConfig } from '../config';
import { isRetryable, type ClaudeClient } from './claude';
import { nowIso } from '../util';

export interface AiResponse<T> {
  result: T;
  source: 'ai' | 'rules';
  lastIssue?: string;
}

export interface AiCall<T> {
  task: string;
  projectId: string | null;
  system: string;
  user: string;
  maxTokens: number;
  /** null = the reply is unusable (→ fallback, 'unreadable'). Must not throw. */
  parse: (reply: string) => T | null;
  fallback: () => T;
}

/** Redact for the log: designer text beyond 200 chars is cut; anything shaped like an API key is masked. */
export function redact(prompt: string): string {
  return prompt
    .replace(/<designer-text>([\s\S]*?)<\/designer-text>/g, (_m, t: string) => `<designer-text>${t.length > 200 ? `${t.slice(0, 200)}…[redacted ${t.length - 200} chars]` : t}</designer-text>`)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted-key]');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Timeout extends Error {}

/** Sliding one-minute window per key. */
export class Budget {
  private hits = new Map<string, number[]>();
  constructor(
    private limit: number,
    private now: () => number = Date.now,
  ) {}
  take(key: string): boolean {
    const t = this.now();
    const live = (this.hits.get(key) ?? []).filter((h) => t - h < 60_000);
    if (live.length >= this.limit) {
      this.hits.set(key, live);
      return false;
    }
    live.push(t);
    this.hits.set(key, live);
    return true;
  }
}

export class AiRunner {
  readonly budget: Budget;
  constructor(
    private db: Db,
    private config: ServerConfig,
    private claude: ClaudeClient | null,
    now: () => number = Date.now,
  ) {
    this.budget = new Budget(config.aiBudgetPerMinute, now);
  }

  private log(call: AiCall<unknown>, source: string, outcome: string, latency: number, response: string | null): void {
    try {
      this.db
        .prepare('INSERT INTO ai_log (ts, task, project_id, model, source, outcome, latency_ms, prompt, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(nowIso(), call.task, call.projectId, this.claude?.model ?? null, source, outcome, Math.round(latency), redact(call.user), response === null ? null : redact(response).slice(0, 8000));
    } catch {
      /* logging must never break a request */
    }
  }

  async run<T>(call: AiCall<T>): Promise<AiResponse<T>> {
    const started = performance.now();
    const rules = (issue: AiIssue, response: string | null = null): AiResponse<T> => {
      this.log(call, 'rules', issue, performance.now() - started, response);
      return { result: call.fallback(), source: 'rules', lastIssue: issue === 'offline' ? OFFLINE_ISSUE : AI_ISSUES[issue] };
    };
    if (!this.claude) return rules('offline');
    if (!this.budget.take(call.projectId ?? 'global')) return rules('budget');

    const attempt = async (): Promise<string> => {
      const ctl = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          ctl.abort();
          rej(new Timeout());
        }, this.config.aiTimeoutMs);
      });
      try {
        const reply = await Promise.race([
          this.claude!.complete({ system: call.system, user: call.user, maxTokens: call.maxTokens, signal: ctl.signal }),
          timeout,
        ]);
        return reply.text;
      } finally {
        clearTimeout(timer);
      }
    };

    let text: string;
    try {
      try {
        text = await attempt();
      } catch (e) {
        if (!isRetryable(e)) throw e;
        await sleep(this.config.aiRetryDelayMs);
        text = await attempt();
      }
    } catch (e) {
      return rules(e instanceof Timeout ? 'timeout' : 'offline');
    }
    let parsed: T | null = null;
    try {
      parsed = call.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed === null) return rules('unreadable', text);
    this.log(call, 'ai', 'ok', performance.now() - started, text);
    return { result: parsed, source: 'ai' };
  }
}
