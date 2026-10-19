// The Data Report page (spec §8.5, §10.2) as a reader meets it: rendered from a pre-filled query
// cache, the way the fleet dashboard is pinned (fleet-dashboard.spec.tsx). The model's rules are
// pinned in `lib/register-report-view.spec.ts`; this file pins that the page DRAWS them — the three
// sections in the sheet's order, every chart and table left-to-right inside the Arabic page, the
// first category at the smallest x, the owner's colours on the right charts, a `0` where nothing
// is counted, only the branches the server shows, and the as-of stamp in the sheet's format.
//
// Every number below is synthetic, folded by the contracts' own fold.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ATM_BANK_REPORT_COLORS,
  ATM_REGISTER_BRANCH_CODES,
  ATM_REPORT_TOTALS_COLOR,
  foldAtmRegisterReport,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterReportDto,
  type AtmRegisterReportGroup,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { RegisterReportPage } from './pages/RegisterReportPage';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 23:30 UTC on the 15th is already the 16th in Cairo — the stamp is the Cairo day. */
const GENERATED_AT = '2026-03-15T23:30:00.000Z';

const GROUPS: AtmRegisterReportGroup[] = [
  { branchCode: 'EGYCASH-1', bankCode: 'NBE', count: 40 },
  { branchCode: 'EGYCASH-1', bankCode: 'BM', count: 12 },
  { branchCode: 'EGYCASH-4', bankCode: 'NXT', count: 3 },
  { branchCode: 'EGYCASH-4', bankCode: 'HDB', count: 5 },
  { branchCode: 'EGYCASH-7', bankCode: 'CIB', count: 2 },
  { branchCode: 'EGYCASH-6', bankCode: null, count: 1 },
  { branchCode: null, bankCode: 'BRK', count: 4 },
];

const report = (
  shown: readonly AtmRegisterBranchCode[] = ATM_REGISTER_BRANCH_CODES,
  groups: readonly AtmRegisterReportGroup[] = GROUPS,
): AtmRegisterReportDto => ({
  generatedAt: GENERATED_AT,
  branchesShown: [...shown],
  counts: foldAtmRegisterReport(groups, shown),
});

const store = (locale: Locale) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: {
        me: {
          id: 'u1',
          permissions: { 'atmRegisterReport.view': 'organization' },
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = (data: AtmRegisterReportDto | null = report(), locale: Locale = 'ar'): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (data !== null) qc.setQueryData(listKey('atm', 'registerReport'), data);
  return renderToStaticMarkup(
    <Provider store={store(locale)}>
      <QueryClientProvider client={qc}>
        <RegisterReportPage />
      </QueryClientProvider>
    </Provider>,
  );
};

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** One section's markup, from its marker to the next section (or the end). */
const sectionOf = (markup: string, n: 1 | 2 | 3): string => {
  const at = markup.indexOf(`data-report-section="${String(n)}"`);
  if (at === -1) return '';
  const next = markup.indexOf('data-report-section="', at + 1);
  return markup.slice(at, next === -1 ? undefined : next);
};

/** The bars of a chart, left to right as drawn: key, slot x, and the fill of its path (if any). */
const barsOf = (
  markup: string,
): { key: string; x: number; series: string | null; fill: string | null }[] =>
  [
    ...markup.matchAll(
      /<g data-report-bar="([^"]+)"(?: data-report-series="([^"]+)")?[^>]*><rect data-report-hit="[^"]+" x="([\d.]+)"[^>]*><\/rect>(?:<path d="[^"]*" fill="([^"]+)"><\/path>)?/g,
    ),
  ].map((m) => ({
    key: m[1] as string,
    series: m[2] ?? null,
    x: Number(m[3]),
    fill: m[4] ?? null,
  }));

const cellText = (markup: string, key: string): string | null => {
  const m = new RegExp(`data-report-cell="${key.replace(/\./g, '\\.')}"[^>]*>([^<]*)<`).exec(
    markup,
  );
  return m === null ? null : (m[1] as string);
};

