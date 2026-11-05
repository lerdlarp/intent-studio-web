import Anthropic from '@anthropic-ai/sdk';

/** What the AI routes need from a model: one system prompt + one user message in, text out. Tests inject a fake. */
export interface ClaudeRequest {
  /** Stable across calls (instructions + target table): sent as a cached block. */
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
}
export interface ClaudeReply {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}
export interface ClaudeClient {
  readonly model: string;
  complete(req: ClaudeRequest): Promise<ClaudeReply>;
}

/** Error carrying an HTTP-ish status so the runner can decide to retry (5xx / overload). */
export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const isRetryable = (e: unknown): boolean => {
  const s = (e as { status?: number } | null)?.status;
  return typeof s === 'number' && (s >= 500 || s === 429);
};

/** Real client over the Anthropic SDK. The key never leaves the server. */
export class AnthropicClaude implements ClaudeClient {
  private readonly sdk: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    // Retries are owned by the AI runner (exactly one), so the SDK's own are off.
    this.sdk = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async complete(req: ClaudeRequest): Promise<ClaudeReply> {
    try {
      const res = await this.sdk.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          // system prompt + target table are identical across calls: cache them
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: req.user }],
        },
        { signal: req.signal },
      );
      if (res.stop_reason === 'refusal') throw new ClaudeError('refusal');
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return {
        text,
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? undefined,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? undefined,
        },
      };
    } catch (e) {
      if (e instanceof ClaudeError) throw e;
      if (e instanceof Anthropic.APIError) throw new ClaudeError(e.message, e.status);
      throw e;
    }
  }
}
