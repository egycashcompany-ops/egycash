// Which responses are compressed, and which never are.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { drainingWriter } from '../../shared/utils/draining-writer';
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

  it('never compresses another spelling of an auth path that Express routes there', async () => {
    // Express matches paths regardless of case, and its mount accepts a doubled slash: each of
    // these reaches the login handler (encodingOf checks the 2xx).
    for (const path of ['/API/v1/auth/login', '/api/v1/AUTH/login', '/api/v1//auth/login']) {
      expect(await encodingOf(appWith(), path, {}, 'post'), path).toBeUndefined();
    }
    expect(
      await encodingOf(appWith('/ecms'), '/ECMS/api/v1/auth/login', {}, 'post'),
    ).toBeUndefined();
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

  it('knows them whatever their case, and with repeated slashes', () => {
    expect(isAuthPath('/API/v1/auth/login', '')).toBe(true);
    expect(isAuthPath('/api/v1/Auth/login', '')).toBe(true);
    expect(isAuthPath('/api/v1//auth/login', '')).toBe(true);
    expect(isAuthPath('/api/v1//AUTH', '')).toBe(true);
    expect(isAuthPath('/ECMS/api/v1/auth/login', '/ecms')).toBe(true);
    expect(isAuthPath('/ecms/api/v1//auth/login', '/ECMS')).toBe(true);
    expect(isAuthPath('/API/v1/Authorizations', '')).toBe(false);
    expect(isAuthPath('/api/v1//authorizations', '')).toBe(false);
  });
});

describe('a streamed CSV export behind compression', () => {
  it('arrives whole, and its waits for drain leave no listener behind', async () => {
    const rows = 50_000;
    const warnings: Error[] = [];
    const onWarning = (warning: Error): void => {
      warnings.push(warning);
    };
    process.on('warning', onWarning);
    // The gzip streams the middleware makes, to count the 'drain' listeners it moves onto them.
    const gzips: zlib.Gzip[] = [];
    const createGzip = zlib.createGzip;
    const spy = vi.spyOn(zlib, 'createGzip').mockImplementation((options) => {
      const gzip = createGzip(options);
      gzips.push(gzip);
      return gzip;
    });
    const row = (i: number): string => `${i},employee ${i},${'note-'.repeat(8)}\n`;
    let waits = 0;
    let mostDrainListeners = 0;
    try {
      const app = express();
      app.use(responseCompression(''));
      app.get('/api/v1/export.csv', (_req, res) => {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        // Counts the writes that hit backpressure, so the test knows it waited often enough to
        // matter: more than the 10 listeners after which Node warns.
        const compressedWrite = res.write.bind(res) as (chunk: string) => boolean;
        res.write = ((chunk: string) => {
          const accepted = compressedWrite(chunk);
          if (!accepted) waits += 1;
          return accepted;
        }) as typeof res.write;
        const write = drainingWriter(res);
        void (async () => {
          await write('id,name,note\n');
          for (let i = 0; i < rows; i += 1) {
            await write(row(i));
            for (const gzip of gzips) {
              mostDrainListeners = Math.max(mostDrainListeners, gzip.listenerCount('drain'));
            }
          }
          res.end();
        })();
      });

      const response = await request(app).get('/api/v1/export.csv').set('Accept-Encoding', 'gzip');
      // Node emits the warning on a later tick than the listener that tripped it.
      await new Promise((resolve) => setImmediate(resolve));

      expect(response.headers['content-encoding']).toBe('gzip');
      const expected = `id,name,note\n${Array.from({ length: rows }, (_, i) => row(i)).join('')}`;
      expect(response.text).toHaveLength(expected.length);
      expect(response.text === expected, 'the decompressed body is the CSV that was written').toBe(
        true,
      );
      expect(waits).toBeGreaterThan(10);
      expect(warnings.filter((warning) => warning.name === 'MaxListenersExceededWarning')).toEqual(
        [],
      );
      expect(gzips).toHaveLength(1);
      expect(mostDrainListeners).toBe(1);
    } finally {
      process.off('warning', onWarning);
      spy.mockRestore();
    }
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
