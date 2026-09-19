// The one door outbound HTTP leaves through (Security Architecture §4, SSRF).
//
// The api talks to a handful of services: the n8n instance and the OCR sidecar an operator
// configured, and the SaaS endpoints the code itself names — Microsoft Graph, Meta, Twilio. That is
// the whole list, and this file is where it is written down. A request to anything else is refused
// before a socket opens, and so is a request to something on the list that turns out to resolve
// to a private address: the cloud metadata endpoint at 169.254.169.254, a Redis on the same
// network, the api's own health route. Server-side request forgery is exactly a request the
// application makes on an attacker's behalf, and the two things the attacker needs — a host of
// their choosing, or a listed host that quietly points somewhere private — are the two things this
// checks.
//
// Redirects are the third way in, and the reason `outboundFetch` follows them by hand: a listed
// host that answers `302 Location: http://169.254.169.254/` would otherwise be followed by `fetch`
// without a second look. Every hop is judged as if it were the first request.
//
// Two tiers, deliberately:
//   · PINNED hosts — the base URLs the operator put in the environment — are trusted at whatever
//     address they resolve to. On a compose network `http://n8n:5678` IS a private address, and
//     the operator typing it is the authorization.
//   · Everything else must be on the allowlist AND resolve to public addresses, unless the operator
//     set `OUTBOUND_HTTP_ALLOW_PRIVATE` for an integration that lives on their own network under a
//     name that is not a configured base URL.
//
// Enforced by `outbound-only-fetch.spec.ts`: no other file in the api may call `fetch` directly.
import { lookup as systemLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '../config/env';
import { logger } from '../logging/logger';

export interface OutboundPolicy {
  /** Hostnames the api may contact — exact (`api.twilio.com`) or a suffix (`*.example.com`). */
  readonly allowHosts: readonly string[];
  /** Hosts trusted at whatever address they resolve to: the operator's configured base URLs. */
  readonly pinnedHosts: readonly string[];
  /** Whether an allowlisted (non-pinned) host may resolve to a private address. */
  readonly allowPrivate: boolean;
}

/** Resolves a hostname to its addresses. Injected so the policy is testable without DNS. */
export type AddressLookup = (hostname: string) => Promise<string[]>;

export class OutboundBlockedError extends Error {
  constructor(
    readonly destination: string,
    readonly reason: string,
  ) {
    super(`outbound request refused: ${reason}`);
    this.name = 'OutboundBlockedError';
  }
}

/**
 * The SaaS endpoints the code names. One row per host, with the caller that needs it, so adding an
 * integration is a reviewable line here rather than an unguarded `fetch` somewhere else.
 */
const NAMED_SAAS_HOSTS: readonly string[] = [
  'graph.microsoft.com', // atm/mail-tickets/graph-mail.source.ts — the maintenance mailbox
  'login.microsoftonline.com', // same — the client-credentials token
  'graph.facebook.com', // infrastructure/messaging/whatsapp.ts — WhatsApp Cloud API
  'api.twilio.com', // same — the Twilio transport
];

const normalizeHost = (hostname: string): string =>
  hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[(.*)\]$/, '$1');

const hostOf = (url: string | undefined): string | null => {
  if (url === undefined || url === '') return null;
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
};

const parseList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => normalizeHost(entry.trim()))
    .filter((entry) => entry !== '');

/** The deployment's policy, read from the environment. */
export const outboundPolicyFromEnv = (): OutboundPolicy => ({
  allowHosts: [...NAMED_SAAS_HOSTS, ...parseList(env.OUTBOUND_HTTP_ALLOWLIST)],
  pinnedHosts: [hostOf(env.N8N_BASE_URL), hostOf(env.NATIONAL_ID_OCR_URL)].filter(
    (host): host is string => host !== null,
  ),
  allowPrivate: env.OUTBOUND_HTTP_ALLOW_PRIVATE,
});

let policyOverride: OutboundPolicy | null = null;

/** Test-only: a client spec talks to `https://n8n.example`, which no environment pins. */
export const setOutboundPolicyForTests = (policy: OutboundPolicy | null): void => {
  policyOverride = policy;
};

const currentPolicy = (): OutboundPolicy => policyOverride ?? outboundPolicyFromEnv();

