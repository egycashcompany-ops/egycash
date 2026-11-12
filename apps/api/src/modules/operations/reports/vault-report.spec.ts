// The vault roll-up's one structural claim: it is the SAME roll-up as the bank report.
//
// This is worth a test of its own because the legacy pair got it wrong in a way nobody could see
// from either screen alone. `/vault1` counted packages per DOCUMENT (contad_app.js:1437) while
// `/ops_bank_report` counted them per CURRENCY LINE (:5023, quirk Q26), so the vault screen and
// the bank report reported different package totals for the same shipments and both looked
// internally consistent. Sharing `bankReportRows` is what makes that impossible here.
//
// And its period — «يجيب اللى اتسلم واللى متسلمش ويجيب البداية كل اول شهر»: the days the vault
// RECEIVED the shipments, on Cairo's calendar, the current month by default.
import { describe, expect, it } from 'vitest';
import { bankReportRows, vaultReceiptRange, type ReportInputRow } from './report-aggregation';

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

describe('vault roll-up period — the vault receipt\'s Cairo day (the owner\'s decision)', () => {
  /** A UTC-midnight Date, as `z.coerce.date()` makes of a typed 'YYYY-MM-DD'. */
  const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

  it('opens on the first of the current month by default and closes on its last day', () => {
    const range = vaultReceiptRange({}, new Date('2026-11-12T10:00:00Z'));
    expect(range.from).toBe('2026-11-01');
    expect(range.to).toBe('2026-11-30');
    // Cairo is UTC+2 in November: its 1st begins at 22:00 UTC on the 31st of October.
    expect(range.start.toISOString()).toBe('2026-10-31T22:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-11-30T22:00:00.000Z');
  });

  it('reads "the current month" off Cairo\'s today, not UTC\'s', () => {
    // 00:30 on the 1st of December in Cairo, still the 30th of November in UTC.
    const range = vaultReceiptRange({}, new Date('2026-11-30T22:30:00Z'));
    expect(range.from).toBe('2026-12-01');
    expect(range.to).toBe('2026-12-31');
  });

  it('rolls December over into January', () => {
    const range = vaultReceiptRange({}, new Date('2026-12-15T10:00:00Z'));
    expect(range.to).toBe('2026-12-31');
    expect(range.endExclusive.toISOString()).toBe('2026-12-31T22:00:00.000Z');
  });

  it('counts an explicit end day WHOLE, on Cairo\'s clock', () => {
    const range = vaultReceiptRange(
      { from: day('2026-11-05'), to: day('2026-11-05') },
      new Date('2026-11-12T10:00:00Z'),
    );
    const inRange = (at: string): boolean => {
      const t = new Date(at).getTime();
      return t >= range.start.getTime() && t < range.endExclusive.getTime();
    };
    // 00:30 Cairo on the 5th is the 5th's, though UTC still reads the 4th.
    expect(inRange('2026-11-04T22:30:00Z')).toBe(true);
    // 23:59 Cairo on the 5th is in; 01:30 Cairo on the 6th is not, though UTC still reads the 5th.
    expect(inRange('2026-11-05T21:59:00Z')).toBe(true);
    expect(inRange('2026-11-05T23:30:00Z')).toBe(false);
  });

  it('follows Cairo\'s summer clock — no offset is hard-coded', () => {
    const range = vaultReceiptRange(
      { from: day('2026-07-01'), to: day('2026-07-31') },
      new Date('2026-11-12T10:00:00Z'),
    );
    // UTC+3 in July.
    expect(range.start.toISOString()).toBe('2026-06-30T21:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-07-31T21:00:00.000Z');
  });

  it('falls back per bound — a caller who sent only a start asked for that start', () => {
    const range = vaultReceiptRange({ from: day('2026-11-10') }, new Date('2026-11-12T10:00:00Z'));
    expect(range.from).toBe('2026-11-10');
    expect(range.to).toBe('2026-11-30');
    const onlyEnd = vaultReceiptRange({ to: day('2026-11-20') }, new Date('2026-11-12T10:00:00Z'));
    expect(onlyEnd.from).toBe('2026-11-01');
    expect(onlyEnd.to).toBe('2026-11-20');
  });

  it('never fails on a year still being typed, nor on the last day the calendar names', () => {
    // A date box applies each keystroke, so «2026» arrives as 0002, 0020, 0202 first. Years below
    // 100 and a day after 9999-12-30 are outside what the Cairo helpers can name — they threw
    // (a 500) until the bounds were pulled back inside, which no receipt can lie beyond.
    const now = new Date('2026-11-12T10:00:00Z');
    for (const year of ['0002', '0020', '0099']) {
      const range = vaultReceiptRange({ from: day(`${year}-11-05`) }, now);
      expect(range.from).toBe('0100-01-01');
      expect(range.to).toBe('2026-11-30');
      expect(range.start.getTime()).toBeLessThan(new Date('2000-01-01T00:00:00Z').getTime());
    }
    expect(vaultReceiptRange({ from: day('0202-11-05') }, now).from).toBe('0202-11-05');
    const late = vaultReceiptRange({ to: new Date('9999-12-31T00:00:00.000Z') }, now);
    expect(late.from).toBe('2026-11-01');
    expect(late.to).toBe('9999-12-30');
    expect(late.endExclusive.getTime()).toBeGreaterThan(Date.UTC(2100, 0, 1));
    // A start the calendar cannot name either, with an end before it: still an empty window.
    const gone = vaultReceiptRange({ from: new Date('+010000-01-01T00:00:00.000Z') }, now);
    expect(gone.endExclusive.getTime()).toBeLessThanOrEqual(gone.start.getTime());
  });

  it('makes an inverted range an EMPTY window, as the other reports do — never a swapped one', () => {
    const range = vaultReceiptRange(
      { from: day('2026-11-20'), to: day('2026-11-10') },
      new Date('2026-11-12T10:00:00Z'),
    );
    expect(range.from).toBe('2026-11-20');
    expect(range.to).toBe('2026-11-10');
    expect(range.endExclusive.getTime()).toBeLessThanOrEqual(range.start.getTime());
  });
});
