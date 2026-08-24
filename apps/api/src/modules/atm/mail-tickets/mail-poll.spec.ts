// The poll loop's rules, against a fake mailbox and a fake ingestion seam. What is asserted here
// is the OWNER'S RULE — an unmatched message stays unread — plus the two facts that make one
// central reader work: the branch's category is applied to the message, and a failure never
// marks anything read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AtmMailIngestResultDto } from '@ecms/contracts';
import { registerAtmMailSource, resetAtmMailSource, type AtmMailMessage } from './mail-source';
import { atmMailIngestionService } from './mail-ingestion.service';
import { pollAtmMailbox } from './mail-poll.service';
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
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAtmMailSource();
});

describe('pollAtmMailbox — an unconfigured mailbox', () => {
  it('does nothing at all when no source is registered', async () => {
    const ingest = vi.spyOn(atmMailIngestionService, 'ingest');
    expect(await pollAtmMailbox()).toEqual({
      read: 0,
      created: 0,
      duplicates: 0,
      unmatched: 0,
      failed: 0,
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

    expect(report).toEqual({ read: 3, created: 1, duplicates: 1, unmatched: 1, failed: 0 });
    // m2 is absent: unmatched mail stays in the mailbox for a human to see.
    expect(handled.map((h) => h.id)).toEqual(['m1', 'm3']);
    expect(handled[0]).toEqual({ id: 'm1', category: 'Green Category' });
  });
});