/**
 * `*.example.com` matches `a.example.com` and `a.b.example.com`, never `example.com` itself. A bare
 * `*` matches any host — the address check is then the only rule, which is what a browser-supplied
 * push endpoint gets.
 */
export const hostMatches = (hostname: string, pattern: string): boolean => {
  const host = normalizeHost(hostname);
  const rule = normalizeHost(pattern);
  if (rule === '*') return true;
  if (rule.startsWith('*.')) return host.endsWith(rule.slice(1)) && host.length > rule.length - 1;
  return host === rule;
};

// ── Address classification ─────────────────────────────────────────────────

const parseIpv4 = (address: string): [number, number, number, number] | null => {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return null;
  return octets as [number, number, number, number];
};

/**
 * Not globally routable, per the IANA special-purpose registries: private, loopback, link-local
 * (where cloud metadata lives), carrier-grade NAT, the unspecified block, multicast, reserved, and
 * the documentation and benchmarking ranges — anything a request from this process should never
 * be steered towards by a URL it did not choose.
 */
const isPrivateIpv4 = ([a, b, c]: [number, number, number, number]): boolean =>
  a === 0 || // 0.0.0.0/8 — "this network"
  a === 10 || // 10.0.0.0/8
  (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 — carrier-grade NAT
  a === 127 || // 127.0.0.0/8 — loopback
  (a === 169 && b === 254) || // 169.254.0.0/16 — link-local, cloud metadata
  (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
  (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 — IETF protocol assignments
  (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 — TEST-NET-1
  (a === 192 && b === 168) || // 192.168.0.0/16
  (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 — benchmarking
  (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 — TEST-NET-2
  (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 — TEST-NET-3
  a >= 224; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255

/** The sixteen bytes of an IPv6 address, or null when it is not one. Handles `::` and a v4 tail. */
const parseIpv6 = (address: string): number[] | null => {
  let text = address;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  // A dotted-quad tail (`::ffff:10.0.0.1`) becomes two hex groups.
  const tail = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (tail !== null) {
    const v4 = parseIpv4(tail[1] as string);
    if (v4 === null) return null;
    const [a, b, c, d] = v4;
    text = `${text.slice(0, -(tail[1] as string).length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = groups(halves[0] as string);
  const rest = halves.length === 2 ? groups(halves[1] as string) : [];
  if (head === null || rest === null) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const words = [...head, ...new Array<number>(halves.length === 2 ? missing : 0).fill(0), ...rest];
  return words.flatMap((word) => [word >> 8, word & 0xff]);
};

const isPrivateIpv6 = (bytes: number[]): boolean => {
  const allZeroTo = (end: number): boolean => bytes.slice(0, end).every((byte) => byte === 0);
  // `::` and `::1`.
  if (allZeroTo(15) && ((bytes[15] as number) === 0 || (bytes[15] as number) === 1)) return true;
  // `::ffff:a.b.c.d` — an IPv4 address in IPv6 clothing: judge the IPv4.
  if (allZeroTo(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4(bytes.slice(12) as [number, number, number, number]);
  }
  // `64:ff9b::a.b.c.d` — NAT64 carries an IPv4 in its last four bytes too.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isPrivateIpv4(bytes.slice(12) as [number, number, number, number]);
  }
  const first = bytes[0] as number;
  const second = bytes[1] as number;
  return (
    (first & 0xfe) === 0xfc || // fc00::/7 — unique local
    (first === 0xfe && (second & 0xc0) === 0x80) || // fe80::/10 — link-local
    first === 0xff || // ff00::/8 — multicast
    (first === 0x20 && second === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) // 2001:db8::/32 — documentation
  );
};

/**
 * Is this address one a request from here must never be steered to? Unparseable input counts as
 * private: the check exists to refuse, and "I could not read it" is not a reason to allow.
 */
export const isPrivateAddress = (address: string): boolean => {
  const kind = isIP(address);
  if (kind === 4) {
    const octets = parseIpv4(address);
    return octets === null ? true : isPrivateIpv4(octets);
  }
  if (kind === 6) {
    const bytes = parseIpv6(address);
    return bytes === null ? true : isPrivateIpv6(bytes);
  }
  return true;
};

// ── The decision ───────────────────────────────────────────────────────────

const defaultLookup: AddressLookup = async (hostname) => {
  const found = await systemLookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
};

/** A URL as it may appear in a log: origin and path, never the query string or credentials. */
const describe = (url: URL): string => `${url.origin}${url.pathname}`;

/**
 * Why this destination must not be contacted under this policy — or `null` when it may be.
 * Pure but for the address lookup, which is what the tests replace.
 */
export const outboundRefusal = async (
  url: URL,
  policy: OutboundPolicy,
  lookup: AddressLookup = defaultLookup,
): Promise<string | null> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `scheme ${url.protocol} is not http or https`;
  }
  if (url.username !== '' || url.password !== '') return 'credentials in the URL';
  const host = normalizeHost(url.hostname);
  if (host === '') return 'no host';
  if (policy.pinnedHosts.some((pinned) => pinned === host)) return null;
  if (!policy.allowHosts.some((pattern) => hostMatches(host, pattern))) {
    return `host ${host} is not on the outbound allowlist`;
  }
  if (policy.allowPrivate) return null;
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await lookup(host);
    } catch (error) {
      return `host ${host} does not resolve (${error instanceof Error ? error.message : 'lookup failed'})`;
    }
  }
  if (addresses.length === 0) return `host ${host} does not resolve`;
  const hidden = addresses.find(isPrivateAddress);
  if (hidden !== undefined) return `host ${host} resolves to a private address (${hidden})`;
  return null;
};

/**
 * A destination a caller holds because a BROWSER handed it over — a Web Push endpoint. There is no
 * allowlist for those (every browser vendor runs its own push service), so the rule is the
 * protocol's own: HTTPS, no credentials, and an address a server ought to be sending to.
 */
export const publicHttpsRefusal = async (
  destination: string,
  lookup: AddressLookup = defaultLookup,
): Promise<string | null> => {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return 'not a URL';
  }
  if (url.protocol !== 'https:') return `scheme ${url.protocol} is not https`;
  return outboundRefusal(url, { allowHosts: ['*'], pinnedHosts: [], allowPrivate: false }, lookup);
};

// ── The request ────────────────────────────────────────────────────────────

export interface OutboundFetchOptions {
  /** Defaults to the deployment's policy from the environment. */
  policy?: OutboundPolicy;
  lookup?: AddressLookup;
  /** Redirect hops to follow, each judged like the first request. 0 returns the 3xx as-is. */
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Refuses, and says so where an operator reads. The URL in the log carries no query string — a
 * signed URL or an API key in the query is exactly the kind of thing a refused request may hold.
 */
export const assertOutboundAllowed = async (
  url: URL,
  policy: OutboundPolicy = currentPolicy(),
  lookup?: AddressLookup,
): Promise<void> => {
  const reason = await outboundRefusal(url, policy, lookup);
  if (reason === null) return;
  logger.warn({ destination: describe(url), reason }, 'outbound request refused');
  throw new OutboundBlockedError(describe(url), reason);
};

/**
 * `fetch`, behind the policy. Redirects are followed by hand so a listed host cannot bounce the
 * request somewhere unlisted: each `Location` is resolved against the request that produced it
 * and judged afresh. A 303 — and a 301/302 answering a POST — becomes a GET without a body, as
 * browsers do; a 307/308 keeps method and body.
 */
export const outboundFetch = async (
  input: string | URL,
  init: RequestInit = {},
  options: OutboundFetchOptions = {},
): Promise<Response> => {
  const policy = options.policy ?? currentPolicy();
  const maxRedirects = options.maxRedirects ?? 5;
  let url = typeof input === 'string' ? new URL(input) : input;
  let request: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; ; hop += 1) {
    await assertOutboundAllowed(url, policy, options.lookup);
    const response = await fetch(url.href, request);
    if (!REDIRECT_STATUSES.has(response.status) || hop >= maxRedirects) return response;
    const location = response.headers.get('location');
    if (location === null) return response;
    // The body of a redirect is never what the caller wants; release it before the next hop.
    await response.body?.cancel().catch(() => undefined);
    url = new URL(location, url);
    const method = (request.method ?? 'GET').toUpperCase();
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      const asGet: RequestInit = { ...request, method: 'GET' };
      delete asGet.body;
      request = asGet;
    }
  }
};
