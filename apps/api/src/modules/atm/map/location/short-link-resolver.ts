// Google short links, opened once on the server (D-M4; docs/12-planning/atm-map-zones.md §5).
//
// 713 machines in the workbook hold nothing but a `maps.app.goo.gl` link (counts only). The point
// is behind Google's redirect, which a browser cannot follow cross-origin, so the server follows it
// — admin-triggered, audited, one pass (DM-46) — and reads coordinates out of the redirect TARGET
// URL. The response body is never read.
//
// Every request is somebody's register text, so the whole file is an SSRF boundary:
//   · the first URL must be an https short link under the exact host rule (§4.2), with no userinfo
//     and no explicit port; every later hop must be https on exactly five Google hosts;
//   · the resolver resolves DNS itself, under the hop's deadline, refuses a private address, and
//     hands the addresses to `outboundFetch`, whose own check then cannot disagree (and so never
//     logs a URL) — `outbound.ts` is not changed;
//   · redirects are followed by hand (5 hops), coordinates are read only from Google Maps URLs, a
//     consent interstitial is read from its `continue` parameter and never fetched;
//   · 5 s per hop including DNS, 12 s per link, 20 links per call, a 40 s budget checked before
//     every link and every hop.
// Logging carries `{ host, status, failure }` only — never a URL, a path, a query or an error
// object: a short link's path IS its token, a place path holds the coordinates, and Node's
// `ERR_INVALID_URL` carries its input.
import { lookup as dnsLookup } from 'node:dns/promises';
import {
  ATM_MAP_LINK_BATCH_MAX,
  type AtmMapLinkFailure,
  type AtmMapLinkStopReason,
} from '@ecms/contracts';
import {
  hostMatches,
  isPrivateAddress,
  outboundFetch,
  type OutboundPolicy,
} from '../../../../infrastructure/http/outbound';
import { logger } from '../../../../infrastructure/logging/logger';
import { isGoogleMapsUrl, isShortLinkUrl, normalizedHost, pointFromGoogleUrl } from './maps-text';

export const SHORT_LINK_HOP_LIMIT = 5;
export const SHORT_LINK_HOP_TIMEOUT_MS = 5000;
export const SHORT_LINK_LINK_TIMEOUT_MS = 12_000;
export const SHORT_LINK_PAUSE_MS = 300;
export const SHORT_LINK_RUN_BUDGET_MS = 40_000;
export const SHORT_LINK_MAX_LOCATION_LENGTH = 4096;

/**
 * Exactly these five hosts, per call (DM-33): they are not added to the platform's named SaaS
 * hosts, so no other api caller can reach Google. `OUTBOUND_HTTP_ALLOW_PRIVATE` does not apply.
 */
export const GOOGLE_MAPS_LINK_POLICY: OutboundPolicy = {
  allowHosts: ['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com', 'maps.google.com'],
  pinnedHosts: [],
  allowPrivate: false,
};

/** What one hop answered. The body is never read; `cancel` releases it. */
export interface ShortLinkHopResponse {
  status: number;
  location: string | null;
  cancel(): Promise<void>;
}

/** Everything that touches the network or the clock, so the tests never do (§5.3). */
export interface ShortLinkDeps {
  lookup(host: string, signal: AbortSignal): Promise<string[]>;
  hop(url: URL, addresses: string[], signal: AbortSignal): Promise<ShortLinkHopResponse>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * One link's answer:
 *   · `resolved` / `failed` — the link was opened; this is its one result (DM-46);
 *   · `noAnswer` — Google was not reached (DNS, connection or timeout on the FIRST hop) or refused
 *     service (429/503 on any hop): the link was not opened, it stays pending, the run stops;
 *   · `budget` — the run's budget ran out before a hop; the link stays pending.
 */
export type ShortLinkResult =
  | { status: 'resolved'; lat: number; lng: number; viewportOnly: boolean }
  | { status: 'failed'; failure: AtmMapLinkFailure }
  | { status: 'noAnswer'; stopReason: 'unreachable' | 'rateLimited'; failure: AtmMapLinkFailure }
  | { status: 'budget' };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const abortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Rejects with an `AbortError` as soon as `signal` aborts, whatever `promise` does. */
export const raceAbort = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('rejected'));
      },
    );
  });

/**
 * A deadline signal on the global timer, cleared when the work ends. (`AbortSignal.timeout` would
 * do the same, but it runs on a timer the test clock cannot advance, and §9.2 pins the 5 s DNS
 * timeout under fake timers.)
 */
const deadline = (ms: number): { signal: AbortSignal; clear(): void } => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The deadline passed', 'TimeoutError'));
  }, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
};

