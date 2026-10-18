// `req.ip` is the key of every per-IP rate limit and the address on every audit row, so it must be
// the address the EDGE saw, not one the caller wrote into X-Forwarded-For.
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { clientIpFrom, installClientIp } from './client-ip';

const appWith = (header: string): Express => {
  const app = express();
  app.set('trust proxy', true);
  installClientIp(app, header);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip ?? null });
  });
  return app;
};

const ipOf = async (app: Express, headers: Record<string, string>): Promise<string | null> => {
  let call = request(app).get('/ip');
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
  return ((await call).body as { ip: string | null }).ip;
};

describe('the address a request came from', () => {
  it("is the edge's X-Real-IP, whatever the caller wrote into X-Forwarded-For", async () => {
    const app = appWith('x-real-ip');
    expect(
      await ipOf(app, { 'X-Real-IP': '203.0.113.5', 'X-Forwarded-For': '1.2.3.4, 203.0.113.5' }),
    ).toBe('203.0.113.5');
  });

  it('a caller rotating X-Forwarded-For no longer gets a new address per request', async () => {
    const app = appWith('x-real-ip');
    const seen = new Set<string | null>();
    for (const forged of ['9.9.9.1', '9.9.9.2', '9.9.9.3']) {
      seen.add(await ipOf(app, { 'X-Real-IP': '203.0.113.5', 'X-Forwarded-For': forged }));
    }
    expect([...seen]).toEqual(['203.0.113.5']);
  });

  it("falls back to Express's own answer when the edge header is absent — no worse than before", async () => {
    const app = appWith('x-real-ip');
    expect(await ipOf(app, { 'X-Forwarded-For': '198.51.100.7' })).toBe('198.51.100.7');
  });

  it('can be switched off, leaving Express untouched', async () => {
    const app = appWith('');
    expect(await ipOf(app, { 'X-Real-IP': '203.0.113.5', 'X-Forwarded-For': '198.51.100.7' })).toBe(
      '198.51.100.7',
    );
  });

  it('reads only the first address of a list and ignores an empty value', () => {
    expect(clientIpFrom('203.0.113.5, 10.0.0.1', 'fallback')).toBe('203.0.113.5');
    expect(clientIpFrom('  ', 'fallback')).toBe('fallback');
    expect(clientIpFrom(undefined, undefined)).toBeUndefined();
  });

  it('does not leak into other Express apps in the same process', async () => {
    appWith('x-real-ip');
    const plain = express();
    plain.set('trust proxy', true);
    plain.get('/ip', (req, res) => {
      res.json({ ip: req.ip ?? null });
    });
    expect(await ipOf(plain, { 'X-Real-IP': '203.0.113.5', 'X-Forwarded-For': '198.51.100.7' })).toBe(
      '198.51.100.7',
    );
  });
});
