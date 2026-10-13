// «إجمالي العهدة» — «عاوز ازود اجمالى العهده فى الاحصايات و تكون فى الداس بورد». The fund, first
// among the board's figures («الإحصائيات») and first in the KPI row of «لوحة تحكم», in its own calm
// slate, a wallet on its tile; under it «صُرف منها X%» — the spend over the fund. The fund is what
// «شحن العهدة» charges into it, so until that action exists it is «0.00 ج.م.» — a sum, never «—» —
// and its share «—», the board's bar empty. Proven against what the components produce.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetCustodyDashboardDto,
  type FleetCustodySummaryDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import {
  CustodyFigures,
  CustodyFundCard,
  custodySpentOfFund,
  custodySpentOfFundPct,
} from '../components/CustodyFigures';
import { CustodyDashboardContent, CustodyKpis } from '../components/CustodyDashboard';
import { CUSTODY_FUND, CUSTODY_KIND, CUSTODY_KINDS } from '../components/CustodyKinds';
import { CAIRO, CARD_SURFACE } from '../components/custody-dashboard-parts';
import { NUM } from '../components/FuelCardBoard';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

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
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

/** A custody viewer — the figures' own grant and nothing else. */
const VIEWER = ['fleetCustody.view'];

const mount = (node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(VIEWER), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/custody']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** A piece's words as a reader sees them: every tag a gap. */
const text = (part: string): string =>
  part
    .replace(/^[^<]*>/u, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
const classesOf = (html: string, attr: string): string[] => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  const tag = html.slice(Math.max(0, html.lastIndexOf('<', at)), html.indexOf('>', at));
  return (/class="([^"]*)"/u.exec(tag)?.[1] ?? '').split(' ');
};
const esc = (classes: string): string =>
  classes
    .replace(/&/gu, '&amp;')
    .replace(/>/gu, '&gt;')
    .replace(/'/gu, '&#x27;')
    .replace(/"/gu, '&quot;');

/**
 * The board's figures: 4,335.50 spent of a fund of 50,000.00 — «8.7%» — as they will read once
 * «شحن العهدة» has charged the fund.
 */
const summary: FleetCustodySummaryDto = {
  count: 6,
  total: 4335.5,
  dealership: 850,
  fuel: 1965.5,
  tyres: 1400,
  wash: 120,
  vehicles: [],
  fundTotal: 50_000,
};
/** As the server answers today: the same spend, and nothing charged into the fund yet. */
const empty: FleetCustodySummaryDto = { ...summary, fundTotal: 0 };

/** One figure's markup on the board, up to the next figure. */
const figure = (html: string, id: string): string => {
  const at = html.indexOf(`data-custody-figure="${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  const next = html.indexOf('data-custody-figure="', at + 10);
  return html.slice(at, next === -1 ? undefined : html.lastIndexOf('<', next));
};

/** The dashboard's answer — the same figures, nothing else in it read here. */
const dashboard = (over: Partial<FleetCustodyDashboardDto> = {}): FleetCustodyDashboardDto => ({
  ...summary,
  vehicleCount: 0,
  counts: { dealership: 1, fuel: 3, tyres: 1, wash: 1 },
  bySource: [],
  timeline: { granularity: 'month', buckets: [] },
  drivers: [],
  noDriver: { count: 0, amount: 0 },
  fuelTypes: [],
  litres: 0,
  litresMissing: 0,
  periodDays: 0,
  fuelByCompany: {
    companies: [
      { company: 'chillout', amount: 0, count: 0, litres: 0, types: [] },
      { company: 'wataniya', amount: 0, count: 0, litres: 0, types: [] },
    ],
    none: { amount: 0, count: 0, litres: 0, types: [] },
  },
  alerts: {
    doubleFuel: [],
    pendingPrivateBills: { count: 0, oldestOutDate: null },
    receiptsWithoutPhoto: 0,
    duplicateReceipts: 0,
  },
  ...over,
});
/** One KPI card's markup on the dashboard, up to the next one. */
const kpi = (html: string, id: string): string => {
  const at = html.indexOf(`data-custody-kpi="${id}"`);
  expect(at, id).toBeGreaterThan(-1);
  const next = html.indexOf('data-custody-kpi="', at + 10);
  const end = next === -1 ? html.indexOf('data-custody-tile') : next;
  return html.slice(at, html.lastIndexOf('<', end));
};

describe('«صُرف منها X%» — what was spent of the fund', () => {
  it('writes one decimal under ten per cent, whole from there', () => {
    expect(custodySpentOfFund(4335.5, 50_000)).toBe('8.7%');
    expect(custodySpentOfFund(4970, 50_000)).toBe('9.9%');
    // 9.998% is «10%», never «10.0%».
    expect(custodySpentOfFund(4999, 50_000)).toBe('10%');
    expect(custodySpentOfFund(22_000, 50_000)).toBe('44%');
    expect(custodySpentOfFund(50_000, 50_000)).toBe('100%');
  });

  it('never claims what is not true at either end — nor of nothing', () => {
    expect(custodySpentOfFund(0, 50_000)).toBe('0%');
    // A sliver is not «0.0%».
    expect(custodySpentOfFund(10, 250_000)).toBe('<0.1%');
    // All but a sliver is not «100%»; a sliver past it is not «100%» either.
    expect(custodySpentOfFund(49_900, 50_000)).toBe('>99%');
    expect(custodySpentOfFund(50_100, 50_000)).toBe('>100%');
    // The spend can outrun what was charged into the fund — and says so.
    expect(custodySpentOfFund(60_000, 50_000)).toBe('120%');
    // Nothing in the fund (0, as today): nothing to divide by.
    expect(custodySpentOfFund(4335.5, 0)).toBe('—');
    expect(custodySpentOfFund(0, 0)).toBe('—');
  });

  it('draws the same share as a bar: nothing in the fund, none; past the fund, all of it', () => {
    expect(custodySpentOfFundPct(25_000, 50_000)).toBe(50);
    expect(custodySpentOfFundPct(60_000, 50_000)).toBe(100);
    expect(custodySpentOfFundPct(4335.5, 0)).toBe(0);
    expect(custodySpentOfFundPct(0, 0)).toBe(0);
    expect(custodySpentOfFundPct(0, 50_000)).toBe(0);
  });

  it('reads an answer with no fund in it — an older server — as 0, never «NaN%»', () => {
    // The web can reach the screen before the API that carries `fundTotal` as a number (a
    // staggered deploy): an older server's `null`, or no field at all.
    for (const fund of [null, undefined, Number.NaN, Infinity, -5]) {
      expect(custodySpentOfFund(4335.5, fund), String(fund)).toBe('—');
      expect(custodySpentOfFundPct(4335.5, fund), String(fund)).toBe(0);
    }
  });
});

describe('«إجمالي العهدة» on the board — «الإحصائيات»', () => {
  it('comes first, before «إجمالي مصروفات العهدة»', () => {
    const html = mount(<CustodyFigures totals={summary} />);
    expect([...html.matchAll(/data-custody-figure="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'fund',
      'total',
      ...CUSTODY_KINDS,
    ]);
    expect(ar('fleet.custody.fund.title')).toBe('إجمالي العهدة');
    expect(text(figure(html, 'fund'))).toContain(ar('fleet.custody.fund.title'));
  });

  it('shows the fund, «ج.م.» apart, and «صُرف منها 8.7%» over a bar of the same share', () => {
    const fund = figure(mount(<CustodyFigures totals={summary} />), 'fund');
    // The board's figure: black, in the boards' monospace, as its tiles write theirs.
    expect(fund).toContain(
      `<span data-custody-fund-value="true" class="text-2xl font-black tracking-tight text-slate-900 dark:text-white ${esc(NUM)}">50,000.00</span><span class="text-xs ${CUSTODY_FUND.unit}">ج.م.</span>`,
    );
    expect(text(fund)).toContain(`${ar('fleet.custody.fund.spent')} 8.7%`);
    expect(ar('fleet.custody.fund.spent')).toBe('صُرف منها');
    // The share left to right, in Latin digits, on its own chip.
    expect(fund).toMatch(
      /<span dir="ltr" data-custody-fund-pct="true" class="[^"]*">8\.7%<\/span>/u,
    );
    expect(fund).toContain(
      `<span class="block h-full rounded-full ${CUSTODY_FUND.fill}" style="width:8.671%"></span>`,
    );
  });

  it('wears its own calm slate — the dashboard’s card, no kind’s colour and not the total’s emerald', () => {
    const fund = figure(mount(<CustodyFigures totals={summary} />), 'fund');
    expect(classesOf(fund, 'data-custody-fund="true"')).toEqual(
      expect.arrayContaining([
        ...CARD_SURFACE.split(' '),
        ...CUSTODY_FUND.card.split(' '),
        ...CUSTODY_FUND.accent.split(' '),
        'rounded-2xl',
        'p-4',
        'h-full',
      ]),
    );
    expect(CUSTODY_FUND.accent).toContain('border-l-slate-600');
    expect(CUSTODY_FUND.accent).toContain('dark:border-l-slate-400');
    expect(fund).toContain(CUSTODY_FUND.tile);
    // A wallet on its tile.
    expect(fund).toContain(`d="${CUSTODY_FUND.icon[0]}"`);
    // Not the total's emerald, nor any kind's hue — so it never reads as one of them.
    const classes = [...fund.matchAll(/class="([^"]*)"/gu)].map((m) => m[1] ?? '').join(' ');
    expect(classes).not.toMatch(/emerald|blue-|amber-|rose-|cyan-|sky-/u);
    for (const kind of CUSTODY_KINDS) {
      expect(CUSTODY_FUND.fill).not.toBe(CUSTODY_KIND[kind].fill);
    }
    // Every light surface of it has its dark one.
    for (const m of fund.matchAll(/class="([^"]*)"/gu)) {
      const cls = (m[1] ?? '').split(' ');
      if (!cls.some((c) => /^(?:bg-white|bg-slate-50|bg-slate-100)$/u.test(c))) continue;
      expect(
        cls.some((c) => c.startsWith('dark:bg-')),
        cls.join(' '),
      ).toBe(true);
    }
  });

  it('shows «0.00 ج.م.» while nothing is charged into the fund — its share «—», its bar empty', () => {
    const fund = figure(mount(<CustodyFigures totals={empty} />), 'fund');
    expect(fund).toContain(
      `<span data-custody-fund-value="true" class="text-2xl font-black tracking-tight text-slate-900 dark:text-white ${esc(NUM)}">0.00</span><span class="text-xs ${CUSTODY_FUND.unit}">ج.م.</span>`,
    );
    expect(text(fund)).toBe(
      `${ar('fleet.custody.fund.title')} 0.00 ج.م. ${ar('fleet.custody.fund.spent')} —`,
    );
    expect(fund).toMatch(/<span dir="ltr" data-custody-fund-pct="true" class="[^"]*">—<\/span>/u);
    // The bar is drawn, and empty.
    expect(fund).toContain('data-custody-fund-bar="true"');
    expect(fund).toContain(
      `<span class="block h-full rounded-full ${CUSTODY_FUND.fill}" style="width:0%"></span>`,
    );
    expect(fund).not.toMatch(/NaN|Infinity/u);
    // Nothing points anywhere: «شحن العهدة» fills the fund, no settings screen does.
    expect(fund).not.toContain('href=');
    expect(fund).not.toContain('<a ');
    expect(text(fund)).not.toContain('إعدادات الحركة');
  });

  it('reads an answer with no fund at all as 0 — no «ليس رقمًا», no «NaN%»', () => {
    // An older server's summary, without the field: the board's tile reads «0.00 ج.م.».
    const older: Partial<FleetCustodySummaryDto> = { ...summary };
    delete older.fundTotal;
    expect('fundTotal' in older).toBe(false);
    const fund = figure(mount(<CustodyFigures totals={older as FleetCustodySummaryDto} />), 'fund');
    expect(text(fund)).toBe(
      `${ar('fleet.custody.fund.title')} 0.00 ج.م. ${ar('fleet.custody.fund.spent')} —`,
    );
    expect(fund).not.toMatch(/NaN|Infinity|undefined|ليس رقمًا/u);
    expect(fund).toContain('style="width:0%"');
    // …and so does an older server's `null`, and a value that is no amount at all.
    for (const odd of [null, Number.NaN, Infinity, -5]) {
      const tile = figure(
        mount(<CustodyFigures totals={{ ...summary, fundTotal: odd as unknown as number }} />),
        'fund',
      );
      expect(text(tile), String(odd)).toBe(
        `${ar('fleet.custody.fund.title')} 0.00 ج.م. ${ar('fleet.custody.fund.spent')} —`,
      );
      expect(tile, String(odd)).not.toMatch(/NaN|Infinity|undefined|ليس رقمًا/u);
      expect(tile, String(odd)).toContain('style="width:0%"');
    }
    // …and the dashboard's card, the same component.
    const card = kpi(
      mount(<CustodyKpis data={dashboard({ fundTotal: undefined as unknown as number })} />),
      'fund',
    );
    expect(text(card)).toBe(
      `${ar('fleet.custody.fund.title')} 0.00 ج.م. ${ar('fleet.custody.fund.spent')} —`,
    );
    expect(card).not.toMatch(/NaN|Infinity|undefined|ليس رقمًا/u);
  });

  it('lays the six out one to a row on a phone, two from `sm`, three from `xl`, all six in one row from 1,680px — «ج.م.» never cut off', () => {
    const html = mount(<CustodyFigures totals={summary} />);
    const grid = classesOf(html, 'data-custody-figures="true"');
    expect(grid).toEqual(
      expect.arrayContaining([
        'grid',
        'grid-cols-1',
        'sm:grid-cols-2',
        'xl:grid-cols-3',
        '[&amp;_.items-baseline]:flex-wrap',
      ]),
    );
    expect(grid.join(' ')).not.toMatch(/col-span/u);
    // Not three from `lg`: the side bar opens there, and a third of a 1,024px board is about 232px
    // — a sum in the millions ran under its icon («2,500,000.00» lost its «2»). Two until `xl`.
    expect(grid).not.toContain('lg:grid-cols-3');
    // «هتضيف بس فى الاول قبل إجمالي مصروفات العهدة»: one row of six from 1,680px, as the five
    // were — not from `2xl`, where a sixth beside the side bar is 195px and a sum in the millions
    // ran under its icon; the sums a size down there and back up as the room grows.
    expect(grid.filter((c) => /grid-cols-/u.test(c))).toEqual([
      'grid-cols-1',
      'sm:grid-cols-2',
      'xl:grid-cols-3',
      'min-[1680px]:grid-cols-6',
    ]);
    expect(grid).toEqual(
      expect.arrayContaining([
        'min-[1680px]:[&amp;_.text-2xl]:text-lg',
        'min-[1800px]:[&amp;_.text-2xl]:text-xl',
        'min-[2100px]:[&amp;_.text-2xl]:text-2xl',
      ]),
    );
  });

  it('reads past the fund as it is — «120%», the bar full', () => {
    const fund = figure(
      mount(<CustodyFigures totals={{ ...summary, total: 60_000, fundTotal: 50_000 }} />),
      'fund',
    );
    expect(text(fund)).toContain(`${ar('fleet.custody.fund.spent')} 120%`);
    expect(fund).toContain('style="width:100%"');
  });
});

describe('«إجمالي العهدة» on «لوحة تحكم»', () => {
  it('leads the KPI row — six of them — in the dashboard’s own figure, with no bar', () => {
    const html = mount(<CustodyKpis data={dashboard()} />);
    expect([...html.matchAll(/data-custody-kpi="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'fund',
      'total',
      ...CUSTODY_KINDS,
    ]);
    const fund = kpi(html, 'fund');
    expect(text(fund)).toContain(
      `${ar('fleet.custody.fund.title')} 50,000.00 ج.م. ${ar('fleet.custody.fund.spent')} 8.7%`,
    );
    // Cairo, as every figure of the dashboard; never the board's monospace beside it.
    const value = classesOf(fund, 'data-custody-fund-value="true"');
    expect(value).toEqual(expect.arrayContaining(esc(CAIRO).split(' ')));
    expect(value.join(' ')).not.toContain('ui-monospace');
    expect(fund).not.toContain('style="width:');
    // The same card as the board's.
    expect(fund).toContain(CUSTODY_FUND.tile);
    expect(classesOf(fund, 'data-custody-fund="true"')).toEqual(
      expect.arrayContaining(CUSTODY_FUND.accent.split(' ')),
    );
  });

  it('fits six to the row: three from `lg`, all six from `2xl` — and loads six', () => {
    const html = mount(<CustodyKpis data={dashboard()} />);
    const grid = classesOf(html, 'data-custody-kpi="fund"');
    expect(grid).toEqual(['flex', 'min-w-0', 'flex-col']);
    const row = html.slice(html.indexOf('<div', html.indexOf('data-custody-dashboard-section')));
    expect(classesOf(row, '<div')).toEqual([
      'grid',
      'grid-cols-1',
      'gap-3.5',
      'sm:grid-cols-2',
      'lg:grid-cols-3',
      '2xl:grid-cols-6',
    ]);
    const loading = mount(
      <CustodyDashboardContent view="loading" data={undefined} error={null} onRetry={() => {}} />,
    );
    expect(loading.match(/h-\[120px\]/gu)).toHaveLength(6);
    // The shared look: no font-family twice on one element.
    for (const m of html.matchAll(/class="([^"]*)"/gu)) {
      expect((m[1] ?? '').match(/\[font-family:/gu)?.length ?? 0, m[1]).toBeLessThanOrEqual(1);
    }
  });

  it('shows «0.00 ج.م.» while nothing is charged into the fund, its share «—», with no bar', () => {
    const card = kpi(mount(<CustodyKpis data={dashboard({ fundTotal: 0 })} />), 'fund');
    expect(text(card)).toBe(
      `${ar('fleet.custody.fund.title')} 0.00 ج.م. ${ar('fleet.custody.fund.spent')} —`,
    );
    expect(card).toMatch(/data-custody-fund-value="true"[^>]*>0\.00</u);
    expect(card).not.toContain('style="width:');
    expect(card).not.toContain('href=');
    expect(card).not.toMatch(/NaN|Infinity/u);
  });

  it('is one component, drawn by both', () => {
    const figures = read('../components/CustodyFigures.tsx');
    const modal = read('../components/CustodyDashboard.tsx');
    expect(figures).toContain(
      '<CustodyFundCard fundTotal={totals.fundTotal} spent={totals.total} board />',
    );
    expect(modal).toContain(
      '<CustodyFundCard fundTotal={data.fundTotal} spent={data.total} figure={FIGURE} />',
    );
    // A spent total of nothing over a fund: «0%», not a dash.
    const zero = mount(<CustodyFundCard fundTotal={50_000} spent={0} />);
    expect(text(zero)).toContain(`${ar('fleet.custody.fund.spent')} 0%`);
  });
});
