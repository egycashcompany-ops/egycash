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
  compareCurrencies,
  currencyKind,
  currencyOfKind,
  currencyOrder,
  currencyUnit,
  otherCurrencies,
  readDayBoardFilters,
  rowTint,
  saysDelivered,
  boardFilterParams,
  offeredFilters,
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
        : {
            id: 'branch-1',
            name: 'فرع المهندسين',
            code: 'B1',
            bankId: originBankId,
            bankName: 'x',
          },
    destination: null,
    crew: null,
    captainDeliveredAt: null,
    securedStage: null,
    pickedUpBy: null,
    pickedUpAt: null,
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
    securedStage: null,
    pickedUpBy: null,
    pickedUpAt: null,
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

// «ترتيب العملات فى الجدول لما تظهر تكون على حسب ترتيبها ف شاشة البيانات المرجعية» — the catalog's
// dragged order, the server's `byCatalogOrder` exactly (currency.service.ts).
describe('compareCurrencies / currencyOrder — the catalog’s order', () => {
  const at = (id: string, code: string, name: string, sortOrder: number | null) => ({
    id,
    code,
    name,
    sortOrder,
  });

  it('puts the dragged places first, in their order, and a currency nobody placed after them', () => {
    const catalog = [
      at('egp', '1', 'مصري', 2),
      at('usd', '2', 'دولار', 0),
      at('new', '0', 'جديدة', null),
      at('eur', '3', 'يورو', 1),
    ];
    expect([...catalog].sort(compareCurrencies).map((c) => c.id)).toEqual([
      'usd',
      'eur',
      'egp',
      'new',
    ]);
  });

  it('reads the codes as numbers while nobody has arranged the list — «2» before «10»', () => {
    const catalog = [
      at('ten', '10', 'عشرة', null),
      at('two', '2', 'اثنان', null),
      at('one', '1', 'واحد', null),
      at('eur', 'EUR', 'يورو', null),
    ];
    // Text order would put «10» before «2»; a person reads 1, 2, 10. Digits sort before letters.
    expect([...catalog].sort(compareCurrencies).map((c) => c.id)).toEqual([
      'one',
      'two',
      'ten',
      'eur',
    ]);
  });

  it('settles a tie on the place and the code by the name', () => {
    expect(compareCurrencies(at('a', 'X', 'يورو', 1), at('b', 'X', 'دولار', 1))).toBeGreaterThan(0);
    expect(compareCurrencies(at('a', 'X', 'دولار', 1), at('a', 'X', 'دولار', 1))).toBe(0);
  });

  it('orders ids by it, an id the catalog does not hold last, ties in the caller’s order', () => {
    const order = currencyOrder([
      at('egp', '1', 'مصري', 1),
      at('usd', '2', 'دولار', 0),
      at('eur', '3', 'يورو', null),
    ]);
    expect(['gone', 'egp', 'other-gone', 'eur', 'usd'].sort(order)).toEqual([
      'usd',
      'egp',
      'eur',
      'gone',
      'other-gone',
    ]);
  });

  it('changes nothing over an empty catalog — every id is unknown alike', () => {
    expect(['usd', 'egp', 'eur'].sort(currencyOrder([]))).toEqual(['usd', 'egp', 'eur']);
  });
});

