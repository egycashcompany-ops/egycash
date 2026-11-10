// The daily board's client-side decisions, asserted directly.
//
// These are the behaviours the legacy screen implemented in browser JavaScript over rendered HTML
// (main_ops.ejs:966-1010) — including reading a row's background colour to decide whether it was
// received. They are preserved as behaviour and replaced as implementation, so each one is pinned
// here against the shipment's actual fields.
import { describe, expect, it } from 'vitest';
import { type OperationsDayBoardShipmentDto, type OperationsShipmentDto } from '@ecms/contracts';
import {
  EMPTY_DAY_BOARD_FILTERS,
  boardDateOf,
  boardTotals,
  branchCell,
  branchCellText,
  filterDayBoard,
  hasActiveFilter,
  isCrossBank,
  isOtherOriginBank,
  isReceived,
  legacyRowNumber,
  orderedBoardTotals,
  totalsByCurrency,
  type BoardBranchSide,
} from './day-board';

const shipment = (over: Partial<OperationsShipmentDto> = {}): OperationsShipmentDto => ({
  id: 's1',
  shipmentType: 'daily',
  status: 'draft',
  mainBankId: 'bank-a',
  secondaryBankId: null,
  originBranchId: 'branch-1',
  destinationBranchId: 'branch-2',
  areaName: 'الجيزة',
  lines: [{ currencyId: 'egp', amount: 1000 }],
  collectionDate: '2026-10-05T00:00:00.000Z',
  deliveryDate: null,
  receiptNumber: null,
  vaultReceiptNumber: null,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 0,
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T08:00:00.000Z',
  ...over,
});

const BANKS: Record<string, string> = { 'bank-a': 'الأهلي', 'bank-b': 'مصر' };
const BRANCHES: Record<string, string> = {
  'branch-1': 'فرع المهندسين',
  'branch-2': 'فرع الدقي',
};
const bankNameOf = (id: string): string => BANKS[id] ?? '';
const branchNameOf = (id: string): string => BRANCHES[id] ?? '';
/** A caller holding plain shipments: the cell text is the branch name, by id. */
const branchTextOf = (row: OperationsShipmentDto, side: BoardBranchSide): string =>
  branchNameOf(side === 'origin' ? row.originBranchId : row.destinationBranchId);
const run = (rows: OperationsShipmentDto[], over: Partial<typeof EMPTY_DAY_BOARD_FILTERS> = {}) =>
  filterDayBoard(rows, { ...EMPTY_DAY_BOARD_FILTERS, ...over }, bankNameOf, branchTextOf);

describe('isReceived — quirk Q23 NORMALIZE (received merged into status)', () => {
  it('is true only at the terminal status', () => {
    expect(isReceived({ status: 'completed' })).toBe(true);
    for (const status of ['draft', 'inVault', 'dispatched'] as const) {
      expect(isReceived({ status })).toBe(false);
    }
  });
});

describe('boardDateOf — which date the row is actually about', () => {
  it('uses the COLLECTION date for a daily shipment', () => {
    expect(boardDateOf(shipment())).toBe('2026-10-05T00:00:00.000Z');
  });

  it('uses the DELIVERY date for a secured shipment', () => {
    const secured = shipment({
      shipmentType: 'secured',
      deliveryDate: '2026-10-07T00:00:00.000Z',
    });
    expect(boardDateOf(secured)).toBe('2026-10-07T00:00:00.000Z');
  });
});

describe('legacyRowNumber — descending, newest highest (main_ops.ejs:847)', () => {
  it('numbers a three-row board 3, 2, 1', () => {
    expect([0, 1, 2].map((i) => legacyRowNumber(i, 3))).toEqual([3, 2, 1]);
  });

  it('numbers a single row 1', () => {
    expect(legacyRowNumber(0, 1)).toBe(1);
  });
});

