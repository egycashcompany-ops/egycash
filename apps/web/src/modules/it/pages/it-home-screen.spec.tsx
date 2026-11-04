// «عايزك تعمل فى الـ /it الرئيسية.. Dashboard بدل اللى موجود فيها يظهر إجمالى الأصول وإيه فى المخزن
// وإيه متسلم بس أقدر أفلتر بـالفئة.. من خلال Drop Down بـ Multiselection» — the `/it` home, proven
// against what it renders: each panel by its grant; the filters read from the URL and asked of the
// server; the category and branch rows showing the filter they write; every figure a link that
// carries the filters; and a count that failed saying so rather than reading as nothing. What a
// click writes and where each link leads is `lib/it-dashboard.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItConsumableDto,
  type ItDashboardActivityItemDto,
  type ItDashboardAssetsDto,
  type ItMobileLinesSummaryDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { ItHomePage } from './ItHomePage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'ItHomePage.tsx'), 'utf8');
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
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const C_LAPTOP = 'c-laptop';
const C_PRINTER = 'c-printer';
const B_HQ = 'b-hq';
const B_OCT = 'b-oct';

const counts = (inStock: number, assigned: number, underMaintenance: number, disposed: number) => ({
  inStock,
  assigned,
  underMaintenance,
  disposed,
  total: inStock + assigned + underMaintenance + disposed,
});

/** Unfiltered: every category, every branch. */
const ALL: ItDashboardAssetsDto = {
  totals: counts(120, 80, 6, 4),
  byCategory: [
    { categoryId: C_LAPTOP, ...counts(20, 60, 2, 1) },
    { categoryId: C_PRINTER, ...counts(100, 20, 4, 3) },
  ],
  byBranch: [
    { branchId: B_HQ, ...counts(70, 50, 4, 4) },
    { branchId: B_OCT, ...counts(50, 30, 2, 0) },
  ],
  attention: {
    heldByLeavers: 4,
    receiptsAwaitingSignature: 23,
    overdueReturns: 0,
    warrantyEndingSoon: 6,
    warrantyWindowDays: 30,
  },
};

/** Laptops in أكتوبر — figures no other view has, so the page proves which it asked for. */
const NARROWED: ItDashboardAssetsDto = {
  totals: counts(7, 31, 1, 0),
  byCategory: [
    { categoryId: C_LAPTOP, ...counts(7, 31, 1, 0) },
    { categoryId: C_PRINTER, ...counts(11, 5, 0, 0) },
  ],
  byBranch: [
    { branchId: B_HQ, ...counts(13, 29, 1, 1) },
    { branchId: B_OCT, ...counts(7, 31, 1, 0) },
  ],
  attention: {
    heldByLeavers: 2,
    receiptsAwaitingSignature: 5,
    overdueReturns: 1,
    warrantyEndingSoon: 3,
    warrantyWindowDays: 45,
  },
};

const movement = (over: Partial<ItDashboardActivityItemDto>): ItDashboardActivityItemDto => ({
  id: 'ev-1',
  kind: 'assigned',
  at: '2026-11-02T09:00:00.000Z',
  assetId: 'asset-1',
  assetCode: 'AST-00512',
  assetName: 'Lenovo ThinkCentre neo 50a 24',
  branchId: B_OCT,
  employeeId: 'e-1',
  employeeCode: '0100052',
  employeeName: 'محمد أحمد علي',
  fromBranchId: null,
  toBranchId: null,
  ...over,
});

const ACTIVITY = {
  items: [
    movement({}),
    movement({
      id: 'ev-2',
      kind: 'returned',
      assetId: 'asset-2',
      assetCode: 'AST-00087',
      assetName: 'Dell OptiPlex 7070',
      branchId: B_HQ,
      employeeName: 'وليد صفوت جلال صفوت',
    }),
    movement({
      id: 'ev-3',
      kind: 'transferred',
      assetId: 'asset-3',
      assetCode: 'AST-00231',
      branchId: B_HQ,
      // A holder HR has no name for: the line names them by their code.
      employeeId: 'e-3',
      employeeCode: '0100077',
      employeeName: null,
      fromBranchId: B_OCT,
      toBranchId: B_HQ,
    }),
    movement({
      id: 'asset-4',
      kind: 'registered',
      assetId: 'asset-4',
      assetCode: 'AST-00551',
      employeeId: null,
      employeeCode: null,
      employeeName: null,
    }),
  ],
};

