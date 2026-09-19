// The outbound policy (Security Architecture §4, SSRF): which destinations the api may contact,
// judged without a network — the address lookup is injected, and `fetch` is stubbed for the
// redirect cases.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OutboundBlockedError,
  hostMatches,
  isPrivateAddress,
  outboundFetch,
  outboundRefusal,
  publicHttpsRefusal,
  type AddressLookup,
  type OutboundPolicy,
} from './outbound';

const policy = (over: Partial<OutboundPolicy> = {}): OutboundPolicy => ({
  allowHosts: ['api.twilio.com', '*.blob.core.windows.net'],
  pinnedHosts: ['n8n', 'nid-ocr'],
  allowPrivate: false,
  ...over,
});

/** A resolver with a fixed table; anything else fails to resolve. */
const table =
  (entries: Record<string, string[]>): AddressLookup =>
  async (hostname) => {
    const found = entries[hostname];
    if (found === undefined) throw new Error(`ENOTFOUND ${hostname}`);
    return found;
  };

const publicDns = table({
  'api.twilio.com': ['54.1.2.3'],
  'evil.blob.core.windows.net': ['20.1.2.3'],
  'rebound.blob.core.windows.net': ['20.1.2.3', '10.0.0.5'],
  'inside.blob.core.windows.net': ['169.254.169.254'],
});

