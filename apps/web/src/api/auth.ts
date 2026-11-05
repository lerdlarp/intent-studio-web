// Optional bearer-token access (server API_TOKEN). Every API request goes through `authFetch`: it sends
// `Authorization: Bearer <token>` when a token is stored; on a 401 it asks the designer for the token (the
// "Access token" dialog registers itself as the prompt), stores it and retries. A rejected token re-prompts (with
// `rejected: true`); cancelling returns the 401 response so the caller reports it as usual. Concurrent 401s share one
// prompt. The token lives in localStorage when it is available, else in memory for this tab.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenStorage {
  get(): string | null;
  set(token: string | null): void;
}

export interface PromptOptions {
  /** The previous token was refused by the server. */
  rejected: boolean;
}
/** Resolves with the token the designer entered, or null when they cancelled. */
export type TokenPrompt = (opts: PromptOptions) => Promise<string | null>;

export const TOKEN_KEY = 'intent-studio.api-token';

/** localStorage with an in-memory fallback (private windows, blocked storage). */
export function browserTokenStorage(): TokenStorage {
  let memory: string | null = null;
  return {
    get() {
      try {
        const v = globalThis.localStorage?.getItem(TOKEN_KEY);
        if (v) return v;
      } catch {
        /* fall back to memory */
      }
      return memory;
    },
    set(token) {
      memory = token;
      try {
        if (token === null) globalThis.localStorage?.removeItem(TOKEN_KEY);
        else globalThis.localStorage?.setItem(TOKEN_KEY, token);
      } catch {
        /* memory only */
      }
    },
  };
}

export interface AuthFetch extends FetchLike {
  /** Install the UI prompt (null removes it: 401 responses are then returned as they are). */
  setPrompt(prompt: TokenPrompt | null): void;
  storage: TokenStorage;
}

const withToken = (init: RequestInit | undefined, token: string | null): RequestInit | undefined => {
  if (!token) return init;
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
};

/** Build an authorising fetch (injectable pieces for tests). Gives up after `maxPrompts` refused tokens in a row. */
export function createAuthFetch(base: FetchLike, storage: TokenStorage, maxPrompts = 10): AuthFetch {
  let prompt: TokenPrompt | null = null;
  let pending: Promise<string | null> | null = null;

  const ask = (opts: PromptOptions): Promise<string | null> => {
    if (!prompt) return Promise.resolve(null);
    pending ??= prompt(opts).finally(() => {
      pending = null;
    });
    return pending;
  };

  const f = (async (input: string, init?: RequestInit) => {
    let sent = storage.get();
    let res = await base(input, withToken(init, sent));
    for (let k = 0; res.status === 401 && k < maxPrompts; k++) {
      // another request may have stored a fresh token meanwhile: try it before asking
      const current = storage.get();
      if (current && current !== sent) {
        sent = current;
        res = await base(input, withToken(init, sent));
        continue;
      }
      const token = (await ask({ rejected: sent !== null }))?.trim() ?? null;
      if (!token) return res;
      storage.set(token);
      sent = token;
      res = await base(input, withToken(init, sent));
    }
    return res;
  }) as AuthFetch;
  f.setPrompt = (p) => {
    prompt = p;
  };
  f.storage = storage;
  return f;
}

/** The app's shared instance. */
export const authFetch: AuthFetch = createAuthFetch((i, init) => fetch(i, init), browserTokenStorage());
