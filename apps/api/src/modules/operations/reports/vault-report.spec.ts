// The vault roll-up's one structural claim: it is the SAME roll-up as the bank report.
//
// This is worth a test of its own because the legacy pair got it wrong in a way nobody could see
// from either screen alone. `/vault1` counted packages per DOCUMENT (contad_app.js:1437) while
// `/ops_bank_report` counted them per CURRENCY LINE (:5023, quirk Q26), so the vault screen and
// the bank report reported different package totals for the same shipments and both looked
// internally consistent. Sharing `bankReportRows` is what makes that impossible here.
import { describe, expect, it } from 'vitest';
import { bankReportRows, type ReportInputRow } from './report-aggregation';

const row = (over: Partial<ReportInputRow> = {}): ReportInputRow => ({
  shipmentId: 's1',
  captainEmployeeId: null,
  captainName: '',
  bankId: 'bank-1',
  bankName: 'الأهلي',
  bagCount: 10,
  cartonCount: 4,
  boxCount: 2,
  lines: [
    { currencyId: 'egp', currencyName: 'مصري', amount: 100 },
    { currencyId: 'usd', currencyName: 'دولار', amount: 200 },
    { currencyId: 'eur', currencyName: 'يورو', amount: 300 },
  ],
  ...over,
});

describe('vault roll-up (B6)', () => {
  it('counts packages once per shipment however many currencies it carries (Q26)', () => {
    const { rows, grandTotal } = bankReportRows([row()]);
    expect(rows).toHaveLength(1);
    // The legacy /ops_bank_report figure for this shipment would have been 30/12/6; the legacy
    // /vault1 figure would have been 10/4/2. They disagreed. There is one answer now.
    expect(rows[0]?.totals).toMatchObject({ bagCount: 10, cartonCount: 4, boxCount: 2 });
    expect(grandTotal).toMatchObject({ bagCount: 10, cartonCount: 4, boxCount: 2 });
  });

  it('rolls two banks up separately and totals them once', () => {
    const { rows, grandTotal } = bankReportRows([
      row({ shipmentId: 's1', bankId: 'bank-1', bankName: 'الأهلي' }),
      row({ shipmentId: 's2', bankId: 'bank-2', bankName: 'مصر', bagCount: 5 }),
      row({ shipmentId: 's3', bankId: 'bank-1', bankName: 'الأهلي', bagCount: 1 }),
    ]);
    expect(rows).toHaveLength(2);
    const ahly = rows.find((r) => r.bankId === 'bank-1');
    expect(ahly?.totals.shipmentCount).toBe(2);
    expect(ahly?.totals.bagCount).toBe(11);
    // The grand total equals the rows exactly — and is not one of them (Q27).
    expect(grandTotal.shipmentCount).toBe(3);
    expect(grandTotal.bagCount).toBe(16);
    expect(rows.reduce((acc, r) => acc + r.totals.shipmentCount, 0)).toBe(
      grandTotal.shipmentCount,
    );
  });

  it('merges the same currency across shipments instead of listing it twice', () => {
    const { rows } = bankReportRows([
      row({ shipmentId: 's1', lines: [{ currencyId: 'egp', currencyName: 'مصري', amount: 100 }] }),
      row({ shipmentId: 's2', lines: [{ currencyId: 'egp', currencyName: 'مصري', amount: 250 }] }),
    ]);
    expect(rows[0]?.totals.currencies).toHaveLength(1);
    expect(rows[0]?.totals.currencies[0]?.amount).toBe(350);
  });

  it('keeps a held shipment with no money in the count (Q28)', () => {
    const { rows, grandTotal } = bankReportRows([row({ lines: [] })]);
    // The vault physically holds bags whether or not a value was recorded against them.
    expect(rows[0]?.totals.shipmentCount).toBe(1);
    expect(rows[0]?.totals.bagCount).toBe(10);
    expect(rows[0]?.totals.currencies).toEqual([]);
    expect(grandTotal.shipmentCount).toBe(1);
  });
});
