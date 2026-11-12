// «تجميع الخزينة» and «تقرير القادة» on the boards' look (Round 11) — «تجميع الخزينة هيكون زى الشاشة
// اللى بعتهالك بتاعت البنوك وتقرير القادة الشاشة هتكون الشاشة التانية»: the legacy screens' STRUCTURE
// in the boards' look. Rendered from the pages themselves over a seeded cache, and pinned in the
// source where a refactor could quietly undo a decision:
//
//   · the columns, legacy's, in its order — «اجمالي العملات» under the boards' word «عملات أخرى»;
//   · «الإجمالي» is the server's grand total, never the rows added up (Q27);
//   · the vault's «إجمالي قيمة الشحنات»: the pound, the foreign sum with the dollar, then every
//     currency of the reference list, zeros dimmed;
//   · the vault's «من» / «إلى» are the period it covers — «يجيب اللى اتسلم واللى متسلمش ويجيب البداية
//     كل اول شهر»: they go with the request, open on the current month, refuse an inverted range;
//   · the captain report's range opens on the current month and refuses an inverted one in words;
//   · «تقرير البنوك» is left as it was.
//
// Round 12 — «شيل الديف اللى فيها الفلاتر بتاعت التاريخ وخليها زى الفلاتر عادى وزود ان اعمل فلتر ب اسم
// القائد [البنك] و ان اكسيل او pdf … والجدول فى الشاشتين يكون الصف بتاع الجماليات يفضل ظاهر»:
//
//   · one bar across the screen, the boards' — the name filter, «من», «إلى», the reset, «Excel | PDF»;
//   · the name narrows the rows as typed, Arabic folded, and «الإجمالي» (and the vault's panel)
//     follow it: the server's grand total with no name, the shown rows summed with one;
//   · the table's card runs to the screen's bottom with its total pinned; the panel as tall.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const HELD_DIALOG = read('../components/VaultHeldReportDialog.tsx');
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
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-30T00:00:00.000Z',
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

/**
 * The page over a cache seeded for ONE period (`range`): the rows can only be on screen if the page
 * asked for exactly that period — the range IS the query key, as it is the request's `from`/`to`.
 */
