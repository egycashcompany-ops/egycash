// The custody receipt's number — «ابدأ بـ 0001 وكل طباعة زود رقم». The counter is the shared atomic
// allocator; what is pinned here is the one judgement on top of it: a hand-over may record the
// number a print handed out, and nothing the counter has not handed out yet.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCustodyReceiptNumber } from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  next: vi.fn(),
  current: vi.fn(),
  onLinePaper: vi.fn(),
  onDevicePaper: vi.fn(),
  claim: vi.fn(),
}));

vi.mock('../shared/sequence', () => ({
  nextSequenceValue: mocks.next,
  currentSequenceValue: mocks.current,
  claimSequenceValue: mocks.claim,
}));
// The two kinds of paper in the one F-14 series — what each hand-over asks of the OTHER kind.
vi.mock('../mobile-lines/line-receipt.repository', () => ({
  itMobileLineReceiptRepository: { holdsFormNumber: mocks.onLinePaper },
}));
vi.mock('./receipt.repository', () => ({
  itCustodyReceiptRepository: { exists: mocks.onDevicePaper },
}));

const {
  RECEIPT_SEQUENCE_KEY,
  claimReceiptNumber,
  mobileLineReceiptNumberFor,
  nextReceiptNumber,
  receiptNumberFor,
} = await import('./receipt-number');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.next.mockResolvedValue(8);
  mocks.current.mockResolvedValue(7);
  mocks.onLinePaper.mockResolvedValue(false);
  mocks.onDevicePaper.mockResolvedValue(false);
  mocks.claim.mockResolvedValue(true);
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

// «خطوط المحمول» — a line handed to an employee is signed for on the same department form, so its
// paper takes its number from the same counter. Two collections, one series: each hand-over
// refuses a printed number the other kind of paper already carries, which no index can.
describe('one series for devices and mobile lines', () => {
  it('a device hand-over refuses a number already on a line acknowledgment', async () => {
    mocks.onLinePaper.mockImplementation(async (n: number) => n === 5);

    await expect(receiptNumberFor(5)).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(receiptNumberFor(5)).rejects.toThrow(/mobile line acknowledgment/);
    expect(await receiptNumberFor(6)).toBe(6);
    expect(mocks.onLinePaper).toHaveBeenCalledWith(5);
  });

  it('a line hand-over refuses a number already on a device receipt', async () => {
    mocks.onDevicePaper.mockImplementation(
      async (filter: { formNumber: number }) => filter.formNumber === 5,
    );

    await expect(mobileLineReceiptNumberFor(5)).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(mobileLineReceiptNumberFor(5)).rejects.toThrow(/device receipt/);
    expect(await mobileLineReceiptNumberFor(6)).toBe(6);
    expect(mocks.onDevicePaper).toHaveBeenCalledWith({ formNumber: 5 });
  });

  it('a line hand-over takes from the same counter, and refuses what it never printed', async () => {
    expect(await mobileLineReceiptNumberFor(undefined)).toBe(8);
    expect(mocks.next).toHaveBeenCalledWith(RECEIPT_SEQUENCE_KEY);
    await expect(mobileLineReceiptNumberFor(8)).rejects.toThrow(/never printed/);
    expect(mocks.onDevicePaper).not.toHaveBeenCalled();
  });

  it('a line hand-over refuses a number already on another line acknowledgment', async () => {
    mocks.onLinePaper.mockImplementation(async (n: number) => n === 5);

    await expect(mobileLineReceiptNumberFor(5)).rejects.toThrow(/another mobile line/);
    expect(await mobileLineReceiptNumberFor(6)).toBe(6);
  });

  it('each hand-over claims its number inside its own transaction — two cannot both record it', async () => {
    const session = {} as never;
    await claimReceiptNumber(5, session);
    expect(mocks.claim).toHaveBeenCalledWith(RECEIPT_SEQUENCE_KEY, 5, session);

    // The other hand-over claimed it first (or the race's retry finds its claim): refused.
    mocks.claim.mockResolvedValue(false);
    await expect(claimReceiptNumber(5, session)).rejects.toBeInstanceOf(ConflictError);
    await expect(claimReceiptNumber(5, session)).rejects.toThrow(/already on another paper/);
  });

  it('a fresh number is asked of neither collection — the counter never repeats one', async () => {
    await receiptNumberFor(undefined);
    await mobileLineReceiptNumberFor(undefined);
    expect(mocks.onLinePaper).not.toHaveBeenCalled();
    expect(mocks.onDevicePaper).not.toHaveBeenCalled();
  });
});
