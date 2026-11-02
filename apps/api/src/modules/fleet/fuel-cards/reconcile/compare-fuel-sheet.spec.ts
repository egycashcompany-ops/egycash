// The sheet against the cards — every rule of the pure comparison: matching by (canonical) name
// first, the number checking it, identical repeats counted once, anything ambiguous kept out of
// reach of ✓ / ✗, piastre exactness, order.
import { describe, expect, it } from 'vitest';
import {
  canonCardName,
  codeMatchesPlace,
  compareFuelSheet,
  lastFourDigits,
  normaliseCardName,
  numberFits,
  sheetCompanyOf,
  sheetNumberOf,
  type CompareCard,
} from './compare-fuel-sheet';
import { sheetNumberKindOf, type FuelSheetInvalidRow, type FuelSheetRow } from './read-fuel-sheet';

let nextRow = 2;
const kindOf = (number: string) => sheetNumberKindOf({ kind: 'text', value: number });
const row = (
  name: string,
  balance: number,
  number = '548**********0001',
  over: Partial<FuelSheetRow> = {},
): FuelSheetRow => ({
  row: nextRow++,
  number,
  name,
  balance,
  builtName: name,
  plate: null,
  chassis: null,
  code: null,
  numberKind: kindOf(number),
  ...over,
});
const card = (
  id: string,
  name: string,
  balance: number,
  number = '5485640000000001',
  place: string | null = null,
): CompareCard => ({
  id,
  name,
  number,
  balance,
  place,
});
const bad = (name: string, balance: number | null = null): FuelSheetInvalidRow => ({
  row: nextRow++,
  number: '548**********0009',
  name,
  balance,
  builtName: name,
  plate: null,
  chassis: null,
  code: null,
  numberKind: 'masked',
  reason: 'badBalance',
});

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
      invalid: [bad('NEG', -2214.66), bad('MIXED')],
      cards: [card('n', 'NEG', 7035.34), card('m', 'MIXED', 10)],
    });
    expect(plan.conflicts.map((c) => [c.reason, c.name, c.cardId])).toEqual([
      ['sheetRowsDiffer', 'MIXED', 'm'],
      ['badBalance', 'NEG', 'n'],
    ]);
    expect(plan.conflicts[1]?.rows[0]?.balance).toBe(-2214.66);
    expect([...plan.differs, ...plan.equal, ...plan.systemOnly]).toEqual([]);
  });

  // Rewritten on purpose (6c): the reader no longer sets a nameless row aside as `noName` — a row
  // with a number and no name is matched by its number, and a masked one is listed, not decided.
  it('a row with no name: its last four on one card is listed, never decided — and its card stays system-only', () => {
    const plan = compareFuelSheet({
      rows: [row('', 50, '548**********0001')],
      invalid: [],
      cards: [card('a', 'A', 1)],
    });
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        reason: 'lastFourOnly',
        name: '',
        cardId: null,
        candidateIds: ['a'],
      }),
    ]);
    expect([...plan.differs, ...plan.equal]).toEqual([]);
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
      invalid: [bad('EGYCASH-2')],
      cards: [],
    });
    expect(plan.sheetCompany).toBeNull();
  });

  it('a bare prefix counts as its company — the statements print «EGYCASH» alone', () => {
    expect(sheetCompanyOf(['EGYCASHTCS', 'EGYCASHTCS-8344-250541'])).toBe('chillout');
    expect(sheetCompanyOf(['egycash', 'EGYCASH-3674-B257539'])).toBe('wataniya');
    expect(sheetCompanyOf(['EGYCASHX'])).toBeNull();
  });

  it('a Chill Out statement read as Wataniya says Chill Out — the screen stops on it', () => {
    const plan = compareFuelSheet({
      rows: [
        row('EGYCASHTCS', 5, '548**********5824', { builtName: 'EGYCASHTCS-8344-250541' }),
        row('EGYCASHTCS', 6, '548**********5825', { builtName: 'EGYCASHTCS-8345-250542' }),
      ],
      invalid: [],
      cards: [card('w', 'EGYCASH-8344-250541', 5, '5485640000005824')],
    });
    expect(plan.sheetCompany).toBe('chillout');
    expect([...plan.differs, ...plan.equal]).toEqual([]);
    expect(plan.sheetOnly).toHaveLength(2);
  });
});

