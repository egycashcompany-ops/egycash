// «لوحة البنك بفروعه» (Round 25) — rendered from «تقرير البنوك» itself over a seeded cache.
//
// THE OWNER: «صفحة تقرير البنوك عاوز فى الجدول عند البنك فى الاخر بعد الصناديق يكون فيه سهم ادوس عليه
// يفتح زى داش برود كدا للبنك بالفروع بتاعته». Pinned here:
//
//   · the arrow at the END of each bank's row, after «الصناديق», named for its bank — none on
//     «الإجمالي»;
//   · the bank in the address opens the dashboard over the page, for the page's own period;
//   · the dashboard: the bank's seven tiles off the server's total (which IS the bank's row), the
//     two charts, and the branch table with «المنطقة», a branch of another bank saying whose,
//     sortable heads, «الإجمالي» the server's total;
//   · «من فرع» / «إلى فرع» — the side in the address is the side asked for.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  type Locale,
  type MeDto,
  type OperationsBankBranchReportDto,
  type OperationsBankReportDto,
  type OperationsCurrencyDto,
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { BankReportPage } from './BankReportPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const DASHBOARD = read('../components/BankBranchDashboard.tsx');
const BANK_PAGE = read('./BankReportPage.tsx');

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const T = '2026-01-01T00:00:00.000Z';
const me = (): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: { 'operationsShipment.view': 'organization' },
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

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
const CURRENCIES = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
];
const BANKS = [
  { id: 'ba', code: 1, opsName: 'الأهلي', sortOrder: 0, name: { ar: 'الأهلي', en: 'NBE' } },
  { id: 'bm', code: 2, opsName: 'مصر', sortOrder: 1, name: { ar: 'مصر', en: 'Misr' } },
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

const AHLY = totals(
  6,
  [9, 2, 1],
  [line('egp', 'مصري', 1_350_000), line('usd', 'دولار', 70_000), line('eur', 'يورو', 5_000)],
);
const REPORT: OperationsBankReportDto = {
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-30T00:00:00.000Z',
  rows: [
    { bankId: 'ba', bankName: 'الأهلي', totals: AHLY },
    { bankId: 'bm', bankName: 'مصر', totals: totals(2, [1, 0, 0], [line('egp', 'مصري', 40_000)]) },
  ],
  grandTotal: totals(8, [10, 2, 1], [line('egp', 'مصري', 1_390_000), line('usd', 'دولار', 70_000)]),
};
const BRANCHES: OperationsBankBranchReportDto = {
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-30T00:00:00.000Z',
  side: 'origin',
  bankId: 'ba',
  bankName: 'الأهلي',
  rows: [
    {
      branchId: 'f1',
      branchName: 'الدقي',
      branchCode: 'D-1',
      areaName: 'الجيزة',
      otherBankName: null,
      totals: totals(3, [5, 2, 0], [line('egp', 'مصري', 300_000), line('usd', 'دولار', 70_000)]),
    },
    {
      branchId: 'f2',
      branchName: 'الزمالك',
      branchCode: 'D-2',
      areaName: null,
      otherBankName: null,
      totals: totals(2, [3, 0, 1], [line('egp', 'مصري', 1_050_000), line('eur', 'يورو', 5_000)]),
    },
    {
      branchId: 'f3',
      branchName: 'شبرا',
      branchCode: 'M-9',
      areaName: 'القاهرة',
      otherBankName: 'مصر',
      totals: totals(1, [1, 0, 0], []),
    },
  ],
  // The bank's row, exactly.
  total: AHLY,
};
const RANGE = { from: '2026-11-01', to: '2026-11-30' };

const page = <R,>(items: R[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const render = (
  query: string,
  branches: OperationsBankBranchReportDto | null = BRANCHES,
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(
    listKey('operations', 'currencies', { page: 1, pageSize: MAX_PAGE_SIZE }),
    page(CURRENCIES),
  );
  qc.setQueryData(
    listKey('operations', 'banks', {
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    }),
    page(BANKS),
  );
  qc.setQueryData(listKey('operations', 'vaultReport', RANGE), REPORT);
  if (branches !== null) {
    qc.setQueryData(
      listKey('operations', 'vaultReport', {
        bankId: branches.bankId,
        ...RANGE,
        side: branches.side,
      }),
      branches,
    );
  }
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter
          initialEntries={[`/operations/reports/banks?from=${RANGE.from}&to=${RANGE.to}${query}`]}
        >
          <Routes>
            <Route path="/operations/reports/banks" element={<BankReportPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The text of a table's head cells, in order — the table that starts at `from`. */
const headers = (html: string, from = 0): string[] => {
  const at = html.indexOf('<thead', from);
  const head = html.slice(at, html.indexOf('</thead>', at));
  return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    (m[1] ?? '').replace(/<[^>]+>/g, '').trim(),
  );
};
const bodyRows = (html: string, from = 0): string[] => {
  const at = html.indexOf('<tbody', from);
  const body = html.slice(at, html.indexOf('</tbody>', at));
  return [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
};
const cells = (row: string): string[] =>
  [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    (m[1] ?? '')
      .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim(),
  );

describe('the arrow — at the end of each bank’s row, after «الصناديق»', () => {
  it('is the table’s last column, «الفروع», after «صندوق»', () => {
    const head = headers(render(''));
    expect(head.slice(-2)).toEqual(['صندوق', 'الفروع']);
  });

  it('is on every bank’s row, named for its bank — and not on «الإجمالي»', () => {
    const html = render('');
    const rows = bodyRows(html);
    expect(rows[0]).toContain('data-report-open="ba"');
    expect(rows[0]).toContain(
      `aria-label="${ar('operations.bankDashboard.open', { bank: 'الأهلي' })}"`,
    );
    expect(ar('operations.bankDashboard.open', { bank: 'الأهلي' })).toBe('فتح لوحة الأهلي بفروعه');
    expect(rows[1]).toContain('data-report-open="bm"');
    expect(rows.at(-1)).toContain('data-report-total="true"');
    expect(rows.at(-1)).not.toContain('data-report-open');
  });

  it('opens nothing until a bank is named in the address', () => {
    expect(render('')).not.toContain('data-bank-dashboard-dialog');
  });

  it('names the bank in the address — a step of the history, so Back closes it', () => {
    expect(BANK_PAGE).toContain('setSp(withBankDashboard(sp, row.key));');
    expect(BANK_PAGE).toContain('navigate(-1);');
  });
});

describe('the dashboard — the bank by its branches, over the page’s period', () => {
  const html = render('&bank=ba');
  const dialog = html.slice(html.indexOf('data-bank-dashboard-dialog'));

  it('opens over the page with the bank’s name and the page’s period', () => {
    expect(html).toContain('data-bank-dashboard-dialog="true"');
    expect(dialog).toContain(ar('operations.bankDashboard.title', { bank: 'الأهلي' }));
    const period = dialog.slice(
      dialog.indexOf('data-bank-dashboard-period'),
      dialog.indexOf('</span>', dialog.indexOf('data-bank-dashboard-period')) + 200,
    );
    expect(period).toContain('2026-11-01');
    expect(period).toContain('2026-11-30');
  });

  it('leads with the bank’s seven tiles, off the server’s total — the bank’s own row', () => {
    const tile = (which: string): string => {
      const at = dialog.indexOf(`data-bank-dashboard-tile="${which}"`);
      return dialog.slice(at, dialog.indexOf('data-bank-dashboard-tile=', at + 10));
    };
    expect(tile('count')).toContain('>6<');
    expect(tile('egp')).toContain('1,350,000');
    expect(tile('usd')).toContain('70,000');
    expect(tile('others')).toContain('5,000');
    expect(tile('bags')).toContain('>9<');
  });

  it('draws two charts, one measure each, the largest branch first', () => {
    const egp = dialog.slice(
      dialog.indexOf('data-bank-dashboard-chart="egp"'),
      dialog.indexOf('data-bank-dashboard-chart="count"'),
    );
    const bars = [...egp.matchAll(/data-bank-dashboard-bar="([^"]+)"/g)].map((m) => m[1]);
    // الزمالك 1,050,000 before الدقي 300,000; شبرا brought no pound — no bar.
    expect(bars).toEqual(['f2', 'f1']);
    expect(egp).toContain(ar('operations.bankDashboard.chart.egp'));
    const count = dialog.slice(dialog.indexOf('data-bank-dashboard-chart="count"'));
    expect(
      [
        ...count
          .slice(0, count.indexOf('</section>'))
          .matchAll(/data-bank-dashboard-bar="([^"]+)"/g),
      ].map((m) => m[1]),
    ).toEqual(['f1', 'f2', 'f3']);
    // The hover title says every figure of the branch.
    expect(egp).toContain(
      `title="${ar('operations.bankDashboard.chart.bar', { label: 'الدقي', count: '3', egp: '300,000', usd: '70,000' })}"`,
    );
  });

  it('lists the branches with «المنطقة» after the name — the pound first, largest at the top', () => {
    const at = dialog.indexOf('data-report-table');
    expect(headers(dialog, at)).toEqual([
      'م',
      'الفرع',
      'المنطقة',
      'عدد المحصنات',
      'المصري',
      'الدولار',
      'عملات أخرى',
      'الحقائب',
      'كرتونة',
      'صندوق',
    ]);
    const rows = bodyRows(dialog, at).map(cells);
    expect(rows.map((row) => row.slice(0, 4))).toEqual([
      ['1', 'الزمالك', '—', '2'],
      ['2', 'الدقي', 'الجيزة', '3'],
      // A branch of another bank says whose — under its name.
      ['3', `شبرا${ar('operations.bankDashboard.otherBank', { bank: 'مصر' })}`, 'القاهرة', '1'],
      ['', 'الإجمالي', '', '6'],
    ]);
    expect(ar('operations.bankDashboard.otherBank', { bank: 'مصر' })).toBe('فرع تابع لـمصر');
  });

  it('puts the server’s total under the branches — the bank’s row, never the branches added up', () => {
    const at = dialog.indexOf('data-report-table');
    const total = cells(bodyRows(dialog, at).at(-1) ?? '');
    expect(total).toEqual(['', 'الإجمالي', '', '6', '1,350,000', '70,000', '5,000', '9', '2', '1']);
    expect(DASHBOARD).toContain('total={data?.total}');
  });

  it('sorts by any head — the table hands the clicks to `nextBranchSort`', () => {
    const at = dialog.indexOf('data-report-table');
    const head = dialog.slice(dialog.indexOf('<thead', at), dialog.indexOf('</thead>', at));
    // Every column but «م» is a button.
    expect([...head.matchAll(/<button/g)]).toHaveLength(9);
    expect(DASHBOARD).toContain('onChange: (key) => setSort((now) => nextBranchSort(now, key))');
  });

  it('counts the branches beside the table’s title, in the form the count takes', () => {
    expect(dialog).toContain('data-bank-dashboard-branch-count="3"');
    expect(dialog).toContain(ar('operations.bankDashboard.branchCount.few', { count: '3' }));
  });

  it('files by «من فرع» unless the address says «إلى فرع»', () => {
    expect(dialog).toContain('data-bank-dashboard-side="origin"');
    const to = render('&bank=ba&bankSide=destination', { ...BRANCHES, side: 'destination' });
    expect(to).toContain('data-bank-dashboard-side="destination"');
    expect(to).toMatch(/aria-pressed="true"[^>]*data-bank-dashboard-side-option="destination"/);
  });

  it('carries Excel and PDF of the branch table, with its panel', () => {
    expect(dialog).toContain('data-report-export-excel="true"');
    expect(DASHBOARD).toContain('withValuePanel: true,');
    expect(DASHBOARD).toContain('detail={detail}');
  });
});

describe('a bank with nothing in the period', () => {
  it('keeps every section, at zero, and says so in the table’s place', () => {
    const html = render('&bank=ba', { ...BRANCHES, rows: [], total: totals(0, [0, 0, 0], []) });
    const dialog = html.slice(html.indexOf('data-bank-dashboard-dialog'));
    expect(dialog).toContain('data-bank-dashboard-tiles="true"');
    expect(dialog).toContain('data-bank-dashboard-chart-empty="egp"');
    expect(dialog).toContain('data-bank-dashboard-chart-empty="count"');
    expect(dialog).toContain(ar('operations.bankDashboard.empty'));
  });
});
