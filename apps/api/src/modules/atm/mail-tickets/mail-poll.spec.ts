// The poll loop's rules, against a fake mailbox and a fake ingestion seam. What is asserted here
// is the OWNER'S RULE — an unmatched message stays unread — plus the two facts that make one
// central reader work: the branch's category is applied to the message, and a failure never
// marks anything read.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AtmMailIngestResultDto } from '@ecms/contracts';
import {
  registerAtmMailSource,
  registerAtmMailSourceFactory,
  resetAtmMailSource,
  type AtmMailMessage,
  type AtmMailSource,
} from './mail-source';
import { atmMailIngestionService } from './mail-ingestion.service';
import { pollAtmMailbox, resetAtmMailSweep } from './mail-poll.service';
import { type AtmMailboxConfigDoc } from './mailbox-config.model';
import { atmMailboxConfigRepository } from './mailbox-config.repository';
import { settingsService } from '../../../platform/settings';

const BRANCH_ALEX = '64b7f9c2e13b4a0012345678';
const BRANCH_TANTA = '64b7f9c2e13b4a0012345679';

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
  vi.spyOn(settingsService, 'resolve').mockResolvedValue([
    { branchId: BRANCH_ALEX, category: 'Green Category' },
    { branchId: BRANCH_TANTA, category: 'Blue Category' },
  ] as never);
  // No document saved on /atm/settings: the environment mode every test below this line ran in
  // before the screen existed.
  vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAtmMailSource();
  registerAtmMailSourceFactory(null);
  resetAtmMailSweep();
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

    expect(run.unmatched).toBe(7);
    expect(run.unmatchedReasons).toHaveLength(5);
    expect(run.unmatchedReasons[0]).toBe('no active machine with code m1');
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
    /** A paged mailbox, NEWEST FIRST at index 0: what is unread, and every page asked for. */
    const pagedMailbox = (unread: AtmMailMessage[]) => {
      const state = {
        unread: [...unread],
        pages: [] as { limit: number; skip: number }[],
        handled: [] as { id: string; category: string | null }[],
      };
      registerAtmMailSourceFactory(() => ({
        providerId: 'fake-paged',
        available: () => true,
        listUnread: async () => {
          throw new Error('the document is read newest first, page by page');
        },
        listUnreadPage: async (limit, skip) => {
          state.pages.push({ limit, skip });
          const messages = state.unread.slice(skip, skip + limit);
          return { messages, listed: messages.length };
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

    beforeEach(() => {
      ingestByMessage();
      recorded();
    });

    it('files a new mail however much mail it left unread sits in the mailbox', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const mailbox = pagedMailbox([message('on-new'), ...pile(60)]);

      const run = await pollAtmMailbox();

      expect(mailbox.handled).toEqual([{ id: 'on-new', category: 'Red Category' }]);
      expect(run).toMatchObject({ read: 61, created: 1, unmatched: 60, error: null });
      // The newest page, then the rest below what it left unread (49 of its 50).
      expect(mailbox.pages).toEqual([
        { limit: 50, skip: 0 },
        { limit: 50, skip: 49 },
      ]);
    });

    it('lists one page when the whole unread list fits on it', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const mailbox = pagedMailbox([message('on-1'), ...pile(3)]);

      await pollAtmMailbox();

      expect(mailbox.pages).toEqual([{ limit: 50, skip: 0 }]);
      expect(mailbox.handled.map((h) => h.id)).toEqual(['on-1']);
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
      // Run one swept 50–99, run two 100 onwards — the end, so run three starts over at 50.
      await pollAtmMailbox();
      expect(mailbox.pages.filter((page) => page.skip > 0).map((page) => page.skip)).toEqual([
        50, 100, 50,
      ]);
    });

    it('starts the sweep over after a save — a branch just switched on is first', async () => {
      const find = vi.spyOn(atmMailboxConfigRepository, 'findSingleton');
      find.mockResolvedValue(mailboxDoc({ __v: 1 }));
      const mailbox = pagedMailbox(pile(160));

      await pollAtmMailbox();
      find.mockResolvedValue(mailboxDoc({ __v: 2 }));
      await pollAtmMailbox();

      expect(mailbox.pages.filter((page) => page.skip > 0).map((page) => page.skip)).toEqual([
        50, 50,
      ]);
    });

    it('keeps what a run did when the older page then fails, with the error', async () => {
      vi.spyOn(atmMailboxConfigRepository, 'findSingleton').mockResolvedValue(mailboxDoc());
      const handled: string[] = [];
      registerAtmMailSourceFactory(() => ({
        providerId: 'fake-paged',
        available: () => true,
        listUnread: async () => [],
        listUnreadPage: async (_limit, skip) => {
          if (skip > 0) throw new Error('microsoft graph 503 on /users/x/messages');
          const messages = [message('on-new'), ...pile(49)];
          return { messages, listed: messages.length };
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
  });
});
