// The custody receipt's number — «ابدأ بـ 0001 وكل طباعة زود رقم». The counter is the shared atomic
// allocator; what is pinned here is the one judgement on top of it: a hand-over may record the
// number a print handed out, and nothing the counter has not handed out yet.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCustodyReceiptNumber } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  next: vi.fn(),
  current: vi.fn(),
}));

vi.mock('../shared/sequence', () => ({
  nextSequenceValue: mocks.next,
  currentSequenceValue: mocks.current,
}));

const { RECEIPT_SEQUENCE_KEY, nextReceiptNumber, receiptNumberFor } =
  await import('./receipt-number');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.next.mockResolvedValue(8);
  mocks.current.mockResolvedValue(7);
});

describe('the receipt number', () => {
  it('starts at 0001 and is printed with four digits at least', () => {
    expect(formatCustodyReceiptNumber(1)).toBe('EGYCASH-IT-F-14-0001');
    expect(formatCustodyReceiptNumber(42)).toBe('EGYCASH-IT-F-14-0042');
    expect(formatCustodyReceiptNumber(10000)).toBe('EGYCASH-IT-F-14-10000');
  });

  it('every print takes the next one from its own counter', async () => {
    expect(await nextReceiptNumber()).toBe(8);
    expect(mocks.next).toHaveBeenCalledWith(RECEIPT_SEQUENCE_KEY);
    expect(RECEIPT_SEQUENCE_KEY).not.toBe('asset:global');
  });

  it('a hand-over records the number its paper was printed with', async () => {
    expect(await receiptNumberFor(5)).toBe(5);
    expect(await receiptNumberFor(7)).toBe(7);
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it('a hand-over that printed nothing takes the next one', async () => {
    expect(await receiptNumberFor(undefined)).toBe(8);
  });

  it('refuses a number the counter has not handed out — it belongs to a paper not printed yet', async () => {
    await expect(receiptNumberFor(8)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.next).not.toHaveBeenCalled();
  });
});