afterEach(() => vi.restoreAllMocks());

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.10',
    '198.18.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::10.0.0.1',
    '2001:db8::1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '54.1.2.3',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it('treats what it cannot parse as private — the check exists to refuse', () => {
    expect(isPrivateAddress('not-an-address')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('hostMatches', () => {
  it('matches exact hosts case-insensitively and ignores a trailing dot', () => {
    expect(hostMatches('API.Twilio.com.', 'api.twilio.com')).toBe(true);
    expect(hostMatches('api.twilio.com.evil.example', 'api.twilio.com')).toBe(false);
  });

  it('matches a wildcard suffix but never the bare domain', () => {
    expect(hostMatches('a.blob.core.windows.net', '*.blob.core.windows.net')).toBe(true);
    expect(hostMatches('a.b.blob.core.windows.net', '*.blob.core.windows.net')).toBe(true);
    expect(hostMatches('blob.core.windows.net', '*.blob.core.windows.net')).toBe(false);
    expect(hostMatches('xblob.core.windows.net', '*.blob.core.windows.net')).toBe(false);
  });
});

describe('outboundRefusal', () => {
  it('allows an allowlisted host that resolves publicly', async () => {
    const reason = await outboundRefusal(
      new URL('https://api.twilio.com/2010-04-01/Accounts/x/Messages.json'),
      policy(),
      publicDns,
    );
    expect(reason).toBeNull();
  });

  it('refuses a host that is not on the list, before any lookup', async () => {
    const lookup = vi.fn<AddressLookup>();
    const reason = await outboundRefusal(new URL('https://attacker.example/'), policy(), lookup);
    expect(reason).toMatch(/not on the outbound allowlist/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a listed host that resolves to a private address, even alongside a public one', async () => {
    expect(
      await outboundRefusal(new URL('https://inside.blob.core.windows.net/'), policy(), publicDns),
    ).toMatch(/resolves to a private address \(169\.254\.169\.254\)/);
    expect(
      await outboundRefusal(new URL('https://rebound.blob.core.windows.net/'), policy(), publicDns),
    ).toMatch(/private address \(10\.0\.0\.5\)/);
  });

  it('refuses a literal private IP without consulting DNS', async () => {
    const lookup = vi.fn<AddressLookup>();
    const reason = await outboundRefusal(
      new URL('http://169.254.169.254/latest/meta-data/'),
      policy({ allowHosts: ['*'] }),
      lookup,
    );
    expect(reason).toMatch(/private address/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('sees through the numeric spellings of an address the URL parser normalizes', async () => {
    // 2130706433 is 127.0.0.1 in decimal; 0x7f000001 is the same in hex. WHATWG parsing turns
    // both into dotted quads, which is what the classifier then judges.
    for (const spelling of [
      'http://2130706433/',
      'http://0x7f000001/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      const reason = await outboundRefusal(new URL(spelling), policy({ allowHosts: ['*'] }));
      expect(reason, spelling).toMatch(/private address/);
    }
  });

  it('trusts a pinned host at whatever address it has — the operator typed it', async () => {
    const lookup = vi.fn<AddressLookup>();
    expect(
      await outboundRefusal(new URL('http://n8n:5678/webhook/x'), policy(), lookup),
    ).toBeNull();
    expect(
      await outboundRefusal(new URL('http://nid-ocr:8099/extract'), policy(), lookup),
    ).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lets an allowlisted host resolve privately only when the operator said so', async () => {
    const url = new URL('https://inside.blob.core.windows.net/');
    expect(await outboundRefusal(url, policy({ allowPrivate: true }), publicDns)).toBeNull();
    expect(await outboundRefusal(url, policy(), publicDns)).not.toBeNull();
  });

  it('refuses non-http schemes, credentials in the URL, and a host that does not resolve', async () => {
    expect(await outboundRefusal(new URL('ftp://api.twilio.com/'), policy(), publicDns)).toMatch(
      /scheme ftp: is not http/,
    );
    expect(
      await outboundRefusal(new URL('https://user:pw@api.twilio.com/'), policy(), publicDns),
    ).toMatch(/credentials/);
    expect(
      await outboundRefusal(new URL('https://gone.blob.core.windows.net/'), policy(), publicDns),
    ).toMatch(/does not resolve/);
  });
});

describe('publicHttpsRefusal — a browser-supplied destination', () => {
  const dns = table({ 'fcm.googleapis.com': ['142.250.1.1'], 'push.internal': ['10.0.0.9'] });

  it('accepts a public HTTPS endpoint', async () => {
    expect(await publicHttpsRefusal('https://fcm.googleapis.com/fcm/send/abc', dns)).toBeNull();
  });

  it('refuses plain http, a private address, credentials, and garbage', async () => {
    expect(await publicHttpsRefusal('http://fcm.googleapis.com/x', dns)).toMatch(/not https/);
    expect(await publicHttpsRefusal('https://push.internal/x', dns)).toMatch(/private address/);
    expect(await publicHttpsRefusal('https://a:b@fcm.googleapis.com/x', dns)).toMatch(
      /credentials/,
    );
    expect(await publicHttpsRefusal('not a url', dns)).toBe('not a URL');
  });
});

describe('outboundFetch', () => {
  const response = (status: number, headers: Record<string, string> = {}): Response =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
      body: null,
    }) as unknown as Response;

  it('refuses before opening a socket', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(
      outboundFetch('https://attacker.example/', {}, { policy: policy(), lookup: publicDns }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows a redirect to a listed public host, judging the hop like a first request', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(302, { location: 'https://evil.blob.core.windows.net/next' }))
      .mockResolvedValueOnce(response(200));
    const result = await outboundFetch(
      'https://api.twilio.com/start',
      { method: 'GET' },
      { policy: policy(), lookup: publicDns },
    );
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(String(secondUrl)).toBe('https://evil.blob.core.windows.net/next');
    // Never `follow`: the whole point is that no hop is taken without being judged.
    expect(secondInit.redirect).toBe('manual');
  });

  it('refuses a redirect that lands on a private address', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        response(302, { location: 'http://169.254.169.254/latest/meta-data/' }),
      );
    await expect(
      outboundFetch(
        'https://api.twilio.com/start',
        {},
        { policy: policy({ allowHosts: ['*'] }), lookup: publicDns },
      ),
    ).rejects.toThrow(/private address/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a host that is not listed, even from a pinned host', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      response(301, { location: 'https://attacker.example/collect' }),
    );
    await expect(
      outboundFetch('http://n8n:5678/webhook/x', {}, { policy: policy(), lookup: publicDns }),
    ).rejects.toThrow(/not on the outbound allowlist/);
  });

  it('turns a 303 (and a redirected POST) into a GET without a body, and keeps a 307 intact', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(303, { location: '/done' }))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(307, { location: '/retry' }))
      .mockResolvedValueOnce(response(200));
    const options = { policy: policy(), lookup: publicDns };

    await outboundFetch('https://api.twilio.com/a', { method: 'POST', body: 'x' }, options);
    const afterSeeOther = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(afterSeeOther.method).toBe('GET');
    expect(afterSeeOther.body).toBeUndefined();
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://api.twilio.com/done');

    await outboundFetch('https://api.twilio.com/b', { method: 'POST', body: 'x' }, options);
    const afterTemporary = fetchMock.mock.calls[3]?.[1] as RequestInit;
    expect(afterTemporary.method).toBe('POST');
    expect(afterTemporary.body).toBe('x');
  });

  it('stops following after the configured number of hops and hands back the 3xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(302, { location: '/loop' }));
    const result = await outboundFetch(
      'https://api.twilio.com/loop',
      {},
      { policy: policy(), lookup: publicDns, maxRedirects: 3 },
    );
    expect(result.status).toBe(302);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });
});
