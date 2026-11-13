// The Graph transport's two listings, against a stubbed `outboundFetch`. What is pinned is the
// query each one sends — the environment's oldest-first page exactly as it always was, and the
// mailbox document's newest-first page in the shape Graph accepts (every `$orderby` property
// first in `$filter`, or Graph refuses with `InefficientFilter`) — plus that a refused token names
// the status and the path, never the secret it was asked with. Every value below is synthetic.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetched: { url: string; init: RequestInit | undefined }[] = [];
let respond: (url: string) => Response;

vi.mock('../../../infrastructure/http/outbound', () => ({
  outboundFetch: async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetched.push({ url, init });
    return respond(url);
  },
}));

const { createGraphMailboxSource } = await import('./graph-mail.source');

const SECRET = 'syn-graph-secret-3c1d-do-not-leak';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const graphMessage = (id: string, body: string) => ({
  id,
  subject: 'ATM alert',
  isRead: false,
  receivedDateTime: '2026-10-28T08:00:00Z',
  from: { emailAddress: { address: 'alerts@bank.example' } },
  body: { content: body },
});

const source = () =>
  createGraphMailboxSource({
    tenantId: 'syn-tenant.onmicrosoft.com',
    clientId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    userEmail: 'maintenance@bank.example',
    openSecret: async () => SECRET,
  });

const messagesCall = (): URL => {
  const call = fetched.find((entry) => entry.url.startsWith('https://graph.microsoft.com/'));
  if (call === undefined) throw new Error('no Graph listing was requested');
  return new URL(call.url);
};

beforeEach(() => {
  fetched.length = 0;
  respond = (url) =>
    url.includes('/oauth2/v2.0/token')
      ? json({ access_token: 'syn-token', expires_in: 3600 })
      : json({
          value: [graphMessage('m1', 'Managed client:BM000345'), graphMessage('m2', '')],
        });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the mailbox document’s listing', () => {
  const SINCE = '2026-11-11T09:00:00Z';

  it('asks for the unread mail of a range of dates, newest first, in the shape Graph accepts', async () => {
    // 2026-11-13: asked for every date (`ge 1900-01-01`), the mailbox answered nothing for twenty
    // seconds. A range of days is what it can answer.
    await source().listUnreadPage?.(50, { since: SINCE, before: null });
    const query = messagesCall().searchParams;
    expect(query.get('$filter')).toBe(`receivedDateTime ge ${SINCE} and isRead eq false`);
    expect(query.get('$orderby')).toBe('receivedDateTime desc');
    expect(query.get('$top')).toBe('50');
    expect(query.has('$skip')).toBe(false);
  });

  it('finds an older page by its dates, never by counting down the pile with `$skip`', async () => {
    await source().listUnreadPage?.(50, { since: SINCE, before: '2026-11-12T08:15:02Z' });
    const query = messagesCall().searchParams;
    expect(query.get('$filter')).toBe(
      `receivedDateTime ge ${SINCE} and receivedDateTime lt 2026-11-12T08:15:02Z and isRead eq false`,
    );
    expect(query.get('$orderby')).toBe('receivedDateTime desc');
    expect(query.has('$skip')).toBe(false);
  });

  it('writes nothing into the query but receipt times', async () => {
    for (const window of [
      { since: SINCE, before: '2026-11-12T08:15:02Z or isRead eq true' },
      { since: '1900-01-01 or isRead eq true', before: null },
    ]) {
      const failure = await source()
        .listUnreadPage?.(50, window)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
    }
    expect(fetched.some((entry) => entry.url.includes('/messages'))).toBe(false);
  });

  it('counts every message listed, the ones it cannot use included, and names the oldest', async () => {
    respond = (url) =>
      url.includes('/oauth2/v2.0/token')
        ? json({ access_token: 'syn-token', expires_in: 3600 })
        : json({
            value: [
              graphMessage('m1', 'Managed client:BM000345'),
              { ...graphMessage('m2', ''), receivedDateTime: '2026-10-28T07:59:00Z' },
            ],
          });
    const page = await source().listUnreadPage?.(50, { since: SINCE, before: null });
    // m2 has no body: left out of the messages, and still one of the places in the list — and
    // the page's oldest, where the next page starts.
    expect(page?.messages.map((m) => m.providerMessageId)).toEqual(['m1']);
    expect(page?.listed).toBe(2);
    expect(page?.oldest).toBe('2026-10-28T07:59:00Z');
  });

  it('names no oldest on an empty page', async () => {
    respond = (url) =>
      url.includes('/oauth2/v2.0/token')
        ? json({ access_token: 'syn-token', expires_in: 3600 })
        : json({ value: [] });
    const page = await source().listUnreadPage?.(50, { since: SINCE, before: null });
    expect(page).toEqual({ messages: [], listed: 0, oldest: null });
  });
});

describe('the environment’s listing', () => {
  it('is the oldest page it always was', async () => {
    const messages = await source().listUnread(50);
    const query = messagesCall().searchParams;
    expect(query.get('$filter')).toBe('isRead eq false');
    expect(query.get('$orderby')).toBe('receivedDateTime asc');
    expect(query.get('$top')).toBe('50');
    expect(query.has('$skip')).toBe(false);
    expect(messages.map((m) => m.providerMessageId)).toEqual(['m1']);
  });
});

describe('a refused token', () => {
  it('names the status and the path, never the secret it was asked with', async () => {
    respond = (url) =>
      url.includes('/oauth2/v2.0/token')
        ? json({ error: 'invalid_client', error_description: 'AADSTS7000215' }, 401)
        : json({ value: [] });
    const failure = await source()
      .listUnreadPage?.(1, { since: '2026-11-11T09:00:00Z', before: null })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'microsoft graph 401 on /syn-tenant.onmicrosoft.com/oauth2/v2.0/token',
    );
    expect((failure as Error).message).not.toContain(SECRET);
    // The secret travelled in the token request's form body, and nowhere in a URL.
    expect(fetched.every((entry) => !entry.url.includes(SECRET))).toBe(true);
  });
});
