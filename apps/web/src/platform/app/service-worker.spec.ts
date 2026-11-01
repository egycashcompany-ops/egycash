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

interface PushEvent {
  data: { json: () => unknown } | null;
  waitUntil: (promise: unknown) => void;
}

/** What the worker asked the browser to show for one push. */
interface Shown {
  title: string;
  options: { icon?: string; badge?: string; body?: string };
}

interface Harness {
  /** Dispatch a GET at the worker; null when it declined to intercept. */
  get: (url: string, mode?: string) => Promise<'network' | 'cache' | null>;
  /** URLs the worker put to the network itself. */
  fetched: string[];
  /** URLs it looked for in a cache. */
  matched: string[];
  /** URLs it stored into a cache. */
  stored: string[];
  /** Deliver a push message; resolves to the notification the worker showed for it. */
  push: (payload: unknown) => Promise<Shown | undefined>;
}

/** How the stand-in network answers one URL. Unlisted URLs get a 200 JavaScript response. */
interface Answer {
  ok: boolean;
  status: number;
  contentType: string;
}

/**
 * Load `sw.js` into a stand-in worker global.
 *
 * The caches are stubbed as always-empty, so a request answered from cache is distinguishable
 * from one answered from the network by which stub it reached — which is exactly the question.
 */
const load = (scope: string, answers: ReadonlyMap<string, Answer> = new Map()): Harness => {
  const listeners = new Map<string, Listener>();
  const pushListeners: ((event: PushEvent) => void)[] = [];
  const shown: Shown[] = [];
  const fetched: string[] = [];
  const matched: string[] = [];
  const stored: string[] = [];

  const emptyCache = {
    match: (request: { url: string } | string) => {
      matched.push(typeof request === 'string' ? request : request.url);
      return Promise.resolve(undefined);
    },
    put: (request: { url: string } | string) => {
      stored.push(typeof request === 'string' ? request : request.url);
      return Promise.resolve(undefined);
    },
    add: () => Promise.resolve(undefined),
  };

  const self = {
    registration: {
      scope: `${ORIGIN}${scope}`,
      showNotification: (title: string, options: Shown['options']) => {
        shown.push({ title, options });
        return Promise.resolve(undefined);
      },
    },
    location: { origin: ORIGIN },
    skipWaiting: () => Promise.resolve(undefined),
    clients: { claim: () => Promise.resolve(undefined) },
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'push') pushListeners.push(listener as unknown as (event: PushEvent) => void);
      else listeners.set(type, listener);
    },
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
      const answer = answers.get(request.url) ?? {
        ok: true,
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
      };
      return Promise.resolve({
        ok: answer.ok,
        status: answer.status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? answer.contentType : null) },
        clone: () => ({}),
      });
    },
  };

  runInContext(SOURCE, createContext(sandbox));

  return {
    fetched,
    matched,
    stored,
    push: async (payload) => {
      const pending: unknown[] = [];
      for (const listener of pushListeners) {
        listener({ data: { json: () => payload }, waitUntil: (promise) => pending.push(promise) });
      }
      await Promise.all(pending);
      return shown.at(-1);
    },
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

  it.each(['favicon.svg', 'icons/icon-192.png', 'icons/badge-96.png', 'apple-touch-icon.png'])(
    'never answers the logo file %s from a cache, so a new logo is never hidden behind an old one',
    async (file) => {
      expect(await sw.get(`${ORIGIN}/${file}`)).toBeNull();
    },
  );
});

// Android paints a notification's badge from its alpha alone, in the status bar's colour: the
// full-colour app icon there is a plain square. The badge is the mark, white on transparent.
describe('a push notification carries the logo', () => {
  const PAYLOAD = {
    title: 'طلب جديد',
    body: 'تمت إضافة طلب',
    url: '/approvals',
    notificationId: 'n1',
  };

  it('shows the app icon, and the mark alone as the status-bar badge', async () => {
    const notification = await load('/').push(PAYLOAD);
    expect(notification?.title).toBe('طلب جديد');
    expect(notification?.options.icon).toBe('/icons/icon-192.png');
    expect(notification?.options.badge).toBe('/icons/badge-96.png');
  });

  it('points at the prefixed copies under a subpath deployment', async () => {
    const notification = await load('/ecms/').push(PAYLOAD);
    expect(notification?.options.icon).toBe('/ecms/icons/icon-192.png');
    expect(notification?.options.badge).toBe('/ecms/icons/badge-96.png');
  });
});

// «لما بسيب الموقع مدة طويلة وأرجع… Failed to fetch dynamically imported module». A tab opened
// before a deploy asks for a chunk the OLD build named. The server used to answer that with the HTML
// shell and a 200, and a cache-first worker files whatever answers an asset's name — forever.
describe('a chunk the server no longer has is never cached as one', () => {
  const OLD_CHUNK = `${ORIGIN}/assets/routes-Mp_nHbTf.js`;

  it('does not file the HTML shell under a script’s name', async () => {
    const sw = load(
      '/',
      new Map([[OLD_CHUNK, { ok: true, status: 200, contentType: 'text/html; charset=UTF-8' }]]),
    );
    expect(await sw.get(OLD_CHUNK)).toBe('cache');
    expect(sw.fetched).toContain(OLD_CHUNK);
    expect(sw.stored).not.toContain(OLD_CHUNK);
  });

  it('does not cache the 404 the server answers now either', async () => {
    const sw = load(
      '/',
      new Map([[OLD_CHUNK, { ok: false, status: 404, contentType: 'application/json' }]]),
    );
    await sw.get(OLD_CHUNK);
    expect(sw.stored).not.toContain(OLD_CHUNK);
  });

  it('still caches a real script, which is the point of caching the build output', async () => {
    const sw = load('/');
    const current = `${ORIGIN}/assets/routes-CsOY0Zb2.js`;
    await sw.get(current);
    expect(sw.stored).toContain(current);
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
