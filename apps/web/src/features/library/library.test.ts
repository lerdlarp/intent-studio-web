import { describe, expect, it } from 'vitest';
import { createLibraryApi, LibraryError } from './api';

const product = { label: 'X · 1,000 lm', lumens: 1000, watts: 10, family: 'downlight', productId: '8713baa4-22dc-51c2-6e01-fb595b1d00b5' };
const view = { id: product.productId, projectId: 'p', product, iesAssetId: 'a1', createdAt: 't' };

describe('library api', () => {
  it('uploads the asset then creates the product from it', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith('/api/assets')) return new Response(JSON.stringify({ id: 'a1', name: 'x.ies' }), { status: 201 });
      return new Response(JSON.stringify(view), { status: 201 });
    };
    const api = createLibraryApi(fetchImpl);
    const v = await api.uploadIes('p', new Blob(['IES']), 'x.ies');
    expect(v.product.lumens).toBe(1000);
    expect(calls[0]!.url).toBe('/api/assets?kind=ies');
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ iesAssetId: 'a1' });
  });
  it('surfaces the server parser error', async () => {
    const api = createLibraryApi(async () => new Response(JSON.stringify({ error: 'not a readable IES LM-63 file: type B …' }), { status: 422 }));
    await expect(api.uploadIes('p', new Blob(['x']), 'b.ies')).rejects.toBeInstanceOf(LibraryError);
    await expect(api.uploadIes('p', new Blob(['x']), 'b.ies')).rejects.toThrow(/type B/);
  });
  it('lists and deletes', async () => {
    const api = createLibraryApi(async (_u, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify([view]), { status: 200 }),
    );
    expect(await api.list('p')).toHaveLength(1);
    await expect(api.remove('p', 'x')).resolves.toBeUndefined();
  });
});