describe('isCrossBank — the dark-red highlight the operator must not miss', () => {
  it('is false when there is no secondary bank', () => {
    expect(isCrossBank(shipment())).toBe(false);
  });

  it('is false when the secondary bank IS the main bank', () => {
    expect(isCrossBank(shipment({ secondaryBankId: 'bank-a' }))).toBe(false);
  });

  it('is true when the movement crosses banks', () => {
    expect(isCrossBank(shipment({ secondaryBankId: 'bank-b' }))).toBe(true);
  });
});

describe('totalsByCurrency', () => {
  it('sums repeated lines of the same currency', () => {
    const row = shipment({
      lines: [
        { currencyId: 'egp', amount: 1000 },
        { currencyId: 'egp', amount: 250 },
        { currencyId: 'usd', amount: 40 },
      ],
    });
    expect(totalsByCurrency(row)).toEqual([
      { currencyId: 'egp', amount: 1250 },
      { currencyId: 'usd', amount: 40 },
    ]);
  });

  it('is empty for a shipment with no lines rather than throwing', () => {
    expect(totalsByCurrency(shipment({ lines: [] }))).toEqual([]);
  });
});

describe('filterDayBoard — the eight legacy filters, over data instead of HTML', () => {
  const daily = shipment({ id: 'daily' });
  const secured = shipment({
    id: 'secured',
    shipmentType: 'secured',
    status: 'completed',
    mainBankId: 'bank-b',
    areaName: 'القاهرة',
    notes: 'عاجل',
    deliveryDate: '2026-10-05T00:00:00.000Z',
  });
  const rows = [daily, secured];

  it('returns everything when no filter is set', () => {
    expect(run(rows)).toHaveLength(2);
    expect(hasActiveFilter(EMPTY_DAY_BOARD_FILTERS)).toBe(false);
  });

  it('matches a bank by SUBSTRING, as the legacy filter did', () => {
    expect(run(rows, { bank: 'أهل' }).map((r) => r.id)).toEqual(['daily']);
  });

  it('matches origin and destination branches independently', () => {
    expect(run(rows, { origin: 'المهندسين' })).toHaveLength(2);
    expect(run(rows, { origin: 'الدقي' })).toHaveLength(0);
    expect(run(rows, { destination: 'الدقي' })).toHaveLength(2);
  });

  it('filters by type', () => {
    expect(run(rows, { type: 'secured' }).map((r) => r.id)).toEqual(['secured']);
    expect(run(rows, { type: 'daily' }).map((r) => r.id)).toEqual(['daily']);
  });

  it('filters by received state, in both directions', () => {
    expect(run(rows, { received: 'yes' }).map((r) => r.id)).toEqual(['secured']);
    expect(run(rows, { received: 'no' }).map((r) => r.id)).toEqual(['daily']);
  });

  it('filters by area and notes, and tolerates a null note', () => {
    expect(run(rows, { area: 'القاهرة' }).map((r) => r.id)).toEqual(['secured']);
    expect(run(rows, { notes: 'عاجل' }).map((r) => r.id)).toEqual(['secured']);
    expect(run(rows, { notes: 'لا شيء' })).toHaveLength(0);
  });

  it('combines filters with AND', () => {
    expect(run(rows, { type: 'secured', received: 'no' })).toHaveLength(0);
    expect(run(rows, { type: 'secured', received: 'yes' })).toHaveLength(1);
  });

  it('ignores surrounding whitespace in a typed filter', () => {
    expect(run(rows, { bank: '  أهل  ' }).map((r) => r.id)).toEqual(['daily']);
  });

  it('preserves the incoming order — the server decides ordering, not the filter', () => {
    expect(run(rows).map((r) => r.id)).toEqual(['daily', 'secured']);
  });

  it('hasActiveFilter reports whether the operator has narrowed anything', () => {
    expect(hasActiveFilter({ ...EMPTY_DAY_BOARD_FILTERS, bank: 'أهل' })).toBe(true);
    expect(hasActiveFilter({ ...EMPTY_DAY_BOARD_FILTERS, received: 'yes' })).toBe(true);
    expect(hasActiveFilter({ ...EMPTY_DAY_BOARD_FILTERS, captain: 'محمود' })).toBe(true);
  });

  it('filters by the crew captain’s name — legacy’s «قائد الطاقم» box', () => {
    const captainOf = (row: OperationsShipmentDto): string =>
      row.id === 'secured' ? 'محمود حسن' : '';
    const byCaptain = (captain: string) =>
      filterDayBoard(
        rows,
        { ...EMPTY_DAY_BOARD_FILTERS, captain },
        bankNameOf,
        branchTextOf,
        captainOf,
      ).map((r) => r.id);
    expect(byCaptain('محمود')).toEqual(['secured']);
    // A row with no crew yet has no captain to match — it drops out rather than matching all.
    expect(byCaptain('أحمد')).toEqual([]);
    expect(byCaptain('')).toEqual(['daily', 'secured']);
  });
});

