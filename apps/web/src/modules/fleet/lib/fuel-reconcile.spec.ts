// «مطابقة أرصدة الكروت» — the screen's pure half: how its figures are written and summed, and what
// is ticked, decided and refused.
import { describe, expect, it } from 'vitest';
import {
  ErrorCodes,
  type FleetFuelCardDto,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileChargeDto,
  type FleetFuelReconcileLineDto,
  type FleetFuelReconcileResultDto,
  type FleetFuelSheetConflictDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  NO_SELECTION,
  asksFirst,
  chooseConflictsOf,
  dayText,
  daysBetween,
  decideExtrasOf,
  defaultChoices,
  laterCharges,
  markedTooMuch,
  maskedOf,
  maskedPrefixOf,
  mostUnmatched,
  plainConflictsOf,
  preTickedCharges,
  requestMatches,
  sheetDateOfName,
  balanceNow,
  changedNumbersOf,
  confirmTotalsOf,
  conflictRowsOf,
  decidedCardIds,
  dots,
  isOpen,
  largestOf,
  lastFour,
  money,
  movedCardIds,
  netOf,
  openLines,
  piastres,
  reconcileSelection,
  repeatsOf,
  signed,
  stampOf,
  sumOf,
  tickedLines,
  timeOf,
  wrongCompanyOf,
  type ReconcileSelection,
} from './fuel-reconcile';

