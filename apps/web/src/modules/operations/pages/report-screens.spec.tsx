// «تجميع الخزينة» and «تقرير القادة» on the boards' look (Round 11) — «تجميع الخزينة هيكون زى الشاشة
// اللى بعتهالك بتاعت البنوك وتقرير القادة الشاشة هتكون الشاشة التانية»: the legacy screens' STRUCTURE
// in the boards' look. Rendered from the pages themselves over a seeded cache, and pinned in the
// source where a refactor could quietly undo a decision:
//
//   · the columns, legacy's, in its order — «اجمالي العملات» under the boards' word «عملات أخرى»;
//   · «الإجمالي» is the server's grand total, never the rows added up (Q27);
//   · the vault's «إجمالي قيمة الشحنات»: the pound, the foreign sum with the dollar, then every
//     currency of the reference list, zeros dimmed;
//   · the vault's «من» / «إلى» are SHOWN and NOT SENT — pending the owner's decision (Q32);
//   · the captain report's range opens on the current month and refuses an inverted one in words;
//   · «تقرير البنوك» and «جرد الخزينة» are left as they were.
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
  type OperationsCaptainReportDto,
  type OperationsCurrencyDto,
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
  type OperationsVaultReportDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { CaptainReportPage } from './CaptainReportPage';
import { VaultReportPage } from './VaultReportPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const BOARD = read('../components/ReportBoard.tsx');
const PANEL = read('../components/VaultValuePanel.tsx');
const VAULT_PAGE = read('./VaultReportPage.tsx');
const CAPTAIN_PAGE = read('./CaptainReportPage.tsx');
const BANK_PAGE = read('./BankReportPage.tsx');
const INVENTORY_PAGE = read('./VaultInventoryPage.tsx');
const SHIPMENTS_BOARD = read('../components/ShipmentsBoard.tsx');

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const T = '2026-01-01T00:00:00.000Z';
const me = (permissions: string[]): MeDto =>
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
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
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
/** The production catalog's shape: the legacy numbers as codes. */
const CURRENCIES = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
  currency('gbp', '4', 'جنيه إسترليني', 3),
  currency('sar', '6', 'ريال سعودي', 4),
];
const bank = (id: string, code: number, opsName: string, sortOrder: number | null) => ({
  id,
  code,
  opsName,
  sortOrder,
  name: { ar: opsName, en: opsName },
});
const BANKS = [bank('bm', 2, 'مصر', 1), bank('ba', 1, 'الأهلي', 0), bank('bq', 3, 'القاهرة', 2)];

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

/**
 * The server's answer, in the server's order (by name). Its grand total is deliberately NOT the sum
 * of the rows — what «الإجمالي» shows must be this figure, so it can only have come from here.
 */
const VAULT: OperationsVaultReportDto = {
  rows: [
    {
      bankId: 'bq',
      bankName: 'القاهرة',
      totals: totals(
        7,
        [17, 2, 1],
        [line('egp', 'مصري', 18_200_000), line('usd', 'دولار', 410_000)],
      ),
    },
    {
      bankId: 'ba',
      bankName: 'الأهلي',
      totals: totals(
        14,
        [38, 6, 3],
        [
          line('egp', 'مصري', 48_500_000),
          line('usd', 'دولار', 1_250_000),
          line('sar', 'ريال سعودي', 450_000),
          line('eur', 'يورو', 320_000),
        ],
      ),
    },
    {
      bankId: 'bm',
      bankName: 'مصر',
      totals: totals(11, [29, 4, 2], [line('egp', 'مصري', 36_750_000)]),
    },
  ],
  grandTotal: totals(
    77,
    [111, 22, 33],
    [
      line('egp', 'مصري', 123_456_000),
      line('usd', 'دولار', 7_000_000),
      line('eur', 'يورو', 900_000),
    ],
  ),
  baseCurrencyCode: 'EGP',
  // What the server sends on a catalog coded «1»: the pound too. The page does not read it.
  foreignCurrencies: [line('egp', 'مصري', 123_456_000)],
};

