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
} from './mail-source';
import { atmMailIngestionService } from './mail-ingestion.service';
import {
  categoriesFiledAs,
  documentRules,
  MAIL_POLL_LEASE_KEY,
  mailInstant,
  NEWEST_WINDOW_MS,
  pollAtmMailbox,
  resetAtmMailSweep,
  RUN_BUDGET_MS,
  SWEEP_HORIZON_MS,
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
  await getCache().del(MAIL_POLL_LEASE_KEY);
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
  describe('reading the shared mailbox newest first', () => {
    /** The receipt time of the `index`-th unread mail, newest first: a minute apart, as Graph writes it. */
    const receivedAt = (index: number): string =>
      new Date(Date.UTC(2026, 10, 13, 12, 0, 0) - index * 60_000).toISOString().replace('.000', '');

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

    /** The reader's clock in these tests: half an hour after the newest mail. */
    const NOW = Date.UTC(2026, 10, 13, 12, 30, 0);
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
      // The last two days' newest page, then three days below its oldest mail — found by dates,
      // never by count, never «every date».
      expect(mailbox.pages).toEqual([
        { limit: 50, since: newestSince, before: null },
        { limit: 50, ...below(receivedAt(49)) },
      ]);
    });

    it('sweeps on below the two days when they held every unread mail of theirs', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const mailbox = pagedMailbox([message('on-1'), ...pile(3)]);

      await pollAtmMailbox();

      // The two days held four: the older unread mail, if any, lies below them.
      expect(mailbox.pages).toEqual([
        { limit: 50, since: newestSince, before: null },
        { limit: 50, ...below(newestSince) },
      ]);
      expect(mailbox.handled.map((h) => h.id)).toEqual(['on-1']);
    });

    it('walks back three days at a time to thirty, then starts over', async () => {
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
      // The last step stops at the horizon, and the run after it starts over below the two days.
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
      // short page, so run three steps three days further down.
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
