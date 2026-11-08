// GET /auth/passkeys answers the list in `data` and whether passkeys are on in `meta` (ADR-036).
// The request reads both; an API from before the change sent no `meta`, and only answered the
// list while passkeys were on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthApiModule from './api';

const passkey = {
  id: 'pk1',
  name: 'iPhone',
  backedUp: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  lastUsedAt: null,
};

const answer = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('listPasskeysRequest', () => {
  let api: typeof AuthApiModule;
  let urls: string[];

  beforeEach(async () => {
    vi.resetModules();
    urls = [];
    api = await import('./api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const serve = (body: unknown): void => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return answer(body);
    });
  };

  it('reads the switch from meta', async () => {
    serve({ success: true, data: [passkey], meta: { enabled: false } });
    await expect(api.listPasskeysRequest()).resolves.toEqual({ items: [passkey], enabled: false });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/auth/passkeys');
  });

  it('no meta (an older API): on', async () => {
    serve({ success: true, data: [passkey] });
    await expect(api.listPasskeysRequest()).resolves.toEqual({ items: [passkey], enabled: true });
  });
});