const RANGE = { from: '2026-11-01', to: '2026-11-30' };
const CAPTAINS: OperationsCaptainReportDto = {
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-30T00:00:00.000Z',
  rows: [
    // The server sorts by the captain's name: the unassigned bucket's empty name comes first.
    {
      captainEmployeeId: null,
      captainName: '',
      totals: totals(3, [0, 0, 0], [line('egp', 'مصري', 1_650_000)]),
    },
    {
      captainEmployeeId: 'e1',
      captainName: 'محمود حسن عبد الله',
      totals: totals(
        46,
        [21, 3, 1],
        [line('egp', 'مصري', 92_400_000), line('eur', 'يورو', 140_000)],
      ),
    },
  ],
  grandTotal: totals(
    49,
    [21, 3, 1],
    [line('egp', 'مصري', 94_050_000), line('eur', 'يورو', 140_000)],
  ),
};

const storeFor = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: me(['operationsVault.view', 'operationsShipment.view']),
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const render = (path: string, element: JSX.Element, seed: (qc: QueryClient) => void): string => {
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
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={storeFor()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path.split('?')[0]} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const renderVault = (data: OperationsVaultReportDto = VAULT, query = ''): string =>
  render(`/operations/reports/vault${query}`, <VaultReportPage />, (qc) =>
    qc.setQueryData(listKey('operations', 'vaultReport', {}), data),
  );
const renderCaptains = (query = `?from=${RANGE.from}&to=${RANGE.to}`): string =>
  render(`/operations/reports/captains${query}`, <CaptainReportPage />, (qc) =>
    qc.setQueryData(listKey('operations', 'reportCaptains', RANGE), CAPTAINS),
  );

/** The text of the table's head cells, in order. */
const headers = (html: string): string[] => {
  const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
  return [...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1] ?? '');
};
/** A body row's cell texts as they are SEEN — tags stripped, a screen reader's words left out. */
const cells = (row: string): string[] =>
  [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    (m[1] ?? '')
      .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim(),
  );
const bodyRows = (html: string): string[] => {
  const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
};

