// The sheet against the cards — every rule of the pure comparison: matching by name, identical
// repeats counted once, anything ambiguous kept out of reach of ✓ / ✗, piastre exactness, order.
import { describe, expect, it } from 'vitest';
import {
  compareFuelSheet,
  lastFourDigits,
  normaliseCardName,
  sheetCompanyOf,
  type CompareCard,
} from './compare-fuel-sheet';
import { type FuelSheetInvalidRow, type FuelSheetRow } from './read-fuel-sheet';

let nextRow = 2;
const row = (name: string, balance: number, number = '548**********0001'): FuelSheetRow => ({
  row: nextRow++,
  number,
  name,
  balance,
});
const card = (
  id: string,
  name: string,
  balance: number,
  number = '5485640000000001',
): CompareCard => ({
  id,
  name,
  number,
  balance,
});
const bad = (
  name: string,
  reason: FuelSheetInvalidRow['reason'],
  balance: number | null = null,
): FuelSheetInvalidRow => ({ row: nextRow++, number: '548**********0009', name, balance, reason });

describe('names and digits', () => {
  it('a name is compared after NFKC, trimming, folding spaces and upper-casing', () => {
    expect(normaliseCardName('  egycash-3674   b257539 ')).toBe('EGYCASH-3674 B257539');
    // Full-width letters and digits (NFKC) read as their plain forms.
    expect(normaliseCardName('ＥＧＹＣＡＳＨ-１')).toBe('EGYCASH-1');
  });

  it('the last four digits of a masked or spaced number', () => {
    expect(lastFourDigits('548**********0021')).toBe('0021');
    expect(lastFourDigits('5485 6400 0688 0021')).toBe('0021');
    expect(lastFourDigits('***12')).toBe('12');
  });
});