const LINES: ItMobileLinesSummaryDto = {
  networks: [
    {
      network: 'vodafone',
      total: 50,
      inStock: 8,
      assigned: 41,
      suspended: 1,
      accounts: [],
      ratePlans: [],
    },
    {
      network: 'etisalat',
      total: 270,
      inStock: 39,
      assigned: 228,
      suspended: 3,
      accounts: [],
      ratePlans: [],
    },
    {
      network: 'orange',
      total: 72,
      inStock: 21,
      assigned: 50,
      suspended: 1,
      accounts: [],
      ratePlans: [],
    },
  ],
};

const consumable = (over: Partial<ItConsumableDto>): ItConsumableDto => ({
  id: 'k-1',
  code: 'CON-00010',
  name: 'HDMI Cable 1 m',
  typeId: 't-cable',
  unit: 'قطعة',
  branchId: B_HQ,
  minQty: 2,
  notes: null,
  active: true,
  onHandQty: 1,
  issuedQty: 9,
  scrappedQty: 0,
  belowMin: true,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

const page = <T,>(items: T[], totalItems = items.length) => ({
  items,
  meta: { page: 1, pageSize: 5, totalItems, totalPages: 1 },
});

const category = (id: string, name: string) => ({
  id,
  kind: 'assetCategory' as const,
  code: null,
  name: { ar: name, en: name },
  description: null,
  sortOrder: 0,
  isActive: true,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
});

const branch = (id: string, name: string) => ({
  id,
  code: id,
  name: { ar: name, en: name },
  parentId: null,
});

const CONSUMABLES = {
  pageSize: 5,
  belowMin: true,
  active: true,
  sortBy: 'onHandQty',
  sortDir: 'asc',
};
const NARROW = { categoryId: C_LAPTOP, branchId: B_OCT };

const render = (
  permissions: string[],
  path = '/it',
  {
    failed = false,
    pending = false,
    assets = ALL,
  }: { failed?: boolean; pending?: boolean; assets?: ItDashboardAssetsDto } = {},
): string => {
  const qc = new QueryClient({
    // `retryOnMount: false`: a failed read is shown as failed, rather than as a retry starting.
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Infinity, refetchOnMount: false },
    },
  });
  const assetsKey = (params: object) => listKey('it', 'assets', { dashboard: 'assets', ...params });
  if (failed) {
    // A read that FAILED — the cache as a rejected request leaves it.
    const query = qc.getQueryCache().build(qc, { queryKey: assetsKey({}) });
    query.setState({
      ...query.state,
      status: 'error',
      error: new Error('boom'),
      errorUpdatedAt: 1,
      fetchStatus: 'idle',
    });
  } else if (!pending) {
    qc.setQueryData(assetsKey({}), assets);
    qc.setQueryData(assetsKey(NARROW), NARROWED);
  }
  qc.setQueryData(listKey('it', 'assets', { dashboard: 'activity' }), ACTIVITY);
  qc.setQueryData(listKey('it', 'assets', { dashboard: 'activity', ...NARROW }), { items: [] });
  qc.setQueryData(listKey('it', 'mobileLines', { summary: true }), LINES);
  qc.setQueryData(listKey('it', 'mobileLines', { summary: true, branchId: B_OCT }), LINES);
  qc.setQueryData(
    listKey('it', 'consumables', CONSUMABLES),
    page(
      [
        consumable({}),
        consumable({ id: 'k-2', code: 'CON-00001', name: 'SSD', onHandQty: 3, minQty: 5 }),
      ],
      7,
    ),
  );
  qc.setQueryData(listKey('it', 'consumables', { ...CONSUMABLES, branchId: B_OCT }), page([]));
  qc.setQueryData(listKey('it', 'tickets', { pageSize: 1, active: true }), page([], 17));
  qc.setQueryData(
    listKey('it', 'tickets', { pageSize: 1, breached: true, active: true }),
    page([], 3),
  );
  qc.setQueryData(listKey('it', 'catalogs', { kind: 'assetCategory', select: true }), {
    items: [category(C_LAPTOP, 'لاب توب'), category(C_PRINTER, 'طابعات')],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    branch(B_HQ, 'المهندسين'),
    branch(B_OCT, 'أكتوبر'),
  ]);
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/it" element={<ItHomePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const text = (markup: string): string => markup.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ');

/** Every link's target, as the browser will read it. */
const hrefs = (html: string): string[] =>
  [...html.matchAll(/href="([^"]*)"/gu)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));

/** The markup of the element carrying `attr` (to its first closing tag of the same name). */
const block = (html: string, attr: string, tag = 'li'): string => {
  const start = html.indexOf(attr);
  expect(start, attr).toBeGreaterThan(-1);
  const open = html.lastIndexOf(`<${tag}`, start);
  return html.slice(open, html.indexOf(`</${tag}>`, start) + tag.length + 3);
};

const EVERYTHING = [
  'itAsset.view',
  'itTicket.view',
  'itVendor.view',
  'itCatalog.manage',
  'itSlaPolicy.manage',
  'itMaintenance.view',
  'itSparePart.view',
  'itSoftware.view',
  'itLicense.view',
];

describe('the panels, each by its grant', () => {
  it('shows every panel, in the sample’s order, to a reader who holds every grant', () => {
    const html = render(EVERYTHING);
    const order = [
      ar('it.dashboard.title'),
      ar('it.dashboard.totalAssets'),
      ar('it.dashboard.statusSplit'),
      ar('it.dashboard.byCategory.title'),
      ar('it.dashboard.byBranch.title'),
      ar('it.dashboard.attention.title'),
      ar('it.dashboard.activity.title'),
      ar('it.dashboard.consumables.title'),
      'data-help-desk',
      ar('it.dashboard.pages'),
    ].map((needle) => html.indexOf(needle));
    expect(
      order.every((at) => at > -1),
      JSON.stringify(order),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`aria-label="${ar('it.assets.columns.category')}"`);
  });

  it('gives a reader of the help desk alone its two counts and its page — no asset panel', () => {
    const html = render(['itTicket.view']);
    expect(html).toContain('data-help-desk');
    expect(text(html)).toContain('١٧');
    expect(html).not.toContain('data-kpis');
    expect(html).not.toContain(ar('it.dashboard.statusSplit'));
    expect(html).not.toContain(`aria-label="${ar('it.assets.columns.category')}"`);
    expect(hrefs(html).filter((href) => href.startsWith('/it/') && !href.includes('?'))).toEqual([
      '/it/tickets',
    ]);
  });

  it('gives a reader of the assets alone the asset panels, the lines and the consumables — no help desk', () => {
    const html = render(['itAsset.view']);
    expect(html).toContain('data-kpis');
    expect(html).toContain(ar('it.nav.mobileLines'));
    expect(html).toContain(ar('it.dashboard.consumables.title'));
    expect(html).not.toContain('data-help-desk');
    expect(hrefs(html)).not.toContain('/it/tickets');
  });

  it('lists only the pages a reader’s grants open', () => {
    expect(hrefs(render(['itSoftware.view']))).toEqual(['/it/software']);
  });

  it('tells a reader with no IT grant so, once, instead of a wall of errors', () => {
    const html = render([]);
    expect(html).toContain(ar('it.overview.noAccessTitle'));
    expect(html).not.toContain('data-kpis');
    expect(html).not.toContain('data-pages');
  });
});

describe('the figures', () => {
  const html = render(['itAsset.view']);
  const words = text(html);

  it('are the server’s counts, in Arabic digits, each with its share of the total', () => {
    // 120 + 80 + 6 + 4 = 210 assets.
    expect(words).toContain(`${ar('it.dashboard.totalAssets')} ٢١٠`);
    expect(words).toContain(`${ar('it.assets.status.inStock')} ١٢٠`);
    expect(words).toContain(ar('it.dashboard.ofTotal', { share: '٥٧٪' }));
    expect(words).toContain(`${ar('it.assets.status.assigned')} ٨٠`);
    expect(words).toContain(ar('it.dashboard.ofTotal', { share: '٣٨٪' }));
  });

  it('say what they are of — every category, every branch', () => {
    expect(words).toContain(`${ar('it.assets.allCategories')} · ${ar('it.assets.allBranches')}`);
  });

  it('split the states in the sample’s colours, and the legend names each', () => {
    const split = block(html, 'data-status-split', 'div');
    expect(split).toContain('data-segment="inStock"');
    expect(split).toMatch(/data-segment="inStock"[^>]*class="[^"]*bg-emerald-500/u);
    expect(split).toMatch(/data-segment="assigned"[^>]*class="[^"]*bg-brand-600/u);
    expect(split).toMatch(/data-segment="underMaintenance"[^>]*class="[^"]*bg-amber-500/u);
    expect(split).toMatch(/data-segment="disposed"[^>]*class="[^"]*bg-slate-400/u);
    expect(text(block(html, 'data-legend="underMaintenance"'))).toContain('٦');
  });

  it('list «يحتاج متابعة» with each count', () => {
    expect(text(block(html, 'data-attention="heldByLeavers"'))).toContain('٤');
    expect(text(block(html, 'data-attention="receiptsAwaitingSignature"'))).toContain('٢٣');
    expect(text(block(html, 'data-attention="warrantyEndingSoon"'))).toContain(
      ar('it.dashboard.attention.warranty', { within: 'ينتهي خلال ٣٠ يومًا' }),
    );
  });

  it('name each movement — to whom, from whom, between which branches', () => {
    expect(text(block(html, 'data-activity="assigned"'))).toContain('إلى محمد أحمد علي');
    expect(text(block(html, 'data-activity="returned"'))).toContain('من وليد صفوت جلال صفوت');
    expect(text(block(html, 'data-activity="transferred"'))).toContain(
      'إلى 0100077 — أكتوبر ← المهندسين',
    );
  });

  it('never print the asset’s branch today as where an older movement happened', () => {
    // Each fixture's asset is now in a branch; only the transfer recorded one of its own.
    expect(text(block(html, 'data-activity="assigned"'))).not.toContain('أكتوبر');
    expect(text(block(html, 'data-activity="returned"'))).not.toContain('المهندسين');
    expect(text(block(html, 'data-activity="registered"'))).not.toContain('أكتوبر');
  });

  it('link each movement to its asset, and say what it was', () => {
    expect(text(block(html, 'data-activity="assigned"'))).toContain(
      ar('it.custody.event.assigned'),
    );
    expect(hrefs(html)).toEqual(
      expect.arrayContaining(['/it/assets/asset-1', '/it/assets/asset-4']),
    );
  });

  it('show each network with its logo and its lines in each state', () => {
    for (const network of ['vodafone', 'etisalat', 'orange']) {
      expect(block(html, `data-line-network="${network}"`, 'div')).toContain(`${network}.png`);
    }
    const etisalat = text(block(html, 'data-line-network="etisalat"', 'div'));
    expect(etisalat).toContain('٢٧٠');
    expect(etisalat).toContain(`${ar('it.mobileLines.status.assigned')} ٢٢٨`);
    expect(etisalat).toContain(`${ar('it.mobileLines.status.suspended')} ٣`);
  });

  it('list the consumables at their minimum, and how many there are in all', () => {
    const row = text(block(html, 'data-consumable="CON-00001"'));
    expect(row).toContain('SSD');
    expect(row).toContain(`${ar('it.consumables.columns.onHand')} ٣`);
    expect(row).toContain(`${ar('it.consumables.columns.minQty')} ٥`);
    expect(words).toContain(ar('it.dashboard.viewAllCount', { count: '٧' }));
  });
});

