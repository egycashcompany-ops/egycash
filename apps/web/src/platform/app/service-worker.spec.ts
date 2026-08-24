// What the service worker actually DOES with a request — run, not read.
//
// `installable.spec.ts` pins the shape of the file; this one loads it into a stand-in worker
// global and dispatches real fetch events at it. The difference matters for the rule that carries
// the risk: ECMS is authenticated and permission-scoped, so an API response in a shared browser
// profile is one user's data waiting for the next user, and a stale one is an RBAC decision the
// server has since revoked. "The source mentions `api/`" is not evidence that no API response is
// ever served from cache; watching the worker decline to intercept one is.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, '../../../public/sw.js'), 'utf8');

const ORIGIN = 'https://ecms.example.com';

interface FetchEvent {
  request: { url: string; method: string; mode: string };
  respondWith: (response: unknown) => void;
}
type Listener = (event: FetchEvent) => void;

interface Harness {
  /** Dispatch a GET at the worker; null when it declined to intercept. */
  get: (url: string, mode?: string) => Promise<'network' | 'cache' | null>;
  /** URLs the worker put to the network itself. */
  fetched: string[];
  /** URLs it looked for in a cache. */
  matched: string[];
}

/**
 * Load `sw.js` into a stand-in worker global.
 *
 * The caches are stubbed as always-empty, so a request answered from cache is distinguishable
 * from one answered from the network by which stub it reached — which is exactly the question.
 */
const load = (scope: string): Harness => {
  const listeners = new Map<string, Listener>();
  const fetched: string[] = [];
  const matched: string[] = [];

  const emptyCache = {
    match: (request: { url: string } | string) => {
      matched.push(typeof request === 'string' ? request : request.url);
      return Promise.resolve(undefined);
    },
    put: () => Promise.resolve(undefined),
    add: () => Promise.resolve(undefined),
  };

  const self = {
    registration: { scope: `${ORIGIN}${scope}` },
    location: { origin: ORIGIN },
    skipWaiting: () => Promise.resolve(undefined),
    clients: { claim: () => Promise.resolve(undefined) },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };

  const sandbox = {
    self,
    URL,
    Promise,
    Request: class {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
    caches: {
      open: () => Promise.resolve(emptyCache),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: (request: { url: string } | string) => emptyCache.match(request),
    },
    fetch: (request: { url: string }) => {
      fetched.push(request.url);
      return Promise.resolve({ ok: true, clone: () => ({}) });
    },
  };

  runInContext(SOURCE, createContext(sandbox));

  return {
    fetched,
    matched,
    get: async (url, mode = 'no-cors') => {
      const listener = listeners.get('fetch');
      if (listener === undefined) throw new Error('the worker registered no fetch listener');
      const before = matched.length;
      let answer: unknown = null;
      listener({
        request: { url, method: 'GET', mode },
        respondWith: (response) => {
          answer = response;
        },
      });
      // Declining to intercept is a synchronous decision — no respondWith, no answer.
      if (answer === null) return null;
      // Both strategies open a cache synchronously and only then diverge, so the answer has to
      // settle before "did it consult the cache?" means anything.
      await answer;
      return matched.length > before ? 'cache' : 'network';
    },
  };
};

describe('the API is never intercepted', () => {
  const sw = load('/');

  it.each([
    ['a navigation catalog read', `${ORIGIN}/api/v1/platform/me/applications`],
    ['an employee list', `${ORIGIN}/api/v1/hr/employees?page=1`],
    ['a payslip', `${ORIGIN}/api/v1/hr/payroll/payslips/abc`],
  ])('declines %s outright', async (_what, url) => {
    // Declining means the browser goes to the network with no worker in the path at all — the
    // only version of "never cached" that cannot rot.
    expect(await sw.get(url)).toBeNull();
  });

  it('declines the health probes too', async () => {
    expect(await sw.get(`${ORIGIN}/health/ready`)).toBeNull();
  });

  it('declines another origin entirely', async () => {
    expect(await sw.get('https://tile.openstreetmap.org/7/64/44.png')).toBeNull();
  });
});

describe('the shell and the build output', () => {
  const sw = load('/');

  it('answers a navigation from the network first', async () => {
    expect(await sw.get(`${ORIGIN}/employees`, 'navigate')).toBe('network');
    expect(sw.fetched).toContain(`${ORIGIN}/employees`);
  });

  it('answers a hashed asset from the cache first', async () => {
    expect(await sw.get(`${ORIGIN}/assets/index-CsOY0Zb2.js`)).toBe('cache');
  });

  it('declines anything else same-origin rather than guessing', async () => {
    // No rule covers it, so it is not the worker's to answer.
    expect(await sw.get(`${ORIGIN}/robots.txt`)).toBeNull();
  });
});

// A subpath deployment is the case a hard-coded '/api/' would silently break: under /ecms/ the
// API lives at /ecms/api/, and a worker still guarding '/api/' would start caching it.
describe('under a subpath deployment it scopes itself', () => {
  const sw = load('/ecms/');

  it('still declines the API, at its prefixed path', async () => {
    expect(await sw.get(`${ORIGIN}/ecms/api/v1/platform/me/applications`)).toBeNull();
  });

  it('still serves the prefixed shell and assets', async () => {
    expect(await sw.get(`${ORIGIN}/ecms/employees`, 'navigate')).toBe('network');
    expect(await sw.get(`${ORIGIN}/ecms/assets/index-CsOY0Zb2.js`)).toBe('cache');
  });

  it('and claims nothing at the origin root, which is somebody else’s app', async () => {
    expect(await sw.get(`${ORIGIN}/assets/index-CsOY0Zb2.js`)).toBeNull();
  });
});