describe('6c — the canonical name, the number checking it', () => {
  it('canonical: upper case, split on spaces, «-» and «_», digits without leading zeros', () => {
    expect(canonCardName(' egycashtcs-6728-043684 ')).toBe('EGYCASHTCS-6728-43684');
    expect(canonCardName('EGYCASH 3674_B257539')).toBe('EGYCASH-3674-B257539');
    expect(canonCardName('EGYCASH--0-000')).toBe('EGYCASH-0-0');
    expect(canonCardName('')).toBe('');
  });

  it('the number kinds: full, masked (prefix + tail), other, none', () => {
    expect(sheetNumberOf('5485640006880021', 'full')).toMatchObject({ tail: '0021' });
    expect(sheetNumberOf('548**********0021', 'masked')).toMatchObject({
      prefix: '548',
      tail: '0021',
    });
    expect(numberFits(sheetNumberOf('548**********0021', 'masked'), '5485640006880021')).toBe(true);
    expect(numberFits(sheetNumberOf('549**********0021', 'masked'), '5485640006880021')).toBe(
      false,
    );
    expect(numberFits(sheetNumberOf('5485640006880021', 'full'), '5485 6400 0688 0021')).toBe(true);
    expect(numberFits(sheetNumberOf('12', 'other'), '5485640006880012')).toBeNull();
    expect(numberFits(sheetNumberOf('', 'none'), '5485640006880012')).toBeNull();
    // A numeric cell a spreadsheet rounded: its fifteen kept digits are compared, never the last.
    expect(numberFits(sheetNumberOf('5485640006880020', 'imprecise'), '5485640006880021')).toBe(
      true,
    );
  });

  it('a bare «EGYCASH» rebuilt with plate and chassis matches the card, its leading zeros ignored', () => {
    const plan = compareFuelSheet({
      rows: [
        row('EGYCASHTCS', 120, '548**********4466', {
          builtName: 'EGYCASHTCS-1476-46466',
          plate: '1476',
          chassis: '46466',
        }),
      ],
      invalid: [],
      cards: [card('z', 'EGYCASHTCS-1476-046466', 100, '5485640000004466')],
    });
    expect(plan.differs).toEqual([
      expect.objectContaining({
        cardId: 'z',
        difference: 20,
        matchedBy: 'name',
        nameMatches: true,
        numberMatches: true,
        numberHolderId: null,
      }),
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('a crossed cycle of three: each matched BY NAME, its number flagged, its holder named', () => {
    // The system holds the three numbers crossed: the sheet's 0935 is on B, 2813 on C, 3375 on A.
    const cards = [
      card('a', 'EGYCASH-1-A', 10, '5485640000003375'),
      card('b', 'EGYCASH-2-B', 20, '5485640000000935'),
      card('c', 'EGYCASH-3-C', 30, '5485640000002813'),
    ];
    const plan = compareFuelSheet({
      rows: [
        row('EGYCASH-1-A', 10, '548**********0935'),
        row('EGYCASH-2-B', 20, '548**********2813'),
        row('EGYCASH-3-C', 30, '548**********3375'),
      ],
      invalid: [],
      cards,
    });
    expect(
      plan.equal.map((m) => [m.cardId, m.matchedBy, m.numberMatches, m.numberHolderId]),
    ).toEqual([
      ['a', 'name', false, 'b'],
      ['b', 'name', false, 'c'],
      ['c', 'name', false, 'a'],
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('a full number on one card whose name the sheet does not carry: matched by number', () => {
    const plan = compareFuelSheet({
      rows: [row('EGYCASHTCS-6119-783213', 385.22, '5485640000004108')],
      invalid: [],
      cards: [card('r', 'EGYCASHTCS-OLD-NAME', 385.22, '5485640000004108')],
    });
    expect(plan.equal).toEqual([
      expect.objectContaining({ cardId: 'r', matchedBy: 'number', nameMatches: false }),
    ]);
  });

  it('a named row on no card is the sheet’s own — its masked last four prove nothing', () => {
    const plan = compareFuelSheet({
      rows: [row('EGYCASHTCS-1781-312986', 4305.09, '548**********0001')],
      invalid: [],
      cards: [card('a', 'EGYCASHTCS-X', 1), card('b', 'EGYCASHTCS-Y', 1)],
    });
    expect(plan.sheetOnly.map((r) => r.builtName)).toEqual(['EGYCASHTCS-1781-312986']);
    expect(plan.conflicts).toEqual([]);
  });

  it('no name to check, last four on two cards: ambiguous — a code may pre-select, never decide', () => {
    const plan = compareFuelSheet({
      rows: [row('EGYCASH', 10, '548**********0001', { code: '164' })],
      invalid: [],
      cards: [
        card('a', 'EGYCASH-1-A', 10, '5485640000000001', '164'),
        card('b', 'EGYCASH-2-B', 10, '5485640000010001', '170'),
      ],
    });
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        reason: 'ambiguousNumber',
        name: 'EGYCASH',
        cardId: null,
        candidateIds: ['a', 'b'],
      }),
    ]);
    expect([...plan.differs, ...plan.equal]).toEqual([]);
  });

  it('one card claimed by two rows: neither decides it (cardTwice)', () => {
    const plan = compareFuelSheet({
      rows: [row('EGYCASH-1-A', 10, '548**********0001'), row('EGYCASH', 11, '5485640000000001')],
      invalid: [],
      cards: [card('a', 'EGYCASH-1-A', 10)],
    });
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ reason: 'cardTwice', cardId: 'a', name: 'EGYCASH-1-A' }),
    ]);
    expect(plan.conflicts[0]?.rows).toHaveLength(2);
    expect([...plan.differs, ...plan.equal, ...plan.systemOnly]).toEqual([]);
  });

  it('a bare prefix with no plate or chassis is no name — rows are never grouped by it', () => {
    const plan = compareFuelSheet({
      rows: [row('EGYCASH', 1, '548**********0001'), row('EGYCASH', 2, '548**********0002')],
      invalid: [],
      cards: [card('a', 'EGYCASH-A', 1, '5485640000000001')],
    });
    expect(plan.conflicts.map((c) => [c.reason, c.candidateIds])).toEqual([
      ['lastFourOnly', ['a']],
    ]);
    expect(plan.sheetOnly).toHaveLength(1);
    expect(plan.duplicates).toEqual([]);
  });

  it('a name two cards share is told apart by the number, else by the car code', () => {
    const plan = compareFuelSheet({
      rows: [
        row('TWIN', 5, '548**********0002'),
        row('PAIR', 7, '548**********0009', { code: 'm g 2' }),
      ],
      invalid: [],
      cards: [
        card('t1', 'TWIN', 1, '5485640000000001'),
        card('t2', 'twin', 5, '5485640000000002'),
        card('p1', 'PAIR', 7, '5485640000000009', 'MG 2'),
        card('p2', 'PAIR', 7, '5485640000010009', '172'),
      ],
    });
    expect(plan.equal.map((m) => m.cardId)).toEqual(['t2', 'p1']);
    expect(plan.conflicts).toEqual([]);
    // The twin the sheet does not show is the system's alone.
    expect(plan.systemOnly.sort()).toEqual(['p2', 't1']);
  });

  it('an imprecise number is never matched by number', () => {
    const plan = compareFuelSheet({
      rows: [row('', 5, '5485640000000000', { numberKind: 'imprecise' })],
      invalid: [],
      cards: [card('a', 'A', 5, '5485640000000001')],
    });
    expect(plan.sheetOnly).toHaveLength(1);
    expect([...plan.equal, ...plan.differs]).toEqual([]);
  });

  it('the place hint: the sheet’s code against the card’s car or label, folded; none without a code', () => {
    expect(codeMatchesPlace('m g 3', 'MG 3')).toBe(true);
    expect(codeMatchesPlace('530', '283')).toBe(false);
    expect(codeMatchesPlace(null, '283')).toBeNull();
    expect(codeMatchesPlace('530', null)).toBe(false);
    const plan = compareFuelSheet({
      rows: [row('A', 1, '548**********0001', { code: '530' })],
      invalid: [],
      cards: [card('a', 'A', 1, '5485640000000001', '283')],
    });
    expect(plan.equal[0]?.placeMatches).toBe(false);
  });
});