describe('orderedBoardTotals — a row’s money, in the catalog’s order', () => {
  const CURRENCIES: Record<string, { code: string; name: string; sortOrder?: number | null }> = {
    egp: { code: 'EGP', name: 'مصري', sortOrder: 1 },
    usd: { code: 'USD', name: 'دولار', sortOrder: 0 },
    eur: { code: 'EUR', name: 'يورو', sortOrder: null },
    sar: { code: 'SAR', name: 'ريال', sortOrder: 2 },
  };
  const currencyOf = (id: string) => CURRENCIES[id];
  const ids = (rows: OperationsShipmentDto[]) =>
    orderedBoardTotals(rows, currencyOf).map((total) => total.currencyId);

  it('follows the catalog’s places — not the pound first — and a currency it cannot name last', () => {
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
    // The dollar was dragged above the pound; the euro has no place, so it follows every placed
    // one; `gone` is not in the catalog.
    expect(ids(rows)).toEqual(['usd', 'egp', 'sar', 'eur', 'gone']);
  });

  it('keeps each currency’s sum — ordering never merges or drops a figure', () => {
    const rows = [
      shipment({ lines: [{ currencyId: 'usd', amount: 40 }] }),
      shipment({ lines: [{ currencyId: 'egp', amount: 500 }] }),
      shipment({ lines: [{ currencyId: 'egp', amount: 250 }] }),
    ];
    expect(orderedBoardTotals(rows, currencyOf)).toEqual([
      { currencyId: 'usd', amount: 40 },
      { currencyId: 'egp', amount: 750 },
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
      { currencyId: 'usd', amount: 5 },
      { currencyId: 'egp', amount: 1000 },
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
      filterDayBoard(rows, { ...EMPTY_DAY_BOARD_FILTERS, received }, bankNameOf, (row, side) =>
        branchNameOf(side === 'origin' ? row.originBranchId : row.destinationBranchId),
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
    shipment({
      lines: [
        { currencyId: 'egp', amount: 12_000_000 },
        { currencyId: 'gbp', amount: 60_000 },
      ],
    }),
    shipment({
      lines: [
        { currencyId: 'usd', amount: 100_000 },
        { currencyId: 'eur', amount: 30_000 },
      ],
    }),
  ];

  it('keeps the pound and the dollar apart, and sums every other currency into one figure', () => {
    const figures = boardFigures(rows, currencyOf);
    expect(figures.egp).toBe(12_000_000);
    expect(figures.usd).toBe(100_000);
    // Legacy's «عملات أجنبية»: every currency but the pound and the dollar (main_ops.ejs:3309).
    expect(figures.othersSum).toBe(90_000);
  });

  it('lists the others each on its own, in the catalog’s order — what «عملات أخرى» opens on', () => {
    // Nobody has placed these two, so the codes decide: EUR before GBP.
    expect(boardFigures(rows, currencyOf).others).toEqual([
      { currencyId: 'eur', amount: 30_000 },
      { currencyId: 'gbp', amount: 60_000 },
    ]);
  });

  it('is all zeros for an empty board, and counts an unnamed currency with the others', () => {
    expect(boardFigures([], currencyOf)).toEqual({ egp: 0, usd: 0, others: [], othersSum: 0 });
    const unknown = boardFigures(
      [shipment({ lines: [{ currencyId: 'xyz', amount: 5 }] })],
      currencyOf,
    );
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
    for (const name of [
      'مصرى',
      'جنية',
      'جنيه مصرى',
      'الجنيه المصرى',
      'L.E',
      'LE',
      'ج.م',
      'ج. م',
      'E£',
    ]) {
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

  it('orders a row’s money by the catalog’s codes, read as numbers, until somebody drags it', () => {
    const more = [...rows, shipment({ lines: [{ currencyId: 'sar', amount: 9 }] })];
    // «1» مصري, «2» دولار, «3» يورو, «4» ريال سعودي — the order the owner typed them in.
    expect(orderedBoardTotals(more, currencyOf).map((total) => total.currencyId)).toEqual([
      'egp',
      'usd',
      'eur',
      'sar',
    ]);
  });

  it('follows the order dragged on the reference-data screen once there is one', () => {
    const dragged = (id: string) => {
      const places: Record<string, number> = { sar: 0, eur: 1, usd: 2, egp: 3 };
      const currency = PRODUCTION[id];
      return currency === undefined ? undefined : { ...currency, sortOrder: places[id] ?? null };
    };
    const more = [...rows, shipment({ lines: [{ currencyId: 'sar', amount: 9 }] })];
    expect(orderedBoardTotals(more, dragged).map((total) => total.currencyId)).toEqual([
      'sar',
      'eur',
      'usd',
      'egp',
    ]);
    // The pills do not move: the pound and the dollar are still the pound and the dollar.
    const figures = boardFigures(more, dragged);
    expect([figures.egp, figures.usd]).toEqual([55_000_000, 300_000]);
    expect(figures.others.map((total) => total.currencyId)).toEqual(['sar', 'eur']);
  });
});

describe('otherCurrencies — what the «عملات أخرى» dialog shows', () => {
  // Arranged on the reference-data screen: the riyal dragged first, the euro — the largest sum
  // here — last.
  const CATALOG: Record<string, { code: string; name: string; sortOrder: number | null }> = {
    egp: { code: '1', name: 'مصري', sortOrder: 1 },
    usd: { code: '2', name: 'دولار', sortOrder: 2 },
    eur: { code: '3', name: 'يورو', sortOrder: 4 },
    gbp: { code: 'GBP', name: 'جنيه استرليني', sortOrder: 3 },
    sar: { code: 'SAR', name: 'ريال', sortOrder: 0 },
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

  it('lists them in the catalog’s order, as every list of currencies reads — not by size', () => {
    // يورو is 75,000 of the 105,000, yet it was dragged last; ريال was dragged first.
    expect(result.cards.map((card) => card.currencyId)).toEqual(['sar', 'gbp', 'eur']);
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
    expect(result.cards.find((card) => card.currencyId === 'eur')?.share).toBeCloseTo(
      75_000 / 105_000,
    );
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
    // ملاحظات — the day is the page's, not a filter. «الحالة» is a param per board: the delivery
    // (the day board and the history), the محصنة's stage (the secured screen) — and, on the vault's
    // board since Round 13, one per status column: «حالة الاستلام» (`pickup`) and «حالة الخزينة»
    // (`vault`), in that order as the columns are.
    expect([...DAY_BOARD_FILTER_PARAMS]).toEqual([
      'vehicle',
      'bank',
      'origin',
      'destination',
      'area',
      'captain',
      'type',
      'received',
      'stage',
      'pickup',
      'vault',
      'notes',
    ]);
  });

  it('reads every filter from its param', () => {
    const params = new URLSearchParams(
      'vehicle=150&bank=أهل&origin=a&destination=b&area=c&captain=d&type=secured&received=no&stage=inVault&pickup=captain&vault=waiting&notes=e&date=2026-11-01',
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
      stage: 'inVault',
      pickup: 'captain',
      vault: 'waiting',
      notes: 'e',
    });
    expect(readDayBoardFilters(new URLSearchParams())).toEqual(EMPTY_DAY_BOARD_FILTERS);
  });

  it('reads a hand-edited select value as no filter, not as one nothing matches', () => {
    const filters = readDayBoardFilters(
      new URLSearchParams('type=all&received=maybe&stage=lost&pickup=vault&vault=draft'),
    );
    expect(filters.type).toBe('');
    expect(filters.received).toBe('');
    expect(filters.stage).toBe('');
    // The vault's two boxes answer in their own words — a shipment status or a stage is not one.
    expect(filters.pickup).toBe('');
    expect(filters.vault).toBe('');
  });

  // A param with no box on screen must not narrow the table: the day board offers «التسليم» and
  // not the stage; the secured screen the stage, and neither «التسليم» nor «النوع» (every row on
  // it is a محصنة); the vault's board (Round 13) its two status columns' boxes in the stage's place.
  // The vault's two boxes are no other board's — those boards are as they were.
  it('reads only the filters a board offers, and a page remembers exactly those', () => {
    const all = {
      ...EMPTY_DAY_BOARD_FILTERS,
      type: 'daily' as const,
      received: 'yes' as const,
      stage: 'inVault' as const,
      pickup: 'none' as const,
      vault: 'inVault' as const,
      bank: 'أهل',
    };
    expect(offeredFilters(all, 'shipments')).toEqual({ ...all, stage: '', pickup: '', vault: '' });
    expect(offeredFilters(all, 'secured')).toEqual({
      ...all,
      type: '',
      received: '',
      pickup: '',
      vault: '',
    });
    expect(offeredFilters(all, 'vault')).toEqual({ ...all, type: '', received: '', stage: '' });
    expect(boardFilterParams('shipments')).toEqual([
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
    expect(boardFilterParams('secured')).toEqual([
      'vehicle',
      'bank',
      'origin',
      'destination',
      'area',
      'captain',
      'stage',
      'notes',
    ]);
    expect(boardFilterParams('vault')).toEqual([
      'vehicle',
      'bank',
      'origin',
      'destination',
      'area',
      'captain',
      'pickup',
      'vault',
      'notes',
    ]);
  });

  // The vault queue offers «لم يتم التسليم» only with «الكل»: a stage its box does not offer is
  // read as no stage, rather than as a filter nothing on screen explains.
  it('reads a stage the board’s box does not offer as no stage', () => {
    const waiting = { ...EMPTY_DAY_BOARD_FILTERS, stage: 'awaitingPickup' as const, bank: 'أهل' };
    expect(offeredFilters(waiting, 'secured', ['withCaptain', 'inVault'])).toEqual({
      ...waiting,
      stage: '',
    });
    expect(offeredFilters(waiting, 'secured', ['awaitingPickup', 'withCaptain'])).toEqual(waiting);
    // No list given: every stage is read, as before.
    expect(offeredFilters(waiting, 'secured')).toEqual(waiting);
  });
});

// «اليوم التشغيلى هيظهر فيها اليومى والمحصنة اللى اليوم بتاعها فى اليوم اللى هتخرج فيه»: a محصنة is on
// the day board whatever its stage, and its status cell reads the stage — so «التسليم» must answer
// for it by what that cell says, and the secured screen's «الحالة» by the stage itself.
describe('the status filters over secured rows', () => {
  const at = '2026-11-10T09:30:00.000Z';
  const row = (
    id: string,
    over: Partial<OperationsShipmentDto>,
    extra: Partial<OperationsDayBoardShipmentDto>,
  ): OperationsDayBoardShipmentDto => ({
    ...shipment({ id, ...over }),
    origin: null,
    destination: null,
    crew: null,
    captainDeliveredAt: null,
    securedStage: null,
    pickedUpBy: null,
    pickedUpAt: null,
    ...extra,
  });
  const ROWS = [
    row('daily-waiting', {}, {}),
    row('daily-captain', {}, { captainDeliveredAt: at }),
    row('daily-desk', { status: 'completed' }, {}),
    row('s-awaiting', { shipmentType: 'secured' }, { securedStage: 'awaitingPickup' }),
    row(
      's-captain',
      { shipmentType: 'secured' },
      { securedStage: 'withCaptain', pickedUpBy: 'captain', pickedUpAt: at },
    ),
    // Round 10 — the desk confirmed the pickup instead: «تم الاستلام من العمليات», yellow too.
    row(
      's-operations',
      { shipmentType: 'secured' },
      { securedStage: 'withOperations', pickedUpBy: 'operations', pickedUpAt: at },
    ),
    row('s-vault', { shipmentType: 'secured', status: 'inVault' }, { securedStage: 'inVault' }),
    // On the road, not delivered yet — «خرجت للتسليم».
    row(
      's-road',
      { shipmentType: 'secured', status: 'dispatched' },
      { securedStage: 'dispatched' },
    ),
    // On the road, and its delivery captain has pressed «تم التسليم» in the app — the cell says
    // «تم التسليم» on a yellow row, as a daily row the captain delivered (`shownStage`), and its
    // stage is still `dispatched`.
    row(
      's-road-captain',
      { shipmentType: 'secured', status: 'dispatched' },
      { securedStage: 'dispatched', captainDeliveredAt: at },
    ),
    row('s-done', { shipmentType: 'secured', status: 'completed' }, { securedStage: 'completed' }),
  ];
  const ids = (over: Partial<typeof EMPTY_DAY_BOARD_FILTERS>): string[] =>
    filterDayBoard(ROWS, { ...EMPTY_DAY_BOARD_FILTERS, ...over }, bankNameOf, () => '').map(
      (r) => r.id,
    );

  it('«تم التسليم» finds a محصنة only once it is delivered — its cell says so then, and only then', () => {
    expect(ids({ received: 'yes' })).toEqual([
      'daily-captain',
      'daily-desk',
      's-road-captain',
      's-done',
    ]);
    expect(ids({ received: 'no' })).toEqual([
      'daily-waiting',
      's-awaiting',
      's-captain',
      's-operations',
      's-vault',
      's-road',
    ]);
  });

  it('saysDelivered reads the stage of a secured row and who delivered a daily one', () => {
    expect(saysDelivered({ status: 'draft', securedStage: 'withCaptain' })).toBe(false);
    expect(saysDelivered({ status: 'draft', securedStage: 'withOperations' })).toBe(false);
    expect(saysDelivered({ status: 'dispatched', securedStage: 'dispatched' })).toBe(false);
    // Its delivery captain delivered it from the app: «تم التسليم» on a yellow row, as a daily row.
    expect(
      saysDelivered({ status: 'dispatched', securedStage: 'dispatched', captainDeliveredAt: at }),
    ).toBe(true);
    // Before it leaves the vault, no captain's «delivered» can make it say so.
    expect(
      saysDelivered({ status: 'inVault', securedStage: 'inVault', captainDeliveredAt: at }),
    ).toBe(false);
    expect(saysDelivered({ status: 'completed', securedStage: 'completed' })).toBe(true);
    // No stage (a daily row, or a plain shipment): the daily rule.
    expect(saysDelivered({ status: 'draft', securedStage: null, captainDeliveredAt: at })).toBe(
      true,
    );
    expect(saysDelivered({ status: 'draft' })).toBe(false);
  });

  it('the stage filter keeps that one stage — and no daily row, which has none', () => {
    expect(ids({ stage: 'withCaptain' })).toEqual(['s-captain']);
    // The two yellows are two stages: the desk's pickup is found apart from the captain's.
    expect(ids({ stage: 'withOperations' })).toEqual(['s-operations']);
    expect(ids({ stage: 'inVault' })).toEqual(['s-vault']);
    expect(ids({ stage: 'awaitingPickup' })).toEqual(['s-awaiting']);
    // The stage is the server's: one its delivery captain delivered is still on the road.
    expect(ids({ stage: 'dispatched' })).toEqual(['s-road', 's-road-captain']);
    // A plain shipment carries no stage to match.
    expect(run([shipment({ shipmentType: 'secured' })], { stage: 'awaitingPickup' })).toEqual([]);
  });

  it('a stage narrows the board as any filter does', () => {
    expect(hasActiveFilter({ ...EMPTY_DAY_BOARD_FILTERS, stage: 'dispatched' })).toBe(true);
  });

  // Round 13 — «مكان الحاله عمودين»: the vault's board asks each of its two status columns its own
  // question, on what that column's cell says. A receipt nobody handed over — in the vault with
  // nobody's ✓ — answers both: «لم يتم الاستلام» AND «بالخزينة».
  describe('the vault board’s two status filters', () => {
    const DIRECT = row(
      's-direct',
      { shipmentType: 'secured', status: 'inVault' },
      { securedStage: 'inVault', pickedUpBy: null },
    );
    const VAULT_ROWS = [
      ...ROWS.filter((r) => r.shipmentType === 'secured'),
      DIRECT,
      // Received after the captain's ✓ and sent out since: his pickup still says it was his.
      row(
        's-captain-out',
        { shipmentType: 'secured', status: 'dispatched' },
        { securedStage: 'dispatched', pickedUpBy: 'captain', pickedUpAt: at },
      ),
    ];
    const vaultIds = (over: Partial<typeof EMPTY_DAY_BOARD_FILTERS>): string[] =>
      filterDayBoard(VAULT_ROWS, { ...EMPTY_DAY_BOARD_FILTERS, ...over }, bankNameOf, () => '').map(
        (r) => r.id,
      );

    it('«حالة الاستلام» finds by who collected it — the record, whatever the vault did since', () => {
      expect(vaultIds({ pickup: 'captain' })).toEqual(['s-captain', 's-captain-out']);
      expect(vaultIds({ pickup: 'operations' })).toEqual(['s-operations']);
      expect(vaultIds({ pickup: 'none' })).toContain('s-direct');
      expect(vaultIds({ pickup: 'none' })).toContain('s-awaiting');
      expect(vaultIds({ pickup: 'none' })).not.toContain('s-captain');
    });

    it('«حالة الخزينة» finds by the vault’s side — every draft is «لم تُستلم بعد», white or yellow', () => {
      expect(vaultIds({ vault: 'waiting' })).toEqual(['s-awaiting', 's-captain', 's-operations']);
      expect(vaultIds({ vault: 'inVault' })).toEqual(['s-vault', 's-direct']);
      expect(vaultIds({ vault: 'dispatched' })).toEqual([
        's-road',
        's-road-captain',
        's-captain-out',
      ]);
      expect(vaultIds({ vault: 'completed' })).toEqual(['s-done']);
    });

    it('asks both questions together — the receipts nobody handed over', () => {
      expect(vaultIds({ pickup: 'none', vault: 'inVault' })).toEqual(['s-vault', 's-direct']);
      expect(vaultIds({ pickup: 'captain', vault: 'waiting' })).toEqual(['s-captain']);
    });

    it('narrows the board as any filter does, and the reset clears them', () => {
      expect(hasActiveFilter({ ...EMPTY_DAY_BOARD_FILTERS, pickup: 'none' })).toBe(true);
      expect(hasActiveFilter({ ...EMPTY_DAY_BOARD_FILTERS, vault: 'waiting' })).toBe(true);
      expect(DAY_BOARD_FILTER_PARAMS).toContain('pickup');
      expect(DAY_BOARD_FILTER_PARAMS).toContain('vault');
    });
  });
});
