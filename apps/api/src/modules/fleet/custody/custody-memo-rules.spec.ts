// The memos' pure rules — days and periods, which receipts an edit lets go of and takes, the paper
// order of the lines, and what a receipt on a memo may still change.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  dayAfter,
  dayKey,
  lineChanges,
  orderLines,
  periodOf,
  receiptChangeVerdict,
  utcDay,
  type ReceiptMemoFacts,
} from './custody-memo-rules';

const d = (iso: string): Date => new Date(iso);

describe('days', () => {
  it('a day is its UTC midnight, written YYYY-MM-DD', () => {
    expect(utcDay(d('2026-09-20T22:15:00.000Z')).toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(dayKey(d('2026-09-20T22:15:00.000Z'))).toBe('2026-09-20');
    expect(dayAfter(d('2026-09-30T00:00:00.000Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('a period runs from the first receipt’s day to the last, whatever order they come in', () => {
    expect(
      periodOf([d('2026-09-12T10:00:00Z'), d('2026-09-01T08:00:00Z'), d('2026-09-30T23:00:00Z')]),
    ).toEqual({ from: d('2026-09-01T00:00:00Z'), to: d('2026-09-30T00:00:00Z') });
    expect(periodOf([d('2026-09-05T00:00:00Z')])).toEqual({
      from: d('2026-09-05T00:00:00Z'),
      to: d('2026-09-05T00:00:00Z'),
    });
    expect(periodOf([])).toBeNull();
  });
});

describe('an edit’s change set', () => {
  const a = new Types.ObjectId().toString();
  const b = new Types.ObjectId().toString();
  const c = new Types.ObjectId().toString();

  it('frees what was taken off and claims what was added — nothing for what stayed', () => {
    expect(lineChanges([a, b], [b, c])).toEqual({ release: [a], take: [c] });
    expect(lineChanges([a, b], [b, a])).toEqual({ release: [], take: [] });
  });

  it('compares ids regardless of letter case', () => {
    expect(lineChanges([a], [a.toUpperCase()])).toEqual({ release: [], take: [] });
  });
});

describe('the lines’ paper order', () => {
  it('day ascending, then the order the receipts were entered in, then the id', () => {
    const early = { date: d('2026-09-01T00:00:00Z'), createdAt: d('2026-09-02T09:00:00Z') };
    const lateDay = { date: d('2026-09-03T00:00:00Z'), createdAt: d('2026-09-01T09:00:00Z') };
    const sameDayLater = { date: d('2026-09-01T00:00:00Z'), createdAt: d('2026-09-02T10:00:00Z') };
    const receipts = new Map([
      ['a', early],
      ['b', lateDay],
      ['c', sameDayLater],
    ]);
    const lines = [{ receiptId: 'b' }, { receiptId: 'c' }, { receiptId: 'a' }];
    expect(orderLines(lines, receipts).map((line) => line.receiptId)).toEqual(['a', 'c', 'b']);
  });
});

describe('what a receipt on a memo may still change — compared by value', () => {
  const car = new Types.ObjectId();
  const card = new Types.ObjectId();
  const live: ReceiptMemoFacts = {
    date: d('2026-09-20T00:00:00.000Z'),
    vehicleId: car,
    kind: 'tyres',
    source: 'custody',
    cardId: null,
    amount: 1690,
  };
  /** What the receipts dialog sends back on a driver-only edit: the same facts, new objects. */
  const resent = (over: Partial<ReceiptMemoFacts> = {}): ReceiptMemoFacts => ({
    date: new Date(live.date.getTime()),
    vehicleId: new Types.ObjectId(String(car)),
    kind: live.kind,
    source: live.source,
    cardId: null,
    amount: 1690.0,
    ...over,
  });
  const pending = { replenished: false };
  const replenished = { replenished: true };

  it('on no memo, anything goes', () => {
    expect(receiptChangeVerdict(live, resent({ kind: 'wash', amount: 5 }), null)).toBe('ok');
  });

  it('a driver-only edit passes on any memo — the same day, car and amount resent as new values', () => {
    expect(receiptChangeVerdict(live, resent(), pending)).toBe('ok');
    expect(receiptChangeVerdict(live, resent(), replenished)).toBe('ok');
    // The same day at another hour is the same paper day.
    expect(
      receiptChangeVerdict(live, resent({ date: d('2026-09-20T13:30:00Z') }), replenished),
    ).toBe('ok');
    // The car's id as text, in either case.
    expect(
      receiptChangeVerdict(live, resent({ vehicleId: String(car).toUpperCase() }), replenished),
    ).toBe('ok');
    // 0.1 + 0.2 is 0.3 to the piastre.
    expect(
      receiptChangeVerdict({ ...live, amount: 0.3 }, resent({ amount: 0.1 + 0.2 }), replenished),
    ).toBe('ok');
  });

  it('a pending memo: the amount, the day and the car may change — the memo’s total follows', () => {
    expect(receiptChangeVerdict(live, resent({ amount: 1700 }), pending)).toBe('ok');
    expect(receiptChangeVerdict(live, resent({ date: d('2026-09-21T00:00:00Z') }), pending)).toBe(
      'ok',
    );
    expect(receiptChangeVerdict(live, resent({ vehicleId: new Types.ObjectId() }), pending)).toBe(
      'ok',
    );
  });

  it('a pending memo: its kind and what paid for it stay', () => {
    expect(receiptChangeVerdict(live, resent({ kind: 'wash' }), pending)).toBe('kindOrSource');
    expect(
      receiptChangeVerdict(
        { ...live, kind: 'fuel' },
        resent({ kind: 'fuel', source: 'card', cardId: card }),
        pending,
      ),
    ).toBe('kindOrSource');
  });

  it('a replenished memo: the amount, the day, the car, the kind and the payment all stay', () => {
    expect(receiptChangeVerdict(live, resent({ amount: 1690.01 }), replenished)).toBe('locked');
    expect(
      receiptChangeVerdict(live, resent({ date: d('2026-09-21T00:00:00Z') }), replenished),
    ).toBe('locked');
    expect(
      receiptChangeVerdict(live, resent({ vehicleId: new Types.ObjectId() }), replenished),
    ).toBe('locked');
    expect(receiptChangeVerdict(live, resent({ kind: 'wash' }), replenished)).toBe('locked');
    expect(receiptChangeVerdict(live, resent({ source: 'card', cardId: card }), replenished)).toBe(
      'locked',
    );
  });
});