describe('the page', () => {
  it('opens under its title, stamped with the Cairo day the server counted', () => {
    const markup = render();
    expect(markup).toContain(t('atm.registerReport.title'));
    expect(markup).toContain('data-report-as-of="true"');
    const en = render(report(), 'en');
    expect(en).toContain('As of 16 / March / 2026');
    // The Arabic stamp: the same day, the month spelled out, the sheet's slashes.
    expect(markup).toMatch(/بتاريخ [^<]+ \/ مارس \/ [^<]+</);
  });

  it('lays out the three sections in the sheet order, each chart with its table under it', () => {
    const markup = render();
    const at = [1, 2, 3].map((n) => markup.indexOf(`data-report-section="${String(n)}"`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const n of [1, 2, 3] as const) {
      const section = sectionOf(markup, n);
      expect(section).toContain(t(`atm.registerReport.section${String(n)}`));
      const chart = section.indexOf('data-report-chart=');
      const table = section.indexOf('data-report-table=');
      expect(chart).toBeGreaterThan(-1);
      expect(table).toBeGreaterThan(chart);
    }
  });

  it('wraps every chart and every table in dir="ltr", and keeps each label dir="auto"', () => {
    const markup = render();
    const frames = [...markup.matchAll(/<div[^>]*data-report-(chart|table)="\d"[^>]*>/g)];
    expect(frames).toHaveLength(6);
    for (const [tag] of frames) expect(tag).toContain('dir="ltr"');
    const labels = [...markup.matchAll(/<span[^>]*data-report-category="[^"]+"[^>]*>/g)];
    expect(labels.length).toBe(7 + 8 + 7);
    for (const [tag] of labels) expect(tag).toContain('dir="auto"');
  });

  it('gives each drawing one summary for a screen reader', () => {
    const markup = render();
    const images = [...markup.matchAll(/<svg[^>]*role="img"[^>]*aria-label="([^"]+)"/g)];
    expect(images.map((m) => m[1])).toEqual([
      t('atm.registerReport.chartSummary', {
        title: t('atm.registerReport.section1'),
        total: '66',
      }),
      t('atm.registerReport.chartSummary', {
        title: t('atm.registerReport.section2'),
        total: '63',
      }),
      t('atm.registerReport.chartSummary', {
        title: t('atm.registerReport.section3'),
        total: '62',
      }),
    ]);
  });

  it('waits for the report, and draws nothing invented meanwhile', () => {
    const markup = render(null);
    expect(markup).toContain(translate('ar', 'common.loading'));
    expect(markup).not.toContain('data-report-section=');
    expect(markup).not.toContain('data-report-as-of=');
  });
});

describe('charts 1–2', () => {
  it('draws the first category at the smallest x and the total bar last, in #4472C4', () => {
    const markup = render();
    const one = barsOf(sectionOf(markup, 1));
    expect(one.map((bar) => bar.key)).toEqual([
      's1.NXT',
      's1.NBE',
      's1.BM',
      's1.CIB',
      's1.HDB',
      's1.BRK',
      's1.total',
    ]);
    const xs = one.map((bar) => bar.x);
    expect(xs[0]).toBe(Math.min(...xs));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(one.every((bar) => bar.fill === ATM_REPORT_TOTALS_COLOR)).toBe(true);

    const two = barsOf(sectionOf(markup, 2));
    expect(two[0]?.key).toBe('s2.EGYCASH-7');
    expect(two[two.length - 1]?.key).toBe('s2.total');
    // Tanta has nothing in operation: no bar to fill, its value still written.
    expect(two.find((bar) => bar.key === 's2.EGYCASH-2')?.fill).toBeNull();
    expect(two.filter((bar) => bar.fill !== null).every((b) => b.fill === '#4472C4')).toBe(true);
    expect(sectionOf(markup, 2)).toContain('data-report-divider="true"');
  });

  it('labels the total with the provisional formal spelling, never the sheet’s «اجمالى»', () => {
    const markup = render();
    expect(markup).toContain('إجمالي عدد الماكينات');
    expect(markup).not.toContain('اجمالى');
  });

  it('writes the sheet’s typo-fixed names', () => {
    const markup = render();
    expect(markup).toContain('فرع إيجي كاش بور سعيد');
    expect(markup).toContain('فرع إيجي كاش الإسكندرية');
    expect(markup).toContain('NXT BANK');
    expect(markup).not.toContain('الاسكندية');
    expect(markup).not.toContain('NXT  BANK');
  });

  it('shows 0 where nothing is counted — in the table and on the bar', () => {
    const markup = render();
    expect(cellText(markup, 's2.EGYCASH-2')).toBe('0');
    expect(cellText(markup, 's2.EGYCASH-5')).toBe('0');
    expect(cellText(markup, 's1.total')).toBe('66');
    expect(cellText(markup, 's2.total')).toBe('63');
    const tanta = /data-report-bar="s2\.EGYCASH-2"[\s\S]*?<text[^>]*>([^<]*)<\/text>/.exec(markup);
    expect(tanta?.[1]).toBe('0');
  });
});

describe('chart 3', () => {
  it('runs the branches left to right with the six banks in their own colours', () => {
    const section = sectionOf(render(), 3);
    const bars = barsOf(section);
    expect(bars).toHaveLength(42);
    expect(bars[0]?.key).toBe('s3.EGYCASH-1.NBE');
    const xs = bars.map((bar) => bar.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (const bar of bars) {
      if (bar.fill === null) continue;
      expect(bar.fill).toBe(ATM_BANK_REPORT_COLORS[bar.series as AtmBankCode]);
    }
    expect(bars.filter((bar) => bar.fill !== null).map((bar) => bar.key)).toEqual([
      's3.EGYCASH-1.NBE',
      's3.EGYCASH-1.BM',
      's3.EGYCASH-4.HDB',
      's3.EGYCASH-4.NXT',
      's3.EGYCASH-7.CIB',
    ]);
    expect(section).not.toContain(ATM_REPORT_TOTALS_COLOR);
  });

  it('writes a value on every bar, a zero included', () => {
    const section = sectionOf(render(), 3);
    const values = [
      ...section.matchAll(/data-report-bar="[^"]+"[\s\S]*?<text[^>]*>([^<]*)<\/text>/g),
    ];
    expect(values).toHaveLength(42);
    expect(values.filter((m) => m[1] === '0')).toHaveLength(37);
  });

  it('names its banks in a legend, swatch beside each name', () => {
    const section = sectionOf(render(), 3);
    expect(section).toContain(`aria-label="${t('atm.registerReport.legend')}"`);
    const items = [...section.matchAll(/data-report-legend-item="([^"]+)"/g)].map((m) => m[1]);
    expect(items).toEqual(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT']);
    expect(section).toContain('background-color:#FFD966');
    expect(section).toContain('البنك التجارى الدولى');
  });

  it('tables every branch × bank, zeros written, no totals', () => {
    const markup = render();
    expect(cellText(markup, 's3.EGYCASH-1.NBE')).toBe('40');
    expect(cellText(markup, 's3.EGYCASH-4.HDB')).toBe('5');
    expect(cellText(markup, 's3.EGYCASH-4.NXT')).toBe('3');
    expect(cellText(markup, 's3.EGYCASH-6.NBE')).toBe('0');
    const cells = [...sectionOf(markup, 3).matchAll(/data-report-cell="([^"]+)"/g)];
    expect(cells).toHaveLength(42);
    expect(sectionOf(markup, 3)).not.toContain('total');
  });
});

describe('a reader sees only their branches', () => {
  it('draws Alexandria alone for an Alexandria-scoped reader', () => {
    const markup = render(report(['EGYCASH-4']));
    expect(markup).toContain('فرع إيجي كاش الإسكندرية');
    expect(markup).not.toContain('فرع إيجي كاش المهندسين');
    expect(markup).not.toContain('إيجي كــاش ( المهندسين )');
    expect(barsOf(sectionOf(markup, 2)).map((bar) => bar.key)).toEqual([
      's2.EGYCASH-4',
      's2.total',
    ]);
    expect(markup).not.toMatch(/data-report-cell="s3\.EGYCASH-1\./);
    // The banks are company-wide: all six stay in section 1.
    expect(barsOf(sectionOf(markup, 1))).toHaveLength(7);
  });

  it('says there is nothing to draw when no branch is shown', () => {
    const markup = render(report([]));
    expect(sectionOf(markup, 2)).toContain('data-report-no-branch="true"');
    expect(sectionOf(markup, 3)).toContain('data-report-no-branch="true"');
    expect(sectionOf(markup, 3)).not.toContain('data-report-chart=');
  });
});

describe('the notes', () => {
  it('says which machines appear in one set of figures only', () => {
    const markup = render();
    expect(markup).toContain(t('atm.registerReport.unmapped', { count: '4' }));
    expect(markup).toContain(t('atm.registerReport.withoutBank', { count: '1' }));
    expect(markup).not.toContain('data-report-empty=');
  });

  it('says so when nothing is in operation, and still draws the zeros', () => {
    const markup = render(report(ATM_REGISTER_BRANCH_CODES, []));
    expect(markup).toContain('data-report-empty="true"');
    expect(markup).toContain(t('atm.registerReport.empty'));
    expect(markup).not.toContain('data-report-unmapped=');
    expect(cellText(markup, 's1.total')).toBe('0');
    expect(barsOf(sectionOf(markup, 3))).toHaveLength(42);
  });
});

describe('the page file stays a thin shell (spec §8.5)', () => {
  it('holds no table, list mapping, filter or URL read', () => {
    const src = readFileSync(join(HERE, 'pages', 'RegisterReportPage.tsx'), 'utf8');
    expect(src).not.toMatch(/<DataTable\b|<Table\b|\.items\.map\(|rows=\{/);
    expect(src).not.toMatch(/<Select\b|<FilterBar\b|<SearchInput\b|sp\.get\(/);
  });
});