/** The production dependencies: real DNS, `outboundFetch`, real timers (§5.1). */
export const defaultShortLinkDeps: ShortLinkDeps = {
  lookup: async (host, signal) => {
    const found = await raceAbort(dnsLookup(host, { all: true, verbatim: true }), signal);
    return found.map((entry) => entry.address);
  },
  hop: async (url, addresses, signal) => {
    // No cookies (Node's fetch keeps no jar), no Authorization, no Referer. Node's fetch honours
    // `cache`, which its `RequestInit` type does not declare.
    const init: RequestInit & { cache: 'no-store' } = {
      method: 'GET',
      headers: { accept: 'text/html' },
      cache: 'no-store',
      signal,
    };
    const response = await outboundFetch(url, init, {
      policy: GOOGLE_MAPS_LINK_POLICY,
      maxRedirects: 0,
      lookup: async () => addresses,
    });
    return {
      status: response.status,
      location: response.headers.get('location'),
      cancel: async () => {
        await response.body?.cancel();
      },
    };
  },
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  now: () => Date.now(),
};

const onAllowlist = (url: URL): boolean =>
  GOOGLE_MAPS_LINK_POLICY.allowHosts.some((pattern) => hostMatches(normalizedHost(url), pattern));

/** https, no userinfo, no explicit port — the shape every request must have. */
const plainHttps = (url: URL): boolean =>
  url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '';

const parse = (value: string, base?: URL): URL | null => {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
};

/** Coordinates in a target URL — only when it is an https Google Maps URL (DM-36). */
const pointIn = (url: URL): ShortLinkResult | null => {
  if (url.protocol !== 'https:' || !isGoogleMapsUrl(url)) return null;
  const point = pointFromGoogleUrl(url);
  return point === null ? null : { status: 'resolved', ...point };
};

const log = (host: string | null, status: number | null, result: ShortLinkResult): void => {
  const failure =
    result.status === 'failed' || result.status === 'noAnswer' ? result.failure : null;
  logger.info({ host, status, failure }, 'atm map short link');
};

/**
 * Opens one short link and reads the point its redirect leads to (§5.1). Never throws for a
 * network outcome. `budgetEndsAt` is the run's 40 s budget, checked before every hop.
 */
export const resolveShortLink = async (
  raw: string,
  deps: ShortLinkDeps,
  options: { budgetEndsAt?: number } = {},
): Promise<ShortLinkResult> => {
  let host: string | null = null;
  let status: number | null = null;
  const done = (result: ShortLinkResult): ShortLinkResult => {
    if (result.status !== 'budget') log(host, status, result);
    return result;
  };
  const failed = (failure: AtmMapLinkFailure): ShortLinkResult =>
    done({ status: 'failed', failure });

  const first = parse(raw);
  if (first === null || (first.protocol !== 'https:' && first.protocol !== 'http:')) {
    return failed('invalidUrl');
  }
  // http: is upgraded for the same host and path; nothing is ever requested over http.
  if (first.protocol === 'http:') first.protocol = 'https:';
  host = normalizedHost(first);
  if (!plainHttps(first) || !isShortLinkUrl(first)) return failed('hostNotAllowed');

  const link = deadline(SHORT_LINK_LINK_TIMEOUT_MS);
  let current = first;
  try {
    for (let hop = 0; ; hop += 1) {
      if (hop >= SHORT_LINK_HOP_LIMIT) return failed('tooManyRedirects');
      if (options.budgetEndsAt !== undefined && deps.now() >= options.budgetEndsAt) {
        return done({ status: 'budget' });
      }
      host = normalizedHost(current);
      // Judged before every hop, as if it were the first request.
      if (!plainHttps(current) || !onAllowlist(current)) return failed('hostNotAllowed');

      // "No answer at all" on the first hop: Google was not reached, the link was not opened.
      const unreachable = (failure: AtmMapLinkFailure): ShortLinkResult =>
        hop === 0
          ? done({ status: 'noAnswer', stopReason: 'unreachable', failure })
          : failed(failure);

      const hopDeadline = deadline(SHORT_LINK_HOP_TIMEOUT_MS);
      const signal = AbortSignal.any([hopDeadline.signal, link.signal]);
      let response: ShortLinkHopResponse;
      try {
        let addresses: string[];
        try {
          addresses = await raceAbort(deps.lookup(host, signal), signal);
        } catch (error) {
          // ENOTFOUND, EAI_AGAIN and every other lookup error alike: the name did not resolve.
          return unreachable(isAbort(error) ? 'timeout' : 'network');
        }
        if (addresses.length === 0) return unreachable('network');
        if (addresses.some(isPrivateAddress)) return failed('hostNotAllowed');
        try {
          response = await raceAbort(deps.hop(current, addresses, signal), signal);
        } catch (error) {
          return unreachable(isAbort(error) ? 'timeout' : 'network');
        }
      } finally {
        hopDeadline.clear();
      }

      status = response.status;
      await response.cancel().catch(() => undefined);

      if (status === 429 || status === 503) {
        return done({ status: 'noAnswer', stopReason: 'rateLimited', failure: 'httpStatus' });
      }
      if (status === 200)
        return done(pointIn(current) ?? { status: 'failed', failure: 'noCoordinates' });
      if (!REDIRECT_STATUSES.has(status) || response.location === null) {
        return failed('httpStatus');
      }

      const location = response.location;
      if (location.length > SHORT_LINK_MAX_LOCATION_LENGTH) return failed('invalidUrl');
      const next = parse(location, current);
      if (next === null) return failed('invalidUrl');

      // 1. An https Google Maps URL with a pin or a viewport: read, never requested.
      const found = pointIn(next);
      if (found !== null) return done(found);
      // 2. Another allowlisted https URL: the next hop.
      if (next.protocol === 'https:' && onAllowlist(next)) {
        current = next;
        continue;
      }
      // 3. A consent interstitial: its `continue` parameter is parsed, the page never fetched.
      if (normalizedHost(next) === 'consent.google.com') {
        const target = parse(next.searchParams.get('continue') ?? '');
        if (target !== null && target.protocol === 'https:' && isGoogleMapsUrl(target)) {
          return done(pointIn(target) ?? { status: 'failed', failure: 'consentPage' });
        }
      }
      // 4. Anything else is refused — and never read: `https://evil.example/@30,31` is no point.
      return failed('hostNotAllowed');
    }
  } finally {
    link.clear();
  }
};

