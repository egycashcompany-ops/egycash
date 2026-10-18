// The short-link resolver (docs/12-planning/atm-map-zones.md §5, §9.2), against fake DNS, a fake
// hop, a fake pause and a fake clock: nothing here touches the network. Every link is synthetic.
//
// Read it as an SSRF suite first: which URLs are never requested, which redirect targets are never
// read, and what the log may ever carry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../../infrastructure/logging/logger';
import {
  SHORT_LINK_HOP_LIMIT,
  resolveShortLink,
  runShortLinkBatch,
  type ShortLinkBatchIo,
  type ShortLinkDeps,
  type ShortLinkResult,
} from './short-link-resolver';

const LINK = 'https://maps.app.goo.gl/SecretToken1';
const PIN_URL = 'https://www.google.com/maps/place/X/data=!3d30.0444!4d31.2357';
const PUBLIC = ['142.250.180.14'];

type Answer = { status: number; location?: string } | { throws: Error };

interface Fake {
  deps: ShortLinkDeps;
  hops: string[];
  lookups: string[];
  sleeps: number[];
  cancels: number;
  clock: { now: number };
}

/** A fake network: `routes` maps a requested href to its answer; anything else is a test bug. */
const fake = (
  routes: Record<string, Answer>,
  options: {
    lookup?: (host: string) => Promise<string[]>;
    /** Milliseconds the fake clock moves on each hop. */
    hopCost?: number;
  } = {},
): Fake => {
  const f: Fake = {
    hops: [],
    lookups: [],
    sleeps: [],
    cancels: 0,
    clock: { now: 1_000_000 },
    deps: undefined as unknown as ShortLinkDeps,
  };
  f.deps = {
    lookup: (host) => {
      f.lookups.push(host);
      return options.lookup?.(host) ?? Promise.resolve(PUBLIC);
    },
    hop: (url) => {
      f.hops.push(url.href);
      f.clock.now += options.hopCost ?? 0;
      const answer = routes[url.href];
      if (answer === undefined) return Promise.reject(new Error(`unexpected request ${url.href}`));
      if ('throws' in answer) return Promise.reject(answer.throws);
      return Promise.resolve({
        status: answer.status,
        location: answer.location ?? null,
        cancel: () => {
          f.cancels += 1;
          return Promise.resolve();
        },
      });
    },
    sleep: (ms) => {
      f.sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => f.clock.now,
  };
  return f;
};

const redirect = (location: string): Answer => ({ status: 302, location });
const resolvedCairo: ShortLinkResult = {
  status: 'resolved',
  lat: 30.0444,
  lng: 31.2357,
  viewportOnly: false,
};

const logCalls: unknown[][] = [];
beforeEach(() => {
  logCalls.length = 0;
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
    vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
      logCalls.push(args);
    }) as never);
  }
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the first URL', () => {
  it('requests http://maps.app.goo.gl/x as https:', async () => {
    const f = fake({ 'https://maps.app.goo.gl/x': redirect(PIN_URL) });
    expect(await resolveShortLink('http://maps.app.goo.gl/x', f.deps)).toEqual(resolvedCairo);
    expect(f.hops).toEqual(['https://maps.app.goo.gl/x']);
  });

  it.each([
    ['https://maps.app.goo.gl@evil.example/x'],
    ['https://evil.example/x'],
    ['https://1.2.3.4/x'],
    ['https://maps.app.goo.gl:8443/x'],
    ['https://goo.gl/mapsX'],
    ['https://www.google.com/maps/place/X'],
  ])('never requests %s', async (url) => {
    const f = fake({});
    expect(await resolveShortLink(url, f.deps)).toEqual({
      status: 'failed',
      failure: 'hostNotAllowed',
    });
    expect(f.hops).toEqual([]);
    expect(f.lookups).toEqual([]);
  });

  it('answers invalidUrl for text that is not an http(s) URL', async () => {
    const f = fake({});
    expect(await resolveShortLink('not a url', f.deps)).toEqual({
      status: 'failed',
      failure: 'invalidUrl',
    });
    expect(await resolveShortLink('ftp://maps.app.goo.gl/x', f.deps)).toEqual({
      status: 'failed',
      failure: 'invalidUrl',
    });
    expect(f.hops).toEqual([]);
  });
});