describe('the filters and the URL', () => {
  const html = render(['itAsset.view'], `/it?category=${C_LAPTOP}&branch=${B_OCT}`);

  it('read the categories and the branch from the URL and ask the server for that view', () => {
    // 7 + 31 + 1 = 39 — NARROWED's total, which only the narrowed request answers.
    expect(text(html)).toContain(`${ar('it.dashboard.totalAssets')} ٣٩`);
    expect(text(html)).toContain('لاب توب · أكتوبر');
    // The multi-select names the pick; the branch box holds the branch.
    expect(html).toContain('title="لاب توب"');
    expect(html).toMatch(new RegExp(`<option value="${B_OCT}" selected="">`, 'u'));
  });

  it('offer «مسح الفلاتر» only while something is set', () => {
    expect(html).toContain(ar('it.dashboard.clearFilters'));
    expect(render(['itAsset.view'])).not.toContain(ar('it.dashboard.clearFilters'));
  });

  it('remember both, under the asset register’s own names', () => {
    expect(SOURCE).toContain("const REMEMBERED_FILTERS = ['branch', 'category'] as const;");
    expect(SOURCE).toContain('useRememberedFilters([sp, setSp], REMEMBERED_FILTERS)');
  });

  it('mark the chosen category’s row pressed, and dim the ones outside the view', () => {
    const laptop = block(html, `data-category-row="${C_LAPTOP}"`, 'button');
    const printer = block(html, `data-category-row="${C_PRINTER}"`, 'button');
    expect(laptop).toContain('aria-pressed="true"');
    expect(laptop).not.toContain('opacity-50');
    expect(printer).toContain('aria-pressed="false"');
    expect(printer).toContain('opacity-50');
    // Unfiltered, every row is in the view and none is pressed.
    const open = render(['itAsset.view']);
    expect(block(open, `data-category-row="${C_PRINTER}"`, 'button')).not.toContain('opacity-50');
  });

  it('mark the chosen branch’s row pressed', () => {
    const oct = block(html, `data-branch-row="${B_OCT}"`, 'tr');
    const hq = block(html, `data-branch-row="${B_HQ}"`, 'tr');
    expect(oct).toContain('aria-pressed="true"');
    expect(hq).toContain('aria-pressed="false"');
    expect(hq).toContain('opacity-50');
  });

  it('wire a row’s click to the rule that toggles a category or picks a branch', () => {
    expect(SOURCE).toContain(
      'onToggleCategory={(id) => setCategories(toggleCategory(categoryIds, id))}',
    );
    expect(SOURCE).toContain(
      'onPickBranch={(id) => patch({ branch: pickBranch(branchId, id) || null })}',
    );
  });
});

