import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('server', () => {
  it('GET /api/health returns ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
