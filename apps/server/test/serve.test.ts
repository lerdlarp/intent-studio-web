import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bearerToken, isProtectedPath, tokenMatches } from '../src/auth';
import { configFromEnv } from '../src/config';
import { resolveStatic } from '../src/static';
import { makeApp, type TestApp } from './helpers';

const open: TestApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function webDist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dist-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Studio</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, '..', path.basename(dir) + '-secret.txt'), 'secret');
  dirs.push(path.join(dir, '..', path.basename(dir) + '-secret.txt'));
  return dir;
}

function make(config: Parameters<typeof makeApp>[0]) {
  const t = makeApp(config);
  open.push(t);
  return t.app;
}

describe('config', () => {
  it('reads STATIC_DIR and API_TOKEN; blanks mean off', () => {
    expect(configFromEnv({}).staticDir).toBeNull();
    expect(configFromEnv({ STATIC_DIR: ' ', API_TOKEN: '' }).apiToken).toBeNull();
    const c = configFromEnv({ STATIC_DIR: 'dist', API_TOKEN: 's3cret' });
    expect(path.isAbsolute(c.staticDir!)).toBe(true);
    expect(c.apiToken).toBe('s3cret');
  });
});

describe('auth helpers', () => {
  it('compares tokens exactly', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abc', 'abd')).toBe(false);
    expect(tokenMatches('abc', 'abcd')).toBe(false);
    expect(tokenMatches('', 'abc')).toBe(false);
  });
  it('parses bearer headers', () => {
    expect(bearerToken('Bearer xyz')).toBe('xyz');
    expect(bearerToken('bearer xyz')).toBe('xyz');
    expect(bearerToken('Basic xyz')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
  it('protects /api except health', () => {
    expect(isProtectedPath('/api/health')).toBe(false);
    expect(isProtectedPath('/api/health?x=1')).toBe(false);
    expect(isProtectedPath('/api/projects')).toBe(true);
    expect(isProtectedPath('/api')).toBe(true);
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/apiary')).toBe(false);
  });
});

describe('API_TOKEN', () => {
  it('is off by default', async () => {
    const app = make({});
    expect((await app.inject({ url: '/api/projects' })).statusCode).toBe(200);
  });
  it('rejects missing / wrong tokens, accepts the right one, keeps health open', async () => {
    const app = make({ config: { apiToken: 'tok-123' } });
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    const none = await app.inject({ url: '/api/projects' });
    expect(none.statusCode).toBe(401);
    expect(none.headers['www-authenticate']).toBe('Bearer');
    expect((await app.inject({ url: '/api/projects', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/projects', headers: { authorization: 'Basic tok-123' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/projects', headers: { authorization: 'Bearer tok-123' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' } })).statusCode).toBe(401);
  });
  it('does not gate static files', async () => {
    const app = make({ config: { apiToken: 't', staticDir: webDist() } });
    expect((await app.inject({ url: '/' })).statusCode).toBe(200);
  });
});

describe('STATIC_DIR', () => {
  it('serves index, assets and falls back to index for SPA routes', async () => {
    const app = make({ config: { staticDir: webDist() } });
    const root = await app.inject({ url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.headers['cache-control']).toBe('no-cache');
    expect(root.body).toContain('<title>Studio</title>');
    const js = await app.inject({ url: '/assets/app-abc.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    const spa = await app.inject({ url: '/project/123/room/4' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('<title>Studio</title>');
  });
  it('missing files with an extension, unknown /api paths and non-GET stay 404', async () => {
    const app = make({ config: { staticDir: webDist() } });
    expect((await app.inject({ url: '/assets/missing.js' })).statusCode).toBe(404);
    const api = await app.inject({ url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
    expect((await app.inject({ method: 'POST', url: '/somewhere' })).statusCode).toBe(404);
  });
  it('does not escape the root', async () => {
    const dir = webDist();
    const secret = path.basename(dir) + '-secret.txt';
    const app = make({ config: { staticDir: dir } });
    expect(resolveStatic(dir, `/../${secret}`)).toBeNull();
    expect(resolveStatic(dir, `/%2e%2e/${secret}`)).toBeNull();
    expect(resolveStatic(dir, '/%00')).toBeNull();
    expect((await app.inject({ url: `/..%2f${secret}` })).body).not.toContain('secret');
    expect((await app.inject({ url: `/%2e%2e/${secret}` })).body).not.toContain('secret');
  });
  it('is off when unset', async () => {
    const app = make({});
    expect((await app.inject({ url: '/' })).statusCode).toBe(404);
  });
});

describe('request logging', () => {
  it('logs method, path, status and time without query or body', async () => {
    const lines: string[] = [];
    const { buildApp } = await import('../src/app');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-log-'));
    dirs.push(dir);
    const app = buildApp({ config: { dbPath: path.join(dir, 'db'), blobDir: path.join(dir, 'b'), apiKey: null }, claude: null, log: (l) => lines.push(l) });
    await app.inject({ method: 'POST', url: '/api/projects?token=leak', payload: { name: 'topsecretname' } });
    await app.close();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^POST \/api\/projects \d{3} \d+ms$/);
    expect(lines[0]).not.toContain('leak');
    expect(lines[0]).not.toContain('topsecretname');
  });
});
