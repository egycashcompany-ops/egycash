// «لوحة البنك بفروعه» (Round 25) — the dashboard's decisions over the server's answer, asserted
// directly (`lib/bank-dashboard.ts`): «عاوز فى الجدول عند البنك فى الاخر بعد الصناديق يكون فيه سهم
// ادوس عليه يفتح زى داش برود كدا للبنك بالفروع بتاعته».
import { describe, expect, it } from 'vitest';
import {
  type OperationsBankBranchReportRowDto,
  type OperationsCurrencyDto,
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';
import {
  BANK_DASHBOARD_PARAM,
  BANK_DASHBOARD_SIDE_PARAM,
  DEFAULT_BRANCH_SORT,
  bankDashboardSide,
  branchBars,
  branchBoardRows,
  nextBranchSort,
  sortBranchRows,
  withBankDashboard,
} from './bank-dashboard';

const T = '2026-01-01T00:00:00.000Z';
const currency = (
  id: string,
  code: string,
  name: string,
  sortOrder: number,
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
});
/** The production catalog's shape — the legacy numbers as codes. */
const CATALOG = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
];
const line = (
  currencyId: string,
  currencyName: string,
  amount: number,
): OperationsReportCurrencyTotalDto => ({
  currencyId,
  currencyName,
  amount,
});
const totals = (
  shipmentCount: number,
  [bagCount, cartonCount, boxCount]: [number, number, number],
  currencies: OperationsReportCurrencyTotalDto[],
): OperationsReportTotalsDto => ({ shipmentCount, bagCount, cartonCount, boxCount, currencies });
const branch = (
  branchId: string | null,
  branchName: string,
  areaName: string | null,
  t: OperationsReportTotalsDto,
  otherBankName: string | null = null,
): OperationsBankBranchReportRowDto => ({
  branchId,
  branchName,
  branchCode: branchId,
  areaName,
  otherBankName,
  totals: t,
});

/** The server's order: by name. */
const SERVER = [
  branch(
    'b1',
    'الدقي',
    'الجيزة',
    totals(3, [4, 0, 1], [line('egp', 'مصري', 900), line('usd', 'دولار', 50)]),
  ),
  branch(
    'b2',
    'المعادي',
    null,
    totals(5, [2, 3, 0], [line('egp', 'مصري', 300), line('eur', 'يورو', 70)]),
  ),
  branch('b3', 'شبرا', 'القاهرة', totals(1, [0, 0, 0], [line('usd', 'دولار', 80)]), 'بنك مصر'),
  branch(null, '', null, totals(1, [1, 0, 0], [line('egp', 'مصري', 5_000)])),
];
const ROWS = branchBoardRows(SERVER);

describe('the address — the bank named in it opens its dashboard, Back closes it', () => {
  it('opens a bank, keeping the page’s own parameters, «من فرع» unsaid (the default)', () => {
    const next = withBankDashboard(
      new URLSearchParams('from=2026-11-01&to=2026-11-30&name=مصر'),
      'b-1',
    );
    expect(next.get(BANK_DASHBOARD_PARAM)).toBe('b-1');
    expect(next.has(BANK_DASHBOARD_SIDE_PARAM)).toBe(false);
    expect(next.get('from')).toBe('2026-11-01');
    expect(next.get('name')).toBe('مصر');
  });

  it('names «إلى فرع» when asked, and drops it again for «من فرع»', () => {
    const to = withBankDashboard(new URLSearchParams('bank=b-1'), 'b-1', 'destination');
    expect(to.get(BANK_DASHBOARD_SIDE_PARAM)).toBe('destination');
    expect(withBankDashboard(to, 'b-1', 'origin').has(BANK_DASHBOARD_SIDE_PARAM)).toBe(false);
  });

  it('closes by taking the bank and its side out — nothing else', () => {
    const closed = withBankDashboard(
      new URLSearchParams('from=2026-11-01&bank=b-1&bankSide=destination'),
      null,
    );
    expect(closed.toString()).toBe('from=2026-11-01');
  });

  it('reads any side but «destination» as «من فرع»', () => {
    expect(bankDashboardSide('destination')).toBe('destination');
    expect(bankDashboardSide('origin')).toBe('origin');
    expect(bankDashboardSide(null)).toBe('origin');
    expect(bankDashboardSide('both')).toBe('origin');
  });
});

describe('the rows — the report table’s, with the branch’s area and bank beside', () => {
  it('keys each by its branch, and draws an unresolved branch as the report’s bucket', () => {
    expect(ROWS.map((row) => [row.key, row.label, row.unattributed])).toEqual([
      ['b1', 'الدقي', false],
      ['b2', 'المعادي', false],
      ['b3', 'شبرا', false],
      ['unattributed', '', true],
    ]);
    expect(ROWS[2]).toMatchObject({ areaName: 'القاهرة', otherBankName: 'بنك مصر', code: 'b3' });
  });
});