describe('DNS, checked by the resolver itself', () => {
  it.each([['10.0.0.1'], ['169.254.169.254'], ['::1'], ['not-an-address']])(
    'refuses a lookup answering %s without a request',
    async (address) => {
      const f = fake({}, { lookup: () => Promise.resolve(['142.250.180.14', address]) });
      expect(await resolveShortLink(LINK, f.deps)).toEqual({
        status: 'failed',
        failure: 'hostNotAllowed',
      });
      expect(f.hops).toEqual([]);
    },
  );

  it('answers network for ENOTFOUND — and "no answer" when it is the short-link host itself', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const later = fake(
      { [LINK]: redirect('https://www.google.com/maps/place/Cairo+Tower') },
      {
        lookup: (host) =>
          host === 'www.google.com' ? Promise.reject(notFound) : Promise.resolve(PUBLIC),
      },
    );
    expect(await resolveShortLink(LINK, later.deps)).toEqual({
      status: 'failed',
      failure: 'network',
    });

    const first = fake({}, { lookup: () => Promise.reject(notFound) });
    expect(await resolveShortLink(LINK, first.deps)).toEqual({
      status: 'noAnswer',
      stopReason: 'unreachable',
      failure: 'network',
    });
  });

  it('answers network for a name with no address', async () => {
    const f = fake(
      { [LINK]: redirect('https://www.google.com/maps/place/Cairo+Tower') },
      {
        lookup: (host) => Promise.resolve(host === 'www.google.com' ? [] : PUBLIC),
      },
    );
    expect(await resolveShortLink(LINK, f.deps)).toEqual({ status: 'failed', failure: 'network' });
  });

  it('times out a lookup that never answers within 5 s', async () => {
    vi.useFakeTimers();
    const f = fake(
      { [LINK]: redirect('https://www.google.com/maps/place/Cairo+Tower') },
      {
        lookup: (host) =>
          host === 'www.google.com'
            ? new Promise<string[]>(() => undefined)
            : Promise.resolve(PUBLIC),
      },
    );
    let settled: ShortLinkResult | null = null;
    void resolveShortLink(LINK, f.deps).then((r) => {
      settled = r;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ status: 'failed', failure: 'timeout' });
    expect(f.hops).toEqual([LINK]);
  });

  it('times out a first-hop lookup as "no answer" (the link was not opened)', async () => {
    vi.useFakeTimers();
    const f = fake({}, { lookup: () => new Promise<string[]>(() => undefined) });
    const pending = resolveShortLink(LINK, f.deps);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({
      status: 'noAnswer',
      stopReason: 'unreachable',
      failure: 'timeout',
    });
  });
});