describe('every figure links to its list, carrying the filters', () => {
  const links = hrefs(render(['itAsset.view'], `/it?category=${C_LAPTOP}&branch=${B_OCT}`));
  const has = (path: string, params: Record<string, string>): boolean =>
    links.some((href) => {
      const [p = '', q = ''] = href.split('?');
      return (
        p === path &&
        JSON.stringify(Object.fromEntries(new URLSearchParams(q))) === JSON.stringify(params)
      );
    });
  const scope = { category: C_LAPTOP, branch: B_OCT };

  it('the five counts open the asset register under the same filters, in their state', () => {
    expect(has('/it/assets', scope)).toBe(true);
    for (const status of ['inStock', 'assigned', 'underMaintenance', 'disposed']) {
      expect(has('/it/assets', { ...scope, status }), status).toBe(true);
    }
  });

  it('«يحتاج متابعة» opens the custody register and the asset list in their own words', () => {
    expect(has('/it/custody', { open: 'true', holderExited: 'true', ...scope })).toBe(true);
    expect(has('/it/custody', { open: 'true', receipt: 'unsigned', ...scope })).toBe(true);
    expect(has('/it/custody', { overdue: 'true', ...scope })).toBe(true);
    // The setting's window, as the server read it — 45 days here, not a 30 of ours.
    expect(has('/it/assets', { warrantyEndsWithinDays: '45', ...scope })).toBe(true);
  });

  it('the lines link is never the bare path, which would restore the page’s remembered view', () => {
    expect(hrefs(render(['itAsset.view']))).toContain('/it/mobile-lines?status=');
  });

  it('the lines and the consumables carry the branch', () => {
    expect(has('/it/mobile-lines', { branch: B_OCT })).toBe(true);
    expect(has('/it/consumables', { belowMin: 'true', branch: B_OCT })).toBe(true);
  });

  it('the help desk’s counts open the queue they count', () => {
    const desk = hrefs(render(['itTicket.view']));
    expect(desk).toContain('/it/tickets?active=true');
    expect(desk).toContain('/it/tickets?view=breached&active=true');
  });
});

describe('the warranty early warning switched off', () => {
  // `it.warrantyWarnDays` = 0: no window, so no «٠ أيام» row and no link that would open every asset.
  const html = render(['itAsset.view'], '/it', {
    assets: {
      ...ALL,
      attention: { ...ALL.attention, warrantyEndingSoon: 0, warrantyWindowDays: 0 },
    },
  });

  it('shows no warranty row, and keeps the others', () => {
    expect(html).not.toContain('data-attention="warrantyEndingSoon"');
    expect(html).not.toContain('warrantyEndsWithinDays');
    expect(html).toContain('data-attention="heldByLeavers"');
  });
});

describe('a count on its way, and one that failed', () => {
  it('holds the tiles’ space while the figures load — never a dash that reads as nothing', () => {
    const html = render(['itAsset.view'], '/it', { pending: true });
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain(ar('it.overview.countUnavailable'));
  });

  it('says a figure could not be fetched, and offers to try again', () => {
    const html = render(['itAsset.view'], '/it', { failed: true });
    expect(html).toContain(ar('it.overview.countUnavailable'));
    expect(html).toContain(ar('common.retry'));
    // The panels that do not ride the failed read still stand.
    expect(html).toContain('data-line-network="vodafone"');
  });
});
