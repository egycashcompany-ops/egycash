// «تقرير الخزينة» — the decisions over the live answer: the rows in the banks' order, the figure
// tiles off the grand total by the boards' currency classifier, the face, which dialog answers
// Escape, and where Tab keeps the focus.
import { describe, expect, it } from 'vitest';
import {
  type OperationsCurrencyDto,
  type OperationsReportTotalsDto,
  type OperationsVaultHeldReportDto,
} from '@ecms/contracts';
import {
  focusScope,
  heldReportFace,
  heldReportRows,
  heldReportTiles,
  isTopDialog,
} from './vault-held-report';

const T = '2026-01-01T00:00:00.000Z';
const currency = (id: string, code: string, name: string, sortOrder: number) =>
  ({
    id,
    code,
    name,
    legacyAliases: [],
    sortOrder,
    isActive: true,
    version: 0,
    createdAt: T,
    updatedAt: T,
  }) as OperationsCurrencyDto;
/** Production's catalog: legacy numeric codes — the pound is «1», never `EGP`. */
const CATALOG = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
  currency('gbp', '4', 'جنيه إسترليني', 3),
];

const totals = (over: Partial<OperationsReportTotalsDto> = {}): OperationsReportTotalsDto => ({
  shipmentCount: 0,
  bagCount: 0,
  cartonCount: 0,
  boxCount: 0,
  currencies: [],
  ...over,
});

describe('the tiles — off the grand total, by the boards’ classifier', () => {
  const grand = totals({
    shipmentCount: 77,
    bagCount: 111,
    cartonCount: 22,
    boxCount: 33,
    // The server's order (by name), not the reference list's.
    currencies: [
      { currencyId: 'gbp', currencyName: 'جنيه إسترليني', amount: 40_000 },
      { currencyId: 'usd', currencyName: 'دولار', amount: 5_000 },
      { currencyId: 'egp', currencyName: 'مصري', amount: 99_000_000 },
      { currencyId: 'eur', currencyName: 'يورو', amount: 112_000 },
    ],
  });

  it('counts the محصنات and their packages as the server counted them', () => {
    const tiles = heldReportTiles(grand, CATALOG);
    expect([tiles.count, tiles.bags, tiles.cartons, tiles.boxes]).toEqual([77, 111, 22, 33]);
  });

  it('splits the money as the table does: the pound coded «1» is the pound, not «عملات أخرى»', () => {
    const { money } = heldReportTiles(grand, CATALOG);
    expect(money.egp).toBe(99_000_000);
    expect(money.usd).toBe(5_000);
    expect(money.othersSum).toBe(152_000);
    // Kept apart for the breakdown, in the reference list's order.
    expect(money.others.map((line) => [line.key, line.amount])).toEqual([
      ['eur', 112_000],
      ['gbp', 40_000],
    ]);
  });

  it('reads a currency the catalog no longer holds by the name the server printed', () => {
    const { money } = heldReportTiles(
      totals({ currencies: [{ currencyId: 'gone', currencyName: 'مصري', amount: 7 }] }),
      CATALOG,
    );
    expect(money.egp).toBe(7);
    expect(money.othersSum).toBe(0);
  });

  it('is all zeros for an empty vault — the tiles keep their frame and say 0', () => {
    const tiles = heldReportTiles(totals(), CATALOG);
    expect(tiles).toEqual({
      count: 0,
      money: { egp: 0, usd: 0, others: [], othersSum: 0 },
      bags: 0,
      cartons: 0,
      boxes: 0,
    });
  });
});

describe('the rows — the banks’ reference order, the unattributed bucket last', () => {
  const answer: OperationsVaultHeldReportDto['rows'] = [
    { bankId: null, bankName: '', totals: totals({ shipmentCount: 1 }) },
    { bankId: 'b-misr', bankName: 'مصر', totals: totals({ shipmentCount: 2 }) },
    { bankId: 'b-ahly', bankName: 'الأهلي', totals: totals({ shipmentCount: 3 }) },
  ];
  const banks = [
    { id: 'b-misr', code: 2, sortOrder: 1 },
    { id: 'b-ahly', code: 1, sortOrder: 0 },
  ];

  it('orders by the bank’s own sort order and keys each row for the table', () => {
    expect(heldReportRows(answer, banks).map((row) => [row.key, row.unattributed])).toEqual([
      ['b-ahly', false],
      ['b-misr', false],
      ['unattributed', true],
    ]);
  });
});

describe('the face — the custody dashboard’s three', () => {
  const data = { asOf: T, rows: [], grandTotal: totals() };

  it('shows an answer whenever there is one, even beside a failed refetch', () => {
    expect(heldReportFace({ isError: false, data })).toBe('ready');
    expect(heldReportFace({ isError: true, data })).toBe('ready');
  });

  it('is the error face only for a report that never answered, else it loads', () => {
    expect(heldReportFace({ isError: true, data: undefined })).toBe('error');
    expect(heldReportFace({ isError: false, data: undefined })).toBe('loading');
  });
});

describe('which dialog answers Escape — the top of the page’s stack', () => {
  it('answers alone', () => {
    const mine = { id: 'report' };
    expect(isTopDialog([mine], mine)).toBe(true);
  });

  it('lets the «عملات أخرى» breakdown opened over it answer first', () => {
    const mine = { id: 'report' };
    const breakdown = { id: 'breakdown' };
    expect(isTopDialog([mine, breakdown], mine)).toBe(false);
    expect(isTopDialog([mine, breakdown], breakdown)).toBe(true);
  });

  it('never answers while it is not mounted', () => {
    expect(isTopDialog([], null)).toBe(false);
    expect(isTopDialog([{ id: 'other' }], null)).toBe(false);
  });
});

describe('where Tab keeps the focus — the report, or the breakdown it opened over itself', () => {
  it('keeps it in the report while nothing is over it', () => {
    const mine = { id: 'report' };
    expect(focusScope([mine], mine)).toBe(mine);
  });

  it('moves it onto the «عملات أخرى» breakdown while that is up, never to the page behind', () => {
    const mine = { id: 'report' };
    const breakdown = { id: 'breakdown' };
    expect(focusScope([mine, breakdown], mine)).toBe(breakdown);
  });

  it('never hands it to a dialog that was open under the report', () => {
    const under = { id: 'under' };
    const mine = { id: 'report' };
    expect(focusScope([under, mine], mine)).toBe(mine);
  });

  it('is nowhere while the report is not mounted', () => {
    expect(focusScope([{ id: 'other' }], null)).toBeNull();
  });
});