describe('redirects', () => {
  it('resolves a 302 whose Location carries !3d!4d after exactly one hop', async () => {
    const f = fake({ [LINK]: redirect(PIN_URL) });
    expect(await resolveShortLink(LINK, f.deps)).toEqual(resolvedCairo);
    expect(f.hops).toHaveLength(1);
  });

  it('resolves a viewport-only target as viewportOnly', async () => {
    const f = fake({ [LINK]: redirect('https://www.google.com/maps/@30.05,31.24,15z') });
    expect(await resolveShortLink(LINK, f.deps)).toEqual({
      status: 'resolved',
      lat: 30.05,
      lng: 31.24,
      viewportOnly: true,
    });
  });

  it('follows two redirects, then reads the coordinates URL', async () => {
    const f = fake({
      [LINK]: redirect('https://goo.gl/maps/Second'),
      'https://goo.gl/maps/Second': redirect(
        'https://www.google.com/maps/place/Cairo+Tower?entry=x',
      ),
      'https://www.google.com/maps/place/Cairo+Tower?entry=x': redirect(PIN_URL),
    });
    expect(await resolveShortLink(LINK, f.deps)).toEqual(resolvedCairo);
    expect(f.hops).toHaveLength(3);
  });

  it('reads the final URL of a 200 — a short-link page is no Google Maps URL', async () => {
    const f = fake({
      [LINK]: redirect('/maps/place/X?entry=y'),
      'https://maps.app.goo.gl/maps/place/X?entry=y': { status: 200 },
    });
    expect(await resolveShortLink(LINK, f.deps)).toEqual({
      status: 'failed',
      failure: 'noCoordinates',
    });
    expect(f.hops).toHaveLength(2);
  });

  it('gives tooManyRedirects after 5 hops', async () => {
    const chain = Array.from(
      { length: 7 },
      (_, i) => `https://www.google.com/maps/place/Hop${String(i)}`,
    );
    const routes: Record<string, Answer> = { [LINK]: redirect(chain[0] as string) };
    chain.slice(0, -1).forEach((url, i) => {
      routes[url] = redirect(chain[i + 1] as string);
    });
    const f = fake(routes);
    expect(await resolveShortLink(LINK, f.deps)).toEqual({
      status: 'failed',
      failure: 'tooManyRedirects',
    });
    expect(f.hops).toHaveLength(SHORT_LINK_HOP_LIMIT);
  });

  it('refuses a Location to another host without requesting it, and never reads its digits', async () => {
    const f = fake({ [LINK]: redirect('https://evil.example/@30,31') });
    expect(await resolveShortLink(LINK, f.deps)).toEqual({
      status: 'failed',
      failure: 'hostNotAllowed',
    });
    expect(f.hops).toEqual([LINK]);
    const g = fake({
      [LINK]: redirect('https://evil.example/maps/place/X/data=!3d30.0444!4d31.2357'),
    });
    expect(await resolveShortLink(LINK, g.deps)).toEqual({
      status: 'failed',
      failure: 'hostNotAllowed',
    });
  });

  it('refuses an http:, a userinfo or a port Location on an allowed host', async () => {
    for (const location of [
      'http://www.google.com/maps/place/X',
      'https://user@www.google.com/maps/place/X',
      'https://www.google.com:8443/maps/place/X',
    ]) {
      const f = fake({ [LINK]: redirect(location) });
      expect(await resolveShortLink(LINK, f.deps), location).toEqual({
        status: 'failed',
        failure: 'hostNotAllowed',
      });
      expect(f.hops).toEqual([LINK]);
    }
  });

  it('answers invalidUrl for a Location over 4096 characters, or one that does not parse', async () => {
    const long = fake({ [LINK]: redirect(`https://www.google.com/maps/${'a'.repeat(4100)}`) });
    expect(await resolveShortLink(LINK, long.deps)).toEqual({
      status: 'failed',
      failure: 'invalidUrl',
    });
    const broken = fake({ [LINK]: redirect('https://[broken') });
    expect(await resolveShortLink(LINK, broken.deps)).toEqual({
      status: 'failed',
      failure: 'invalidUrl',
    });
  });

  it('reads a consent page from its continue parameter, never requesting consent.google.com', async () => {
    const consent = `https://consent.google.com/ml?continue=${encodeURIComponent(PIN_URL)}&gl=EG`;
    const f = fake({ [LINK]: redirect(consent) });
    expect(await resolveShortLink(LINK, f.deps)).toEqual(resolvedCairo);
    expect(f.hops).toEqual([LINK]);

    const empty = `https://consent.google.com/ml?continue=${encodeURIComponent('https://www.google.com/maps/place/Cairo+Tower')}`;
    const g = fake({ [LINK]: redirect(empty) });
    expect(await resolveShortLink(LINK, g.deps)).toEqual({
      status: 'failed',
      failure: 'consentPage',
    });
    expect(g.hops).toEqual([LINK]);
  });

  it('answers noCoordinates for a 200 on a named place, httpStatus for a 404 or a 302 without Location', async () => {
    const named = fake({
      [LINK]: redirect('https://www.google.com/maps/place/Cairo+Tower'),
      'https://www.google.com/maps/place/Cairo+Tower': { status: 200 },
    });
    expect(await resolveShortLink(LINK, named.deps)).toEqual({
      status: 'failed',
      failure: 'noCoordinates',
    });
    const missing = fake({ [LINK]: { status: 404 } });
    expect(await resolveShortLink(LINK, missing.deps)).toEqual({
      status: 'failed',
      failure: 'httpStatus',
    });
    const bare = fake({ [LINK]: { status: 302 } });
    expect(await resolveShortLink(LINK, bare.deps)).toEqual({
      status: 'failed',
      failure: 'httpStatus',
    });
  });

  it('answers timeout for an AbortError after the first hop', async () => {
    const f = fake({
      [LINK]: redirect('https://www.google.com/maps/place/Cairo+Tower'),
      'https://www.google.com/maps/place/Cairo+Tower': {
        throws: new DOMException('aborted', 'AbortError'),
      },
    });
    expect(await resolveShortLink(LINK, f.deps)).toEqual({ status: 'failed', failure: 'timeout' });
  });

  it('answers "no answer" for a refused connection on the first hop, network on a later one', async () => {
    const first = fake({ [LINK]: { throws: new Error('connect ECONNREFUSED') } });
    expect(await resolveShortLink(LINK, first.deps)).toEqual({
      status: 'noAnswer',
      stopReason: 'unreachable',
      failure: 'network',
    });
    const later = fake({
      [LINK]: redirect('https://www.google.com/maps/place/Cairo+Tower'),
      'https://www.google.com/maps/place/Cairo+Tower': { throws: new Error('socket hang up') },
    });
    expect(await resolveShortLink(LINK, later.deps)).toEqual({
      status: 'failed',
      failure: 'network',
    });
  });

  it.each([[429], [503]])('stops on a %s on any hop as rateLimited', async (status) => {
    const f = fake({
      [LINK]: redirect('https://www.google.com/maps/place/Cairo+Tower'),
      'https://www.google.com/maps/place/Cairo+Tower': { status },
    });
    expect(await resolveShortLink(LINK, f.deps)).toEqual({
      status: 'noAnswer',
      stopReason: 'rateLimited',
      failure: 'httpStatus',
    });
  });

  it('cancels every response body', async () => {
    const f = fake({
      [LINK]: redirect('https://goo.gl/maps/Second'),
      'https://goo.gl/maps/Second': redirect('https://www.google.com/maps/place/Cairo+Tower'),
      'https://www.google.com/maps/place/Cairo+Tower': { status: 200 },
    });
    await resolveShortLink(LINK, f.deps);
    expect(f.hops).toHaveLength(3);
    expect(f.cancels).toBe(3);
  });
});

