// The poll loop's rules, against a fake mailbox and a fake ingestion seam. What is asserted here
// is the OWNER'S RULE — an unmatched message stays unread — plus the two facts that make one
// central reader work: the branch's category is applied to the message, and a failure never
// marks anything read.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AtmSettingKeys,
  type AtmBranchLinksSetting,
  type AtmMailIngestResultDto,
} from '@ecms/contracts';
import {
  registerAtmMailSource,
  registerAtmMailSourceFactory,
  resetAtmMailSource,
  type AtmMailMessage,
  type AtmMailSource,
  type AtmMailWindow,
} from './mail-source';
import { atmMailIngestionService } from './mail-ingestion.service';
import {
  BACKOFF_MAX_MS,
  backoffAfter,
  categoriesFiledAs,
  documentRules,
  MAIL_POLL_ANSWERED_KEY,
  MAIL_POLL_BACKOFF_KEY,
  MAIL_POLL_LEASE_KEY,
  MAIL_POLL_SWEEP_KEY,
  mailInstant,
  NEWEST_WINDOW_MS,
  pollAtmMailbox,
  resetAtmMailSweep,
  RUN_BUDGET_MS,
  SWEEP_HORIZON_MS,
  SWEEP_MIN_WINDOW_MS,
  SWEEP_SKIP_AFTER,
  SWEEP_WINDOW_MS,
} from './mail-poll.service';
import { type AtmMailboxConfigDoc } from './mailbox-config.model';
import { atmMailboxConfigRepository } from './mailbox-config.repository';
import { settingsService } from '../../../platform/settings';
import { getCache } from '../../../infrastructure/redis/cache';

const BRANCH_ALEX = '64b7f9c2e13b4a0012345678';
const BRANCH_TANTA = '64b7f9c2e13b4a0012345679';
/** Linked to work as Tanta in the tests that set `links` (`atm.branchLinks`). */
const BRANCH_LINKED = '64b7f9c2e13b4a001234567b';

/** The stored branch links the settings read answers with — none unless a test sets them. */
let links: AtmBranchLinksSetting = [];

const message = (id: string): AtmMailMessage => ({
  providerMessageId: id,
  receivedAt: new Date('2026-08-23T07:00:00.000Z'),
  senderEmail: 'alerts@bank.example',
  subject: 'ATM alert',
  bodyText: 'Managed client:BM000345 Status code Description : jammed',
  isRead: false,
});

/** Records what the transport was told to do, which is the whole point of these assertions. */
const fakeSource = (messages: AtmMailMessage[]) => {
  const handled: { id: string; category: string | null }[] = [];
  registerAtmMailSource({
    providerId: 'fake',
    available: () => true,
    listUnread: async () => messages,
    markHandled: async (id, category) => {
      handled.push({ id, category });
    },
  });
  return handled;
};

const ingestReturns = (...results: AtmMailIngestResultDto[]): void => {
  const queue = [...results];
  vi.spyOn(atmMailIngestionService, 'ingest').mockImplementation(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected extra ingest call');
    return next;
  });
};

beforeEach(() => {
  links = [];
  vi.spyOn(settingsService, 'resolve').mockImplementation(async (key: string) =>
    key === AtmSettingKeys.BranchLinks
      ? (links as never)
      : ([
          { branchId: BRANCH_ALEX, category: 'Green Category' },
          { branchId: BRANCH_TANTA, category: 'Blue Category' },
        ] as never),
  );
  // No document saved on /atm/settings: the environment mode every test below this line ran in
  // before the screen existed.
  vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(null);
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetAtmMailSource();
  registerAtmMailSourceFactory(null);
  resetAtmMailSweep();
  await getCache().del(
    MAIL_POLL_LEASE_KEY,
    MAIL_POLL_BACKOFF_KEY,
    MAIL_POLL_ANSWERED_KEY,
    MAIL_POLL_SWEEP_KEY,
  );
});

