// /atm/reports/daily «تقرير اليوم», rendered from a pre-filled query cache:
//
//   · the day sits in the header, on the title's line (2026-11-02, «عايز تطلع الصف بتاع الـ Form
//     يبقي بجانب العنوان عشان نستفيد بالمساحة»);
//   · each of the two tables has a column filter per column (2026-11-02, «فلتر لكل عمود», then «لأ
//     عايز الفلتر الكبير اللى فوق الجداول يكون Drop Down بـ Multi select»): a drop-down list of the
//     values the column's cells show, several of them pickable — and the totals line under a table
//     adds up exactly the banks its lists keep, never rows off screen.
//
// Every bank name and count below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
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
import { cairoToday } from './lib/operation-view';

// The column lists' picks, set per test: a static render cannot open a list to pick from it. Empty
// by default, so every other test renders the report unfiltered. Both tables read the same picks.
let columnValues: Record<string, string[]> = {};
vi.mock('../../shared/ui/useColumnFilters', () => ({
  useColumnFilters: () => ({
    values: columnValues,
    set: () => {},
    clear: () => {},
    active: Object.values(columnValues).some((value) => value.length > 0),
    generation: 0,
  }),
}));

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const DAY = '2026-10-28';

const REPLENISHMENTS: AtmBankCountsDto[] = [
  { bankName: 'بنك تجريبي أول', total: 12, open: 3 },
  { bankName: 'بنك تجريبي ثان', total: 7, open: 0 },
  { bankName: 'SYN BANK', total: 20, open: 11 },
];