describe('boardTotals — the legacy «مصري = … دولار = …» strip, over the rows shown', () => {
  it('sums each currency across every row, never adding one currency to another', () => {
    const rows = [
      shipment({ lines: [{ currencyId: 'egp', amount: 1000 }] }),
      shipment({
        lines: [
          { currencyId: 'egp', amount: 500 },
          { currencyId: 'usd', amount: 40 },
        ],
      }),
      shipment({ lines: [{ currencyId: 'eur', amount: 7 }] }),
    ];
    expect(boardTotals(rows)).toEqual([
      { currencyId: 'egp', amount: 1500 },
      { currencyId: 'usd', amount: 40 },
      { currencyId: 'eur', amount: 7 },
    ]);
  });

  it('is empty for an empty board', () => {
    expect(boardTotals([])).toEqual([]);
  });
});

describe('isOtherOriginBank — money collected from a bank other than the one billed', () => {
  const row = (originBankId: string | null): OperationsDayBoardShipmentDto => ({
    ...shipment(),
    origin:
      originBankId === null
        ? null
        : { id: 'branch-1', name: 'فرع المهندسين', code: 'B1', bankId: originBankId, bankName: 'x' },
    destination: null,
    crew: null,
  });

  it('is false when the origin branch belongs to the billed bank', () => {
    expect(isOtherOriginBank(row('bank-a'))).toBe(false);
  });

  it('is true when the origin branch belongs to another bank', () => {
    expect(isOtherOriginBank(row('bank-b'))).toBe(true);
  });

  it('is false when the origin could not be resolved — nothing to say about it', () => {
    expect(isOtherOriginBank(row(null))).toBe(false);
  });
});

type BranchAt = { name: string; bankId: string } | null;

/** A board row: a shipment plus the branches the server resolved for it, banks by name. */
const boardRow = (
  over: Partial<OperationsShipmentDto>,
  origin: BranchAt,
  destination: BranchAt,
): OperationsDayBoardShipmentDto => {
  const resolved = (id: string, branch: BranchAt) =>
    branch === null ? null : { id, code: id, ...branch, bankName: bankNameOf(branch.bankId) };
  return {
    ...shipment(over),
    origin: resolved('o', origin),
    destination: resolved('d', destination),
    crew: null,
  };
};

