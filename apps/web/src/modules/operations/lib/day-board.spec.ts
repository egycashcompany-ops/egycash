// The daily board's client-side decisions, asserted directly.
//
// These are the behaviours the legacy screen implemented in browser JavaScript over rendered HTML
// (main_ops.ejs:966-1010) — including reading a row's background colour to decide whether it was
// received. They are preserved as behaviour and replaced as implementation, so each one is pinned
// here against the shipment's actual fields.
import { describe, expect, it } from 'vitest';
import { type OperationsShipmentDto } from '@ecms/contracts';
import {
  EMPTY_DAY_BOARD_FILTERS,
  boardDateOf,
  filterDayBoard,
  hasActiveFilter,
  isCrossBank,
  isReceived,
  legacyRowNumber,
  totalsByCurrency,
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
const run = (rows: OperationsShipmentDto[], over: Partial<typeof EMPTY_DAY_BOARD_FILTERS> = {}) =>
  filterDayBoard(rows, { ...EMPTY_DAY_BOARD_FILTERS, ...over }, bankNameOf, branchNameOf);

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
  });
});