describe('«تجميع الخزينة» — the legacy vault roll-up, on the boards’ look', () => {
  it('draws legacy’s table: its title strip and its columns, in its order', () => {
    const html = renderVault();
    expect(html).toContain(ar('operations.vaultReport.table'));
    expect(ar('operations.vaultReport.table')).toBe('بيان الشحنات لكل بنك');
    expect(headers(html)).toEqual([
      'م',
      'البنك',
      'عدد المحصنات',
      'المصري',
      'الدولار',
      'عملات أخرى',
      'الحقائب',
      'كرتونة',
      'صندوق',
    ]);
  });

  it('reads the banks in the reference order (Q31), not the server’s alphabet', () => {
    const rows = bodyRows(renderVault()).map(cells);
    expect(rows.map((row) => row.slice(0, 2))).toEqual([
      ['1', 'الأهلي'],
      ['2', 'مصر'],
      ['3', 'القاهرة'],
      ['', 'الإجمالي'],
    ]);
  });

  it('splits a row’s money the boards’ way: the dollar on its own, «عملات أخرى» the rest', () => {
    const [ahly] = bodyRows(renderVault()).map(cells);
    expect(ahly).toEqual([
      '1',
      'الأهلي',
      '14',
      '48,500,000',
      '1,250,000',
      // يورو + ريال سعودي — the dollar is not among them.
      '770,000',
      '38',
      '6',
      '3',
    ]);
  });

  it('opens the boards’ breakdown from a row’s «عملات أخرى» — and offers nothing to open on a zero', () => {
    const html = renderVault();
    expect(html).toContain('data-report-others="ba"');
    expect(html).not.toContain('data-report-others="bm"');
    // Named by its own figure, then what the figure is — never an `aria-label` that would replace
    // the digits a reader sees with a description that has no amount in it.
    const button = html.slice(
      html.indexOf('data-report-others="ba"'),
      html.indexOf('</button>', html.indexOf('data-report-others="ba"')),
    );
    expect(button).not.toContain('aria-label=');
    expect(button.indexOf('770,000')).toBeGreaterThan(-1);
    expect(button.indexOf('770,000')).toBeLessThan(
      button.indexOf(
        `<span class="sr-only">${ar('operations.reportBoard.othersOf', { name: 'الأهلي' })}</span>`,
      ),
    );
    expect(BOARD).toContain('<OtherCurrenciesDialog');
    expect(BOARD).toContain('cards={shownOthers ?? []}');
  });

  it('puts «الإجمالي» under the rows from the SERVER’s grand total — never the rows added up (Q27)', () => {
    const total = bodyRows(renderVault()).at(-1) ?? '';
    expect(total).toContain('data-report-total="true"');
    // 77 / 123,456,000 / 7,000,000 / 900,000 / 111 / 22 / 33 are the grand total's own figures;
    // the rows add up to none of them.
    expect(cells(total)).toEqual([
      '',
      'الإجمالي',
      '77',
      '123,456,000',
      '7,000,000',
      '900,000',
      '111',
      '22',
      '33',
    ]);
    expect(BOARD).toContain('const lines = reportTableLines(rows, grandTotal);');
    expect(BOARD).not.toMatch(/rows\.reduce\(/);
  });

  it('keeps legacy’s «إجمالي قيمة الشحنات» beside the table, from the grand total', () => {
    const html = renderVault();
    expect(html).toContain(ar('operations.vaultReport.value'));
    const total = (which: string): string => {
      const at = html.indexOf(`data-vault-value-total="${which}"`);
      return html.slice(at, html.indexOf('</div>', html.indexOf('dir="ltr"', at)));
    };
    expect(total('egp')).toContain('123,456,000');
    // «إجمالي العملات الأجنبية»: every currency but the pound — the dollar included, as legacy's.
    expect(total('foreign')).toContain('7,900,000');
  });

  it('lists every currency of the reference list but the pound, in its order, zeros marked', () => {
    const html = renderVault();
    const lines = [...html.matchAll(/data-vault-value-line="(\w+)"(?: data-zero="true")?/g)].map(
      (m) => (m[0].includes('data-zero') ? `${m[1] ?? ''}:0` : (m[1] ?? '')),
    );
    expect(lines).toEqual(['usd', 'eur', 'gbp:0', 'sar:0']);
    // The panel never reads the server's `foreignCurrencies`, which tells the pound by `EGP` alone.
    expect(PANEL).not.toContain('foreignCurrencies');
    expect(VAULT_PAGE).not.toContain('foreignCurrencies');
    expect(PANEL).toContain('vaultValuePanel(grandTotal.currencies,');
  });

  it('shows «من» / «إلى» empty — everything in the vault now', () => {
    const html = renderVault();
    expect(html).toContain(`aria-label="${ar('operations.reports.from')}"`);
    expect(html).toContain(`aria-label="${ar('operations.reports.to')}"`);
    expect(html).toContain('data-date-label="from"');
    expect(html).toContain('data-date-label="to"');
  });

  it('SENDS NOTHING from the dates — pending the owner’s decision on what they filter (Q32)', () => {
    // The server refuses `?from` / `?to` on the vault roll-up; the sample shows the boxes only.
    expect(VAULT_PAGE).toContain("PENDING THE OWNER'S DECISION");
    expect(VAULT_PAGE).toContain('const report = useVaultReport();');
    expect(VAULT_PAGE).not.toMatch(/useVaultReport\([^)]/);
    // A picked date keeps the same report on screen — the same cache entry, asked with no query.
    const html = renderVault(VAULT, '?from=2026-11-01');
    expect(html).toContain('value="2026-11-01"');
    expect(bodyRows(html)).toHaveLength(4);
  });

  it('says the vault is empty in the table’s place, with no row of zeros', () => {
    const html = renderVault({
      ...VAULT,
      rows: [],
      grandTotal: totals(0, [0, 0, 0], []),
      foreignCurrencies: [],
    });
    expect(html).toContain(ar('operations.vault.empty'));
    expect(html).not.toContain('data-report-total="true"');
    expect(bodyRows(html)).toHaveLength(1);
  });
});

describe('«تقرير القادة» — the legacy captain report, on the boards’ look', () => {
  it('draws legacy’s table, «عدد الشحنات» over a count of daily AND secured shipments', () => {
    const html = renderCaptains();
    expect(ar('operations.reports.captains.table')).toBe('بيان عدد الشحنات لكل قائد طاقم');
    expect(html).toContain(ar('operations.reports.captains.table'));
    expect(headers(html)).toEqual([
      'م',
      'اسم القائد',
      'عدد الشحنات',
      'المصري',
      'الدولار',
      'عملات أخرى',
      'الحقائب',
      'كرتونة',
      'صندوق',
    ]);
  });

  it('keeps the unassigned bucket, worded as it always was, last above «الإجمالي»', () => {
    const rows = bodyRows(renderCaptains()).map(cells);
    expect(rows.map((row) => row.slice(0, 3))).toEqual([
      ['1', 'محمود حسن عبد الله', '46'],
      ['2', ar('operations.reports.unattributed'), '3'],
      ['', 'الإجمالي', '49'],
    ]);
  });

  it('holds the range in «من» / «إلى», opening on the current month', () => {
    const html = renderCaptains();
    expect(html).toContain(`value="${RANGE.from}"`);
    expect(html).toContain(`value="${RANGE.to}"`);
    expect(CAPTAIN_PAGE).toContain(
      "const range = rangeFromParams({ from: sp.get('from'), to: sp.get('to') }, new Date());",
    );
    expect(CAPTAIN_PAGE).toContain('const report = useCaptainReport(range, valid);');
  });

  it('refuses an inverted range in words, in the table’s place — never sent', () => {
    const html = renderCaptains('?from=2026-11-20&to=2026-11-05');
    expect(html).toContain(ar('operations.reports.invalidRange'));
    expect(html).toContain('data-shipments-refusal="true"');
    expect(html).not.toContain('<table');
  });
});

describe('one board for both reports, built from the boards’ own pieces', () => {
  it('draws the boards’ date box, refusal and table look — not copies of them', () => {
    expect(BOARD).toContain('<BoardDateBox key={picker.param} picker={picker} />');
    expect(BOARD).toContain('<BoardRefusal>{refusal}</BoardRefusal>');
    expect(BOARD).toContain('BOARD_TABLE_LOOK,');
    expect(BOARD).not.toContain('type="date"');
    for (const piece of ['BoardDateBox', 'BoardRefusal', 'BOARD_TABLE_LOOK', 'BAR_LAYOUT']) {
      expect(SHIPMENTS_BOARD).toMatch(new RegExp(`export const ${piece}\\b`));
    }
  });

  it('applies the dates as they are chosen — no «بحث» button, as no board has one', () => {
    // The code, its comments left out (they quote legacy's «بحث» to say why it is gone).
    const code = BOARD.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/reports\.search|بحث/);
    expect(BOARD).toContain('<FilterBar hasActiveFilters={periodActive} onClear={onResetPeriod}>');
  });

  it('pins «الإجمالي» to the bottom of the table’s own scroll, under a head that stays', () => {
    expect(BOARD).toContain(
      "rowProps={(line) => (line.kind === 'total' ? TOTAL_ROW_MARK : undefined)}",
    );
    expect(BOARD).toContain(
      '[&_tr[data-report-total]_td]:sticky [&_tr[data-report-total]_td]:bottom-0',
    );
    expect(BOARD).toContain('stickyHead');
  });

  it('leaves «تقرير البنوك» and «جرد الخزينة» as they were', () => {
    expect(BANK_PAGE).toContain(
      "import { ReportView, type ReportRow } from '../components/ReportView';",
    );
    expect(BANK_PAGE).toContain('<ReportRangePicker range={range} onChange={setRange} />');
    expect(BANK_PAGE).not.toContain('ReportBoard');
    expect(INVENTORY_PAGE).not.toContain('ReportBoard');
  });
});