// ── The batch ───────────────────────────────────────────────────────────────────────────────────

/** How a run claims, stores and releases its links — the location service's queries (§5.4). */
export interface ShortLinkBatchIo<T> {
  /** The atomic claim, immediately before the fetch. False = skip (another run, or it changed). */
  claim(item: T): Promise<boolean>;
  /** The link's one result and the re-derivation, under the version guard. */
  store(
    item: T,
    result: Extract<ShortLinkResult, { status: 'resolved' | 'failed' }>,
  ): Promise<'stored' | 'conflict'>;
  /** Clears this run's claim on a link it did not finish; the link stays pending. */
  release(item: T): Promise<void>;
}

export interface ShortLinkBatchResult<T> {
  /** Links opened and given a result (resolved + failed + conflicts). */
  attempted: number;
  resolved: number;
  failed: number;
  /** Results that matched no document because a person wrote it in between. */
  conflicts: number;
  stopReason: AtmMapLinkStopReason | null;
  outcomes: { item: T; status: 'resolved' | 'failed'; failure: AtmMapLinkFailure | null }[];
}

/**
 * One call's links, sequentially: at most `ATM_MAP_LINK_BATCH_MAX`, a 300 ms pause between links,
 * the 40 s budget checked before every link and every hop. A stop — budget, rate limit, Google
 * unreachable — releases the claim of the link it did not finish.
 */
export const runShortLinkBatch = async <T extends { url: string }>(
  items: readonly T[],
  io: ShortLinkBatchIo<T>,
  deps: ShortLinkDeps,
): Promise<ShortLinkBatchResult<T>> => {
  const result: ShortLinkBatchResult<T> = {
    attempted: 0,
    resolved: 0,
    failed: 0,
    conflicts: 0,
    stopReason: null,
    outcomes: [],
  };
  const budgetEndsAt = deps.now() + SHORT_LINK_RUN_BUDGET_MS;
  let pauseDue = false;

  for (const item of items.slice(0, ATM_MAP_LINK_BATCH_MAX)) {
    if (pauseDue) {
      await deps.sleep(SHORT_LINK_PAUSE_MS);
      pauseDue = false;
    }
    if (deps.now() >= budgetEndsAt) {
      result.stopReason = 'budget';
      break;
    }
    if (!(await io.claim(item))) continue;

    let finished = false;
    try {
      const answer = await resolveShortLink(item.url, deps, { budgetEndsAt });
      pauseDue = true;
      if (answer.status === 'budget' || answer.status === 'noAnswer') {
        result.stopReason = answer.status === 'budget' ? 'budget' : answer.stopReason;
        break;
      }
      const stored = await io.store(item, answer);
      finished = true;
      result.attempted += 1;
      if (stored === 'conflict') result.conflicts += 1;
      else if (answer.status === 'resolved') result.resolved += 1;
      else result.failed += 1;
      result.outcomes.push({
        item,
        status: answer.status,
        failure: answer.status === 'failed' ? answer.failure : null,
      });
    } finally {
      if (!finished) await io.release(item);
    }
  }
  return result;
};
