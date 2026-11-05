// IES upload parsing (assets) and IES-backed products (products routes).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioProductSchema } from '@intent-studio/core';
import { makeApp, multipart, type TestApp } from './helpers';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/core/test/fixtures/ies');
const fixture = (n: string): string => fs.readFileSync(path.join(fixtures, n), 'utf8');

let t: TestApp;
afterEach(async () => t?.close());

async function project(): Promise<string> {
  return (await t.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'P' } })).json().id as string;
}
const upload = (name: string, body: string) => t.app.inject({ method: 'POST', url: '/api/assets?kind=ies', ...multipart(name, body) });

describe('IES assets', () => {
  it('parses on upload and returns the derived photometry and a product preview', async () => {
    t = makeApp();
    const r = await upload('lambert.ies', fixture('lambert-2002.ies'));
    expect(r.statusCode).toBe(201);
    const ies = r.json().ies;
    expect(ies.format).toBe('LM-63-2002');
    expect(Math.abs(ies.derived.lumens / (Math.PI * 1000) - 1)).toBeLessThan(0.01);
    expect(ies.derived.beamAngle).toBeCloseTo(120, 0);
    expect(ies.product).toMatchObject({ watts: 30, family: 'downlight-ho', brand: 'Example Works' });
    expect(ies.product.ies).toBeUndefined();
    const again = await upload('copy.ies', fixture('lambert-2002.ies'));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ deduped: true, id: r.json().id });
    expect(again.json().ies.derived.lumens).toBe(ies.derived.lumens);
  });
  it('rejects unparsable files with 422 and the parser error, keeping no blob', async () => {
    t = makeApp();
    const typeB = await upload('b.ies', fixture('typeb-2002.ies'));
    expect(typeB.statusCode).toBe(422);
    expect(typeB.json().error).toMatch(/type B/);
    const truncated = await upload('t.ies', 'IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 3 1 1 1 0 0 0\n');
    expect(truncated.statusCode).toBe(422);
    expect(truncated.json().error).toContain('ends early');
    const noTilt = await upload('n.ies', 'hello');
    expect(noTilt.statusCode).toBe(422);
    expect(noTilt.json().error).toContain('TILT');
    expect(fs.readdirSync(path.join(t.dir, 'blobs'))).toEqual([]);
  });
});

describe('IES products', () => {
  it('creates a product from an uploaded IES asset with parsed photometry; GET returns it parsed', async () => {
    t = makeApp();
    const pid = await project();
    const a = (await upload('WW-6.ies', fixture('washer-2019.ies'))).json();
    const c = await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/products`, payload: { iesAssetId: a.id } });
    expect(c.statusCode).toBe(201);
    const p = c.json().product;
    expect(p).toMatchObject({ family: 'wallwash', asymmetric: true, productId: c.json().id, watts: 12, isGeneric: false });
    expect(p.ies.derived.symmetry).toBe('full');
    expect(c.json().iesAssetId).toBe(a.id);
    const list = (await t.app.inject({ method: 'GET', url: `/api/projects/${pid}/products` })).json();
    expect(list).toHaveLength(1);
    const parsed = StudioProductSchema.safeParse(list[0].product);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.ies?.candela.length).toBe(24);
  });
  it('hand-given fields override the file (label, lumens) but never the photometry', async () => {
    t = makeApp();
    const pid = await project();
    const a = (await upload('dl.ies', fixture('downlight-1995.ies'))).json();
    const c = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${pid}/products`,
      payload: { iesAssetId: a.id, product: { label: 'My downlight', lumens: 1000, ies: { nope: 1 }, productId: 'x' } },
    });
    expect(c.statusCode).toBe(201);
    expect(c.json().product).toMatchObject({ label: 'My downlight', lumens: 1000, productId: c.json().id });
    expect(c.json().product.ies.format).toBe('LM-63-1995');
  });
  it('needs a label or an IES asset; a stored unreadable IES asset is a 422', async () => {
    t = makeApp();
    const pid = await project();
    expect((await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/products`, payload: {} })).statusCode).toBe(400);
    // an asset row from before parsing was enforced, pointing at bytes the parser rejects
    const blobDir = path.join(t.dir, 'blobs');
    const sha = 'a'.repeat(64);
    fs.writeFileSync(path.join(blobDir, sha), 'TILT=NONE\n1 2 3');
    const { openDb } = await import('../src/db');
    const raw = openDb(path.join(t.dir, 'db.sqlite'));
    raw.prepare('INSERT INTO assets (id, sha256, kind, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('old', sha, 'ies', 'old.ies', 'text/plain', 15, 'x');
    raw.close();
    const r = await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/products`, payload: { iesAssetId: 'old' } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toContain('not a readable IES');
  });
});