describe('the batch', () => {
  interface Item {
    id: string;
    url: string;
  }
  const items = (n: number): Item[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${String(i)}`,
      url: `https://maps.app.goo.gl/L${String(i)}`,
    }));
  const routesFor = (list: Item[], answer: Answer = redirect(PIN_URL)): Record<string, Answer> =>
    Object.fromEntries(list.map((item) => [item.url, answer]));

  const io = (over: Partial<ShortLinkBatchIo<Item>> = {}) => {
    const log = { claimed: [] as string[], stored: [] as string[], released: [] as string[] };
    const value: ShortLinkBatchIo<Item> = {
      claim: (item) => {
        log.claimed.push(item.id);
        return Promise.resolve(true);
      },
      store: (item) => {
        log.stored.push(item.id);
        return Promise.resolve('stored');
      },
      release: (item) => {
        log.released.push(item.id);
        return Promise.resolve();
      },
      ...over,
    };
    return { value, log };
  };

  it('pauses 300 ms between links but not after the last', async () => {
    const list = items(3);
    const f = fake(routesFor(list));
    const { value } = io();
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result).toMatchObject({
      attempted: 3,
      resolved: 3,
      failed: 0,
      conflicts: 0,
      stopReason: null,
    });
    expect(f.sleeps).toEqual([300, 300]);
  });

  it('processes 20 of a batch of 25', async () => {
    const list = items(25);
    const f = fake(routesFor(list));
    const { value, log } = io();
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result.attempted).toBe(20);
    expect(log.claimed).toHaveLength(20);
    expect(f.hops).toHaveLength(20);
  });

  it('skips a link whose claim matches nothing, without a request or a pause', async () => {
    const list = items(3);
    const f = fake(routesFor(list));
    const { value, log } = io({ claim: (item) => Promise.resolve(item.id !== 'm1') });
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result.attempted).toBe(2);
    expect(f.hops).toEqual([list[0]?.url, list[2]?.url]);
    expect(f.sleeps).toEqual([300]);
    expect(log.stored).toEqual(['m0', 'm2']);
  });

  it('counts failed links and conflicting writes', async () => {
    const list = items(3);
    const f = fake({
      [list[0]?.url as string]: redirect(PIN_URL),
      [list[1]?.url as string]: { status: 404 },
      [list[2]?.url as string]: redirect(PIN_URL),
    });
    const { value } = io({
      store: (item) => Promise.resolve(item.id === 'm2' ? 'conflict' : 'stored'),
    });
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result).toMatchObject({ attempted: 3, resolved: 1, failed: 1, conflicts: 1 });
    expect(result.outcomes.map((o) => [o.item.id, o.status, o.failure])).toEqual([
      ['m0', 'resolved', null],
      ['m1', 'failed', 'httpStatus'],
      ['m2', 'resolved', null],
    ]);
  });

  it('stops on a 429 with rateLimited; the link stays pending (no result stored, claim released)', async () => {
    const list = items(3);
    const f = fake({ ...routesFor(list), [list[1]?.url as string]: { status: 429 } });
    const { value, log } = io();
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result).toMatchObject({ attempted: 1, stopReason: 'rateLimited' });
    expect(log.stored).toEqual(['m0']);
    expect(log.released).toEqual(['m1']);
    expect(f.hops).toHaveLength(2);
  });

  it('stops on a network failure on the first hop with unreachable; the link stays pending', async () => {
    const list = items(2);
    const f = fake({ [list[0]?.url as string]: { throws: new Error('connect ECONNREFUSED') } });
    const { value, log } = io();
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result).toMatchObject({ attempted: 0, stopReason: 'unreachable' });
    expect(log.stored).toEqual([]);
    expect(log.released).toEqual(['m0']);
    expect(log.claimed).toEqual(['m0']);
  });

  it('checks the 40 s budget before every hop, stops with budget and clears the unfinished claim', async () => {
    // Every hop costs 15 s: link 0 takes 30 s (two hops); link 1's second hop starts at 45 s.
    const list = items(3);
    const routes: Record<string, Answer> = {};
    for (const item of list) {
      routes[item.url] = redirect(`https://goo.gl/maps/${item.id}`);
      routes[`https://goo.gl/maps/${item.id}`] = redirect(PIN_URL);
    }
    const f = fake(routes, { hopCost: 15_000 });
    const { value, log } = io();
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result).toMatchObject({ attempted: 1, resolved: 1, stopReason: 'budget' });
    expect(log.stored).toEqual(['m0']);
    expect(log.claimed).toEqual(['m0', 'm1']);
    expect(log.released).toEqual(['m1']);
    expect(f.hops).toHaveLength(3);
  });

  it('checks the budget before every link', async () => {
    const list = items(2);
    const f = fake(routesFor(list), { hopCost: 40_000 });
    const { value, log } = io();
    const result = await runShortLinkBatch(list, value, f.deps);
    expect(result).toMatchObject({ attempted: 1, stopReason: 'budget' });
    expect(log.claimed).toEqual(['m0']);
  });

  it('releases the claim when storing throws, and lets the error through', async () => {
    const list = items(1);
    const f = fake(routesFor(list));
    const { value, log } = io({ store: () => Promise.reject(new Error('db down')) });
    await expect(runShortLinkBatch(list, value, f.deps)).rejects.toThrow('db down');
    expect(log.released).toEqual(['m0']);
  });
});