const renderVault = (
  data: OperationsVaultReportDto = VAULT,
  query = `?from=${RANGE.from}&to=${RANGE.to}`,
  range: { from: string; to: string } = RANGE,
): string =>
  render(`/operations/reports/vault${query}`, <VaultReportPage />, (qc) =>
    qc.setQueryData(listKey('operations', 'vaultReport', range), data),
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
    // The board draws the total it is handed; the page hands it the server's while no name is
    // typed (`reportView`) — and the board itself never sums anything.
    expect(BOARD).toContain('const lines = reportTableLines(rows, total);');
    expect(BOARD).not.toMatch(/\.reduce\(/);
    expect(VAULT_PAGE).toMatch(
      /reportView\(\s*valid \? rows : \[\],\s*valid \? report\.data\?\.grandTotal : undefined,/,
    );
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
    // Split by the boards' classifier (code, name or alias) — never by the code `EGP` alone.
    expect(PANEL).toContain('vaultValuePanel(grandTotal.currencies,');
  });

  describe('«من» / «إلى» — the period the roll-up covers («ويجيب البداية كل اول شهر»)', () => {
    // A fixed "now", so "the current month" is a fact of the test rather than of the day it runs.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // 00:30 in Cairo on 1 November — still 31 October in UTC: the month is Cairo's.
      vi.setSystemTime(new Date('2026-10-31T22:30:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('opens on the current month — its first and last day in the boxes, and in the request', () => {
      // Nothing in the URL: the page must ask for 1–30 November, or this seeded answer is not shown.
      const html = renderVault(VAULT, '', RANGE);
      expect(html).toContain(`value="${RANGE.from}"`);
      expect(html).toContain(`value="${RANGE.to}"`);
      expect(bodyRows(html)).toHaveLength(4);
      expect(html).toContain(`aria-label="${ar('operations.reports.from')}"`);
      expect(html).toContain(`aria-label="${ar('operations.reports.to')}"`);
      expect(html).toContain('data-date-label="from"');
      expect(html).toContain('data-date-label="to"');
    });

    it('asks for the period in the URL — and for no other', () => {
      const october = { from: '2026-10-01', to: '2026-10-31' };
      const html = renderVault(VAULT, `?from=${october.from}&to=${october.to}`, october);
      expect(html).toContain(`value="${october.from}"`);
      expect(bodyRows(html)).toHaveLength(4);
      // The same answer filed under November is not October's: the page asks for what it shows.
      const elsewhere = renderVault(VAULT, `?from=${october.from}&to=${october.to}`, RANGE);
      expect(elsewhere).not.toContain('data-report-total="true"');
    });

    it('fills an emptied bound back from the current month, per field', () => {
      // Only «من» typed: «إلى» is the month's last day.
      const html = renderVault(VAULT, '?from=2026-11-10', { from: '2026-11-10', to: RANGE.to });
      expect(html).toContain('value="2026-11-10"');
      expect(html).toContain(`value="${RANGE.to}"`);
      expect(bodyRows(html)).toHaveLength(4);
    });

    it('refuses an inverted range in words, in the table’s place — never sent', () => {
      const html = renderVault(VAULT, '?from=2026-11-20&to=2026-11-05', {
        from: '2026-11-20',
        to: '2026-11-05',
      });
      expect(html).toContain(ar('operations.reports.invalidRange'));
      expect(html).toContain('data-shipments-refusal="true"');
      expect(html).not.toContain('<table');
      // Nor the panel: its figures would be a period nobody asked for.
      expect(html).not.toContain('data-vault-value-total=');
    });

    it('sends the range, as «تقرير القادة» does — no dates held back', () => {
      expect(VAULT_PAGE).toContain(
        "const range = rangeFromParams({ from: sp.get('from'), to: sp.get('to') }, new Date());",
      );
      expect(VAULT_PAGE).toContain('const report = useVaultReport(range, valid);');
      expect(VAULT_PAGE).not.toContain('PENDING');
      expect(VAULT_PAGE).not.toContain('optional: true');
    });
  });

  it('says nothing entered the vault in the period, in the table’s place, with no row of zeros', () => {
    const html = renderVault({
      ...VAULT,
      rows: [],
      grandTotal: totals(0, [0, 0, 0], []),
    });
    // Not «الخزينة فارغة»: a month with no receipt says nothing about what the vault holds now.
    expect(html).toContain(ar('operations.vaultReport.empty'));
    expect(html).not.toContain(ar('operations.vault.empty'));
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
    expect(BOARD).toContain(
      '<FilterBar hasActiveFilters={filtersActive} onClear={onResetFilters} trailing={exports}>',
    );
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

  it('leaves «تقرير البنوك» as it was', () => {
    expect(BANK_PAGE).toContain(
      "import { ReportView, type ReportRow } from '../components/ReportView';",
    );
    expect(BANK_PAGE).toContain('<ReportRangePicker range={range} onChange={setRange} />');
    expect(BANK_PAGE).not.toContain('ReportBoard');
  });

  it('lends «سجل الخزينة»’s «تقرير الخزينة» its table and its files — the same «بيان الشحنات لكل بنك» over what is held now', () => {
    expect(BOARD).toMatch(/export const ReportTable = \(/);
    expect(BOARD).toMatch(/export const ReportExportPair = \(/);
    expect(HELD_DIALOG).toContain("import { ReportExportPair, ReportTable } from './ReportBoard';");
    expect(HELD_DIALOG).toContain('<ReportTable');
    expect(HELD_DIALOG).toContain('<ReportExportPair');
    // The page opens it; it draws no table of its own.
    expect(INVENTORY_PAGE).toContain('<VaultHeldReportDialog');
    expect(INVENTORY_PAGE).not.toContain('<ReportTable');
  });
});

// ── Round 12 — «شيل الديف اللى فيها الفلاتر بتاعت التاريخ وخليها زى الفلاتر عادى وزود ان اعمل فلتر ب
// اسم القائد [البنك] و ان اكسيل او pdf … الlist بتاعت جمالى العملات … بطول الشاشة كامله … الصف بتاع
// الجماليات يفضل ظاهر حتى لو الجدول كبر» ───────────────────────────────────────────────────────────

describe('one bar, the boards’ — the name, «من», «إلى», the reset, «Excel | PDF»', () => {
  it('runs the screen’s width: the dates no longer sit in a card of their own', () => {
    // Round 11's bar shrank to its two dates (`sm:[&>div]:!w-fit`) — the «ديف» the owner circled.
    expect(BOARD).not.toContain('!w-fit');
    expect(BOARD).toContain('DARK_FILTER_BAR,\n  BAR_LAYOUT,');
  });

  it('puts the name filter first, the two dates after it, the files at the bar’s end', () => {
    const html = renderCaptains();
    const bar = html.slice(html.indexOf('data-report-filters'), html.indexOf('data-report-row'));
    const at = (needle: string): number => bar.indexOf(needle);
    expect(at('data-report-name-filter')).toBeGreaterThan(-1);
    expect(at('data-report-name-filter')).toBeLessThan(at('data-date-label="from"'));
    expect(at('data-date-label="from"')).toBeLessThan(at('data-date-label="to"'));
    expect(at('data-date-label="to"')).toBeLessThan(at('data-report-export-excel'));
    expect(at('data-report-export-excel')).toBeLessThan(at('data-report-export-pdf'));
    // The boards' text box, named for what it filters.
    expect(bar).toContain(`placeholder="${ar('operations.reports.captainName')}"`);
    expect(bar).toContain(`aria-label="${ar('operations.reports.captainName')}"`);
  });

  it('names the vault’s box «اسم البنك»', () => {
    const html = renderVault();
    expect(ar('operations.reports.bankName')).toBe('اسم البنك');
    expect(html).toContain(`placeholder="${ar('operations.reports.bankName')}"`);
  });

  it('keeps a date at a date’s width from a computer up, the name taking the row’s give', () => {
    expect(BOARD).toContain(
      'lg:[&>div>*:has(>input[type=date])]:!flex-none lg:[&>div>*:has(>input[type=date])]:!w-44',
    );
  });
});

describe('the name filter — applied as typed, and «الإجمالي» FOLLOWS it', () => {
  const captains = (query: string): string =>
    render(
      `/operations/reports/captains?from=${RANGE.from}&to=${RANGE.to}&name=${encodeURIComponent(query)}`,
      <CaptainReportPage />,
      (qc) => qc.setQueryData(listKey('operations', 'reportCaptains', RANGE), CAPTAINS),
    );
  const vault = (query: string): string =>
    render(
      `/operations/reports/vault?from=${RANGE.from}&to=${RANGE.to}&name=${encodeURIComponent(query)}`,
      <VaultReportPage />,
      (qc) => qc.setQueryData(listKey('operations', 'vaultReport', RANGE), VAULT),
    );

  it('narrows the captains to the names that hold it — typed without the hamza', () => {
    const rows = bodyRows(captains('محمود')).map(cells);
    expect(rows.map((row) => row.slice(0, 3))).toEqual([
      ['1', 'محمود حسن عبد الله', '46'],
      ['', 'الإجمالي', '46'],
    ]);
    // The box holds what was typed; the reset has something to undo.
    expect(captains('محمود')).toContain('value="محمود"');
    expect(captains('محمود')).toContain(`aria-label="${ar('common.filters.clear')}"`);
  });

  it('totals the rows SHOWN with a name typed — not the server’s grand total', () => {
    const total = bodyRows(vault('الاهلي')).map(cells).at(-1);
    // الأهلي alone: its own 14 / 48,500,000 / 1,250,000 / 770,000 / 38 / 6 / 3.
    expect(total).toEqual([
      '',
      'الإجمالي',
      '14',
      '48,500,000',
      '1,250,000',
      '770,000',
      '38',
      '6',
      '3',
    ]);
  });

  it('turns the vault’s panel with the table — the same total, the shown banks’ own', () => {
    const html = vault('الاهلي');
    const sum = (which: string): string => {
      const at = html.indexOf(`data-vault-value-total="${which}"`);
      return html.slice(at, html.indexOf('</div>', html.indexOf('dir="ltr"', at)));
    };
    expect(sum('egp')).toContain('48,500,000');
    // The dollar, the riyal and the euro of الأهلي — 1,250,000 + 450,000 + 320,000.
    expect(sum('foreign')).toContain('2,020,000');
  });

  it('finds the unattributed bucket by the words it is drawn with', () => {
    const rows = bodyRows(captains('منسوب')).map(cells);
    expect(rows.map((row) => row.slice(0, 3))).toEqual([
      ['1', ar('operations.reports.unattributed'), '3'],
      ['', 'الإجمالي', '3'],
    ]);
  });

  it('says so in words when no name matches — no total, no panel, nothing to export', () => {
    const html = captains('زكريا');
    expect(html).toContain(ar('operations.reports.captains.noName'));
    expect(html).not.toContain('data-report-total="true"');
    expect(html).toMatch(/<button type="button" data-report-export-excel="true" disabled=""/);
    const none = vault('زكريا');
    expect(none).toContain(ar('operations.vaultReport.noName'));
    expect(none).not.toContain('data-vault-value=');
  });

  it('keeps the name in the URL and remembers it — never the period', () => {
    for (const page of [CAPTAIN_PAGE, VAULT_PAGE]) {
      expect(page).toContain("const name = sp.get('name') ?? '';");
      expect(page).toContain("const REMEMBERED_FILTERS = ['name'] as const;");
      expect(page).toContain('useRememberedFilters(search, REMEMBERED_FILTERS);');
      // Typing is a view of the same report, not a place to go Back to.
      expect(page).toMatch(/next\.set\('name', value\);\s+setSp\(next, \{ replace: true \}\);/);
      // One reset clears the name and the period together.
      expect(page).toMatch(
        /next\.delete\('from'\);\s+next\.delete\('to'\);\s+next\.delete\('name'\);/,
      );
    }
  });
});

describe('«Excel | PDF» — exactly what is shown', () => {
  it('offers both while the table has lines', () => {
    const html = renderCaptains();
    expect(html).toMatch(/<button type="button" data-report-export-excel="true" class=/);
    expect(html).toMatch(/<button type="button" data-report-export-pdf="true" class=/);
  });

  it('carries the lines the table draws, and the vault its panel too', () => {
    expect(BOARD).toContain('const lines = refusal === null ? reportTableLines(rows, total) : [];');
    expect(BOARD).toContain(
      'reportExportTable(lines, catalog, reportExportHeader(t, keyHeader, countHeader), nameOf)',
    );
    expect(BOARD).toContain('vaultPanelExport(t, total, catalog)');
    expect(VAULT_PAGE).toContain('withValuePanel: true,');
    expect(CAPTAIN_PAGE).not.toContain('withValuePanel');
  });

  it('says on paper which period and which name the file is', () => {
    for (const page of [CAPTAIN_PAGE, VAULT_PAGE]) {
      expect(page).toMatch(
        /subtitle: reportExportSubtitle\(t, \{\s+period: range,\s+filter: \{ label: t\(/,
      );
    }
  });
});

describe('the height — the table to the screen’s bottom, «الإجمالي» always on it, the panel as tall', () => {
  it('stretches the table’s card and the panel to the row’s height on a computer', () => {
    expect(BOARD).toContain(
      "'flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch'",
    );
    expect(BOARD).toContain('className="max-lg:max-h-[75vh] lg:min-h-0 lg:flex-1"');
    // Round 11's `lg:max-h-full` let both cards stop at their content's height.
    expect(BOARD).not.toContain('lg:max-h-full');
    expect(PANEL).not.toContain('lg:max-h-full');
    expect(PANEL).toContain("className = 'lg:w-80 lg:shrink-0 xl:w-[22rem]'");
  });

  it('scrolls the panel’s currency list inside it, under its two sums', () => {
    expect(PANEL).toContain(
      '<ul className="min-h-0 flex-1 overflow-y-auto" data-vault-value-list="true">',
    );
    const html = renderVault();
    expect(html.indexOf('data-vault-value-total="foreign"')).toBeLessThan(
      html.indexOf('data-vault-value-list="true"'),
    );
  });

  it('lets only the rows scroll: the head sticks at the top and «الإجمالي» at the bottom', () => {
    expect(BOARD).toContain(
      "'flex min-h-0 flex-col lg:flex-1 [&>div]:min-h-0 lg:[&>div]:flex-1 [&>div]:!rounded-none [&>div]:!border-0'",
    );
    expect(BOARD).toContain('stickyHead');
    expect(BOARD).toContain(
      '[&_tr[data-report-total]_td]:sticky [&_tr[data-report-total]_td]:bottom-0',
    );
  });
});