describe('the order — by the column clicked, the bucket always last', () => {
  const keys = (by: Parameters<typeof sortBranchRows>[2]): string[] =>
    sortBranchRows(ROWS, CATALOG, by).map((row) => row.key);

  it('opens on the pound, largest first — the bucket last although it holds the most', () => {
    expect(DEFAULT_BRANCH_SORT).toEqual({ by: 'egp', dir: 'desc' });
    expect(keys(DEFAULT_BRANCH_SORT)).toEqual(['b1', 'b2', 'b3', 'unattributed']);
  });

  it('orders by each figure — the count, the dollar, «عملات أخرى», the packages', () => {
    expect(keys({ by: 'count', dir: 'desc' })).toEqual(['b2', 'b1', 'b3', 'unattributed']);
    expect(keys({ by: 'count', dir: 'asc' })).toEqual(['b3', 'b1', 'b2', 'unattributed']);
    expect(keys({ by: 'usd', dir: 'desc' })).toEqual(['b3', 'b1', 'b2', 'unattributed']);
    expect(keys({ by: 'others', dir: 'desc' })).toEqual(['b2', 'b1', 'b3', 'unattributed']);
    expect(keys({ by: 'bags', dir: 'desc' })).toEqual(['b1', 'b2', 'b3', 'unattributed']);
    expect(keys({ by: 'cartons', dir: 'desc' })).toEqual(['b2', 'b1', 'b3', 'unattributed']);
    expect(keys({ by: 'boxes', dir: 'desc' })).toEqual(['b1', 'b2', 'b3', 'unattributed']);
  });

  it('orders by name in Arabic, and by area with a branch of no area after every named one', () => {
    expect(keys({ by: 'label', dir: 'asc' })).toEqual(['b1', 'b2', 'b3', 'unattributed']);
    expect(keys({ by: 'label', dir: 'desc' })).toEqual(['b3', 'b2', 'b1', 'unattributed']);
    // الجيزة before القاهرة; المعادي has no area and stays after both, either way.
    expect(keys({ by: 'detail', dir: 'asc' })).toEqual(['b1', 'b3', 'b2', 'unattributed']);
    expect(keys({ by: 'detail', dir: 'desc' })).toEqual(['b3', 'b1', 'b2', 'unattributed']);
  });

  it('breaks a tie by name, so two runs read alike', () => {
    expect(keys({ by: 'boxes', dir: 'asc' })).toEqual(['b2', 'b3', 'b1', 'unattributed']);
  });

  it('turns the column round on a second click; starts a figure from the largest, a word from أ', () => {
    expect(nextBranchSort({ by: 'egp', dir: 'desc' }, 'egp')).toEqual({ by: 'egp', dir: 'asc' });
    expect(nextBranchSort({ by: 'egp', dir: 'asc' }, 'egp')).toEqual({ by: 'egp', dir: 'desc' });
    expect(nextBranchSort({ by: 'egp', dir: 'desc' }, 'count')).toEqual({
      by: 'count',
      dir: 'desc',
    });
    expect(nextBranchSort({ by: 'egp', dir: 'desc' }, 'label')).toEqual({
      by: 'label',
      dir: 'asc',
    });
    expect(nextBranchSort({ by: 'egp', dir: 'desc' }, 'detail')).toEqual({
      by: 'detail',
      dir: 'asc',
    });
  });
});

describe('the charts — one measure each, largest first, the long tail folded', () => {
  it('draws the branches with any of the measure, longest bar the largest', () => {
    const bars = branchBars(ROWS, CATALOG, 'egp');
    expect(bars.map((bar) => [bar.key, bar.value])).toEqual([
      ['unattributed', 5_000],
      ['b1', 900],
      ['b2', 300],
    ]);
    // شبرا has no pound: not a bar (the table still lists it).
    expect(bars.find((bar) => bar.key === 'b3')).toBeUndefined();
    expect(bars[0]?.share).toBe(1);
    expect(bars[1]?.share).toBeCloseTo(0.18);
  });

  it('counts محصنات on the second chart, ties by name', () => {
    expect(branchBars(ROWS, CATALOG, 'count').map((bar) => [bar.key, bar.value])).toEqual([
      ['b2', 5],
      ['b1', 3],
      ['b3', 1],
      ['unattributed', 1],
    ]);
  });

  it('names the first `limit` and folds the rest into ONE muted bar that says how many', () => {
    const many = branchBoardRows(
      Array.from({ length: 11 }, (_, i) =>
        branch(`b${String(i)}`, `فرع ${String(i)}`, null, totals(i + 1, [0, 0, 0], [])),
      ),
    );
    const bars = branchBars(many, CATALOG, 'count');
    expect(bars).toHaveLength(9);
    const rest = bars.at(-1);
    // 1 + 2 + 3: the three smallest, folded.
    expect(rest).toMatchObject({ key: 'rest', rest: 3, value: 6 });
    expect(bars.slice(0, 8).every((bar) => bar.rest === 0)).toBe(true);
    // Every branch is in it once: the bars add up to the count.
    expect(bars.reduce((sum, bar) => sum + bar.value, 0)).toBe(66);
  });

  it('draws no bar at all when nothing has the measure', () => {
    expect(branchBars([], CATALOG, 'egp')).toEqual([]);
    expect(branchBars(ROWS.slice(2, 3), CATALOG, 'egp')).toEqual([]);
  });
});