describe('matching', () => {
  it('matches by name; equal and differing pairs, with the difference to the piastre', () => {
    const plan = compareFuelSheet({
      rows: [row('EGYCASH-1', 100), row('egycash-2 ', 50.3)],
      invalid: [],
      cards: [card('a', 'EGYCASH-1', 100), card('b', 'EGYCASH-2', 0.1 + 0.2)],
    });
    expect(plan.equal.map((m) => m.cardId)).toEqual(['a']);
    expect(plan.differs).toHaveLength(1);
    expect(plan.differs[0]).toMatchObject({
      cardId: 'b',
      systemBalance: 0.1 + 0.2,
      difference: 50,
    });
  });

  it('numberMatches: last four differ → false; a sheet with fewer than four digits → true', () => {
    const plan = compareFuelSheet({
      rows: [
        row('A', 1, '548**********0021'),
        row('B', 2, '548**********9999'),
        row('C', 3, '***'),
      ],
      invalid: [],
      cards: [card('a', 'A', 1, '5485640006880021'), card('b', 'B', 2), card('c', 'C', 3)],
    });
    expect(plan.equal.map((m) => [m.cardId, m.numberMatches])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
  });

  it('the rest: sheet-only rows and system-only cards', () => {
    const plan = compareFuelSheet({
      rows: [row('A', 1), row('NOT-IN-SYSTEM', 9)],
      invalid: [],
      cards: [card('a', 'A', 1), card('z', 'Z-ONLY', 5), card('y', 'Y-ONLY', 5)],
    });
    expect(plan.sheetOnly.map((r) => r.name)).toEqual(['NOT-IN-SYSTEM']);
    expect(plan.systemOnly).toEqual(['y', 'z']); // by name
  });

  it('differs: the largest difference first, then by name; equal and sheet-only keep sheet order', () => {
    const plan = compareFuelSheet({
      rows: [row('B', 110), row('A', 90), row('C', 150), row('E', 5), row('D', 5)],
      invalid: [],
      cards: [
        card('b', 'B', 100),
        card('a', 'A', 100),
        card('c', 'C', 100),
        card('e', 'E', 5),
        card('d', 'D', 5),
      ],
    });
    expect(plan.differs.map((m) => [m.cardId, m.difference])).toEqual([
      ['c', 50],
      ['a', -10],
      ['b', 10],
    ]);
    expect(plan.equal.map((m) => m.cardId)).toEqual(['e', 'd']);
  });
});

describe('repeats and conflicts — never decidable', () => {
  it('a row the sheet repeats identically counts once and is listed with its times', () => {
    const plan = compareFuelSheet({
      rows: [
        row('A', 10, '548**********0001'),
        row('A', 10, '548**********0001'),
        row('A', 10.001, '***0001'),
      ],
      invalid: [],
      cards: [card('a', 'A', 5)],
    });
    expect(plan.duplicates).toEqual([expect.objectContaining({ name: 'A', times: 3 })]);
    expect(plan.differs.map((m) => m.cardId)).toEqual(['a']);
    expect(plan.conflicts).toEqual([]);
  });

  it('a name given with different numbers or balances is a conflict, and its card is not system-only', () => {
    const plan = compareFuelSheet({
      rows: [
        row('A', 10, '548**********0001'),
        row('A', 11, '548**********0001'),
        row('B', 1, '***0001'),
        row('B', 1, '***0002'),
      ],
      invalid: [],
      cards: [card('a', 'A', 5), card('b', 'B', 5)],
    });
    expect(plan.conflicts.map((c) => [c.reason, c.name, c.cardId, c.rows.length])).toEqual([
      ['sheetRowsDiffer', 'A', 'a', 2],
      ['sheetRowsDiffer', 'B', 'b', 2],
    ]);
    expect([...plan.differs, ...plan.equal]).toEqual([]);
    expect(plan.systemOnly).toEqual([]);
  });

  it('a name two live cards share is a conflict — named on the sheet or not — and neither card is system-only', () => {
    const plan = compareFuelSheet({
      rows: [row('TWICE', 10)],
      invalid: [],
      cards: [
        card('t1', 'TWICE', 1),
        card('t2', 'twice', 2),
        card('u1', 'UNSEEN', 1),
        card('u2', 'UNSEEN', 1),
      ],
    });
    expect(plan.conflicts.map((c) => [c.reason, c.name, c.cardId, c.rows.length])).toEqual([
      ['systemNameTwice', 'TWICE', null, 1],
      ['systemNameTwice', 'UNSEEN', null, 0],
    ]);
    expect(plan.systemOnly).toEqual([]);
    expect(plan.sheetOnly).toEqual([]);
  });

  it('an unreadable or negative balance, alone or beside a readable one, is a conflict', () => {
    const plan = compareFuelSheet({
      rows: [row('MIXED', 10)],
      invalid: [bad('NEG', 'badBalance', -2214.66), bad('MIXED', 'badBalance')],
      cards: [card('n', 'NEG', 7035.34), card('m', 'MIXED', 10)],
    });
    expect(plan.conflicts.map((c) => [c.reason, c.name, c.cardId])).toEqual([
      ['sheetRowsDiffer', 'MIXED', 'm'],
      ['badBalance', 'NEG', 'n'],
    ]);
    expect(plan.conflicts[1]?.rows[0]?.balance).toBe(-2214.66);
    expect([...plan.differs, ...plan.equal, ...plan.systemOnly]).toEqual([]);
  });

  it('a row with no name is its own conflict, matched to nothing', () => {
    const plan = compareFuelSheet({
      rows: [],
      invalid: [bad('', 'noName', 50)],
      cards: [card('a', 'A', 1)],
    });
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ reason: 'noName', name: '', cardId: null }),
    ]);
    expect(plan.systemOnly).toEqual(['a']);
  });
});

describe('the sheet’s company', () => {
  it('EGYCASHTCS- is Chill Out, EGYCASH- Wataniya; a mixed sheet says neither', () => {
    expect(sheetCompanyOf(['EGYCASHTCS-1', 'egycashtcs-2'])).toBe('chillout');
    expect(sheetCompanyOf(['EGYCASH-1', 'EGYCASH-2'])).toBe('wataniya');
    expect(sheetCompanyOf(['EGYCASH-1', 'EGYCASHTCS-2'])).toBeNull();
    expect(sheetCompanyOf(['EGYCASH-1', 'OTHER'])).toBeNull();
    expect(sheetCompanyOf([])).toBeNull();
  });

  it('is read from every named row, the unreadable ones too', () => {
    const plan = compareFuelSheet({
      rows: [row('EGYCASHTCS-1', 1)],
      invalid: [bad('EGYCASH-2', 'badBalance')],
      cards: [],
    });
    expect(plan.sheetCompany).toBeNull();
  });
});
