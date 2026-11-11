// The daily board's client-side decisions, asserted directly.
//
// These are the behaviours the legacy screen implemented in browser JavaScript over rendered HTML
// (main_ops.ejs:966-1010) — including reading a row's background colour to decide whether it was
// received. They are preserved as behaviour and replaced as implementation, so each one is pinned
// here against the shipment's actual fields.
import { describe, expect, it } from 'vitest';
import { type OperationsDayBoardShipmentDto, type OperationsShipmentDto } from '@ecms/contracts';
import {
  DAY_BOARD_FILTER_PARAMS,
  EMPTY_DAY_BOARD_FILTERS,
  boardDateOf,
  boardDelivery,
  boardFigures,
  boardTotals,
  currencyKind,
  currencyOfKind,
  currencyUnit,
  otherCurrencies,
  readDayBoardFilters,
  rowTint,
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
  receiptImage: null,
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
    captainDeliveredAt: null,
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
    captainDeliveredAt: null,
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

describe('boardDelivery — who delivered: «القائد» yellow, «المكتب» green', () => {
  const at = '2026-11-10T09:30:00.000Z';

  it('is the desk once the shipment is completed — whatever the captain did', () => {
    expect(boardDelivery({ status: 'completed', captainDeliveredAt: null })).toBe('desk');
    expect(boardDelivery({ status: 'completed', captainDeliveredAt: at })).toBe('desk');
  });

  it('is the captain when the leg is delivered and the desk has not confirmed', () => {
    expect(boardDelivery({ status: 'draft', captainDeliveredAt: at })).toBe('captain');
    expect(boardDelivery({ status: 'dispatched', captainDeliveredAt: at })).toBe('captain');
  });

  it('is nobody otherwise — and a plain shipment has no captain fact at all', () => {
    expect(boardDelivery({ status: 'draft', captainDeliveredAt: null })).toBe('none');
    expect(boardDelivery({ status: 'draft' })).toBe('none');
  });

  // «التسليم» filters on what the status column says, and it says «تم التسليم» for both.
  it('counts a captain’s delivery as delivered in the «التسليم» filter', () => {
    const rows = [
      { ...shipment({ id: 'waiting' }), captainDeliveredAt: null },
      { ...shipment({ id: 'captain' }), captainDeliveredAt: at },
      { ...shipment({ id: 'desk', status: 'completed' }), captainDeliveredAt: null },
    ];
    const by = (received: 'yes' | 'no') =>
      filterDayBoard(
        rows,
        { ...EMPTY_DAY_BOARD_FILTERS, received },
        bankNameOf,
        (row, side) => branchNameOf(side === 'origin' ? row.originBranchId : row.destinationBranchId),
      ).map((r) => r.id);
    expect(by('yes')).toEqual(['captain', 'desk']);
    expect(by('no')).toEqual(['waiting']);
  });
});

describe('boardFigures — «مصري», «دولار», then «عملات أخرى»', () => {
  const CURRENCIES: Record<string, { code: string; name: string }> = {
    egp: { code: 'EGP', name: 'مصري' },
    usd: { code: 'USD', name: 'دولار' },
    eur: { code: 'EUR', name: 'يورو' },
    gbp: { code: 'GBP', name: 'جنيه استرليني' },
  };
  const currencyOf = (id: string) => CURRENCIES[id];
  const rows = [
    shipment({ lines: [{ currencyId: 'egp', amount: 12_000_000 }, { currencyId: 'gbp', amount: 60_000 }] }),
    shipment({ lines: [{ currencyId: 'usd', amount: 100_000 }, { currencyId: 'eur', amount: 30_000 }] }),
  ];

  it('keeps the pound and the dollar apart, and sums every other currency into one figure', () => {
    const figures = boardFigures(rows, currencyOf);
    expect(figures.egp).toBe(12_000_000);
    expect(figures.usd).toBe(100_000);
    // Legacy's «عملات أجنبية»: every currency but the pound and the dollar (main_ops.ejs:3309).
    expect(figures.othersSum).toBe(90_000);
  });

  it('lists the others each on its own, by name — what a click on «عملات أخرى» shows', () => {
    expect(boardFigures(rows, currencyOf).others).toEqual([
      { currencyId: 'gbp', amount: 60_000 },
      { currencyId: 'eur', amount: 30_000 },
    ]);
  });

  it('is all zeros for an empty board, and counts an unnamed currency with the others', () => {
    expect(boardFigures([], currencyOf)).toEqual({ egp: 0, usd: 0, others: [], othersSum: 0 });
    const unknown = boardFigures([shipment({ lines: [{ currencyId: 'xyz', amount: 5 }] })], currencyOf);
    expect(unknown.othersSum).toBe(5);
  });
});

// «لو تم التسليم من القائد … الصف لونه اصفر ولما ادوس انا على صح من عندى يبقى الصف اخضر».
describe('rowTint — yellow for the captain, green for the desk', () => {
  it('is green (emerald) once the desk confirmed', () => {
    expect(rowTint('desk')).toContain('emerald');
  });
  it('is yellow (amber) while only the captain has delivered', () => {
    const tint = rowTint('captain') ?? '';
    expect(tint).toMatch(/amber|yellow/);
    expect(tint).not.toContain('emerald');
  });
  it('is no colour before either', () => {
    expect(rowTint('none')).toBeUndefined();
  });
});

// «فى مشكلة فى حسبة العملات بيحسب اى حاجه عملات اخرى لا انا عاوز المصرى لوحده الدولار لوحده و اى
// حاجه غير الاتنين دول يتحسب عملات اخرى». Production showed «مصري 0 EGP», «دولار 0 USD» and «عملات
// أخرى 55,750,000»: its catalog codes are the legacy numbers «1», «2», «3», and the figures knew
// the pound and the dollar by the codes EGP and USD alone.
describe('currencyKind — the pound and the dollar by code, name or legacy alias', () => {
  const cur = (code: string, name: string, legacyAliases: string[] = []) => ({
    code,
    name,
    legacyAliases,
  });

  it('knows the production catalog, whose codes are legacy numbers', () => {
    expect(currencyKind(cur('1', 'مصري'))).toBe('pound');
    expect(currencyKind(cur('2', 'دولار'))).toBe('dollar');
    expect(currencyKind(cur('3', 'يورو'))).toBe('other');
  });

  it('knows the ISO codes whatever the name says', () => {
    expect(currencyKind(cur('EGP', 'الجنيه'))).toBe('pound');
    expect(currencyKind(cur('egp', 'Pound'))).toBe('pound');
    expect(currencyKind(cur('USD', 'Greenback'))).toBe('dollar');
  });

  it('knows a currency by a legacy alias alone', () => {
    expect(currencyKind(cur('7', 'عملة محلية', ['جنيه مصري']))).toBe('pound');
    expect(currencyKind(cur('8', 'عملة أجنبية', ['USD']))).toBe('dollar');
  });

  it('reads the spellings an Egyptian typist uses — hamza, ى/ي, ة/ه, the dots', () => {
    for (const name of ['مصرى', 'جنية', 'جنيه مصرى', 'الجنيه المصرى', 'L.E', 'LE', 'ج.م', 'ج. م', 'E£']) {
      expect(currencyKind(cur('x', name)), name).toBe('pound');
    }
    for (const name of ['الدولار', 'دولار أمريكى', 'الدولار الأمريكي', 'US$', '$', 'U.S. Dollar']) {
      expect(currencyKind(cur('x', name)), name).toBe('dollar');
    }
  });

  it('reads a name pasted with a no-break space or a tab as the words it is', () => {
    // `fold` keeps only the plain space; a no-break space (Excel, Word) or a tab between the words
    // must not glue «جنيه مصري» into «جنيهمصري», which spells nothing.
    expect(currencyKind(cur('1', 'جنيه\u00A0مصري'))).toBe('pound');
    expect(currencyKind(cur('1', 'الجنيه\tالمصري'))).toBe('pound');
    expect(currencyKind(cur('2', 'دولار\u00A0أمريكي'))).toBe('dollar');
    expect(currencyKind(cur('2', 'US\u00A0Dollar'))).toBe('dollar');
    // …and still whole: sterling with a no-break space is sterling.
    expect(currencyKind(cur('4', 'جنيه\u00A0استرليني'))).toBe('other');
  });

  it('compares WHOLE values — pound sterling and the Canadian dollar are other currencies', () => {
    expect(currencyKind(cur('GBP', 'جنيه استرليني'))).toBe('other');
    expect(currencyKind(cur('4', 'جنيه استرلينى'))).toBe('other');
    expect(currencyKind(cur('CAD', 'دولار كندي'))).toBe('other');
    expect(currencyKind(cur('AUD', 'Australian dollar'))).toBe('other');
    // «us» is what fold leaves of «US$» — not a currency on its own.
    expect(currencyKind(cur('9', 'US'))).toBe('other');
  });

  it('counts a contradiction with the others rather than guessing', () => {
    expect(currencyKind(cur('2', 'دولار', ['EGP']))).toBe('other');
  });

  it('counts a currency the catalog cannot name yet with the others', () => {
    expect(currencyKind(undefined)).toBe('other');
  });

  it('finds the catalog’s pound and dollar for the pills’ labels', () => {
    const catalog = [cur('3', 'يورو'), cur('2', 'دولار'), cur('1', 'مصري')];
    expect(currencyOfKind(catalog, 'pound')?.name).toBe('مصري');
    expect(currencyOfKind(catalog, 'dollar')?.name).toBe('دولار');
    expect(currencyOfKind([cur('3', 'يورو')], 'pound')).toBeUndefined();
  });

  it('prints only an alphabetic code as a unit — never a legacy number', () => {
    expect(currencyUnit({ code: 'EUR' })).toBe('EUR');
    expect(currencyUnit({ code: 'gbp' })).toBe('GBP');
    expect(currencyUnit({ code: '3' })).toBe('');
    expect(currencyUnit({ code: '٣' })).toBe('');
    expect(currencyUnit({ code: 'يورو' })).toBe('');
    expect(currencyUnit(undefined)).toBe('');
  });
});

describe('the figures over the production catalog', () => {
  const PRODUCTION: Record<string, { code: string; name: string; legacyAliases: string[] }> = {
    egp: { code: '1', name: 'مصري', legacyAliases: [] },
    usd: { code: '2', name: 'دولار', legacyAliases: [] },
    eur: { code: '3', name: 'يورو', legacyAliases: [] },
    sar: { code: '4', name: 'ريال سعودي', legacyAliases: [] },
  };
  const currencyOf = (id: string) => PRODUCTION[id];
  // The owner's screenshot: 55,000,000 مصري, 300,000 دولار, 450,000 يورو.
  const rows = [
    shipment({
      id: 'a',
      lines: [
        { currencyId: 'eur', amount: 450_000 },
        { currencyId: 'usd', amount: 300_000 },
        { currencyId: 'egp', amount: 55_000_000 },
      ],
    }),
  ];

  it('keeps the pound and the dollar apart, and «عملات أخرى» is the euro alone', () => {
    const figures = boardFigures(rows, currencyOf);
    expect(figures.egp).toBe(55_000_000);
    expect(figures.usd).toBe(300_000);
    expect(figures.others).toEqual([{ currencyId: 'eur', amount: 450_000 }]);
    expect(figures.othersSum).toBe(450_000);
  });

  it('orders a row’s money pound, dollar, then the rest by name', () => {
    const more = [...rows, shipment({ lines: [{ currencyId: 'sar', amount: 9 }] })];
    expect(orderedBoardTotals(more, currencyOf).map((total) => total.currencyId)).toEqual([
      'egp',
      'usd',
      'sar',
      'eur',
    ]);
  });
});

describe('otherCurrencies — what the «عملات أخرى» dialog shows', () => {
  const CATALOG: Record<string, { code: string; name: string }> = {
    egp: { code: '1', name: 'مصري' },
    usd: { code: '2', name: 'دولار' },
    eur: { code: '3', name: 'يورو' },
    gbp: { code: 'GBP', name: 'جنيه استرليني' },
    sar: { code: 'SAR', name: 'ريال' },
  };
  const currencyOf = (id: string) => CATALOG[id];
  const rows = [
    shipment({
      id: 'a',
      lines: [
        { currencyId: 'egp', amount: 1_000 },
        { currencyId: 'gbp', amount: 10_000 },
        { currencyId: 'gbp', amount: 5_000 },
      ],
    }),
    shipment({ id: 'b', lines: [{ currencyId: 'eur', amount: 60_000 }] }),
    shipment({
      id: 'c',
      lines: [
        { currencyId: 'eur', amount: 15_000 },
        { currencyId: 'sar', amount: 15_000 },
      ],
    }),
    shipment({ id: 'd', lines: [{ currencyId: 'usd', amount: 500 }] }),
  ];
  const result = otherCurrencies(rows, currencyOf);

  it('lists exactly the currencies the figure counted — never the pound or the dollar', () => {
    expect(result.cards.map((card) => card.currencyId).sort()).toEqual(['eur', 'gbp', 'sar']);
    expect(result.sum).toBe(boardFigures(rows, currencyOf).othersSum);
    expect(result.sum).toBe(105_000);
  });

  it('puts the largest first; equal sums keep the by-name order', () => {
    // يورو 75,000; جنيه استرليني 15,000 and ريال 15,000 tie — by name, جنيه before ريال.
    expect(result.cards.map((card) => card.currencyId)).toEqual(['eur', 'gbp', 'sar']);
  });

  it('counts the SHIPMENTS carrying each currency, not its lines', () => {
    const by = Object.fromEntries(result.cards.map((card) => [card.currencyId, card.shipments]));
    // Two pound-sterling lines on one shipment are one shipment.
    expect(by).toEqual({ eur: 2, gbp: 1, sar: 1 });
    // a, b and c carry some other currency; d carries only dollars.
    expect(result.shipments).toBe(3);
  });

  it('gives each its share of the figure', () => {
    const shares = result.cards.map((card) => card.share);
    expect(shares[0]).toBeCloseTo(75_000 / 105_000);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });

  it('is empty for rows with no other currency', () => {
    expect(otherCurrencies([rows[3]!], currencyOf)).toEqual({ cards: [], sum: 0, shipments: 0 });
  });
});

describe('the van filter — «ضيف كود العربيه ف الفلاتر»', () => {
  const VANS: Record<string, string | null> = { a: '150', b: 'ن ص 1237', c: null };
  const rows = [shipment({ id: 'a' }), shipment({ id: 'b' }), shipment({ id: 'c' })];
  const byVan = (vehicle: string) =>
    filterDayBoard(
      rows,
      { ...EMPTY_DAY_BOARD_FILTERS, vehicle },
      bankNameOf,
      branchTextOf,
      () => '',
      (row) => VANS[row.id] ?? '',
    ).map((r) => r.id);

  it('matches the code the «السيارة» column prints, by fragment', () => {
    expect(byVan('15')).toEqual(['a']);
    expect(byVan('237')).toEqual(['b']);
    expect(byVan('ن ص')).toEqual(['b']);
  });

  it('reads Arabic-Indic digits as the digits they are', () => {
    expect(byVan('١٥٠')).toEqual(['a']);
  });

  it('names several vans at once, as every vehicle-code box does', () => {
    expect(byVan('150 - 1237')).toEqual(['a', 'b']);
  });

  it('drops a row with no van yet, and narrows nothing when empty', () => {
    expect(byVan('1')).toEqual(['a', 'b']);
    expect(byVan('')).toEqual(['a', 'b', 'c']);
    expect(byVan('   ')).toEqual(['a', 'b', 'c']);
  });

  it('counts as a filter the reset can clear', () => {
    expect(hasActiveFilter({ ...EMPTY_DAY_BOARD_FILTERS, vehicle: '150' })).toBe(true);
  });
});

describe('the filters in the URL — «ارتب الفلاتر على حسب عواميد الجدول»', () => {
  it('names them in the table’s column order', () => {
    // السيارة | اسم البنك | من فرع | إلى فرع | المنطقة | قائد الطاقم | (التاريخ) | النوع | الحالة |
    // ملاحظات — the day is the page's, not a filter.
    expect([...DAY_BOARD_FILTER_PARAMS]).toEqual([
      'vehicle',
      'bank',
      'origin',
      'destination',
      'area',
      'captain',
      'type',
      'received',
      'notes',
    ]);
  });

  it('reads every filter from its param', () => {
    const params = new URLSearchParams(
      'vehicle=150&bank=أهل&origin=a&destination=b&area=c&captain=d&type=secured&received=no&notes=e&date=2026-11-01',
    );
    expect(readDayBoardFilters(params)).toEqual({
      vehicle: '150',
      bank: 'أهل',
      origin: 'a',
      destination: 'b',
      area: 'c',
      captain: 'd',
      type: 'secured',
      received: 'no',
      notes: 'e',
    });
    expect(readDayBoardFilters(new URLSearchParams())).toEqual(EMPTY_DAY_BOARD_FILTERS);
  });

  it('reads a hand-edited select value as no filter, not as one nothing matches', () => {
    const filters = readDayBoardFilters(new URLSearchParams('type=all&received=maybe'));
    expect(filters.type).toBe('');
    expect(filters.received).toBe('');
  });
});
