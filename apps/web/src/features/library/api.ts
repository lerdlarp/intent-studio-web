// Project product library API (server routes/products.ts + assets.ts): list, upload an IES file → parsed product,
// delete. Responses are validated with the core zod schemas.
import { z } from 'zod';
import { StudioProductSchema, type StudioProduct } from '@intent-studio/core';

export const ProductViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  product: StudioProductSchema,
  iesAssetId: z.string().nullable(),
  createdAt: z.string(),
});
export type ProductView = z.infer<typeof ProductViewSchema>;

const AssetSchema = z.object({ id: z.string(), name: z.string() }).passthrough();

export class LibraryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LibraryError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LibraryApi {
  list(projectId: string): Promise<ProductView[]>;
  /** Upload an IES file and create a project product from it (the server parses it; 422 carries the parser error). */
  uploadIes(projectId: string, file: Blob, filename: string): Promise<ProductView>;
  remove(projectId: string, productId: string): Promise<void>;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* not JSON */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export function createLibraryApi(fetchImpl: FetchLike = (i, init) => fetch(i, init), base = ''): LibraryApi {
  const call = async <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string, init?: RequestInit): Promise<T> => {
    const res = await fetchImpl(base + path, init);
    if (!res.ok) throw new LibraryError(res.status, await errorText(res));
    return schema.parse(await res.json());
  };
  return {
    list: (projectId) => call(z.array(ProductViewSchema), `/api/projects/${encodeURIComponent(projectId)}/products`),
    async uploadIes(projectId, file, filename) {
      const form = new FormData();
      form.append('file', file, filename);
      const asset = await call(AssetSchema, '/api/assets?kind=ies', { method: 'POST', body: form });
      return call(ProductViewSchema, `/api/projects/${encodeURIComponent(projectId)}/products`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ iesAssetId: asset.id }),
      });
    },
    async remove(projectId, productId) {
      const res = await fetchImpl(
        `${base}/api/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(productId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new LibraryError(res.status, await errorText(res));
    },
  };
}

/** Products of a library listing, in listing order (what the ranker's project list wants). */
export const productsOf = (views: readonly ProductView[]): StudioProduct[] => views.map((v) => v.product);
