// «لوحة تحكم الحركة» — the shared blocks «توزيع السيارات» and «الصيانة والورش» draw with (dash-blocks.tsx,
// dash-columns.tsx), rendered alone: the column chart in the brand's colour with each figure on its
// cap and a muted column never linked; the named bars against the longest, in one or two columns;
// the range chip from the read's echo; «منذ اليوم»; one read's skeleton, error or band; and the
// source rules every dashboard file keeps (no counting, no sample piece).
import { createElement, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { type FleetDashboardPeriodDto, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../../platform/localization/i18n';
import {
  BandHead,
  BlockFoot,
  BlockHead,
  Counted,
  HBars,
  NoteLine,
  NowChip,
  RangeChip,
  ReadBand,
  Since,
  monthName,
  type HBarRow,
} from './components/fleet-dashboard/dash-blocks';
import { ColumnChart, type ColumnDatum } from './components/fleet-dashboard/dash-columns';
import { I, LiveChip } from './components/fleet-dashboard/dash-kit';

const DASH = join(dirname(fileURLToPath(import.meta.url)), 'components', 'fleet-dashboard');

const ar = (key: string): string => translate('ar', key);

const render = (node: ReactElement, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    createElement(Provider, { store, children: createElement(MemoryRouter, null, node) }),
  );
};

const unescape = (s: string): string =>
  s
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'");
/** The words a reader sees (tags dropped, entities read, spaces folded). */
const text = (html: string): string =>
  unescape(html.replace(/<[^>]*>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
/** The markup from the element carrying `attr="value"` (its opening `<`) up to the next element of
 *  its kind. */
const slice = (html: string, attr: string, value: string): string => {
  const at = html.indexOf(`${attr}="${value}"`);
  if (at === -1) throw new Error(`no ${attr}=${value}`);
  const start = html.lastIndexOf('<', at);
  const end = html.indexOf(`${attr}="`, at + attr.length + value.length + 3);
  return html.slice(start, end === -1 ? undefined : html.lastIndexOf('<', end));
};
const metrics = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*data-metric="([^"]*)"/gu)].map((m) => m[1] ?? '');

// ── ColumnChart ───────────────────────────────────────────────────────────────────────────────

const KM = (n: number): string => new Intl.NumberFormat('en-US').format(n);
const COLUMNS: ColumnDatum[] = [
  {
    key: 'b1',
    name: 'المهندسين',
    value: 94_200,
    valueText: KM(94_200),
    unit: 'كم',
    share: '30.1%',
    link: { to: '/fleet/odometer?branch=b1', metric: 'km.byBranch' },
  },
  {
    key: 'b2',
    name: 'أسيوط',
    value: 20_320,
    valueText: KM(20_320),
    unit: 'كم',
    share: null,
    link: null,
  },
  {
    key: 'none',
    name: 'بلا فرع',
    value: 1_000,
    valueText: KM(1_000),
    unit: 'كم',
    share: '0.3%',
    // A muted column never opens a list, even when handed a link.
    link: { to: '/fleet/odometer', metric: 'km.noBranch' },
    muted: true,
  },
];

describe('ColumnChart — the brand columns, each figure on its cap', () => {
  const html = render(
    <ColumnChart id="km" columns={COLUMNS} ariaLabel="الكيلومترات حسب الفرع" of="من الإجمالي" />,
  );

  it('is one labelled group, one list item per column, in the given order', () => {
    expect(html).toContain('data-dash-chart="km"');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="الكيلومترات حسب الفرع"');
    const order = [...html.matchAll(/data-dash-col="([^"]*)"/gu)].map((m) => m[1]);
    expect(order).toEqual(['b1', 'b2', 'none']);
  });

  it('draws the named columns in the brand colour and the muted one in slate', () => {
    for (const key of ['b1', 'b2']) {
      const bar = slice(html, 'data-dash-col-bar', key);
      expect(bar).toContain('bg-brand-600');
      expect(bar).toContain('dark:bg-brand-500');
      expect(bar).not.toContain('bg-slate-');
    }
    const muted = slice(html, 'data-dash-col-bar', 'none');
    expect(muted).toContain('bg-slate-300');
    expect(muted).not.toContain('bg-brand-');
    expect(html).not.toMatch(/bg-(teal|sky|emerald)-/u);
  });

  it('writes each figure and its unit on its cap; only a named column with a link opens a list', () => {
    expect(text(slice(html, 'data-dash-col-value', 'b1'))).toContain('94,200 كم');
    expect(text(slice(html, 'data-dash-col-value', 'b2'))).toContain('20,320 كم');
    expect(text(slice(html, 'data-dash-col-value', 'none'))).toContain('1,000 كم');
    expect(metrics(html)).toEqual(['km.byBranch']);
    expect(slice(html, 'data-dash-col-value', 'b1')).toContain('href="/fleet/odometer?branch=b1"');
    expect(slice(html, 'data-dash-col', 'none')).not.toContain('<a');
    expect(html).toContain('data-dash-col-muted="true"');
  });

  it('measures the columns on a round axis: heights against its top step', () => {
    // custodyTicks(94,200) → 0, 25,000, 50,000, 75,000, 100,000.
    const ticks = [...html.matchAll(/data-dash-tick="(\d+)"/gu)].map((m) => Number(m[1]));
    expect(ticks).toEqual([0, 25_000, 50_000, 75_000, 100_000]);
    expect(slice(html, 'data-dash-col-bar', 'b1')).toContain(`height:${(94_200 / 100_000) * 100}%`);
    expect(slice(html, 'data-dash-col-bar', 'b2')).toContain(`height:${(20_320 / 100_000) * 100}%`);
  });

  it('names each column under it with its share; a column with no share shows none', () => {
    const share = (key: string): string | undefined =>
      new RegExp(`data-dash-col-share="${key}"><span[^>]*>([^<]*)<`, 'u').exec(html)?.[1];
    expect(html).toMatch(/data-dash-col-name="b1"[^>]*>المهندسين<\/span>/u);
    expect(share('b1')).toBe('30.1%');
    expect(html).not.toContain('data-dash-col-share="b2"');
    expect(share('none')).toBe('0.3%');
  });

  it('reads each column out to a screen reader; the readout box only shows under a pointer', () => {
    expect(html).toContain('aria-label="المهندسين: 94,200 كم · 30.1% من الإجمالي"');
    expect(html).toContain('aria-label="أسيوط: 20,320 كم"');
    expect(html).not.toContain('data-dash-col-tip');
    expect(html).not.toContain('role="tooltip"');
  });

  it('draws an empty axis for no column, and never a sample marker', () => {
    const empty = render(<ColumnChart id="x" columns={[]} ariaLabel="x" of="x" />);
    expect([...empty.matchAll(/data-dash-tick="(\d+)"/gu)].map((m) => m[1])).toEqual(['0']);
    expect(empty).not.toContain('data-dash-col=');
    expect(html).not.toContain('data-zz-');
  });
});

// ── HBars ─────────────────────────────────────────────────────────────────────────────────────

const ROWS: HBarRow[] = [
  {
    key: 'a',
    name: 'صيانة',
    value: '12',
    n: 12,
    extra: '37.8%',
    link: { to: '/x', metric: 'm.a' },
  },
  { key: 'b', name: 'إصلاح', value: '6', n: 6, unit: 'زيارة', link: null },
  { key: 'c', name: 'سمكرة', value: '3', n: 3, link: { to: '/y', metric: 'm.c' } },
];

describe('HBars — each bar against the longest', () => {
  it('measures every bar against the largest row, the share written beside it', () => {
    const html = render(<HBars rows={ROWS} />);
    expect(slice(html, 'data-bar-fill', 'a')).toContain('width:100%');
    expect(slice(html, 'data-bar-fill', 'b')).toContain('width:50%');
    expect(slice(html, 'data-bar-fill', 'c')).toContain('width:25%');
    expect(text(slice(html, 'data-bar', 'a'))).toContain('صيانة 12 37.8%');
    expect(text(slice(html, 'data-bar', 'b'))).toContain('إصلاح 6 زيارة');
    expect(metrics(html)).toEqual(['m.a', 'm.c']);
  });

  it('draws the brand by default and the tone an old tab passes', () => {
    const html = render(<HBars rows={ROWS} />);
    expect(slice(html, 'data-bar-fill', 'a')).toContain('bg-brand-600');
    const teal = render(<HBars rows={ROWS} tone="teal" />);
    expect(slice(teal, 'data-bar-fill', 'a')).toContain('bg-teal-500');
  });

  it('runs down two columns from 1024 px when asked, one list otherwise', () => {
    const one = render(<HBars rows={ROWS} />);
    expect(one).toContain('data-bars-columns="1"');
    expect(one).not.toContain('lg:grid');
    expect(one).not.toContain('grid-template-rows');
    const two = render(<HBars rows={ROWS} columns={2} />);
    expect(two).toContain('data-bars-columns="2"');
    expect(two).toContain('lg:grid-flow-col');
    expect(two).toContain('grid-template-rows:repeat(2, auto)');
  });

  it('draws no length at all when every row is zero', () => {
    const html = render(
      <HBars rows={[{ key: 'z', name: 'لا شيء', value: '0', n: 0, link: null }]} />,
    );
    expect(slice(html, 'data-bar-fill', 'z')).toContain('width:0%');
  });
});

// ── The period a read answered for ────────────────────────────────────────────────────────────

const range = (
  preset: FleetDashboardPeriodDto['range']['preset'],
  from: string,
  to: string,
): FleetDashboardPeriodDto['range'] => ({ preset, from, to, days: 30, granularity: 'day' });

describe('RangeChip — the range of the read’s echo', () => {
  it('names a calendar month: «هذا الشهر · نوفمبر 2026», «الشهر الماضي · أكتوبر 2026»', () => {
    const now = render(<RangeChip range={range('thisMonth', '2026-11-01', '2026-11-11')} />);
    expect(text(now)).toBe('هذا الشهر · نوفمبر 2026');
    expect(now).toContain('data-dash-range="thisMonth"');
    const last = render(<RangeChip range={range('lastMonth', '2026-10-01', '2026-10-31')} />);
    expect(text(last)).toBe('الشهر الماضي · أكتوبر 2026');
  });

  it('writes any other range by its two days', () => {
    const last30 = render(<RangeChip range={range('last30', '2026-10-13', '2026-11-11')} />);
    expect(text(last30)).toBe('آخر 30 يومًا · من 2026/10/13 إلى 2026/11/11');
    const custom = render(<RangeChip range={range('custom', '2026-01-05', '2026-02-04')} />);
    expect(text(custom)).toBe('مخصص · من 2026/01/05 إلى 2026/02/04');
  });

  it('speaks English to an English reader, with the same Latin digits', () => {
    const now = render(<RangeChip range={range('thisMonth', '2026-11-01', '2026-11-11')} />, 'en');
    expect(text(now)).toBe('This month · November 2026');
    const custom = render(<RangeChip range={range('custom', '2026-01-05', '2026-02-04')} />, 'en');
    expect(text(custom)).toBe('Custom · 2026/01/05 to 2026/02/04');
  });

  it('names a month in the reader’s language', () => {
    expect(monthName('2026-11-11', 'ar')).toBe('نوفمبر');
    expect(monthName('2026-11-11', 'en')).toBe('November');
  });
});

// ── Small words ───────────────────────────────────────────────────────────────────────────────

describe('Since, NowChip and the contract noun', () => {
  it('says «منذ اليوم» on the day itself, else «منذ N يومًا», amber unless told otherwise', () => {
    const today = render(<Since days={0} />);
    expect(text(today)).toBe('منذ اليوم');
    expect(today).toContain('text-amber-700');
    expect(text(render(<Since days={12} />))).toBe('منذ 12 يومًا');
    expect(text(render(<Since days={7} />))).toBe('منذ 7 أيام');
    const plain = render(<Since days={3} className="text-slate-500" />);
    expect(plain).toContain('text-slate-500');
    expect(plain).not.toContain('text-amber-700');
  });

  it('draws «لقطة الآن» as its own chip, never counted as the long live chip', () => {
    const html = render(<NowChip />);
    expect(text(html)).toBe('لقطة الآن');
    expect(html).toContain('data-now-chip="true"');
    expect(html).not.toContain('data-live-chip');
  });

  it('counts contracts the Arabic way: «1 عقد», «2 عقود», «11 عقدًا»', () => {
    expect(text(render(<Counted n={1} noun="contract" />))).toBe('1 عقد');
    expect(text(render(<Counted n={2} noun="contract" />))).toBe('2 عقود');
    expect(text(render(<Counted n={11} noun="contract" />))).toBe('11 عقدًا');
    expect(text(render(<Counted n={2} noun="contract" />, 'en'))).toBe('2 contracts');
  });
});

// ── Blocks and bands ──────────────────────────────────────────────────────────────────────────

describe('BlockHead, BlockFoot, NoteLine and BandHead', () => {
  it('heads a block with its title, chips, note and end piece', () => {
    const html = render(
      <BlockHead
        icon={I.gauge}
        tone="brand"
        title="الكيلومترات حسب الفرع"
        note="ما قطعته سيارات كل فرع منذ أول الشهر."
        chips={<span data-chip="x">chip</span>}
        end={<span data-end="x">end</span>}
      />,
    );
    expect(html).toContain('data-dash-block-head="true"');
    expect(html).toContain('<h3');
    expect(text(html)).toBe('الكيلومترات حسب الفرع chip ما قطعته سيارات كل فرع منذ أول الشهر. end');
    expect(render(<BlockHead icon={I.gauge} tone="brand" title="T" />)).not.toMatch(/<p[\s>]/u);
  });

  it('lays the foot out in a row, or one line under another with `stack`', () => {
    const row = render(<BlockFoot>a</BlockFoot>);
    expect(row).toContain('data-dash-block-foot="true"');
    expect(row).toContain('flex-wrap');
    const stack = render(<BlockFoot stack>a</BlockFoot>);
    expect(stack).toContain('space-y-1');
    expect(stack).not.toContain('flex-wrap');
    expect(text(render(<NoteLine>ملاحظة</NoteLine>))).toBe('ملاحظة');
  });

  it('heads a band with its dot, title, chips and line, marked with its id', () => {
    const now = render(
      <BandHead id="now" tone="emerald" first title="الآن" chips={<LiveChip />} />,
    );
    expect(now).toContain('data-dash-band="now"');
    expect(now).toContain('bg-emerald-500');
    expect(now).toContain('data-live-chip="true"');
    expect(now).not.toContain('data-dash-band-sub');
    const period = render(
      <BandHead
        id="period"
        tone="sky"
        title="خلال الفترة"
        sub="زيارات الورش التي خرجت خلال الفترة المختارة."
      />,
    );
    expect(period).toContain('data-dash-band="period"');
    expect(period).toContain('bg-sky-500');
    expect(text(slice(period, 'data-dash-band-sub', 'period'))).toBe(
      'زيارات الورش التي خرجت خلال الفترة المختارة.',
    );
  });
});

// ── One read's face ───────────────────────────────────────────────────────────────────────────

describe('ReadBand — one read’s skeleton, error or band', () => {
  const band = <p data-band-body="true">الأرقام</p>;

  it('draws the skeleton while the read is on its way, never the band', () => {
    const html = render(
      <ReadBand state="loading" onRetry={() => undefined}>
        {band}
      </ReadBand>,
    );
    expect(html).toContain('data-read-band="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-dash-loading="true"');
    expect(html).not.toContain('data-band-body');
    const own = render(
      <ReadBand state="loading" onRetry={() => undefined} skeleton={<i data-own="true" />}>
        {band}
      </ReadBand>,
    );
    expect(own).toContain('data-own="true"');
  });

  it('draws the read’s error and its retry when it failed', () => {
    const html = render(
      <ReadBand state="error" error={null} onRetry={() => undefined}>
        {band}
      </ReadBand>,
    );
    expect(html).toContain('data-dash-read-error="true"');
    expect(text(html)).toContain(ar('common.retry'));
    expect(html).not.toContain('data-band-body');
  });

  it('draws the band once the read answered', () => {
    const html = render(
      <ReadBand state="ready" onRetry={() => undefined}>
        {band}
      </ReadBand>,
    );
    expect(html).toContain('data-read-band="ready"');
    expect(html).toContain('data-band-body="true"');
    expect(html).not.toContain('data-dash-loading');
  });
});

// ── The source ────────────────────────────────────────────────────────────────────────────────

describe('the shared blocks’ source', () => {
  const source = (name: string): string =>
    readFileSync(join(DASH, name), 'utf8')
      .replace(/^\s*\/\/.*$/gmu, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/gu, '');

  it('counts nothing and imports no sample', () => {
    for (const name of ['dash-blocks.tsx', 'dash-columns.tsx']) {
      const src = source(name);
      expect(src, name).not.toMatch(/\.reduce\(/u);
      expect(src, name).not.toMatch(/\.filter\([^)]*\)\.length/u);
      expect(src, name).not.toMatch(/\{[\w.?]+\.length\}/u);
      expect(src, name).not.toMatch(/from '[^']*zz-/u);
      expect(src, name).not.toMatch(/data-zz-/u);
    }
  });

  it('keeps the named bars in one place: the old km tab draws them from dash-blocks', () => {
    expect(source('tab-km.tsx')).toContain("from './dash-blocks'");
    expect(source('tab-km.tsx')).not.toContain("from './tab-maintenance'");
  });

  it('leaves four period tabs under the period hand-over; «الصيانة والورش» is not one of them', () => {
    const src = source('period-tabs.tsx');
    expect(src).toContain("tab: 'period' | 'km' | 'ranking' | 'accidents';");
    expect(src).not.toContain('MaintenanceTab');
    expect(src).not.toMatch(/\bmaintenance:/u);
  });
});
