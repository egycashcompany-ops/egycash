// The reports' view over the server's roll-up (`lib/report-board.ts`), asserted directly: the money
// split the boards' way, the reference list's order, the rows' order, and «الإجمالي» taken from the
// server's grand total — never added up from the rows.
import { describe, expect, it } from 'vitest';
import {
  type OperationsCurrencyDto,
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';
import {
  bankRank,
  reportCurrencyLookup,
  reportLineKey,
  reportMoney,
  reportOtherCards,
  reportRowsInOrder,
  reportTableLines,
  vaultValuePanel,
  type ReportBoardRow,
} from './report-board';

const T = '2026-01-01T00:00:00.000Z';
const currency = (
  id: string,
  code: string,
  name: string,
  sortOrder: number | null,
  over: Partial<OperationsCurrencyDto> = {},
): OperationsCurrencyDto => ({
  id,
  code,
  name,
  legacyAliases: [],
  sortOrder,
  isActive: true,
  version: 0,
  createdAt: T,
  updatedAt: T,
  ...over,
});

/**
 * The production catalog's shape: the legacy numbers as codes, so neither the pound nor the dollar
 * is known by `EGP` / `USD`; arranged by hand, so the order is not the alphabet's.
 */
const CATALOG = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
  currency('gbp', '4', 'جنيه إسترليني', 3),
  currency('aed', '5', 'درهم إماراتي', 4),
  currency('sar', '6', 'ريال سعودي', 5),
  currency('cad', '13', 'دولار كندي', 6),
  // Retired: listed only while the vault still holds some.
  currency('dem', '20', 'مارك ألماني', 7, { isActive: false }),
];

const line = (
  currencyId: string | null,
  currencyName: string,
  amount: number,
): OperationsReportCurrencyTotalDto => ({ currencyId, currencyName, amount });

const totals = (
  shipmentCount: number,
  currencies: OperationsReportCurrencyTotalDto[] = [],
): OperationsReportTotalsDto => ({
  shipmentCount,
  bagCount: shipmentCount * 2,
  cartonCount: 1,
  boxCount: 0,
  currencies,
});

describe('reportMoney — «المصري», «الدولار», «عملات أخرى» by the boards’ classifier', () => {
  // The server sends a row's currencies alphabetically (report-aggregation.ts `sortCurrencies`).
  const ROW = [
    line('aed', 'درهم إماراتي', 210_000),
    line('cad', 'دولار كندي', 15_000),
    line('usd', 'دولار', 980_000),
    line('sar', 'ريال سعودي', 450_000),
    line('gbp', 'جنيه إسترليني', 85_000),
    line('egp', 'مصري', 36_750_000),
    line('eur', 'يورو', 320_000),
  ];

  it('keeps the pound and the dollar apart, known by name on a catalog coded «1», «2»', () => {
    const money = reportMoney(ROW, CATALOG);
    expect(money.egp).toBe(36_750_000);
    expect(money.usd).toBe(980_000);
  });

  it('counts every other currency in «عملات أخرى» — sterling and the Canadian dollar among them', () => {
    // Legacy's `total_other`: neither the pound nor the dollar. «جنيه إسترليني» is not the pound and
    // «دولار كندي» is not the dollar — names compared whole, never by "contains".
    const money = reportMoney(ROW, CATALOG);
    expect(money.others.map((other) => other.currencyId)).toEqual([
      'eur',
      'gbp',
      'aed',
      'sar',
      'cad',
    ]);
    expect(money.othersSum).toBe(320_000 + 85_000 + 210_000 + 450_000 + 15_000);
  });

  it('lists the others in the reference list’s order, not the alphabet the server sent', () => {
    const reordered = CATALOG.map((c) =>
      c.id === 'sar' ? { ...c, sortOrder: 2 } : c.id === 'eur' ? { ...c, sortOrder: 5 } : c,
    );
    expect(reportMoney(ROW, reordered).others.map((other) => other.name)).toEqual([
      'ريال سعودي',
      'جنيه إسترليني',
      'درهم إماراتي',
      'يورو',
      'دولار كندي',
    ]);
  });

  it('knows a pound by its legacy alias too, as the boards do', () => {
    const aliased = [currency('x', '9', 'عملة محلية', 0, { legacyAliases: ['جنيه مصري'] })];
    expect(reportMoney([line('x', 'عملة محلية', 500)], aliased).egp).toBe(500);
  });

  it('judges a currency the catalog does not hold by the name the server printed, and lists it last', () => {
    const money = reportMoney(
      [line('gone', 'دولار', 7), line('old', 'فرنك', 3), line('eur', 'يورو', 1)],
      CATALOG,
    );
    expect(money.usd).toBe(7);
    expect(money.others.map((other) => other.key)).toEqual(['eur', 'old']);
    // Before the catalog arrives, the printed names still split the money.
    expect(reportMoney(ROW, []).egp).toBe(36_750_000);
  });

  it('adds a row with no money as zeros — it still happened (Q28)', () => {
    expect(reportMoney([], CATALOG)).toEqual({ egp: 0, usd: 0, others: [], othersSum: 0 });
  });
});