describe('pollAtmMailbox — an unconfigured mailbox', () => {
  it('does nothing at all when no source is registered', async () => {
    const ingest = vi.spyOn(atmMailIngestionService, 'ingest');
    expect(await pollAtmMailbox()).toMatchObject({
      read: 0,
      created: 0,
      duplicates: 0,
      unmatched: 0,
      failed: 0,
      error: null,
      unmatchedReasons: [],
    });
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('pollAtmMailbox — outcomes decide what happens to the message', () => {
  it('marks a filed message read and tags it with ITS BRANCH category', async () => {
    const handled = fakeSource([message('m1')]);
    ingestReturns({ outcome: 'created', ticketId: 't1', branchId: BRANCH_TANTA, reason: null });

    const report = await pollAtmMailbox();

    expect(report).toMatchObject({ read: 1, created: 1, unmatched: 0, failed: 0 });
    expect(handled).toEqual([{ id: 'm1', category: 'Blue Category' }]);
  });

  it('LEAVES AN UNMATCHED MESSAGE UNREAD — the owner’s rule', async () => {
    const handled = fakeSource([message('m1')]);
    ingestReturns({
      outcome: 'unmatched',
      ticketId: null,
      branchId: null,
      reason: 'no active machine with code 345',
    });

    const report = await pollAtmMailbox();

    expect(report).toMatchObject({ read: 1, unmatched: 1, created: 0 });
    expect(handled).toEqual([]);
  });

  it('marks a duplicate read but does not re-tag it', async () => {
    const handled = fakeSource([message('m1')]);
    ingestReturns({
      outcome: 'duplicateMessage',
      ticketId: 't1',
      branchId: BRANCH_ALEX,
      reason: null,
    });

    const report = await pollAtmMailbox();

    expect(report).toMatchObject({ duplicates: 1 });
    expect(handled).toEqual([{ id: 'm1', category: null }]);
  });

  it('leaves a message unread when ingestion throws, so the next poll retries it', async () => {
    const handled = fakeSource([message('m1')]);
    vi.spyOn(atmMailIngestionService, 'ingest').mockRejectedValue(new Error('mongo is down'));

    const report = await pollAtmMailbox();

    expect(report).toMatchObject({ read: 1, failed: 1, created: 0 });
    expect(handled).toEqual([]);
  });

  it('marks a filed message read even when its branch has no configured category', async () => {
    const handled = fakeSource([message('m1')]);
    ingestReturns({
      outcome: 'created',
      ticketId: 't1',
      branchId: '64b7f9c2e13b4a001234567a',
      reason: null,
    });

    await pollAtmMailbox();

    expect(handled).toEqual([{ id: 'm1', category: null }]);
  });
});

describe('pollAtmMailbox — a mixed batch', () => {
  it('handles each message on its own outcome and reports the totals', async () => {
    const handled = fakeSource([message('m1'), message('m2'), message('m3')]);
    ingestReturns(
      { outcome: 'created', ticketId: 't1', branchId: BRANCH_ALEX, reason: null },
      {
        outcome: 'unmatched',
        ticketId: null,
        branchId: null,
        reason: 'no machine code recognized',
      },
      { outcome: 'duplicateMessage', ticketId: 't2', branchId: BRANCH_ALEX, reason: null },
    );

    const report = await pollAtmMailbox();

    expect(report).toMatchObject({
      read: 3,
      created: 1,
      duplicates: 1,
      unmatched: 1,
      failed: 0,
      error: null,
      unmatchedReasons: ['no machine code recognized'],
    });
    // m2 is absent: unmatched mail stays in the mailbox for a human to see.
    expect(handled.map((h) => h.id)).toEqual(['m1', 'm3']);
    expect(handled[0]).toEqual({ id: 'm1', category: 'Green Category' });
  });
});

// /atm/settings (the owner, 2026-10-28): one shared mailbox, branches switched on one at a time.
// With the document in force only its branches are filed, the category comes from its row, every
// run is recorded on it — and with no document, nothing above this line changed.
describe('pollAtmMailbox — the mailbox document', () => {
  const docId = new Types.ObjectId();

  const mailboxDoc = (over: Partial<AtmMailboxConfigDoc> = {}): AtmMailboxConfigDoc =>
    ({
      _id: docId,
      __v: 0,
      key: 'default',
      tenantId: 'tenant.example',
      clientId: '00000000-0000-4000-8000-000000000001',
      // Never opened here: the fake mailbox below asks for no token.
      clientSecretRef: { provider: 'platformCrypto', keyId: 'dev1', ref: {} },
      userEmail: 'maintenance@bank.example',
      enabled: true,
      branches: [
        { branchId: new Types.ObjectId(BRANCH_TANTA), category: 'Red Category' },
        { branchId: new Types.ObjectId(BRANCH_ALEX), category: null },
      ],
      lastPoll: null,
      ...over,
    }) as AtmMailboxConfigDoc;

  /** The document's mailbox: what the transport was told, and how often it was built. */
  const fakeMailbox = (messages: AtmMailMessage[] | Error) => {
    const handled: { id: string; category: string | null }[] = [];
    const built = { count: 0 };
    const source: AtmMailSource = {
      providerId: 'fake-mailbox',
      available: () => true,
      listUnread: async () => {
        if (messages instanceof Error) throw messages;
        return messages;
      },
      markHandled: async (id, category) => {
        handled.push({ id, category });
      },
    };
    registerAtmMailSourceFactory(() => {
      built.count += 1;
      return source;
    });
    return { handled, built };
  };

  const recorded = () =>
    vi.spyOn(atmMailboxConfigRepository, 'recordLastPoll').mockResolvedValue(undefined);

  it('reads nothing while reading is switched off — the environment mailbox included', async () => {
    vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(
      mailboxDoc({ enabled: false }),
    );
    const environment = fakeSource([message('m1')]);
    const mailbox = fakeMailbox([message('m2')]);
    const ingest = vi.spyOn(atmMailIngestionService, 'ingest');
    const record = recorded();

    expect(await pollAtmMailbox()).toMatchObject({ read: 0, created: 0, error: null });
    expect(ingest).not.toHaveBeenCalled();
    expect(environment).toEqual([]);
    expect(mailbox.built.count).toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('files through the gate of switched-on branches, the row’s category first', async () => {
    vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
    const { handled } = fakeMailbox([message('m1'), message('m2')]);
    ingestReturns(
      { outcome: 'created', ticketId: 't1', branchId: BRANCH_TANTA, reason: null },
      { outcome: 'created', ticketId: 't2', branchId: BRANCH_ALEX, reason: null },
    );
    recorded();

    await pollAtmMailbox();

    const gate = vi.mocked(atmMailIngestionService.ingest).mock.calls[0]?.[1];
    expect([...(gate?.branchIds ?? [])].sort()).toEqual([BRANCH_ALEX, BRANCH_TANTA].sort());
    // Tanta's row names its own colour; Alex's names none, so the old setting answers.
    expect(handled).toEqual([
      { id: 'm1', category: 'Red Category' },
      { id: 'm2', category: 'Green Category' },
    ]);
  });

  it('leaves a mail for a branch not switched on UNREAD, and records why', async () => {
    vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
    const { handled } = fakeMailbox([message('m1')]);
    ingestReturns({
      outcome: 'unmatched',
      ticketId: null,
      branchId: null,
      reason: 'branch not enabled for mail',
    });
    const record = recorded();

    const run = await pollAtmMailbox();

    expect(handled).toEqual([]);
    expect(run).toMatchObject({
      read: 1,
      unmatched: 1,
      error: null,
      unmatchedReasons: ['branch not enabled for mail'],
    });
    expect(record).toHaveBeenCalledWith(docId, run);
  });

  it('keeps the first five unmatched reasons, as the log line does', async () => {
    vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
    fakeMailbox(ids.map(message));
    ingestReturns(
      ...ids.map((id): AtmMailIngestResultDto => ({
        outcome: 'unmatched',
        ticketId: null,
        branchId: null,
        reason: `no active machine with code ${id}`,
      })),
    );
    recorded();

    const run = await pollAtmMailbox();

    expect(run?.unmatched).toBe(7);
    expect(run?.unmatchedReasons).toHaveLength(5);
    expect(run?.unmatchedReasons[0]).toBe('no active machine with code m1');
  });

  it('makes a mailbox failing as a whole the run’s error — recorded, nothing marked', async () => {
    vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
    const { handled } = fakeMailbox(new Error('microsoft graph 401 on /tenant/oauth2/v2.0/token'));
    const ingest = vi.spyOn(atmMailIngestionService, 'ingest');
    const record = recorded();

    const run = await pollAtmMailbox();

    expect(run).toMatchObject({
      read: 0,
      error: 'microsoft graph 401 on /tenant/oauth2/v2.0/token',
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(handled).toEqual([]);
    expect(record).toHaveBeenCalledWith(docId, run);
  });

  it('never fails the run when the record itself fails', async () => {
    vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
    fakeMailbox([]);
    vi.spyOn(atmMailboxConfigRepository, 'recordLastPoll').mockRejectedValue(new Error('down'));

    await expect(pollAtmMailbox()).resolves.toMatchObject({ read: 0, error: null });
  });

  it('builds the document’s mailbox once per version, so its token outlives one run', async () => {
    const find = vi.spyOn(atmMailboxConfigRepository, 'findSingleton');
    find.mockResolvedValue(mailboxDoc({ __v: 3 }));
    const { built } = fakeMailbox([]);
    recorded();

    await pollAtmMailbox();
    await pollAtmMailbox();
    expect(built.count).toBe(1);

    // A save moves the version: the next run reads with what was saved.
    find.mockResolvedValue(mailboxDoc({ __v: 4 }));
    await pollAtmMailbox();
    expect(built.count).toBe(2);
  });

  // The owner (2026-10-28): «فرع أكتوبر شغال هو والمهندسين مع بعض». A mail is filed under its
  // machine's RESOLVED branch, so a row saved for the linked source switches its target on.
  it('a linked source’s row switches its target on and colours it, unless the target has a row', async () => {
    links = [{ branchId: BRANCH_LINKED, actsAsBranchId: BRANCH_TANTA }];
    const find = vi.spyOn(atmMailboxConfigRepository, 'findSingleton');
    find.mockResolvedValue(
      mailboxDoc({
        branches: [{ branchId: new Types.ObjectId(BRANCH_LINKED), category: 'Orange Category' }],
      }),
    );
    const { handled } = fakeMailbox([message('m1')]);
    ingestReturns({ outcome: 'created', ticketId: 't1', branchId: BRANCH_TANTA, reason: null });
    recorded();

    await pollAtmMailbox();

    const gate = vi.mocked(atmMailIngestionService.ingest).mock.calls[0]?.[1];
    expect([...(gate?.branchIds ?? [])]).toEqual([BRANCH_TANTA]);
    expect(handled).toEqual([{ id: 'm1', category: 'Orange Category' }]);
  });

  it('keeps the environment mode exactly: every branch, no gate, nothing recorded', async () => {
    const handled = fakeSource([message('m1')]);
    ingestReturns({ outcome: 'created', ticketId: 't1', branchId: BRANCH_TANTA, reason: null });
    const record = recorded();

    await pollAtmMailbox();

    expect(vi.mocked(atmMailIngestionService.ingest).mock.calls[0]?.[1]).toBeUndefined();
    expect(handled).toEqual([{ id: 'm1', category: 'Blue Category' }]);
    expect(record).not.toHaveBeenCalled();
  });

  // The ONE shared mailbox holds the mail ECMS leaves unread on purpose (a branch not switched on
  // yet), and read oldest first fifty of those would hide every new mail for good. So the document
  // is read newest first, a page at a time — and, when the newest page is full, one older page of a
  // sweep that walks the rest of the pile a run at a time.
  describe('a failing mailbox is given time', () => {
    // 2026-11-13: one reading a minute, and Graph answered every one with a 502 after some twenty
    // seconds. A reading a minute only added to what the mailbox was struggling with.
    const T0 = Date.UTC(2026, 10, 13, 10, 0, 0);
    const MINUTE = 60_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * A mailbox that fails while `state.failing`, counting the FIRST listing of every reading — the
     * one whose answer decides the back-off. `paged`: the newest-first pages the mailbox document is
     * read by in production (`listUnreadPage`); otherwise the environment's one oldest page.
     */
    const flakyMailbox = (paged: boolean) => {
      const state = { failing: true, listings: 0 };
      const fail = (): never => {
        throw new Error('microsoft graph 502 on /v1.0/users/x/messages');
      };
      const source: AtmMailSource = {
        providerId: 'fake-mailbox',
        available: () => true,
        listUnread: async () => {
          state.listings += 1;
          if (state.failing) fail();
          return [];
        },
        ...(paged
          ? {
              listUnreadPage: async (_limit: number, window: AtmMailWindow) => {
                if (window.before === null) state.listings += 1;
                if (state.failing) fail();
                return { messages: [], listed: 0, oldest: null };
              },
            }
          : {}),
        markHandled: async () => undefined,
      };
      registerAtmMailSourceFactory(() => source);
      return state;
    };

    const at = async (offsetMs: number, options?: { scheduled?: boolean }) => {
      vi.setSystemTime(T0 + offsetMs);
      return pollAtmMailbox(options);
    };

    it.each([
      ['newest first, page by page (the mailbox document in production)', true],
      ['the one oldest page', false],
    ])(
      'waits longer after each unanswered reading in a row; «قراءة الآن» never waits; a success starts the count over — %s',
      async (_shape, paged) => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        const record = recorded();
        const mailbox = flakyMailbox(paged);
        const scheduled = { scheduled: true };

        // One failure is a hiccup: the next minute reads as usual.
        expect((await at(0, scheduled))?.error).toContain('502');
        expect((await at(MINUTE, scheduled))?.error).toContain('502');
        expect(mailbox.listings).toBe(2);
        // Two in a row: two minutes from the last one's start.
        expect(await at(2 * MINUTE, scheduled)).toBeNull();
        expect((await at(3 * MINUTE, scheduled))?.error).toContain('502');
        expect(mailbox.listings).toBe(3);
        // Three: four minutes — until 6:55.
        for (const minute of [4, 5, 6]) expect(await at(minute * MINUTE, scheduled)).toBeNull();
        expect(mailbox.listings).toBe(3);
        // A reading that waited is not recorded: the screen keeps the last one, and its error.
        expect(record).toHaveBeenCalledTimes(3);

        // «قراءة الآن» reads whatever the wait — and the mailbox has come back…
        mailbox.failing = false;
        expect(await at(6 * MINUTE + 10_000)).toMatchObject({ error: null });
        expect(mailbox.listings).toBe(4);
        // …so the scheduled reading reads at once, inside what was still the four minutes' wait.
        expect(await at(6 * MINUTE + 30_000, scheduled)).toMatchObject({ error: null });
        expect(mailbox.listings).toBe(5);

        // And the count started over: the next failure is a hiccup again, not a fourth in a row.
        mailbox.failing = true;
        expect((await at(8 * MINUTE, scheduled))?.error).toContain('502');
        expect((await at(9 * MINUTE, scheduled))?.error).toContain('502');
        expect(await at(10 * MINUTE, scheduled)).toBeNull();
        expect(mailbox.listings).toBe(7);
      },
    );

    it('does not count a reading whose first listing the mailbox answered, whatever failed after it', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      const calls = { newest: 0, older: 0 };
      const source: AtmMailSource = {
        providerId: 'fake-mailbox',
        available: () => true,
        listUnread: async () => [],
        // The newest page answers; the older page below it fails, every time.
        listUnreadPage: async (_limit, window) => {
          if (window.before === null) {
            calls.newest += 1;
            return { messages: [], listed: 0, oldest: null };
          }
          calls.older += 1;
          throw new Error('microsoft graph 502 on /v1.0/users/x/messages');
        },
        markHandled: async () => undefined,
      };
      registerAtmMailSourceFactory(() => source);

      for (const minute of [0, 1, 2, 3]) {
        expect((await at(minute * MINUTE, { scheduled: true }))?.error).toContain('502');
      }
      // New mail is still looked for every minute.
      expect(calls).toEqual({ newest: 4, older: 4 });
    });

    /**
     * A paged mailbox on the fake clock: `unread` mails at their receipt times, listed by window,
     * newest first; every listing recorded. `fails(window)` says which listings Graph refuses.
     */
    const datedMailbox = (
      unread: { id: string; at: number }[],
      fails: (window: AtmMailWindow) => boolean,
    ) => {
      const state = {
        unread: [...unread].sort((a, b) => b.at - a.at),
        listings: [] as AtmMailWindow[],
        handled: [] as { id: string; at: number }[],
      };
      registerAtmMailSourceFactory(() => ({
        providerId: 'fake-dated',
        available: () => true,
        listUnread: async () => [],
        listUnreadPage: async (limit, window) => {
          state.listings.push(window);
          if (fails(window)) throw new Error('microsoft graph 502 on /v1.0/users/x/messages');
          const from = Date.parse(window.since);
          const bound = window.before === null ? Infinity : Date.parse(window.before);
          // Only what has arrived by the reader's clock.
          const listed = state.unread
            .filter((m) => m.at <= Date.now() && m.at >= from && m.at < bound)
            .slice(0, limit);
          const last = listed[listed.length - 1];
          return {
            messages: listed.map((m) => ({ ...message(m.id), receivedAt: new Date(m.at) })),
            listed: listed.length,
            oldest: last === undefined ? null : mailInstant(last.at),
          };
        },
        markHandled: async (id) => {
          const mail = state.unread.find((m) => m.id === id);
          if (mail !== undefined) state.handled.push({ id, at: Date.now() });
          state.unread = state.unread.filter((m) => m.id !== id);
        },
      }));
      return state;
    };

    const fileEverything = (): void => {
      vi.spyOn(atmMailIngestionService, 'ingest').mockResolvedValue({
        outcome: 'created',
        ticketId: 't-1',
        branchId: BRANCH_TANTA,
        reason: null,
      });
    };

    it('sends the sweep first to the mail of a gap the newest page does not reach back over', async () => {
      // The review's timeline: answered readings until 0:00, a mail at 0:30, then four unanswered
      // readings whose waits add up to fifteen minutes — longer than the newest page reaches back.
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      fileEverything();
      let down = false;
      const mailbox = datedMailbox([{ id: 'on-gap', at: T0 + 30_000 }], () => down);
      const scheduled = { scheduled: true };

      // Answered minutes before it: the sweep walks two hours further down each time.
      for (const minute of [-4, -3, -2, -1, 0]) {
        expect(await at(minute * MINUTE, scheduled)).toMatchObject({ error: null });
      }
      down = true;
      for (const minute of [1, 2, 4, 8]) {
        expect((await at(minute * MINUTE, scheduled))?.error).toContain('502');
      }
      // 8 failures… waits of 2, 4, 8: the next reading is at 0:16, its newest page from 0:01.
      expect(await at(9 * MINUTE, scheduled)).toBeNull();
      down = false;
      const back = await at(16 * MINUTE, scheduled);

      expect(back).toMatchObject({ error: null, created: 1 });
      expect(mailbox.handled).toEqual([{ id: 'on-gap', at: T0 + 16 * MINUTE }]);
      // The newest page did not reach it; the older page, started just below it, did.
      const [newest, older] = mailbox.listings.slice(-2);
      expect(newest).toEqual({ since: mailInstant(T0 + MINUTE), before: null });
      expect(older).toEqual({
        since: mailInstant(T0 + MINUTE - SWEEP_WINDOW_MS),
        before: mailInstant(T0 + MINUTE),
      });

      // Below the gap, the sweep goes back to where it stood before it — five steps of two hours
      // below the first newest page — rather than walk again what it already swept.
      await at(17 * MINUTE, scheduled);
      const resumed = mailbox.listings[mailbox.listings.length - 1];
      expect(resumed?.before).toBe(
        mailInstant(T0 - 4 * MINUTE - NEWEST_WINDOW_MS - 5 * SWEEP_WINDOW_MS),
      );
    });

    describe('after the gap', () => {
      const HOUR = 60 * MINUTE;
      const scheduled = { scheduled: true };
      /** The bounds each older page was asked below, in order. */
      const olderBefores = (listings: AtmMailWindow[]): (string | null)[] =>
        listings.filter((w) => w.before !== null).map((w) => w.before);

      it('walks a second gap that comes during the first, then goes on from where the first walk was, then back', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        recorded();
        const mailbox = datedMailbox([], () => false);
        // Five answered minutes: the sweep stands five steps below the first newest page.
        for (const minute of [-4, -3, -2, -1, 0]) await at(minute * MINUTE, scheduled);
        const stood = mailInstant(T0 - 4 * MINUTE - NEWEST_WINDOW_MS - 5 * SWEEP_WINDOW_MS);
        // Eight hours unread, two steps into walking them, then twenty minutes more.
        await at(8 * HOUR, scheduled);
        await at(8 * HOUR + MINUTE, scheduled);
        for (let minute = 21; minute <= 26; minute += 1) {
          await at(8 * HOUR + minute * MINUTE, scheduled);
        }
        // The second gap is walked from the top; then the walk goes on from where the second gap
        // found it (3:45, partway down the first), down past the first gap's floor — and back.
        expect(olderBefores(mailbox.listings).slice(-6)).toEqual([
          mailInstant(T0 + 8 * HOUR + 6 * MINUTE),
          mailInstant(T0 + 3 * HOUR + 45 * MINUTE),
          mailInstant(T0 + HOUR + 45 * MINUTE),
          stood,
          mailInstant(Date.parse(stood) - SWEEP_WINDOW_MS),
          mailInstant(Date.parse(stood) - 2 * SWEEP_WINDOW_MS),
        ]);
      });

      it('keeps its place through a restart of the worker — every deploy is one', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        recorded();
        const mailbox = datedMailbox([], () => false);
        for (const minute of [0, 1, 2]) await at(minute * MINUTE, scheduled);
        // The process goes; what it kept in memory with it. The cache stays.
        resetAtmMailSweep();
        await at(3 * MINUTE, scheduled);
        // The fourth step, below the third — not the first again, just below the newest page.
        expect(olderBefores(mailbox.listings).at(-1)).toBe(
          mailInstant(T0 - NEWEST_WINDOW_MS - 3 * SWEEP_WINDOW_MS),
        );
      });

      /** Makes the cache fail `op` on the sweep's key, `times` times; every other call goes through. */
      const sweepKeyFails = (op: 'get' | 'set', times: number): void => {
        const cache = getCache();
        const real = cache[op].bind(cache) as (...args: unknown[]) => Promise<unknown>;
        let left = times;
        vi.spyOn(cache, op).mockImplementation((async (...args: unknown[]) => {
          if (args[0] === MAIL_POLL_SWEEP_KEY && left > 0) {
            left -= 1;
            throw new Error('redis blip');
          }
          return real(...args);
        }) as never);
      };

      it('writes nothing back from a reading that could not read the stored sweep', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        recorded();
        datedMailbox([], () => false);
        for (const minute of [-4, -3, -2, -1, 0]) await at(minute * MINUTE, scheduled);
        // The worker walks an eight-hour gap and stores where to go back to.
        await at(8 * HOUR, scheduled);
        const walking = await getCache().get(MAIL_POLL_SWEEP_KEY);
        expect(JSON.parse(walking as string)).toMatchObject({ resume: { then: null } });

        // A press in the api — nothing of its own in memory after a deploy — whose read fails.
        resetAtmMailSweep();
        sweepKeyFails('get', 1);
        expect(await at(8 * HOUR + 30_000)).toMatchObject({ error: null });

        expect(await getCache().get(MAIL_POLL_SWEEP_KEY)).toBe(walking);
      });

      it('finds the gap again when its walk could not be stored', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        recorded();
        const mailbox = datedMailbox([], () => false);
        for (const minute of [-4, -3, -2, -1, 0]) await at(minute * MINUTE, scheduled);
        // The gap's walk does not reach the cache…
        sweepKeyFails('set', 99);
        await at(8 * HOUR, scheduled);
        vi.mocked(getCache().set).mockRestore();
        // …so the answered time stays before the gap…
        expect(await getCache().get(MAIL_POLL_ANSWERED_KEY)).toBe(String(T0));
        // …and the next reading, loading the state from before it, finds the gap and walks it.
        await at(8 * HOUR + MINUTE, scheduled);
        expect(olderBefores(mailbox.listings).at(-1)).toBe(
          mailInstant(T0 + 8 * HOUR + MINUTE - NEWEST_WINDOW_MS),
        );
      });

      it('takes back the step and the failures it had where it stood, so a window it cannot answer is still passed over', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        recorded();
        // Just below the sweep's third step lies an instant the mailbox cannot answer for.
        const poison = T0 - NEWEST_WINDOW_MS - 2 * SWEEP_WINDOW_MS - 5 * MINUTE;
        const mailbox = datedMailbox(
          [],
          (w) =>
            w.before !== null && Date.parse(w.since) <= poison && poison < Date.parse(w.before),
        );
        // Two steps down, then four failures there: two hours, one, thirty minutes, fifteen.
        for (let minute = 0; minute < 6; minute += 1) await at(minute * MINUTE, scheduled);
        // Twenty minutes unread: the gap is walked, and the sweep goes back to the failing window.
        await at(25 * MINUTE, scheduled);
        await at(26 * MINUTE, scheduled);
        await at(27 * MINUTE, scheduled);

        const older = mailbox.listings.filter((w) => w.before !== null);
        const [back, past] = older.slice(-2);
        // Back at fifteen minutes and the fifth failure in a row — not at two hours and the first…
        expect(Date.parse(back?.before as string) - Date.parse(back?.since as string)).toBe(
          SWEEP_MIN_WINDOW_MS,
        );
        // …so the next step lies below the window it passed over.
        expect(Date.parse(past?.before as string)).toBeLessThanOrEqual(poison);
      });

      it('lets go of a gap older than the horizon once it reaches the horizon, and goes back after the next gap', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        recorded();
        const mailbox = datedMailbox([], () => false);
        for (const minute of [-4, -3, -2, -1, 0]) await at(minute * MINUTE, scheduled);
        // Thirty and a half days unread: deeper than the sweep ever walks.
        const lapse = 30 * 24 * HOUR + 12 * HOUR;
        const steps = Math.ceil(SWEEP_HORIZON_MS / SWEEP_WINDOW_MS) + 2;
        for (let minute = 0; minute <= steps + 5; minute += 1) {
          await at(lapse + minute * MINUTE, scheduled);
        }
        // Where it stands now, after a full walk and five more steps…
        const stood = olderBefores(mailbox.listings).at(-1) as string;
        const stoodSince = mailbox.listings.filter((w) => w.before !== null).at(-1)
          ?.since as string;
        // …then a twenty-minute gap: walked, and back to where it stood.
        const after = lapse + (steps + 25) * MINUTE;
        await at(after, scheduled);
        await at(after + MINUTE, scheduled);
        expect(stood).not.toBe(stoodSince);
        expect(olderBefores(mailbox.listings).at(-1)).toBe(stoodSince);
      });
    });

    it('leaves the gap to the worker when «قراءة الآن» is the first reading answered after it', async () => {
      // A press during the worker's back-off is often the first reading answered after a gap: it
      // must not hide the gap from the worker's next reading, which walks it.
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      fileEverything();
      let down = false;
      // At 0:20 — below the press's newest page (from 0:30), as it is below the worker's (from 1:00).
      const mailbox = datedMailbox([{ id: 'on-gap', at: T0 + 20_000 }], () => down);
      const scheduled = { scheduled: true };

      for (const minute of [-4, -3, -2, -1, 0]) await at(minute * MINUTE, scheduled);
      down = true;
      for (const minute of [1, 2, 4, 8]) await at(minute * MINUTE, scheduled);
      down = false;

      // The press, the moment the mailbox is back: the newest fifteen minutes, nothing of the gap.
      expect(await at(15 * MINUTE + 30_000)).toMatchObject({ error: null, created: 0 });
      expect(mailbox.handled).toEqual([]);
      // The worker's next reading still finds the gap, and walks it first.
      expect(await at(16 * MINUTE, scheduled)).toMatchObject({ error: null, created: 1 });
      expect(mailbox.handled).toEqual([{ id: 'on-gap', at: T0 + 16 * MINUTE }]);
    });

    it('grows a halved step back once the mailbox answers it', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      let olderFails = true;
      const mailbox = datedMailbox([], (w) => w.before !== null && olderFails);

      await at(0, { scheduled: true });
      olderFails = false;
      await at(MINUTE, { scheduled: true });
      await at(2 * MINUTE, { scheduled: true });

      const sizes = mailbox.listings
        .filter((w) => w.before !== null)
        .map((w) => Date.parse(w.before as string) - Date.parse(w.since));
      expect(sizes).toEqual([SWEEP_WINDOW_MS, SWEEP_WINDOW_MS / 2, SWEEP_WINDOW_MS]);
    });

    it('does not count a window the mailbox answered toward passing it over, though the run was cut short', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      // The first older page lies below T0 − 15 min; two unread mails sit just under its top.
      let olderFails = true;
      const mailbox = datedMailbox(
        [
          { id: 'off-1', at: T0 - 20 * MINUTE },
          { id: 'off-2', at: T0 - 21 * MINUTE },
        ],
        (w) => w.before !== null && olderFails,
      );
      // Taking on the first mail spends the run's time: the rest waits for the next run.
      vi.spyOn(atmMailIngestionService, 'ingest').mockImplementation(async () => {
        vi.setSystemTime(Date.now() + RUN_BUDGET_MS + 1);
        return {
          outcome: 'unmatched',
          ticketId: null,
          branchId: null,
          reason: 'branch not enabled for mail',
        };
      });

      // Four failures: two hours, one, thirty minutes, fifteen.
      for (const minute of [0, 1, 2, 3]) await at(minute * MINUTE, { scheduled: true });
      // Answered — and cut short after one mail.
      olderFails = false;
      await at(4 * MINUTE, { scheduled: true });
      // One more failure is the first of a new streak, not the fifth of the old one.
      olderFails = true;
      await at(5 * MINUTE, { scheduled: true });
      olderFails = false;
      await at(6 * MINUTE, { scheduled: true });

      const older = mailbox.listings.filter((w) => w.before !== null);
      // Minutes 3 to 6 all asked for the same fifteen minutes: nothing was passed over.
      expect(new Set(older.slice(3).map((w) => `${w.since}..${String(w.before)}`)).size).toBe(1);
    });

    it('keeps its place through gaps the newest page does reach back over', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      let down = false;
      const mailbox = datedMailbox([], () => down);
      const scheduled = { scheduled: true };

      for (const minute of [0, 1, 2]) await at(minute * MINUTE, scheduled);
      down = true;
      await at(3 * MINUTE, scheduled);
      down = false;
      await at(4 * MINUTE, scheduled);

      // A one-minute hiccup: the sweep goes on two hours below where it stood, not back to the top.
      const olderBounds = mailbox.listings.filter((w) => w.before !== null).map((w) => w.before);
      expect(olderBounds).toEqual([
        mailInstant(T0 - NEWEST_WINDOW_MS),
        mailInstant(T0 - NEWEST_WINDOW_MS - SWEEP_WINDOW_MS),
        mailInstant(T0 - NEWEST_WINDOW_MS - 2 * SWEEP_WINDOW_MS),
        mailInstant(T0 - NEWEST_WINDOW_MS - 3 * SWEEP_WINDOW_MS),
      ]);
    });

    it('asks for half a window the mailbox cannot answer, then passes over it — the newest page every minute', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      // One instant the mailbox cannot answer for: thirty minutes below the first newest page.
      const poison = T0 - NEWEST_WINDOW_MS - 15 * MINUTE;
      const mailbox = datedMailbox(
        [],
        (w) => w.before !== null && Date.parse(w.since) <= poison && poison < Date.parse(w.before),
      );

      for (let minute = 0; minute < SWEEP_SKIP_AFTER + 1; minute += 1) {
        await at(minute * MINUTE, { scheduled: true });
      }

      const older = mailbox.listings.filter((w) => w.before !== null);
      const sizes = older.map((w) => Date.parse(w.before as string) - Date.parse(w.since));
      // Two hours, then halved down to fifteen minutes, where it fails twice more…
      expect(sizes.slice(0, SWEEP_SKIP_AFTER)).toEqual([
        SWEEP_WINDOW_MS,
        SWEEP_WINDOW_MS / 2,
        SWEEP_WINDOW_MS / 4,
        SWEEP_MIN_WINDOW_MS,
        SWEEP_MIN_WINDOW_MS,
      ]);
      // …and the next step lies below the window it passed over, at full size again.
      const after = older[SWEEP_SKIP_AFTER];
      expect(Date.parse(after?.before as string)).toBeLessThanOrEqual(poison);
      expect(sizes[SWEEP_SKIP_AFTER]).toBe(SWEEP_WINDOW_MS);
      // The newest page was asked for every minute all along.
      expect(mailbox.listings.filter((w) => w.before === null)).toHaveLength(SWEEP_SKIP_AFTER + 1);
    });

    it('waits 2, 4, 8 minutes after failures in a row, then never more than ten', () => {
      expect([1, 2, 3, 4, 5, 9].map(backoffAfter)).toEqual([
        0,
        2 * MINUTE,
        4 * MINUTE,
        8 * MINUTE,
        BACKOFF_MAX_MS,
        BACKOFF_MAX_MS,
      ]);
      expect(BACKOFF_MAX_MS).toBe(10 * MINUTE);
    });

    it('keeps reading when the cache cannot say how long to wait', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      recorded();
      const mailbox = flakyMailbox(true);
      vi.spyOn(getCache(), 'get').mockRejectedValue(new Error('redis is down'));
      vi.spyOn(getCache(), 'set').mockRejectedValue(new Error('redis is down'));
      for (const minute of [0, 1, 2]) {
        expect((await at(minute * MINUTE, { scheduled: true }))?.error).toContain('502');
      }
      expect(mailbox.listings).toBe(3);
    });
  });

  describe('reading the shared mailbox newest first', () => {
    /**
     * The receipt time of the `index`-th unread mail, newest first: ten seconds apart — a busy
     * shared mailbox, where fifteen minutes hold more than a page — as Graph writes it.
     */
    const receivedAt = (index: number): string =>
      new Date(Date.UTC(2026, 10, 13, 12, 0, 0) - index * 10_000).toISOString().replace('.000', '');

    /** A paged mailbox, NEWEST FIRST at index 0: what is unread, and every page asked for. */
    const pagedMailbox = (unread: AtmMailMessage[]) => {
      const state = {
        unread: unread.map((m, index) => ({ ...m, receivedAt: new Date(receivedAt(index)) })),
        pages: [] as { limit: number; since: string; before: string | null }[],
        handled: [] as { id: string; category: string | null }[],
      };
      registerAtmMailSourceFactory(() => ({
        providerId: 'fake-paged',
        available: () => true,
        listUnread: async () => {
          throw new Error('the document is read newest first, page by page');
        },
        listUnreadPage: async (limit, { since, before }) => {
          state.pages.push({ limit, since, before });
          const bound = before === null ? Infinity : new Date(before).getTime();
          const from = new Date(since).getTime();
          const messages = state.unread
            .filter((m) => m.receivedAt.getTime() < bound && m.receivedAt.getTime() >= from)
            .slice(0, limit);
          const last = messages[messages.length - 1];
          return {
            messages,
            listed: messages.length,
            oldest: last === undefined ? null : last.receivedAt.toISOString().replace('.000', ''),
          };
        },
        markHandled: async (id, category) => {
          state.handled.push({ id, category });
          state.unread = state.unread.filter((m) => m.providerMessageId !== id);
        },
      }));
      return state;
    };

    /** `on-…` is a Tanta machine (switched on); anything else a branch not switched on. */
    const ingestByMessage = (): void => {
      vi.spyOn(atmMailIngestionService, 'ingest').mockImplementation(async (mail) =>
        mail.providerMessageId.startsWith('on-')
          ? {
              outcome: 'created',
              ticketId: `t-${mail.providerMessageId}`,
              branchId: BRANCH_TANTA,
              reason: null,
            }
          : {
              outcome: 'unmatched',
              ticketId: null,
              branchId: null,
              reason: 'branch not enabled for mail',
            },
      );
    };

    const pile = (count: number): AtmMailMessage[] =>
      Array.from({ length: count }, (_, i) => message(`off-${String(i)}`));

    /** The bound each OLDER page was asked below — the sweep's steps. */
    const sweeps = (state: { pages: { before: string | null }[] }): (string | null)[] =>
      state.pages.filter((page) => page.before !== null).map((page) => page.before);

    /** The reader's clock in these tests: a minute after the newest mail. */
    const NOW = Date.UTC(2026, 10, 13, 12, 1, 0);
    const newestSince = mailInstant(NOW - NEWEST_WINDOW_MS);
    /** The window a sweep step below `before` lists. */
    const below = (before: string): { since: string; before: string } => ({
      since: mailInstant(Date.parse(before) - SWEEP_WINDOW_MS),
      before,
    });

    beforeEach(() => {
      ingestByMessage();
      recorded();
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    it('files a new mail however much mail it left unread sits in the mailbox', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const mailbox = pagedMailbox([message('on-new'), ...pile(60)]);

      const run = await pollAtmMailbox();

      expect(mailbox.handled).toEqual([{ id: 'on-new', category: 'Red Category' }]);
      expect(run).toMatchObject({ read: 61, created: 1, unmatched: 60, error: null });
      // The last fifteen minutes' newest page, then two hours below its oldest mail — found by dates,
      // never by count, never «every date».
      expect(mailbox.pages).toEqual([
        { limit: 50, since: newestSince, before: null },
        { limit: 50, ...below(receivedAt(49)) },
      ]);
    });

    it('sweeps on below the fifteen minutes when they held every unread mail of theirs', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const mailbox = pagedMailbox([message('on-1'), ...pile(3)]);

      await pollAtmMailbox();

      // The fifteen minutes held four: the older unread mail, if any, lies below them.
      expect(mailbox.pages).toEqual([
        { limit: 50, since: newestSince, before: null },
        { limit: 50, ...below(newestSince) },
      ]);
      expect(mailbox.handled.map((h) => h.id)).toEqual(['on-1']);
    });

    it('walks back two hours at a time to thirty days, then starts over', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const mailbox = pagedMailbox([]);
      const steps = Math.ceil((SWEEP_HORIZON_MS - NEWEST_WINDOW_MS) / SWEEP_WINDOW_MS);

      for (let run = 0; run < steps + 1; run += 1) await pollAtmMailbox();

      const swept = sweeps(mailbox);
      expect(swept[0]).toBe(newestSince);
      for (let step = 1; step < steps; step += 1) {
        expect(Date.parse(swept[step - 1] as string) - Date.parse(swept[step] as string)).toBe(
          SWEEP_WINDOW_MS,
        );
      }
      // The last step stops at the horizon, and the run after it starts over below the fifteen
      // minutes.
      const last = mailbox.pages.filter((page) => page.before !== null)[steps - 1];
      expect(last?.since).toBe(mailInstant(NOW - SWEEP_HORIZON_MS));
      expect(swept[steps]).toBe(newestSince);
    });

    it('sweeps the older pile a page per run, so a deeper backlog is filed too', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const unread = pile(120);
      unread.splice(110, 0, message('on-old'));
      const mailbox = pagedMailbox(unread);

      await pollAtmMailbox();
      expect(mailbox.handled).toEqual([]);
      await pollAtmMailbox();
      expect(mailbox.handled).toEqual([{ id: 'on-old', category: 'Red Category' }]);
      // Run one swept below the newest page's oldest (49), run two below its own page's (99) — a
      // short page, so run three steps two hours further down.
      await pollAtmMailbox();
      expect(sweeps(mailbox)).toEqual([
        receivedAt(49),
        receivedAt(99),
        below(receivedAt(99)).since,
      ]);
    });

    it('starts the sweep over after a save — a branch just switched on is first', async () => {
      const find = vi.spyOn(atmMailboxConfigRepository, 'findSingleton');
      find.mockResolvedValue(mailboxDoc({ __v: 1 }));
      const mailbox = pagedMailbox(pile(160));

      await pollAtmMailbox();
      find.mockResolvedValue(mailboxDoc({ __v: 2 }));
      await pollAtmMailbox();

      expect(sweeps(mailbox)).toEqual([receivedAt(49), receivedAt(49)]);
    });

    it('keeps what a run did when the older page then fails, with the error', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const handled: string[] = [];
      registerAtmMailSourceFactory(() => ({
        providerId: 'fake-paged',
        available: () => true,
        listUnread: async () => [],
        listUnreadPage: async (_limit, { before }) => {
          if (before !== null) throw new Error('microsoft graph 503 on /users/x/messages');
          const messages = [message('on-new'), ...pile(49)];
          return { messages, listed: messages.length, oldest: receivedAt(49) };
        },
        markHandled: async (id) => {
          handled.push(id);
        },
      }));
      const record = vi.mocked(atmMailboxConfigRepository.recordLastPoll);

      const run = await pollAtmMailbox();

      expect(handled).toEqual(['on-new']);
      expect(run).toMatchObject({
        read: 50,
        created: 1,
        unmatched: 49,
        error: 'microsoft graph 503 on /users/x/messages',
      });
      expect(record).toHaveBeenCalledWith(docId, run);
    });

    it('leaves the environment on its oldest page, even through a source that pages', async () => {
      const page = vi.fn();
      const handled: string[] = [];
      registerAtmMailSource({
        providerId: 'fake-environment',
        available: () => true,
        listUnread: async () => [message('on-env')],
        listUnreadPage: page,
        markHandled: async (id) => {
          handled.push(id);
        },
      });

      await pollAtmMailbox();

      expect(page).not.toHaveBeenCalled();
      expect(handled).toEqual(['on-env']);
    });

    // 2026-11-13: «الـ Automation بتاع الميل واقف بقاله شوية كتير». A run that ran long met the next
    // minute's run in the mailbox; the mailbox queued them both, and both timed out.
    describe('one reading at a time, and a short one', () => {
      it('steps aside while another reading holds the lease — nothing listed, nothing recorded', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        let release: () => void = () => {};
        const listing = new Promise<void>((resolve) => {
          release = resolve;
        });
        let listed = 0;
        registerAtmMailSourceFactory(() => ({
          providerId: 'fake-slow',
          available: () => true,
          listUnread: async () => [],
          listUnreadPage: async () => {
            listed += 1;
            await listing;
            return { messages: [message('on-1')], listed: 1, oldest: receivedAt(0) };
          },
          markHandled: async () => {},
        }));
        const record = vi.mocked(atmMailboxConfigRepository.recordLastPoll);

        const first = pollAtmMailbox();
        await vi.waitFor(() => expect(listed).toBe(1));
        const second = await pollAtmMailbox();

        expect(second).toBeNull();
        expect(listed).toBe(1);
        release();
        await expect(first).resolves.toMatchObject({ read: 1, created: 1, error: null });
        expect(record).toHaveBeenCalledTimes(1);
        // The lease went with the first reading: the next minute reads.
        await expect(pollAtmMailbox()).resolves.toMatchObject({ read: 1 });
      });

      it('lets go of the lease when the reading fails, so the next minute is not locked out', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        let fail = true;
        registerAtmMailSourceFactory(() => ({
          providerId: 'fake-failing',
          available: () => true,
          listUnread: async () => [],
          listUnreadPage: async () => {
            if (fail) throw new Error('This operation was aborted');
            return { messages: [message('on-1')], listed: 1, oldest: receivedAt(0) };
          },
          markHandled: async () => {},
        }));

        await expect(pollAtmMailbox()).resolves.toMatchObject({
          error: 'This operation was aborted',
        });
        fail = false;
        await expect(pollAtmMailbox()).resolves.toMatchObject({ read: 1, error: null });
      });

      it('leaves what its time does not cover to the next minute — the sweep where it stood', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        const mailbox = pagedMailbox(pile(120));
        // Every mail takes fifteen seconds to file: three fit in the run's time.
        let now = Date.UTC(2026, 10, 13, 12, 0, 0);
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        vi.mocked(atmMailIngestionService.ingest).mockImplementation(async () => {
          now += 15_000;
          return {
            outcome: 'unmatched',
            ticketId: null,
            branchId: null,
            reason: 'branch not enabled for mail',
          };
        });

        const run = await pollAtmMailbox();

        expect(RUN_BUDGET_MS).toBe(40_000);
        expect(run).toMatchObject({ read: 3, unmatched: 3, error: null });
        // The newest page only: the sweep waits for a quieter minute.
        expect(mailbox.pages).toEqual([
          {
            limit: 50,
            since: mailInstant(Date.UTC(2026, 10, 13, 12, 0, 0) - NEWEST_WINDOW_MS),
            before: null,
          },
        ]);
      });

      it('counts its time from the mail in hand — a slow listing does not eat it', async () => {
        vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
        let now = Date.UTC(2026, 10, 13, 12, 0, 0);
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        registerAtmMailSourceFactory(() => ({
          providerId: 'fake-slow-listing',
          available: () => true,
          listUnread: async () => [],
          // The mailbox takes thirty-five seconds to answer (2026-11-13: over twenty).
          listUnreadPage: async () => {
            now += 35_000;
            const messages = [message('on-1'), message('off-1'), message('off-2')];
            return { messages, listed: messages.length, oldest: receivedAt(2) };
          },
          markHandled: async () => {
            now += 5_000;
          },
        }));

        const run = await pollAtmMailbox();

        // All three filed or judged: the forty seconds began when the page came back.
        expect(run).toMatchObject({ read: 3, created: 1, unmatched: 2, error: null });
      });
    });
  });
});