describe('logging', () => {
  it('only ever logs { host, status, failure } — never a URL, a path, a query or an error', async () => {
    const cases: [string, Record<string, Answer>, Parameters<typeof fake>[1]?][] = [
      [LINK, { [LINK]: redirect(`${PIN_URL}&secret=1`) }],
      [LINK, { [LINK]: redirect('https://evil.example/@30,31?token=abc') }],
      [LINK, { [LINK]: redirect('https://[broken') }],
      [LINK, { [LINK]: { status: 404 } }],
      [LINK, { [LINK]: { status: 429 } }],
      [LINK, { [LINK]: { throws: new Error(`connect ECONNREFUSED ${LINK}`) } }],
      [LINK, {}, { lookup: () => Promise.reject(new Error(`getaddrinfo ENOTFOUND ${LINK}`)) }],
      [LINK, {}, { lookup: () => Promise.resolve(['10.0.0.1']) }],
      ['https://maps.app.goo.gl@evil.example/SecretToken1?q=1', {}],
      ['not a url SecretToken1', {}],
    ];
    for (const [url, routes, options] of cases) {
      const f = fake(routes, options);
      await resolveShortLink(url, f.deps);
    }
    expect(logCalls.length).toBe(cases.length);
    for (const call of logCalls) {
      const [fields, message] = call as [Record<string, unknown>, unknown];
      expect(Object.keys(fields).sort()).toEqual(['failure', 'host', 'status']);
      expect(message).toBe('atm map short link');
      expect(call).toHaveLength(2);
      for (const value of Object.values(fields)) {
        expect(value instanceof Error).toBe(false);
        expect(typeof value === 'string' || typeof value === 'number' || value === null).toBe(true);
      }
      const text = JSON.stringify(call);
      expect(text).not.toMatch(/SecretToken1|!3d|secret|token|\/@|\?|https?:/i);
      expect(String(fields.host ?? '')).not.toMatch(/[/?#@]/);
    }
  });
});