describe('branchCell / branchCellText — what «من فرع» and «الى فرع» print', () => {
  it('prints the destination bank above the branch only when the movement crosses banks', () => {
    const cross = boardRow(
      { secondaryBankId: 'bank-b' },
      { name: 'فرع المهندسين', bankId: 'bank-a' },
      { name: 'فرع الدقي', bankId: 'bank-b' },
    );
    expect(branchCell(cross, 'destination', bankNameOf)).toEqual({
      bank: 'مصر',
      branch: 'فرع الدقي',
    });
    // Legacy's `innerText`: the dark-red bank line, a line break, the branch.
    expect(branchCellText(cross, 'destination', bankNameOf)).toBe('مصر\nفرع الدقي');

    const same = boardRow(
      { secondaryBankId: 'bank-a' },
      { name: 'فرع المهندسين', bankId: 'bank-a' },
      { name: 'فرع الدقي', bankId: 'bank-a' },
    );
    expect(branchCell(same, 'destination', bankNameOf)).toEqual({
      bank: null,
      branch: 'فرع الدقي',
    });
    expect(branchCellText(same, 'destination', bankNameOf)).toBe('فرع الدقي');
  });

  it('falls back to the secondary bank’s name when the destination branch is gone', () => {
    const orphan = boardRow({ secondaryBankId: 'bank-b' }, null, null);
    expect(branchCell(orphan, 'destination', bankNameOf)).toEqual({ bank: 'مصر', branch: null });
    expect(branchCellText(orphan, 'destination', bankNameOf)).toBe('مصر');
  });

  it('prints the origin bank only when the money came from another bank than the billed', () => {
    const other = boardRow({}, { name: 'فرع المهندسين', bankId: 'bank-b' }, null);
    expect(branchCell(other, 'origin', bankNameOf)).toEqual({
      bank: 'مصر',
      branch: 'فرع المهندسين',
    });
    expect(branchCellText(other, 'origin', bankNameOf)).toBe('مصر\nفرع المهندسين');

    const billed = boardRow({}, { name: 'فرع المهندسين', bankId: 'bank-a' }, null);
    expect(branchCell(billed, 'origin', bankNameOf)).toEqual({
      bank: null,
      branch: 'فرع المهندسين',
    });
    expect(branchCellText(billed, 'origin', bankNameOf)).toBe('فرع المهندسين');
  });

  it('is empty text for a branch that could not be resolved — the «…» is not searchable', () => {
    const lost = boardRow({}, null, null);
    expect(branchCell(lost, 'origin', bankNameOf)).toEqual({ bank: null, branch: null });
    expect(branchCellText(lost, 'origin', bankNameOf)).toBe('');
  });

  it('treats a bank the server could not name (`bankName: ""`) as no bank, not an empty line', () => {
    // `bank-gone` is in no catalog, so the row arrives with `bankName: ''` on that branch.
    const unnamedOrigin = boardRow({}, { name: 'فرع شبرا', bankId: 'bank-gone' }, null);
    expect(branchCell(unnamedOrigin, 'origin', bankNameOf)).toEqual({
      bank: null,
      branch: 'فرع شبرا',
    });

    // On the destination side, the secondary bank is tried next, as for a missing branch.
    const unnamedDestination = boardRow({ secondaryBankId: 'bank-b' }, null, {
      name: 'فرع الدقي',
      bankId: 'bank-gone',
    });
    expect(branchCell(unnamedDestination, 'destination', bankNameOf)).toEqual({
      bank: 'مصر',
      branch: 'فرع الدقي',
    });
  });
});

describe('filterDayBoard over board rows — «من فرع» / «الى فرع» match what the cell SHOWS', () => {
  // Billed to الأهلي, except `same`, which is billed to مصر: whether a cell prints a bank depends
  // on the billed bank as much as on the branch's own.
  const crossBank = boardRow(
    { id: 'cross', secondaryBankId: 'bank-b' },
    { name: 'فرع المهندسين', bankId: 'bank-a' },
    { name: 'فرع الدقي', bankId: 'bank-b' },
  );
  const sameBankDestination = boardRow(
    { id: 'same', mainBankId: 'bank-b', secondaryBankId: 'bank-b' },
    { name: 'فرع العتبة', bankId: 'bank-b' },
    { name: 'فرع الزمالك', bankId: 'bank-b' },
  );
  const otherOrigin = boardRow(
    { id: 'other-origin' },
    { name: 'فرع شبرا', bankId: 'bank-b' },
    { name: 'فرع الدقي', bankId: 'bank-a' },
  );
  const rows = [crossBank, sameBankDestination, otherOrigin];
  const board = (over: Partial<typeof EMPTY_DAY_BOARD_FILTERS>) =>
    filterDayBoard(rows, { ...EMPTY_DAY_BOARD_FILTERS, ...over }, bankNameOf, (row, side) =>
      branchCellText(row, side, bankNameOf),
    ).map((r) => r.id);

  it('finds a cross-bank row by the destination bank printed above its branch', () => {
    expect(board({ destination: 'مصر' })).toEqual(['cross']);
  });

  it('does NOT find a same-bank row by its destination bank — its cell does not print it', () => {
    // `same` goes to a مصر branch too, but its main bank IS مصر, so the cell shows the branch only.
    expect(board({ destination: 'مصر' })).not.toContain('same');
    expect(board({ destination: 'الزمالك' })).toEqual(['same']);
  });

  it('finds a row by the origin bank exactly when the origin cell prints it', () => {
    // `other-origin` was collected from a مصر branch while billed to الأهلي: printed, so found.
    // `same` collects from a مصر branch billed to مصر: not printed, so not found.
    // `cross` collects from a الأهلي branch billed to الأهلي: no bank printed; «أهل» finds none.
    expect(board({ origin: 'مصر' })).toEqual(['other-origin']);
    expect(board({ origin: 'أهل' })).toEqual([]);
  });

  it('still matches by the branch name on either side', () => {
    expect(board({ origin: 'المهندسين' })).toEqual(['cross']);
    expect(board({ destination: 'الدقي' })).toEqual(['cross', 'other-origin']);
  });
});