describe('reportOtherCards / reportCurrencyLookup — the boards’ breakdown, for one row', () => {
  it('cards each other currency with its share, and no shipment count it cannot know', () => {
    const money = reportMoney([line('eur', 'يورو', 300), line('sar', 'ريال سعودي', 100)], CATALOG);
    const cards = reportOtherCards(money);
    expect(cards).toEqual([
      { currencyId: 'eur', amount: 300, share: 0.75 },
      { currencyId: 'sar', amount: 100, share: 0.25 },
    ]);
    expect(cards.every((card) => card.shipments === undefined)).toBe(true);
  });

  it('names a card by the catalog, or by the printed name of a currency it no longer holds', () => {
    const money = reportMoney([line(null, 'روبل', 5), line('eur', 'يورو', 1)], CATALOG);
    const lookup = reportCurrencyLookup(CATALOG, money.others);
    expect(lookup('eur')?.name).toBe('يورو');
    expect(lookup(reportLineKey(line(null, 'روبل', 5)))?.name).toBe('روبل');
    expect(lookup('nowhere')).toBeUndefined();
  });
});

describe('vaultValuePanel — «إجمالي قيمة الشحنات»', () => {
  const GRAND = [
    line('aed', 'درهم إماراتي', 210_000),
    line('usd', 'دولار', 2_885_000),
    line('egp', 'مصري', 131_800_000),
    line('eur', 'يورو', 380_000),
    line('dem', 'مارك ألماني', 1_000),
  ];

  it('reads «إجمالي المصري» and «إجمالي العملات الأجنبية» — the foreign sum WITH the dollar', () => {
    const panel = vaultValuePanel(GRAND, CATALOG);
    expect(panel.egp).toBe(131_800_000);
    // Legacy's second aggregation took out the pound alone (contad_app.js:1559).
    expect(panel.foreign).toBe(2_885_000 + 380_000 + 210_000 + 1_000);
  });

  it('never counts the pound as foreign on a catalog whose pound is coded «1»', () => {
    // The server's `foreignCurrencies` keeps every currency not coded `EGP` — on this catalog that
    // is the pound too. The panel does not read it.
    const panel = vaultValuePanel(GRAND, CATALOG);
    expect(panel.lines.map((l) => l.key)).not.toContain('egp');
  });

  it('lists every active currency but the pound in the reference order, zeros included and marked', () => {
    const panel = vaultValuePanel(GRAND, CATALOG);
    expect(panel.lines.map((l) => [l.name, l.amount, l.zero])).toEqual([
      ['دولار', 2_885_000, false],
      ['يورو', 380_000, false],
      ['جنيه إسترليني', 0, true],
      ['درهم إماراتي', 210_000, false],
      ['ريال سعودي', 0, true],
      ['دولار كندي', 0, true],
      // Retired, but still held: listed. Retired and not held: not listed.
      ['مارك ألماني', 1_000, false],
    ]);
    expect(vaultValuePanel([], CATALOG).lines.map((l) => l.key)).toEqual([
      'usd',
      'eur',
      'gbp',
      'aed',
      'sar',
      'cad',
    ]);
  });

  it('keeps money in a currency the catalog does not list, after the listed ones', () => {
    const panel = vaultValuePanel([...GRAND, line('xx', 'روبل', 9)], CATALOG);
    expect(panel.lines.at(-1)).toEqual({
      key: 'xx',
      currencyId: 'xx',
      name: 'روبل',
      amount: 9,
      zero: false,
    });
    expect(panel.foreign).toBe(2_885_000 + 380_000 + 210_000 + 1_000 + 9);
  });
});

describe('reportRowsInOrder / bankRank — the order the rows read in', () => {
  const ROWS = [
    { id: null as string | null, name: '' },
    { id: 'bq', name: 'القاهرة' },
    { id: 'ba', name: 'الأهلي' },
    { id: 'bm', name: 'مصر' },
  ];

  it('puts the unattributed bucket last — the server’s name sort put it first', () => {
    expect(reportRowsInOrder(ROWS, (row) => row.id === null).map((row) => row.id)).toEqual([
      'bq',
      'ba',
      'bm',
      null,
    ]);
  });

  it('orders banks by the reference order (Q31): sortOrder, then code, unplaced after', () => {
    const rank = bankRank([
      { id: 'bm', code: 2, sortOrder: 1 },
      { id: 'ba', code: 1, sortOrder: 0 },
      { id: 'bq', code: 3, sortOrder: null },
    ]);
    expect(
      reportRowsInOrder(
        ROWS,
        (row) => row.id === null,
        (row) => rank(row.id),
      ).map((row) => row.id),
    ).toEqual(['ba', 'bm', 'bq', null]);
    // A bank the catalog does not list goes after every one it does.
    expect(rank('elsewhere')).toBe(3);
  });
});

describe('reportTableLines — «الإجمالي» is the server’s, never a sum of the rows (Q27)', () => {
  const rows: ReportBoardRow[] = [
    {
      key: 'ba',
      label: 'الأهلي',
      unattributed: false,
      totals: totals(14, [line('egp', 'مصري', 10)]),
    },
    { key: 'none', label: '', unattributed: true, totals: totals(3) },
  ];

  it('numbers the rows in the order given and puts the grand total under them, as it came', () => {
    // A grand total the rows do NOT add up to: what is drawn is the server's figure.
    const grand = totals(99, [line('egp', 'مصري', 1_000)]);
    const lines = reportTableLines(rows, grand);
    expect(lines.map((l) => (l.kind === 'row' ? l.serial : l.kind))).toEqual([1, 2, 'total']);
    const total = lines.at(-1);
    expect(total?.kind).toBe('total');
    expect(total?.totals).toBe(grand);
    expect(total?.totals.shipmentCount).toBe(99);
  });

  it('draws no total for an empty report — the empty state says so instead', () => {
    expect(reportTableLines([], totals(0))).toEqual([]);
    expect(reportTableLines(rows, undefined)).toEqual([]);
  });
});