const card = (
  id: string,
  balance: number,
  over: Partial<FleetFuelCardDto> = {},
): FleetFuelCardDto => ({
  id,
  vehicleId: null,
  vehicleCode: null,
  label: 'سفر 1',
  company: 'wataniya',
  name: `EGYCASH-${id}`,
  number: '7045 1120 0098 2231',
  expiresAt: null,
  hasPassword: false,
  balance,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
/** A sheet row's batch-3 facts, neutral: no plate, chassis or code; the number kind not told. */
const ROW_FACTS = { plate: null, chassis: null, code: null, numberKind: 'other' as const };
/** A line's batch-3 facts, neutral: matched by name, no crossed number, no charge to cancel. */
const LINE_FACTS = {
  matchedBy: 'name' as const,
  nameMatches: true,
  numberHolder: null,
  placeMatches: null,
  charges: [],
};
const line = (
  id: string,
  system: number,
  sheet: number,
  numberMatches = true,
): FleetFuelReconcileLineDto => ({
  card: card(id, system),
  sheet: {
    row: 2,
    number: '548**********2231',
    name: `EGYCASH-${id}`,
    balance: sheet,
    builtName: `EGYCASH-${id}`,
    ...ROW_FACTS,
  },
  difference: (piastres(sheet) - piastres(system)) / 100,
  numberMatches,
  ...LINE_FACTS,
});
const result = (
  id: string,
  decision: 'apply' | 'reject',
  balance: number,
): FleetFuelReconcileResultDto => ({
  cardId: id,
  decision,
  balance,
  at: '2026-10-27T09:41:00.000Z',
  byName: 'أحمد علي',
  cancelledAmount: 0,
  approvedRequest: null,
});
const LINES = [line('a1', 795, 16745.12), line('b2', 14516.85, 596.85), line('c3', 777, 13377.42)];
const moved = (...ids: string[]): ApiError =>
  new ApiError(
    ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
    'Changed',
    409,
    ids.map((id) => ({ field: 'cardIds', code: 'CARD_CHANGED', message: id })),
  );

describe('the figures', () => {
  it('writes balances in Latin figures with two decimals, and a difference with its sign', () => {
    expect(money(16745.12)).toBe('16,745.12');
    expect(money(0)).toBe('0.00');
    expect(signed(640)).toBe('+640.00');
    expect(signed(-1250.5)).toBe('−1,250.50');
    expect(signed(0)).toBe('0.00');
  });

  it('sums to the piastre, so 0.1 + 0.2 is 0.30', () => {
    expect(sumOf([0.1, 0.2])).toBe(0.3);
    expect(netOf([line('x', 0, 0.1), line('y', 0, 0.2)])).toBe(0.3);
    expect(largestOf(LINES)).toBe(15950.12);
    expect(largestOf([])).toBe(0);
  });

  it('a bulk decision’s totals: the balance now, the net difference, the balance after ✓', () => {
    expect(confirmTotalsOf([LINES[0]!, LINES[2]!])).toEqual({
      now: 1572,
      net: 28550.54,
      after: 30122.54,
    });
    expect(confirmTotalsOf([])).toEqual({ now: 0, net: 0, after: 0 });
  });

  it('shows the last four of a number only, as the boards hide one', () => {
    expect(lastFour('548**********0021')).toBe('0021');
    expect(lastFour('7045 1120 0098 2231')).toBe('2231');
    expect(dots('548**********0021')).toBe('•••• 0021');
  });

  it('writes the reading time on the reader’s own clock', () => {
    const at = new Date(2026, 9, 20, 11, 40).toISOString();
    expect(stampOf(at)).toBe('2026/10/20 11:40');
    expect(timeOf(at)).toBe('11:40');
  });
});

describe('what the comparison says beside the table', () => {
  const base: FleetFuelReconcileDto = {
    id: 's-1',
    company: 'wataniya',
    fileName: 'a.xlsx',
    fileSha256: 'f'.repeat(64),
    rows: 223,
    readAt: '2026-10-20T08:40:00.000Z',
    sheetCompany: 'wataniya',
    differs: [line('a1', 1, 2, false), line('b2', 1, 3)],
    equal: [line('c3', 5, 5, false)],
    sheetOnly: [],
    systemOnly: [],
    duplicates: [
      { row: 4, number: '1', name: 'X', balance: 1, times: 2, builtName: 'X', ...ROW_FACTS },
      { row: 9, number: '2', name: 'Y', balance: 2, times: 3, builtName: 'Y', ...ROW_FACTS },
    ],
    conflicts: [
      {
        reason: 'sheetRowsDiffer',
        name: 'A',
        cardId: null,
        candidateIds: [],
        rows: [
          { row: 3, number: '1', balance: 1 },
          { row: 225, number: '1', balance: 2 },
        ],
      },
      {
        reason: 'badBalance',
        name: 'B',
        cardId: 'b',
        candidateIds: [],
        rows: [{ row: 10, number: '2', balance: null }],
      },
      { reason: 'systemNameTwice', name: 'C', cardId: null, candidateIds: [], rows: [] },
    ],
    layout: [],
    nameRebuilt: false,
    cardRows: 223,
    skipped: [],
    totalCheck: null,
    example: null,
    sheetDate: null,
    carColumn: false,
    links: [],
    newCards: [],
  };

  it('counts rows that never match as rows, and repeated rows beyond each card’s first', () => {
    expect(conflictRowsOf(base.conflicts)).toBe(3);
    expect(repeatsOf(base.duplicates)).toBe(3);
  });

  it('flags last four digits that differ on differing and equal cards alike', () => {
    expect(changedNumbersOf(base).map((l) => l.card.id)).toEqual(['a1', 'c3']);
  });

  it('names the other company only when the sheet’s names say it', () => {
    expect(wrongCompanyOf(base)).toBeNull();
    expect(wrongCompanyOf({ ...base, sheetCompany: null })).toBeNull();
    expect(wrongCompanyOf({ ...base, sheetCompany: 'chillout' })).toBe('chillout');
  });
});

describe('the refusals', () => {
  it('reads the cards a 409 names, lower-cased; nothing for any other failure', () => {
    expect(movedCardIds(moved('AB12', 'cd34'))).toEqual(['ab12', 'cd34']);
    expect(decidedCardIds(moved('ab12'))).toEqual([]);
    expect(
      decidedCardIds(
        new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'x', 409, [
          { field: 'cardIds', code: 'DECIDED', message: 'ab12' },
        ]),
      ),
    ).toEqual(['ab12']);
    expect(movedCardIds(new TypeError('Failed to fetch'))).toEqual([]);
  });
});

describe('the selection', () => {
  const run = (...actions: Parameters<typeof reconcileSelection>[1][]): ReconcileSelection =>
    actions.reduce(reconcileSelection, NO_SELECTION);

  it('ticks and unticks open cards; «تحديد الكل» takes every open one, or none', () => {
    const one = run({ type: 'toggle', id: 'B2', on: true });
    expect([...one.picked]).toEqual(['b2']);
    expect(tickedLines(LINES, one).map((l) => l.card.id)).toEqual(['b2']);
    expect(
      run({ type: 'toggle', id: 'b2', on: true }, { type: 'toggle', id: 'b2', on: false }).picked
        .size,
    ).toBe(0);
    const all = run({ type: 'tickAll', lines: LINES, on: true });
    expect(tickedLines(LINES, all).map((l) => l.card.id)).toEqual(['a1', 'b2', 'c3']);
    expect(reconcileSelection(all, { type: 'tickAll', lines: LINES, on: false }).picked.size).toBe(
      0,
    );
    expect(reconcileSelection(all, { type: 'clear' }).picked.size).toBe(0);
  });

  it('a decided card leaves the selection, shows the server’s balance, and cannot be ticked again', () => {
    const state = run(
      { type: 'tickAll', lines: LINES, on: true },
      { type: 'decided', results: [result('a1', 'apply', 16745.12), result('c3', 'reject', 777)] },
    );
    expect([...state.picked]).toEqual(['b2']);
    expect(isOpen(state, 'a1')).toBe(false);
    expect(openLines(LINES, state).map((l) => l.card.id)).toEqual(['b2']);
    expect(reconcileSelection(state, { type: 'toggle', id: 'a1', on: true })).toBe(state);
    expect(balanceNow(state, LINES[0]!.card)).toBe(16745.12);
    expect(balanceNow(state, LINES[2]!.card)).toBe(777);
    expect(balanceNow(state, LINES[1]!.card)).toBe(14516.85);
    const again = reconcileSelection(state, { type: 'tickAll', lines: LINES, on: true });
    expect([...again.picked]).toEqual(['b2']);
  });

  it('a 409 «changed after the read»: the named cards are moved — no tick, never in «تحديد الكل»', () => {
    const state = run(
      { type: 'tickAll', lines: LINES, on: true },
      { type: 'refused', error: moved('B2') },
    );
    expect([...state.moved]).toEqual(['b2']);
    expect([...state.picked].sort()).toEqual(['a1', 'c3']);
    expect(isOpen(state, 'b2')).toBe(false);
    expect(reconcileSelection(state, { type: 'toggle', id: 'b2', on: true })).toBe(state);
    const all = reconcileSelection(state, { type: 'tickAll', lines: LINES, on: true });
    expect([...all.picked].sort()).toEqual(['a1', 'c3']);
  });

  it('any other failure leaves the selection as it was — nothing was written', () => {
    const ticked = run({ type: 'tickAll', lines: LINES, on: true });
    expect(reconcileSelection(ticked, { type: 'refused', error: new TypeError('x') })).toBe(ticked);
    expect(
      reconcileSelection(ticked, {
        type: 'refused',
        error: new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'x', 409, [
          { field: 'cardIds', code: 'DECIDED', message: 'a1' },
        ]),
      }),
    ).toBe(ticked);
  });

  it('a new sheet starts over', () => {
    const state = run(
      { type: 'tickAll', lines: LINES, on: true },
      { type: 'refused', error: moved('a1') },
      { type: 'decided', results: [result('b2', 'reject', 14516.85)] },
      { type: 'reset' },
    );
    expect(state).toBe(NO_SELECTION);
  });
});