const REPORT: AtmDailyReportDto = {
  from: DAY,
  to: DAY,
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

/**
 * The page at an address, its report read for `period` — the period the page should ask for. Any
 * other period finds nothing in the cache, and the page shows its tables loading.
 */
const render = (
  search = `?date=${DAY}`,
  period: { from: string; to: string } = { from: DAY, to: DAY },
  report: AtmDailyReportDto = REPORT,
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('atm', 'reports', { kind: 'daily', ...period }), {
    ...report,
    ...period,
    date: period.from,
  });
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/atm/reports/daily${search}`]}>
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

/** The two date fields of the toolbar, «من» then «إلى», by their values. */
const periodShown = (html: string): string[] =>
  [...toolbarOf(html).matchAll(/<input[^>]*type="date"[^>]*>/g)].map(
    (m) => /value="([^"]*)"/.exec(m[0])?.[1] ?? '',
  );
const BANK_ROW = '>SYN BANK<';

describe('the period on the title’s line (2026-11-02)', () => {
  it('sits inside the header, after the title — «من» and «إلى»', () => {
    const html = render();
    const toolbar = toolbarOf(html);
    expect(toolbar).toContain('data-report-toolbar="true"');
    expect(toolbar).toContain(t('atm.done.from'));
    expect(toolbar).toContain(t('atm.done.to'));
    expect(periodShown(html)).toEqual([DAY, DAY]);
    expect(toolbar).not.toContain('max-w-xs');
    expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('data-page-toolbar'));
  });
});

describe('a period, «من … إلى …» — «بس الـ Default يكون اليوم» (2026-11-02)', () => {
  it('is today, from and to, when the address names no day', () => {
    const today = cairoToday();
    const html = render('', { from: today, to: today });
    expect(periodShown(html)).toEqual([today, today]);
    // The report read is today's: its rows are on the page.
    expect(html).toContain(BANK_ROW);
  });

  it('reads the period the address names, and asks the server for exactly it', () => {
    const period = { from: '2026-10-20', to: '2026-10-28' };
    const html = render('?from=2026-10-20&to=2026-10-28', period);
    expect(periodShown(html)).toEqual(['2026-10-20', '2026-10-28']);
    expect(html).toContain(BANK_ROW);
    // Another period is another read: nothing of this one's is shown for it.
    expect(render('?from=2026-10-21&to=2026-10-28', period)).not.toContain(BANK_ROW);
  });

  it('one bound serves as both, and a «إلى» before the «من» reads the days between', () => {
    expect(
      periodShown(render('?from=2026-10-20', { from: '2026-10-20', to: '2026-10-20' })),
    ).toEqual(['2026-10-20', '2026-10-20']);
    const swapped = { from: '2026-10-20', to: '2026-10-28' };
    const html = render('?from=2026-10-28&to=2026-10-20', swapped);
    expect(periodShown(html)).toEqual(['2026-10-20', '2026-10-28']);
    expect(html).toContain(BANK_ROW);
  });

  it('opens a link from before the period (`?date=`) on its one day', () => {
    const html = render(`?date=${DAY}`, { from: DAY, to: DAY });
    expect(periodShown(html)).toEqual([DAY, DAY]);
    expect(html).toContain(BANK_ROW);
  });

  it('says «nothing in this period» for a period, and «nothing on this day» for a day', () => {
    const none: AtmDailyReportDto = { ...REPORT, replenishments: [], maintenances: [] };
    const period = { from: '2026-10-20', to: '2026-10-28' };
    const longer = render('?from=2026-10-20&to=2026-10-28', period, none);
    expect(longer).toContain(t('atm.reports.emptyPeriod'));
    expect(longer).not.toContain(t('atm.reports.empty'));
    const oneDay = render(`?from=${DAY}&to=${DAY}`, { from: DAY, to: DAY }, none);
    expect(oneDay).toContain(t('atm.reports.empty'));
    expect(oneDay).not.toContain(t('atm.reports.emptyPeriod'));
  });
});

describe('the two tables’ column lists (2026-11-02, «فلتر لكل عمود», a Multi select drop-down)', () => {
  const COLUMNS = [
    ['bank', 'atm.common.bank'],
    ['open', 'atm.reports.open'],
    ['total', 'atm.reports.total'],
  ] as const;
  /** Every column list of the page, in order: its trigger, from the list's marker to its cell's end. */
  const listsOf = (html: string): string[] =>
    [...html.matchAll(/data-column-filter="[^"]+"/g)].map((m) =>
      html.slice(m.index, html.indexOf('</th>', m.index)),
    );
  /** The page, its lists holding these picks. */
  const withPicks = (values: Record<string, string[]>): string => {
    columnValues = values;
    try {
      return render();
    } finally {
      columnValues = {};
    }
  };

  it('draws a list under every column of each table', () => {
    const html = render();
    const lists = [...html.matchAll(/data-column-filter="([^"]+)"/g)].map((m) => m[1]);
    expect(lists).toEqual(['bank', 'open', 'total', 'bank', 'open', 'total']);
    // Each a drop-down named after its column, saying «الكل» while nothing is picked.
    const triggers = listsOf(html);
    [...COLUMNS, ...COLUMNS].forEach(([, header], at) => {
      expect(triggers[at]).toContain('aria-haspopup="listbox"');
      expect(triggers[at]).toContain(
        `aria-label="${t('atm.common.filterColumn', { column: t(header) })}"`,
      );
      expect(triggers[at]).toContain(`>${t('common.filters.all')}<`);
    });
    expect(html).not.toContain('type="search"');
  });

  it('names the picks on the list’s trigger, and totals the banks they keep', () => {
    const html = withPicks({ bank: ['بنك تجريبي أول', 'SYN BANK'] });
    const [bank, open] = listsOf(html);
    expect(bank).toContain('>بنك تجريبي أول, SYN BANK<');
    expect(open).toContain(`>${t('common.filters.all')}<`);
    expect(html).toContain(t('atm.reports.totalsLine', { open: 14, total: 32 }));
    expect(html).toContain(t('atm.reports.totalsLine', { open: 1, total: 4 }));
  });

  it('says the lists hid every bank when no bank holds their picks — and only then', () => {
    const none = withPicks({ total: ['99'] });
    expect(none).toContain(t('atm.common.emptyColumnFiltered'));
    expect(none).not.toContain(t('atm.reports.totalsLine', { open: 14, total: 39 }));
    expect(none).not.toContain(t('atm.reports.totalsLine', { open: 0, total: 0 }));
    expect(render()).not.toContain(t('atm.common.emptyColumnFiltered'));
  });

  it('lists what each cell shows: the bank’s name, the counts as written', () => {
    const [first] = REPLENISHMENTS;
    if (first === undefined) throw new Error('fixture');
    expect(bankCountsText(first, 'bank')).toBe('بنك تجريبي أول');
    expect(bankCountsText(first, 'open')).toBe('3');
    expect(bankCountsText(first, 'total')).toBe('12');
    expect(bankCountsText(first, 'nothing')).toBeNull();
  });

  it('totals exactly the banks the lists keep', () => {
    expect(shownBankCounts(REPLENISHMENTS, {})).toEqual({
      rows: REPLENISHMENTS,
      totals: sumBankCounts(REPLENISHMENTS),
    });
    // Two picks in one column: either keeps the bank.
    const two = shownBankCounts(REPLENISHMENTS, { bank: ['بنك تجريبي أول', 'بنك تجريبي ثان'] });
    expect(two.rows.map((row) => row.bankName)).toEqual(['بنك تجريبي أول', 'بنك تجريبي ثان']);
    expect(two.totals).toEqual({ total: 19, open: 3 });
    // Two columns: both must.
    expect(
      shownBankCounts(REPLENISHMENTS, { bank: ['بنك تجريبي أول', 'SYN BANK'], open: ['3'] }).totals,
    ).toEqual({ total: 12, open: 3 });
    // A pick no bank holds: nothing, and nothing to total.
    expect(shownBankCounts(REPLENISHMENTS, { total: ['99'] })).toEqual({
      rows: [],
      totals: { total: 0, open: 0 },
    });
  });

  it('keeps a bank whose cell IS the pick — a whole name, written as the cell writes it', () => {
    expect(shownBankCounts(REPLENISHMENTS, { bank: ['بنك تجريبي أول'] }).totals).toEqual({
      total: 12,
      open: 3,
    });
    // A part of a name is no value of the column, and neither is a spelling the cell does not use:
    // «اول» without its hamza is not «أول».
    expect(shownBankCounts(REPLENISHMENTS, { bank: ['تجريبي'] }).rows).toEqual([]);
    expect(shownBankCounts(REPLENISHMENTS, { bank: ['بنك تجريبي اول'] }).rows).toEqual([]);
  });

  it('the page’s totals line, with nothing picked, is the whole report’s', () => {
    expect(render()).toContain(t('atm.reports.totalsLine', { open: 14, total: 39 }));
  });
});