describe('orderedBoardTotals — the figures, in the legacy strip’s order', () => {
  const CURRENCIES: Record<string, { code: string; name: string }> = {
    egp: { code: 'EGP', name: 'مصري' },
    usd: { code: 'USD', name: 'دولار' },
    eur: { code: 'EUR', name: 'يورو' },
    sar: { code: 'SAR', name: 'ريال' },
  };
  const currencyOf = (id: string) => CURRENCIES[id];
  const ids = (rows: OperationsShipmentDto[]) =>
    orderedBoardTotals(rows, currencyOf).map((total) => total.currencyId);

  it('puts EGP first, then USD, then the rest by name, and a currency it cannot name last', () => {
    const rows = [
      shipment({
        lines: [
          { currencyId: 'gone', amount: 1 },
          { currencyId: 'eur', amount: 7 },
          { currencyId: 'usd', amount: 40 },
        ],
      }),
      shipment({
        lines: [
          { currencyId: 'sar', amount: 3 },
          { currencyId: 'egp', amount: 1000 },
        ],
      }),
    ];
    // ريال before يورو by name; `gone` is not in the catalog.
    expect(ids(rows)).toEqual(['egp', 'usd', 'sar', 'eur', 'gone']);
  });

  it('keeps each currency’s sum — ordering never merges or drops a figure', () => {
    const rows = [
      shipment({ lines: [{ currencyId: 'usd', amount: 40 }] }),
      shipment({ lines: [{ currencyId: 'egp', amount: 500 }] }),
      shipment({ lines: [{ currencyId: 'egp', amount: 250 }] }),
    ];
    expect(orderedBoardTotals(rows, currencyOf)).toEqual([
      { currencyId: 'egp', amount: 750 },
      { currencyId: 'usd', amount: 40 },
    ]);
  });

  it('is computed over the rows it is GIVEN — the page passes the filtered rows', () => {
    const ahly = shipment({ id: 'a', lines: [{ currencyId: 'egp', amount: 100 }] });
    const misr = shipment({
      id: 'b',
      mainBankId: 'bank-b',
      lines: [
        { currencyId: 'egp', amount: 900 },
        { currencyId: 'usd', amount: 5 },
      ],
    });
    const shown = run([ahly, misr], { bank: 'أهل' });
    expect(orderedBoardTotals(shown, currencyOf)).toEqual([{ currencyId: 'egp', amount: 100 }]);
    expect(orderedBoardTotals([ahly, misr], currencyOf)).toEqual([
      { currencyId: 'egp', amount: 1000 },
      { currencyId: 'usd', amount: 5 },
    ]);
  });

  it('keeps the first-seen order while the catalog has not loaded — nothing to rank by', () => {
    const rows = [
      shipment({
        lines: [
          { currencyId: 'usd', amount: 1 },
          { currencyId: 'egp', amount: 2 },
        ],
      }),
    ];
    const unranked = orderedBoardTotals(rows, () => undefined);
    expect(unranked.map((total) => total.currencyId)).toEqual(['usd', 'egp']);
  });
});
