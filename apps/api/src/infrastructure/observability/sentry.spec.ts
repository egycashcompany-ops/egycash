// DEC-34: an error event never carries a register request body or a register secret field. Pure
// checks on the two exported functions — `initSentry` hands them to the SDK unchanged. Every value
// below is synthetic.
import { type Event } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { isSecretBodyUrl, scrubSentryEvent } from './sentry';

const FAKE = 'synthetic-value-0000';

describe('isSecretBodyUrl', () => {
  it('matches the register entries and the import upload', () => {
    expect(isSecretBodyUrl('http://localhost:4000/api/v1/atm/register/entries')).toBe(true);
    expect(isSecretBodyUrl('http://localhost:4000/api/v1/atm/register/entries/abc/reveal')).toBe(
      true,
    );
    expect(isSecretBodyUrl('http://localhost:4000/api/v1/atm/register/import')).toBe(true);
    expect(isSecretBodyUrl('/api/v1/atm/register/entries?page=1')).toBe(true);
  });

  it('matches under a BASE_PATH prefix', () => {
    expect(isSecretBodyUrl('https://ecms.example/ecms/api/v1/atm/register/entries')).toBe(true);
  });

  it('does not match other ATM routes', () => {
    expect(isSecretBodyUrl('http://localhost:4000/api/v1/atm/machines')).toBe(false);
    expect(isSecretBodyUrl('http://localhost:4000/api/v1/atm/replenishments')).toBe(false);
  });

  // /atm/settings: `PUT /atm/mailbox` carries the Graph client secret in plaintext until it is
  // sealed — every spelling Express routes there (it ignores case, lets a doubled slash through).
  it('matches the maintenance mailbox, however its path is spelled', () => {
    expect(isSecretBodyUrl('http://localhost:4000/api/v1/atm/mailbox')).toBe(true);
    expect(isSecretBodyUrl('https://ecms.example/ecms/api/v1/atm/mailbox/test')).toBe(true);
    expect(isSecretBodyUrl('http://localhost:4000/API/V1/ATM/Mailbox')).toBe(true);
    expect(isSecretBodyUrl('http://localhost:4000/api/v1//atm/mailbox')).toBe(true);
    expect(isSecretBodyUrl('http://localhost:4000/api/v1/atm/mail-tickets')).toBe(false);
  });
});

describe('scrubSentryEvent', () => {
  it('drops the whole body of a register request', () => {
    const event: Event = {
      request: {
        method: 'POST',
        url: 'http://localhost:4000/api/v1/atm/register/entries',
        data: JSON.stringify({
          name: 'ATM',
          safeCombination: FAKE,
          keys: { supervisorCode: FAKE },
        }),
      },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request).toBeDefined();
    expect(scrubbed.request?.data).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain(FAKE);
  });

  it('removes nested secret names from extra and contexts', () => {
    const event: Event = {
      extra: {
        requestId: 'r-1',
        entry: { safeCombination: FAKE, deep: { keys: { cashUnitCode: FAKE } } },
        receiptNotes: FAKE,
      },
      contexts: {
        register: { handoverNotes: FAKE, rows: [{ plaintextCombination: FAKE, importRow: 3 }] },
      },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(JSON.stringify(scrubbed)).not.toContain(FAKE);
    expect(scrubbed.extra?.requestId).toBe('r-1');
    const entry = scrubbed.extra?.entry as Record<string, unknown>;
    expect(entry).not.toHaveProperty('safeCombination');
    expect(entry.deep).toEqual({});
    expect(scrubbed.extra).not.toHaveProperty('receiptNotes');
    expect(scrubbed.contexts?.register).toEqual({ rows: [{ importRow: 3 }] });
  });

  it('scrubs a JSON body of another route without dropping it', () => {
    const event: Event = {
      request: {
        url: 'http://localhost:4000/api/v1/atm/machines',
        data: JSON.stringify({ area: 'North', nested: { receiptNotes: FAKE } }),
      },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(JSON.parse(String(scrubbed.request?.data))).toEqual({ area: 'North', nested: {} });
  });

  it('drops the whole body of a mailbox save, and the secret anywhere else', () => {
    const event: Event = {
      request: {
        method: 'PUT',
        url: 'http://localhost:4000/api/v1/atm/mailbox',
        data: JSON.stringify({ tenantId: 'syn.example', clientSecret: FAKE }),
      },
      extra: { input: { clientSecret: FAKE, enabled: true } },
    };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.extra?.input).toEqual({ enabled: true });
    expect(JSON.stringify(scrubbed)).not.toContain(FAKE);
  });

  it('leaves an unrelated event unchanged', () => {
    const event: Event = {
      message: 'boom',
      request: { url: 'http://localhost:4000/api/v1/atm/machines', data: { area: 'North' } },
      extra: { requestId: 'r-2', path: '/atm/machines' },
      contexts: { os: { name: 'linux' } },
    };
    const before = structuredClone(event);
    expect(scrubSentryEvent(event)).toEqual(before);
  });
});