// ── Batch 3 ─────────────────────────────────────────────────────────────────────────────────────

describe('6c: a sheet’s number and its date', () => {
  it('writes a masked number as the sheet prints it — its start, then the last four', () => {
    expect(maskedOf('548**********0021')).toBe('548 •••• 0021');
    expect(maskedOf('548 •••• •••• 0021')).toBe('548 •••• 0021');
    expect(maskedOf('5485640068890021')).toBe('•••• 0021');
    expect(maskedOf('**********0021')).toBe('•••• 0021');
    expect(maskedPrefixOf('548**********7791')).toBe('548');
    expect(maskedPrefixOf('5485640068897791')).toBe('');
  });

  it('reads the sheet’s day from its file name, day first — or nothing', () => {
    expect(sheetDateOfName('رصيد وطنيه 4-10-2026.xlsx')).toEqual({
      day: '2026-10-04',
      text: '4-10-2026',
    });
    expect(sheetDateOfName('رصيد شل اوت 1-11-2026.xlsx')).toEqual({
      day: '2026-11-01',
      text: '1-11-2026',
    });
    expect(sheetDateOfName('balances_04.10.2026.xlsx')?.day).toBe('2026-10-04');
    expect(sheetDateOfName('بيانات شركه وطنيه.xlsx')).toBeNull();
    // Not a calendar day: nothing, rather than a wrong one.
    expect(sheetDateOfName('31-2-2026.xlsx')).toBeNull();
    expect(sheetDateOfName('4-13-2026.xlsx')).toBeNull();
    expect(dayText('2026-10-04')).toBe('2026/10/04');
    expect(daysBetween('2026-10-04', '2026-11-01')).toBe(28);
  });

  it('splits the rows that list candidates from those that never match', () => {
    const conflict = (reason: FleetFuelSheetConflictDto['reason']): FleetFuelSheetConflictDto => ({
      reason,
      name: '',
      cardId: null,
      candidateIds: [],
      rows: [{ row: 3, number: '548**********0021', balance: 10 }],
    });
    const all = [
      conflict('ambiguousNumber'),
      conflict('cardTwice'),
      conflict('lastFourOnly'),
      conflict('badBalance'),
    ];
    expect(chooseConflictsOf(all).map((c) => c.reason)).toEqual([
      'ambiguousNumber',
      'lastFourOnly',
    ]);
    expect(plainConflictsOf(all).map((c) => c.reason)).toEqual(['cardTwice', 'badBalance']);
  });

  it('raises the guard when fewer than half the card rows found a card', () => {
    const answer = (cardRows: number, found: number): FleetFuelReconcileDto =>
      ({
        differs: LINES.slice(0, found),
        equal: [],
        cardRows,
      }) as unknown as FleetFuelReconcileDto;
    expect(mostUnmatched(answer(7, 3))).toBe(true);
    expect(mostUnmatched(answer(6, 3))).toBe(false);
    expect(mostUnmatched(answer(0, 0))).toBe(false);
  });
});

