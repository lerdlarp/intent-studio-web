import { afterEach, describe, expect, it } from 'vitest';
import { createIntent, office, seed } from '@intent-studio/core';
import { makeApp, multipart, type TestApp } from './helpers';

let t: TestApp;
afterEach(async () => t?.close());

const IES = 'IESNA:LM-63-2002\n[TEST] x\nTILT=NONE\n1 1000 1 2 1 1 1 0 0 0\n1 1 10\n0 90\n0\n100 0\n';

async function project(name = 'P') {
  const r = await t.app.inject({ method: 'POST', url: '/api/projects', payload: { name } });
  return r.json().id as string;
}
async function room(pid: string, r = office()) {
  const res = await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/rooms`, payload: { room: r } });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('health', () => {
  it('reports ok', async () => {
    t = makeApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, ai: 'offline' });
  });
});

describe('projects', () => {
  it('create, list, get, rename, delete; validation and 404', async () => {
    t = makeApp();
    const id = await project('Tower');
    expect((await t.app.inject({ method: 'GET', url: '/api/projects' })).json()).toHaveLength(1);
    expect((await t.app.inject({ method: 'GET', url: `/api/projects/${id}` })).json().name).toBe('Tower');
    const put = await t.app.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: { name: 'Tower 2' } });
    expect(put.json().name).toBe('Tower 2');
    expect((await t.app.inject({ method: 'POST', url: '/api/projects', payload: { name: '  ' } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'GET', url: '/api/projects/nope' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/projects/${id}` })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/projects/${id}` })).statusCode).toBe(404);
  });
});

describe('rooms', () => {
  it('create from StudioRoom JSON, list, get, update, delete; cascade with project', async () => {
    t = makeApp();
    const pid = await project();
    const rid = await room(pid);
    const list = (await t.app.inject({ method: 'GET', url: `/api/projects/${pid}/rooms` })).json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(rid);
    const got = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}` })).json();
    expect(got.room.id).toBe(rid);
    expect(got.room.walls.length).toBe(office().walls.length);
    const upd = await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}`, payload: { room: { ...got.room, label: 'Renamed' } } });
    expect(upd.json().room.label).toBe('Renamed');
    expect(upd.json().label).toBe('Renamed');
    expect((await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/rooms`, payload: { room: { floor: 'x' } } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: `/api/projects/nope/rooms`, payload: { room: office() } })).statusCode).toBe(404);
    await t.app.inject({ method: 'DELETE', url: `/api/projects/${pid}` });
    expect((await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}` })).statusCode).toBe(404);
  });

  it('rejects an unknown source asset and a duplicate room id', async () => {
    t = makeApp();
    const pid = await project();
    const r = { ...office(), id: 'a0000204-0000-4000-8000-000000000204' };
    expect((await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/rooms`, payload: { room: r, sourceAssetId: 'zz' } })).statusCode).toBe(422);
    expect((await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/rooms`, payload: { room: r } })).statusCode).toBe(201);
    expect((await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/rooms`, payload: { room: r } })).statusCode).toBe(409);
  });
});

