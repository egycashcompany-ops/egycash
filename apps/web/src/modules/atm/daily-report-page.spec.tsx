// /atm/reports/daily «تقرير اليوم», rendered from a pre-filled query cache:
//
//   · the day sits in the header, on the title's line (2026-11-02, «عايز تطلع الصف بتاع الـ Form
//     يبقي بجانب العنوان عشان نستفيد بالمساحة»);
//   · each of the two tables has a filter box per column (2026-11-02, «فلتر لكل عمود»), and the
//     totals line under a table adds up exactly the banks its boxes keep — never rows off screen.
//
// Every bank name and count below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  type AtmBankCountsDto,
  type AtmDailyReportDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import {
  DailyReportPage,
  bankCountsText,
  shownBankCounts,
  sumBankCounts,
} from './pages/DailyReportPage';

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const DAY = '2026-10-28';

const REPLENISHMENTS: AtmBankCountsDto[] = [
  { bankName: 'بنك تجريبي أول', total: 12, open: 3 },
  { bankName: 'بنك تجريبي ثان', total: 7, open: 0 },
  { bankName: 'SYN BANK', total: 20, open: 11 },
];

const REPORT: AtmDailyReportDto = {
  date: DAY,
  replenishments: REPLENISHMENTS,
  maintenances: [{ bankName: 'بنك تجريبي أول', total: 4, open: 1 }],
};

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'atmReport.view': 'branch' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('atm', 'reports', { kind: 'daily', date: DAY }), REPORT);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/atm/reports/daily?date=${DAY}`]}>
          <DailyReportPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The markup of the header's toolbar slot (`PageHeader toolbar`), alone — '' when there is none. */
const toolbarOf = (html: string): string => {
  const at = html.indexOf('data-page-toolbar="true"');
  if (at < 0) return '';
  const open = html.lastIndexOf('<div', at);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  return '';
};

describe('the day on the title’s line (2026-11-02)', () => {
  it('sits inside the header, after the title', () => {
    const html = render();
    const toolbar = toolbarOf(html);
    expect(toolbar).toContain('data-report-toolbar="true"');
    expect(toolbar).toContain(`value="${DAY}"`);
    expect(toolbar).toContain(t('atm.reports.day'));
    expect(toolbar).not.toContain('max-w-xs');
    expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('data-page-toolbar'));
  });
});

describe('the two tables’ filter boxes (2026-11-02, «فلتر لكل عمود»)', () => {
  it('draws a box under every column of each table', () => {
    const html = render();
    const boxes = [...html.matchAll(/data-column-filter="([^"]+)"/g)].map((m) => m[1]);
    expect(boxes).toEqual(['bank', 'open', 'total', 'bank', 'open', 'total']);
    expect(html).toContain(
      `aria-label="${t('atm.common.filterColumn', { column: t('atm.common.bank') })}"`,
    );
  });

  it('matches what each cell shows: the bank’s name, the counts as written', () => {
    const [first] = REPLENISHMENTS;
    if (first === undefined) throw new Error('fixture');
    expect(bankCountsText(first, 'bank')).toBe('بنك تجريبي أول');
    expect(bankCountsText(first, 'open')).toBe('3');
    expect(bankCountsText(first, 'total')).toBe('12');
    expect(bankCountsText(first, 'nothing')).toBeNull();
  });

  it('totals exactly the banks the boxes keep', () => {
    expect(shownBankCounts(REPLENISHMENTS, {})).toEqual({
      rows: REPLENISHMENTS,
      totals: sumBankCounts(REPLENISHMENTS),
    });
    const tried = shownBankCounts(REPLENISHMENTS, { bank: 'تجريبي' });
    expect(tried.rows.map((row) => row.bankName)).toEqual(['بنك تجريبي أول', 'بنك تجريبي ثان']);
    expect(tried.totals).toEqual({ total: 19, open: 3 });
    // «اول» finds «أول» (hamza folded); two boxes add up.
    expect(shownBankCounts(REPLENISHMENTS, { bank: 'اول', open: '3' }).totals).toEqual({
      total: 12,
      open: 3,
    });
    expect(shownBankCounts(REPLENISHMENTS, { total: '99' })).toEqual({
      rows: [],
      totals: { total: 0, open: 0 },
    });
  });

  it('the page’s totals line, with no box typed, is the whole report’s', () => {
    expect(render()).toContain(t('atm.reports.totalsLine', { open: 14, total: 39 }));
  });
});
