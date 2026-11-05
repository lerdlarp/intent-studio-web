import { describe, expect, it, vi } from 'vitest';
import { createAuthFetch, type TokenStorage } from './auth';
import { ApiError, createApi } from './client';

const memory = (initial: string | null = null): TokenStorage => {
  let v = initial;
  return { get: () => v, set: (t) => (v = t) };
};

/** Fake server: /api/* needs `Bearer good`. Records the authorization header of every call. */
function server() {
  const seen: (string | null)[] = [];
  const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization');
    seen.push(auth);
    if (auth !== 'Bearer good') return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    return new Response(JSON.stringify([{ id: 'p', name: 'P', createdAt: 't', updatedAt: 't' }]), { status: 200 });
  });
  return { fetch, seen };
}

describe('bearer token access', () => {
  it('no token stored: 401 → prompt → retry with the token, which is stored', async () => {
    const s = server();
    const storage = memory();
    const f = createAuthFetch(s.fetch, storage);
    const prompt = vi.fn(async () => 'good');
    f.setPrompt(prompt);
    const projects = await createApi(f).listProjects();
    expect(projects).toHaveLength(1);
    expect(prompt).toHaveBeenCalledWith({ rejected: false });
    expect(storage.get()).toBe('good');
    expect(s.seen).toEqual([null, 'Bearer good']);
    // the next call sends the stored token straight away
    await createApi(f).listProjects();
    expect(s.seen.at(-1)).toBe('Bearer good');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('a wrong token re-prompts with rejected: true', async () => {
    const s = server();
    const f = createAuthFetch(s.fetch, memory());
    const answers = ['bad', 'good'];
    const prompt = vi.fn(async (_opts: { rejected: boolean }) => answers.shift() ?? null);
    f.setPrompt(prompt);
    await createApi(f).listProjects();
    expect(prompt.mock.calls.map((c) => c[0])).toEqual([{ rejected: false }, { rejected: true }]);
    expect(s.seen).toEqual([null, 'Bearer bad', 'Bearer good']);
  });

  it('a stale stored token prompts as rejected; cancel returns the 401 (ApiError 401)', async () => {
    const s = server();
    const f = createAuthFetch(s.fetch, memory('old'));
    const prompt = vi.fn(async () => null);
    f.setPrompt(prompt);
    await expect(createApi(f).listProjects()).rejects.toMatchObject({ status: 401 });
    await expect(createApi(f).listProjects()).rejects.toBeInstanceOf(ApiError);
    expect(prompt).toHaveBeenCalledWith({ rejected: true });
  });

  it('concurrent 401s share one prompt', async () => {
    const s = server();
    const f = createAuthFetch(s.fetch, memory());
    let release: (t: string) => void = () => {};
    const prompt = vi.fn(() => new Promise<string | null>((r) => (release = r)));
    f.setPrompt(prompt);
    const api = createApi(f);
    const both = Promise.all([api.listProjects(), api.listProjects()]);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    release('good');
    expect(await both).toHaveLength(2);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('without a prompt (no UI) the 401 is returned as is', async () => {
    const s = server();
    const f = createAuthFetch(s.fetch, memory());
    await expect(createApi(f).listProjects()).rejects.toMatchObject({ status: 401 });
  });
});