describe('design', () => {
  it('starts empty at revision 0; put needs the current revision; stale → 409', async () => {
    t = makeApp();
    const rid = await room(await project());
    const g0 = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}/design` })).json();
    expect(g0).toMatchObject({ revision: 0, intents: [] });
    const intents = seed(office()).slice(0, 3);
    const p1 = await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 0, intents } });
    expect(p1.statusCode).toBe(200);
    expect(p1.json().revision).toBe(1);
    const stale = await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 0, intents } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'stale revision', revision: 1 });
    const p2 = await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 1, intents: intents.slice(0, 1) } });
    expect(p2.json().revision).toBe(2);
    const g = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}/design` })).json();
    expect(g.revision).toBe(2);
    expect(g.intents).toHaveLength(1);
    expect(g.intents[0].id).toBe(intents[0]?.id);
  });

  it('validates the body', async () => {
    t = makeApp();
    const rid = await room(await project());
    expect((await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 0, intents: [{ nope: 1 }] } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { intents: [] } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'PUT', url: `/api/rooms/nope/design`, payload: { revision: 0, intents: [] } })).statusCode).toBe(404);
  });

  it('slims what is stored and drops wall/object indices the room no longer has on load', async () => {
    t = makeApp();
    const pid = await project();
    const rid = await room(pid);
    const full = office();
    const intent = createIntent({
      kind: 'Accent',
      region: [{ x: 1.234567, y: 2.5 }],
      objectIndex: full.objects.length - 1,
      wallIndex: full.walls.length - 1,
      trace: ['solver trace'],
    });
    const put = await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 0, intents: [intent] } });
    expect(put.statusCode).toBe(200);
    let g = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}/design` })).json();
    expect(g.intents[0]).toMatchObject({ objectIndex: full.objects.length - 1, wallIndex: full.walls.length - 1, trace: [] });
    expect(g.intents[0].region[0]).toEqual({ x: 1.2346, y: 2.5 });
    // the room shrinks: objects and walls vanish
    const smaller = { ...full, objects: [], walls: full.walls.slice(0, 1) };
    await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}`, payload: { room: smaller } });
    g = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}/design` })).json();
    expect(g.intents[0]).toMatchObject({ objectIndex: null, wallIndex: null });
  });

  it('keeps the suggestion source and agent rationale of open suggestions across a reload (optional field)', async () => {
    t = makeApp();
    const rid = await room(await project());
    const intents = seed(office()).slice(0, 3);
    const [a, b] = [intents[0]!, intents[1]!];
    const accepted = { ...b, isSuggestion: false };
    const payload = {
      revision: 0,
      intents: [a, accepted, intents[2]],
      suggestions: { source: 'ai', rationale: { [a.id]: 'Agent: even wash', [b.id]: 'Agent: accepted, dropped', other: 'x' } },
    };
    expect((await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload })).statusCode).toBe(200);
    let g = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}/design` })).json();
    expect(g.suggestions).toEqual({ source: 'ai', rationale: { [a.id]: 'Agent: even wash' } });
    // a save without the field (older client) keeps working and clears it
    await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 1, intents } });
    g = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}/design` })).json();
    expect(g.suggestions).toBeNull();
    expect(g.intents).toHaveLength(3);
    const bad = await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 2, intents, suggestions: { source: 'magic' } } });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT sanitises references against the current room too', async () => {
    t = makeApp();
    const rid = await room(await project());
    const intent = createIntent({ region: [{ x: 1, y: 1 }], objectIndex: 999, wallIndex: 999 });
    await t.app.inject({ method: 'PUT', url: `/api/rooms/${rid}/design`, payload: { revision: 0, intents: [intent] } });
    const g = (await t.app.inject({ method: 'GET', url: `/api/rooms/${rid}/design` })).json();
    expect(g.intents[0]).toMatchObject({ objectIndex: null, wallIndex: null });
  });
});

describe('assets', () => {
  it('uploads a scene, dedupes by content hash, downloads the same bytes', async () => {
    t = makeApp();
    const bytes = Buffer.from('glTF-pretend-binary-\u0000\u0001\u0002');
    const m = multipart('room.glb', bytes, 'model/gltf-binary');
    const a = await t.app.inject({ method: 'POST', url: '/api/assets?kind=scene', ...m });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ kind: 'scene', size: bytes.length, deduped: false });
    const m2 = multipart('copy-of-room.glb', bytes);
    const b = await t.app.inject({ method: 'POST', url: '/api/assets?kind=scene', ...m2 });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ id: a.json().id, deduped: true });
    const dl = await t.app.inject({ method: 'GET', url: `/api/assets/${a.json().id}` });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(bytes)).toBe(true);
    expect(dl.headers['content-disposition']).toContain('room.glb');
    expect((await t.app.inject({ method: 'GET', url: '/api/assets/nope' })).statusCode).toBe(404);
  });

  it('enforces the scene and IES size limits (413) and keeps nothing', async () => {
    t = makeApp({ config: { sceneMaxBytes: 2048, iesMaxBytes: 512 } });
    const big = await t.app.inject({ method: 'POST', url: '/api/assets?kind=scene', ...multipart('big.glb', Buffer.alloc(4096, 1)) });
    expect(big.statusCode).toBe(413);
    const ok = await t.app.inject({ method: 'POST', url: '/api/assets?kind=scene', ...multipart('ok.glb', Buffer.alloc(2048, 1)) });
    expect(ok.statusCode).toBe(201);
    const bigIes = await t.app.inject({ method: 'POST', url: '/api/assets?kind=ies', ...multipart('a.ies', IES + 'x'.repeat(600)) });
    expect(bigIes.statusCode).toBe(413);
    const fs = await import('node:fs');
    const left = fs.readdirSync(`${t.dir}/blobs`);
    expect(left).toHaveLength(1);
    expect(left.some((f) => f.startsWith('.tmp'))).toBe(false);
  });

  it('accepts a small IES, rejects non-IES text, requires kind and multipart', async () => {
    t = makeApp();
    expect((await t.app.inject({ method: 'POST', url: '/api/assets?kind=ies', ...multipart('a.ies', IES) })).statusCode).toBe(201);
    expect((await t.app.inject({ method: 'POST', url: '/api/assets?kind=ies', ...multipart('a.ies', 'hello') })).statusCode).toBe(422);
    expect((await t.app.inject({ method: 'POST', url: '/api/assets', ...multipart('a.ies', IES) })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: '/api/assets?kind=ies', payload: { a: 1 } })).statusCode).toBe(415);
  });

  it('the default IES limit is 1 MB and scene limit 200 MB', async () => {
    t = makeApp();
    const { configFromEnv } = await import('../src/config');
    const c = configFromEnv({});
    expect(c.iesMaxBytes).toBe(1024 * 1024);
    expect(c.sceneMaxBytes).toBe(200 * 1024 * 1024);
    const big = await t.app.inject({ method: 'POST', url: '/api/assets?kind=ies', ...multipart('a.ies', IES + 'x'.repeat(1024 * 1024)) });
    expect(big.statusCode).toBe(413);
  });

  it('links a source asset to a room', async () => {
    t = makeApp();
    const a = (await t.app.inject({ method: 'POST', url: '/api/assets?kind=scene', ...multipart('r.glb', 'abc') })).json();
    const pid = await project();
    const res = await t.app.inject({ method: 'POST', url: `/api/projects/${pid}/rooms`, payload: { room: office(), sourceAssetId: a.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json().sourceAssetId).toBe(a.id);
  });
});

describe('products', () => {
  it('create, list, delete per project; IES reference must be an IES asset', async () => {
    t = makeApp();
    const pid = await project();
    const ies = (await t.app.inject({ method: 'POST', url: '/api/assets?kind=ies', ...multipart('d.ies', IES) })).json();
    const scene = (await t.app.inject({ method: 'POST', url: '/api/assets?kind=scene', ...multipart('s.glb', 'abc') })).json();
    const mk = (payload: Record<string, unknown>) => t.app.inject({ method: 'POST', url: `/api/projects/${pid}/products`, payload });
    const c = await mk({ product: { label: 'Downlight 6in', lumens: 1000, watts: 12 }, iesAssetId: ies.id });
    expect(c.statusCode).toBe(201);
    expect(c.json().product).toMatchObject({ label: 'Downlight 6in', lumens: 1000, productId: c.json().id });
    expect((await mk({ product: { label: 'x' }, iesAssetId: scene.id })).statusCode).toBe(422);
    expect((await mk({ product: { label: '' } })).statusCode).toBe(400);
    const list = (await t.app.inject({ method: 'GET', url: `/api/projects/${pid}/products` })).json();
    expect(list).toHaveLength(1);
    const other = await project('other');
    expect((await t.app.inject({ method: 'DELETE', url: `/api/projects/${other}/products/${c.json().id}` })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/projects/${pid}/products/${c.json().id}` })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: `/api/projects/${pid}/products` })).json()).toEqual([]);
  });
});
