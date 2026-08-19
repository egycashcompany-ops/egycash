// The report roll-up, and specifically the three legacy defects it fixes.
//
// Each of these changes a number a user has seen before, so each is pinned here with the legacy
// behaviour named. If someone "restores parity" by reintroducing one, a test says what it was.
import { describe, expect, it } from 'vitest';
import {
  bankReportRows,
  captainReportRows,
  defaultReportRange,
  explicitReportRange,
  type ReportInputRow,
} from './report-aggregation';

const row = (over: Partial<ReportInputRow> = {}): ReportInputRow => ({
  shipmentId: 's1',
  captainEmployeeId: 'cap1',
  captainName: 'أحمد',
  bankId: 'bank1',
  bankName: 'الأهلي',
  bagCount: 0,
  cartonCount: 0,
  boxCount: 0,
  lines: [{ currencyId: 'egp', currencyName: 'مصري', amount: 1000 }],
  ...over,
});

describe('Q26 — package counts are per SHIPMENT, not per currency', () => {
  it('counts a three-currency shipment’s bags ONCE', () => {
    // Legacy reported 30 for this shipment (10 bags × 3 currencies) after unwinding currency
    // pairs. The correct answer is 10.
    const { grandTotal } = captainReportRows([
      row({
        bagCount: 10,
        cartonCount: 2,
        boxCount: 1,
        lines: [
          { currencyId: 'egp', currencyName: 'مصري', amount: 100 },
          { currencyId: 'usd', currencyName: 'دولار', amount: 50 },
          { currencyId: 'eur', currencyName: 'يورو', amount: 25 },
        ],
      }),
    ]);
    expect(grandTotal.bagCount).toBe(10);
    expect(grandTotal.cartonCount).toBe(2);
    expect(grandTotal.boxCount).toBe(1);
  });

  it('still sums packages across DIFFERENT shipments', () => {
    const { grandTotal } = captainReportRows([
      row({ shipmentId: 'a', bagCount: 4 }),
      row({ shipmentId: 'b', bagCount: 6 }),
    ]);
    expect(grandTotal.bagCount).toBe(10);
    expect(grandTotal.shipmentCount).toBe(2);
  });
});

describe('Q28 — a shipment with no currency lines is COUNTED, not dropped', () => {
  it('counts it, with no money', () => {
    // Legacy dropped such a document entirely — losing its contribution to the document count.
    const { rows, grandTotal } = captainReportRows([row({ lines: [] })]);
    expect(grandTotal.shipmentCount).toBe(1);
    expect(grandTotal.currencies).toEqual([]);
    expect(rows[0]?.totals.shipmentCount).toBe(1);
  });

  it('counts its packages too', () => {
    const { grandTotal } = captainReportRows([row({ lines: [], bagCount: 3 })]);
    expect(grandTotal.bagCount).toBe(3);
  });
});

describe('Q27 — the grand total is SEPARATE from the rows', () => {
  it('does not appear as a row', () => {
    const { rows, grandTotal } = captainReportRows([
      row({ captainEmployeeId: 'a', captainName: 'أحمد' }),
      row({ captainEmployeeId: 'b', captainName: 'باسم' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.captainEmployeeId)).toEqual(['a', 'b']);
    expect(grandTotal.shipmentCount).toBe(2);
  });

  it('equals the sum of the rows — accumulated alongside, so it cannot drift', () => {
    const { rows, grandTotal } = captainReportRows([
      row({ captainEmployeeId: 'a', captainName: 'أحمد', bagCount: 2 }),
      row({ captainEmployeeId: 'b', captainName: 'باسم', bagCount: 3 }),
      row({ captainEmployeeId: 'a', captainName: 'أحمد', bagCount: 5 }),
    ]);
    const summed = rows.reduce((n, r) => n + r.totals.bagCount, 0);
    expect(grandTotal.bagCount).toBe(summed);
    expect(grandTotal.bagCount).toBe(10);
  });
});

describe('grouping', () => {
  it('groups a captain’s shipments together and sums their currencies', () => {
    const { rows } = captainReportRows([
      row({ shipmentId: 'a', lines: [{ currencyId: 'egp', currencyName: 'مصري', amount: 100 }] }),
      row({ shipmentId: 'b', lines: [{ currencyId: 'egp', currencyName: 'مصري', amount: 250 }] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totals.currencies).toEqual([
      { currencyId: 'egp', currencyName: 'مصري', amount: 350 },
    ]);
  });

  it('keeps distinct currencies distinct within one row', () => {
    const { rows } = captainReportRows([
      row({
        lines: [
          { currencyId: 'egp', currencyName: 'مصري', amount: 100 },
          { currencyId: 'usd', currencyName: 'دولار', amount: 40 },
        ],
      }),
    ]);
    expect(rows[0]?.totals.currencies).toHaveLength(2);
  });

  it('reports shipments with NO captain under their own bucket rather than dropping them', () => {
    // The captain now comes from the assignment entity, so an unassigned shipment has none. It is
    // still money that moved, and a report that hides it is wrong.
    const { rows, grandTotal } = captainReportRows([
      row({ captainEmployeeId: null, captainName: '' }),
      row({ captainEmployeeId: 'cap1', captainName: 'أحمد' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.captainEmployeeId === null)).toBe(true);
    expect(grandTotal.shipmentCount).toBe(2);
  });

  it('groups the bank report on the bank instead', () => {
    const { rows } = bankReportRows([
      row({ bankId: 'b1', bankName: 'الأهلي' }),
      row({ bankId: 'b2', bankName: 'مصر' }),
      row({ bankId: 'b1', bankName: 'الأهلي' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.bankId === 'b1')?.totals.shipmentCount).toBe(2);
  });

  it('is empty, not an error, for no shipments', () => {
    const { rows, grandTotal } = captainReportRows([]);
    expect(rows).toEqual([]);
    expect(grandTotal.shipmentCount).toBe(0);
  });

  it('orders rows by name so two runs read identically', () => {
    const { rows } = captainReportRows([
      row({ captainEmployeeId: 'z', captainName: 'ياسر' }),
      row({ captainEmployeeId: 'a', captainName: 'أحمد' }),
    ]);
    expect(rows.map((r) => r.captainName)).toEqual(['أحمد', 'ياسر']);
  });
});

describe('date ranges', () => {
  it('defaults to the whole current calendar month — the legacy default', () => {
    const { from, toExclusive } = defaultReportRange(new Date('2026-03-17T10:00:00Z'));
    expect(from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(toExclusive.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('handles December rolling into the next year', () => {
    const { toExclusive } = defaultReportRange(new Date('2026-12-05T00:00:00Z'));
    expect(toExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('makes an explicit range INCLUSIVE of its end day', () => {
    // A picker showing 1–5 March means the whole of the 5th, which is why the exclusive bound is
    // the 6th. Legacy did this with setHours(23,59,59,999); a half-open range says it exactly.
    const { from, toExclusive } = explicitReportRange(
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-05T00:00:00Z'),
    );
    expect(from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(toExclusive.toISOString()).toBe('2026-03-06T00:00:00.000Z');
  });

  it('supports a single-day range', () => {
    const { from, toExclusive } = explicitReportRange(
      new Date('2026-03-05T00:00:00Z'),
      new Date('2026-03-05T00:00:00Z'),
    );
    expect(toExclusive.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