describe('6a: a top-up the sheet does not show, a request the difference equals', () => {
  const charge = (
    id: string,
    amount: number,
    afterSheetDate = false,
  ): FleetFuelReconcileChargeDto => ({
    id,
    amount,
    at: '2026-11-01T08:05:00.000Z',
    byName: 'مدير الحركة',
    afterSheetDate,
  });
  const short = (charges: FleetFuelReconcileChargeDto[], system = 11203.43, sheet = 10203.43) => ({
    ...line('x9', system, sheet),
    charges,
  });

  it('pre-ticks the one charge that is exactly what the sheet is short', () => {
    const one = short([charge('c1', 250), charge('c2', 1000)]);
    expect(preTickedCharges(one)).toEqual(['c2']);
    expect(asksFirst(one)).toBe(true);
  });

  it('pre-ticks all of them when together they are exactly the shortfall', () => {
    expect(preTickedCharges(short([charge('c1', 400), charge('c2', 600)]))).toEqual(['c1', 'c2']);
    expect(preTickedCharges(short([charge('c1', 400), charge('c2', 700)]))).toEqual([]);
  });

  it('never pre-ticks a charge after the sheet’s date, even of the exact amount', () => {
    const later = short([charge('c1', 1000, true)]);
    expect(preTickedCharges(later)).toEqual([]);
    expect(laterCharges(later).map((c) => c.id)).toEqual(['c1']);
    // Still asked about — listed apart.
    expect(asksFirst(later)).toBe(true);
  });

  it('asks nothing when the sheet is higher and no request matches', () => {
    const higher = { ...line('x9', 77.48, 1577.48), charges: [] };
    expect(asksFirst(higher)).toBe(false);
    expect(preTickedCharges(higher)).toEqual([]);
  });

  it('a request matches only when the sheet is higher by exactly its amount', () => {
    const higher = line('x9', 77.48, 1577.48);
    const asked = (requestedAmount: number | null): FleetFuelReconcileLineDto => ({
      ...higher,
      card: { ...higher.card, requestedAmount },
    });
    expect(requestMatches(asked(1500))).toBe(true);
    expect(asksFirst(asked(1500))).toBe(true);
    expect(requestMatches(asked(1499.99))).toBe(false);
    expect(requestMatches(asked(null))).toBe(false);
    expect(defaultChoices(asked(1500)).request).toBe('approve');
  });

  it('a ✓ sends the ticked charges and the approved requests — and nothing more when none', () => {
    const lower = short([charge('c1', 1000), charge('c2', 50)]);
    const higher = {
      ...line('y8', 77.48, 1577.48),
      card: { ...line('y8', 77.48, 1577.48).card, requestedAmount: 1500 },
    };
    const plain = line('z7', 10, 20);
    expect(decideExtrasOf([lower, higher, plain], defaultChoices)).toEqual({
      cancelCharges: ['c1'],
      approveRequests: ['y8'],
    });
    // «تسوية فقط» and nothing ticked: exactly batch 2's body.
    expect(
      decideExtrasOf([lower, higher], () => ({ cancel: new Set<string>(), request: 'adjust' })),
    ).toEqual({});
  });

  it('flags ticks that add up to more than the sheet takes off', () => {
    const lower = short([charge('c1', 1000), charge('c2', 50)]);
    expect(markedTooMuch(lower, { cancel: new Set(['c1']), request: null })).toBe(false);
    expect(markedTooMuch(lower, { cancel: new Set(['c1', 'c2']), request: null })).toBe(true);
  });
});
