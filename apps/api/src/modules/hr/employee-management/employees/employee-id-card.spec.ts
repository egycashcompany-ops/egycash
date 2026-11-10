import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toIdCardSummaryDto } from './employee-id-card.mapper';

describe('the company ID card counters', () => {
  it('read as never received and never printed for an employee the counters have not reached yet', () => {
    expect(toIdCardSummaryDto({})).toEqual({
      receivedCount: 0,
      firstReceivedAt: null,
      lastReceivedAt: null,
      lastReceivedBy: null,
      awaitingHandover: false,
      receiptPrintedAt: null,
      printCount: 0,
      firstPrintedAt: null,
      lastPrintedAt: null,
      lastPrintedBy: null,
    });
  });

  it('keep cards received apart from prints: five prints and one handover are ONE card', () => {
    const by = new Types.ObjectId();
    const summary = toIdCardSummaryDto({
      idCard: {
        receivedCount: 1,
        firstReceivedAt: new Date('2026-01-05T10:00:00.000Z'),
        lastReceivedAt: new Date('2026-01-05T10:00:00.000Z'),
        lastReceivedBy: by,
        awaitingHandover: false,
        printCount: 5,
        firstPrintedAt: new Date('2026-01-05T09:00:00.000Z'),
        lastPrintedAt: new Date('2026-01-05T09:20:00.000Z'),
        lastPrintedBy: by,
      },
    });
    expect(summary).toEqual({
      receivedCount: 1,
      firstReceivedAt: '2026-01-05T10:00:00.000Z',
      lastReceivedAt: '2026-01-05T10:00:00.000Z',
      lastReceivedBy: String(by),
      awaitingHandover: false,
      receiptPrintedAt: null,
      printCount: 5,
      firstPrintedAt: '2026-01-05T09:00:00.000Z',
      lastPrintedAt: '2026-01-05T09:20:00.000Z',
      lastPrintedBy: String(by),
    });
  });

  it('say a printed card is waiting for its handover until HR confirms it', () => {
    const summary = toIdCardSummaryDto({ idCard: { printCount: 2, awaitingHandover: true } });
    expect(summary.receivedCount).toBe(0);
    expect(summary.awaitingHandover).toBe(true);
    expect(summary.receiptPrintedAt).toBeNull();
  });

  it('remember that the receipt was printed, so reopening the card keeps the step done', () => {
    const at = new Date('2026-11-10T13:00:00.000Z');
    const summary = toIdCardSummaryDto({
      idCard: { printCount: 1, awaitingHandover: true, receiptPrintedAt: at },
    });
    expect(summary.receiptPrintedAt).toBe('2026-11-10T13:00:00.000Z');
  });
});
