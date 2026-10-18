// Which responses are compressed, and which never are.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { COMPRESSION_THRESHOLD_BYTES, isAuthPath, responseCompression } from './compression';

const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `employee ${i}` })) };

const appWith = (basePath = ''): Express => {
  const app = express();
  app.use(responseCompression(basePath));
  const api = express.Router();
  api.get('/list', (_req, res) => {
    res.json(big);
  });
  api.get('/tiny', (_req, res) => {
    res.json({ ok: true });
  });
  api.get('/picture', (_req, res) => {
    res.type('image/jpeg').send(Buffer.alloc(8 * COMPRESSION_THRESHOLD_BYTES, 7));
  });
  api.get('/events', (_req, res) => {
    res.type('text/event-stream').send('data: x\n\n'.repeat(400));
  });
  const auth = express.Router();
  auth.post('/login', (_req, res) => {
    res.json({ accessToken: 'secret'.repeat(400), ...big });
  });
  api.use('/auth', auth);
  app.use(`${basePath}/api/v1`, api);
  return app;
};

const encodingOf = async (
  app: Express,
  path: string,
  headers: Record<string, string> = {},
  method: 'get' | 'post' = 'get',
): Promise<string | undefined> => {
  let call = request(app)[method](path).set('Accept-Encoding', 'gzip, deflate, br');
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
  const response = await call;
  expect(response.status).toBeLessThan(300);
  return response.headers['content-encoding'] as string | undefined;
};

describe('response compression', () => {
  it('compresses a JSON response a browser accepts compressed, and says it varies by encoding', async () => {
    const response = await request(appWith())
      .get('/api/v1/list')
      .set('Accept-Encoding', 'gzip, deflate, br');
    expect(['br', 'gzip']).toContain(response.headers['content-encoding']);
    expect(response.headers['vary']).toMatch(/Accept-Encoding/i);
    // And the body still arrives intact.
    expect(response.body).toEqual(big);
  });

  it('sends it plain to a client that asks for no encoding', async () => {
    expect(
      await encodingOf(appWith(), '/api/v1/list', { 'Accept-Encoding': 'identity' }),
    ).toBeUndefined();
  });

  it('leaves a response under the threshold alone', async () => {
    expect(await encodingOf(appWith(), '/api/v1/tiny')).toBeUndefined();
  });

  it('leaves bytes that are already compressed alone', async () => {
    expect(await encodingOf(appWith(), '/api/v1/picture')).toBeUndefined();
  });

  it('never compresses the auth routes — their bodies carry tokens (BREACH)', async () => {
    expect(await encodingOf(appWith(), '/api/v1/auth/login', {}, 'post')).toBeUndefined();
  });

  it('never compresses the auth routes under a deployment prefix either', async () => {
    const app = appWith('/ecms');
    expect(await encodingOf(app, '/ecms/api/v1/auth/login', {}, 'post')).toBeUndefined();
    expect(['br', 'gzip']).toContain(await encodingOf(app, '/ecms/api/v1/list'));
  });

  it('never compresses a partial response or server-sent events', async () => {
    expect(await encodingOf(appWith(), '/api/v1/list', { Range: 'bytes=0-99' })).toBeUndefined();
    expect(await encodingOf(appWith(), '/api/v1/events')).toBeUndefined();
  });

  it('knows the auth routes by path, and nothing that merely starts like them', () => {
    expect(isAuthPath('/api/v1/auth', '')).toBe(true);
    expect(isAuthPath('/api/v1/auth/refresh', '')).toBe(true);
    expect(isAuthPath('/ecms/api/v1/auth/login', '/ecms')).toBe(true);
    expect(isAuthPath('/api/v1/authorizations', '')).toBe(false);
    expect(isAuthPath('/api/v1/platform/users', '')).toBe(false);
  });
});

describe('the app compresses everything it serves', () => {
  it('installs compression before the api routes and the web bundle', () => {
    // Express runs middleware in order: installed after a router, compression never sees what that
    // router sends.
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../app.ts'), 'utf8');
    const compressionAt = app.indexOf('app.use(responseCompression(env.BASE_PATH))');
    expect(compressionAt).toBeGreaterThan(-1);
    expect(compressionAt).toBeLessThan(app.indexOf('app.use(`${env.BASE_PATH}/api/v1`, api)'));
    expect(compressionAt).toBeLessThan(app.indexOf('express.static('));
  });
});