describe('documentRules / categoriesFiledAs — branches as ATM files them', () => {
  const LINKS = new Map([[BRANCH_LINKED, BRANCH_TANTA]]);

  it('without links: the rows as saved', () => {
    const rules = documentRules(
      {
        branches: [
          { branchId: new Types.ObjectId(BRANCH_TANTA), category: 'Red Category' },
          { branchId: new Types.ObjectId(BRANCH_ALEX), category: null },
        ],
      },
      new Map(),
    );
    expect([...rules.gate.branchIds].sort()).toEqual([BRANCH_ALEX, BRANCH_TANTA].sort());
    expect([...rules.categories]).toEqual([[BRANCH_TANTA, 'Red Category']]);
  });

  it('a source row stands for its target; the target’s own colour wins, in either order', () => {
    const source = { branchId: BRANCH_LINKED, category: 'Orange Category' };
    const target = { branchId: BRANCH_TANTA, category: 'Red Category' };
    expect([...categoriesFiledAs([source], LINKS)]).toEqual([[BRANCH_TANTA, 'Orange Category']]);
    expect([...categoriesFiledAs([source, target], LINKS)]).toEqual([
      [BRANCH_TANTA, 'Red Category'],
    ]);
    expect([...categoriesFiledAs([target, source], LINKS)]).toEqual([
      [BRANCH_TANTA, 'Red Category'],
    ]);
    const rules = documentRules(
      { branches: [{ branchId: new Types.ObjectId(BRANCH_LINKED), category: null }] },
      LINKS,
    );
    expect([...rules.gate.branchIds]).toEqual([BRANCH_TANTA]);
    expect(rules.categories.size).toBe(0);
  });
});
