// «بطاقات الوقود» and «شحن الكروت» read the BRANCH a dashboard figure was counted over (build-vf plan
// D10, DECISIONS §0b answer 1: fuel cards follow the branch of the card's CURRENT car): the links of
// «الوقود والمصروفات», the overview's fuel lines and «ملخصات» carry `branch`, and each screen must
// show exactly the cards the figure counted.
//
// As in `fleet-dashboard-target-params.spec.tsx`, each case renders the screen at an address and
// seeds the cache ONLY under the key carrying the API fields the link must become (`branchIds`): a
// screen that dropped the branch, or sent it to one read but not the other, looks up another key and
// paints nothing, and the case fails. Also pinned: the branch is SHOWN on the bar while it narrows
// and comes off there and with «مسح»; it is remembered with the screen's other filters, read in the
// page's OWN source; the cards screen's «every active car has its block» fill-in keeps to the
// branch's cars (a car of another branch with no card is not this branch's).
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
  FleetSettingKeys,
  type FleetFuelCardDto,
  type FleetFuelCardTotalsDto,
  type FleetVehicleDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { FuelCardsPage } from './pages/FuelCardsPage';
import { FuelChargingPage } from './pages/FuelChargingPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string => readFileSync(join(HERE, file), 'utf8');
const ar = (key: string): string => translate('ar', key);

const B1 = '650000000000000000000101';
const B2 = '650000000000000000000102';

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  }) as unknown as MeDto;

const ALL = [
  'fleetFuelCard.view',
  'fleetFuelCard.create',
  'fleetFuelCard.edit',
  'fleetFuelCharge.view',
  'fleetFuelCharge.request',
  'fleetFuelCharge.approve',
];

const card = (over: Partial<FleetFuelCardDto> = {}): FleetFuelCardDto => ({
  id: 'c-204',
  vehicleId: 'v-204',
  vehicleCode: '204',
  label: null,
  company: 'wataniya',
  name: 'كارت وطنية 204',
  number: '7045 1120 0098 2231',
  expiresAt: '2099-03-31T00:00:00.000Z',
  hasPassword: true,
  balance: 640,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

/** A car of the registry, as the whole-registry read answers it (only what the screen reads). */
const car = (id: string, code: string, branchId: string | null): FleetVehicleDto =>
  ({ id, code, branchId, status: 'active' }) as unknown as FleetVehicleDto;

/** The branch's totals, told apart from the company's by their figures. */
const BRANCH_TOTALS: FleetFuelCardTotalsDto = {
  wataniyaBalance: 71_320,
  chilloutBalance: 44_180,
  requestedCount: 2,
  requestedAmount: 15_000,
  chargedTodayAmount: 5_000,
  cardCount: 34,
  wataniyaCards: 21,
  chilloutCards: 13,
  noCarCards: 0,
  noCarBalance: 0,
};

/**
 * The screen at `route`, its whole card list (and, for the charging screen, its totals) seeded under
 * the API fields `filters` — and nowhere else — and the registry's cars under the whole-registry key.
 */
const screenAt = (
  page: 'cards' | 'charging',
  route: string,
  {
    filters,
    cards = [card()],
    totals = BRANCH_TOTALS,
    vehicles = [],
  }: {
    filters: Record<string, unknown>;
    cards?: FleetFuelCardDto[];
    totals?: FleetFuelCardTotalsDto;
    vehicles?: FleetVehicleDto[];
  },
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(ALL), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true, ...filters }), {
    items: cards,
    meta: { page: 1, pageSize: 100, totalItems: cards.length, totalPages: 1 },
  });
  qc.setQueryData(listKey('fleet', 'fuelCards', { summary: true, ...filters }), totals);
  qc.setQueryData(listKey('fleet', 'vehicles', { whole: true, anyStatus: true }), {
    items: vehicles,
    meta: { page: 1, pageSize: 100, totalItems: vehicles.length, totalPages: 1 },
  });
  qc.setQueryData(
    ['settings', 'me'],
    [
      { key: FleetSettingKeys.FuelCardExpiryWarnDays, value: 30, resolvedFrom: 'default' },
      { key: FleetSettingKeys.FuelCardBalanceYellow, value: 300, resolvedFrom: 'default' },
      { key: FleetSettingKeys.FuelCardBalanceRed, value: 100, resolvedFrom: 'default' },
    ],
  );
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/fleet/fuel-cards" element={<FuelCardsPage />} />
            <Route path="/fleet/fuel-cards/charging" element={<FuelChargingPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const PAGES = {
  cards: { path: '/fleet/fuel-cards', file: 'pages/FuelCardsPage.tsx' },
  charging: { path: '/fleet/fuel-cards/charging', file: 'pages/FuelChargingPage.tsx' },
} as const;

/** What a screen declared, read out of its own `REMEMBERED_FILTERS` — the census's reading. */
const remembered = (src: string): string[] => {
  const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/u.exec(src);
  return block === null ? [] : [...(block[1] ?? '').matchAll(/'([^']+)'/gu)].map((m) => m[1] ?? '');
};

describe('/fleet/fuel-cards reads the branch of the card’s current car (`branch` → branchIds)', () => {
  it('asks the cards of that branch', () => {
    const html = screenAt('cards', `${PAGES.cards.path}?branch=${B1}`, {
      filters: { branchIds: [B1] },
    });
    expect(html, 'the seeded card is on the board').toContain('data-fuel-tile="v-204"');
  });

  it('never answers a narrowed address from the company’s list', () => {
    const html = screenAt('cards', `${PAGES.cards.path}?branch=${B1}`, { filters: {} });
    expect(html).not.toContain('data-fuel-tile="v-204"');
  });

  it('asks the company’s list when no branch narrows, as before', () => {
    const html = screenAt('cards', PAGES.cards.path, { filters: {} });
    expect(html).toContain('data-fuel-tile="v-204"');
    expect(html).not.toContain('data-fuel-branch-filter');
  });

  it('carries several branches («كل فروعي») as one list', () => {
    const html = screenAt('cards', `${PAGES.cards.path}?branch=${B1},${B2}`, {
      filters: { branchIds: [B1, B2] },
    });
    expect(html).toContain('data-fuel-tile="v-204"');
    expect(html).toContain(`data-fuel-branch-filter="${B1},${B2}"`);
  });

  it('keeps «every active car has its block» to the branch’s cars', () => {
    const vehicles = [car('v-204', '204', B1), car('v-302', '302', B1), car('v-301', '301', B2)];
    const narrowed = screenAt('cards', `${PAGES.cards.path}?branch=${B1}`, {
      filters: { branchIds: [B1] },
      vehicles,
    });
    expect(narrowed, 'a car of the branch with no card still has its block').toContain(
      'data-fuel-tile="v-302"',
    );
    expect(narrowed, 'a car of another branch is not this branch’s').not.toContain(
      'data-fuel-tile="v-301"',
    );
    const company = screenAt('cards', PAGES.cards.path, { filters: {}, vehicles });
    expect(company).toContain('data-fuel-tile="v-301"');
    expect(company).toContain('data-fuel-tile="v-302"');
  });
});

describe('/fleet/fuel-cards/charging reads the branch for its list AND its totals', () => {
  it('asks both reads for that branch: the cards and «أرصدة …» / «شُحن اليوم» above them', () => {
    const html = screenAt('charging', `${PAGES.charging.path}?branch=${B1}`, {
      filters: { branchIds: [B1] },
    });
    expect(html).toContain('data-fuel-tile="v-204"');
    // The totals of the branch (`wataniyaBalance` 71,320 and today's 5,000), not a dash.
    expect(html).toContain('71,320');
    expect(html).toContain('5,000');
  });

  it('never answers a narrowed address from the company’s reads', () => {
    const html = screenAt('charging', `${PAGES.charging.path}?branch=${B1}`, { filters: {} });
    expect(html).not.toContain('data-fuel-tile="v-204"');
    expect(html).not.toContain('71,320');
  });

  it('carries the branch beside a state and a company the dashboard sends', () => {
    // «طلبات الرصيد والرصيد المنخفض» under a branch; a balance KPI under a branch.
    const states = screenAt('charging', `${PAGES.charging.path}?state=requested,low&branch=${B1}`, {
      filters: { branchIds: [B1] },
    });
    expect(states).toContain(`data-fuel-branch-filter="${B1}"`);
    const company = screenAt('charging', `${PAGES.charging.path}?company=wataniya&branch=${B1}`, {
      filters: { company: 'wataniya', branchIds: [B1] },
    });
    expect(company).toContain('data-fuel-tile="v-204"');
  });
});

describe('both screens show the branch while it narrows, take it off, and remember it', () => {
  for (const page of ['cards', 'charging'] as const) {
    it(`${page}: shows ONE «الفرع» control on the bar while narrowed, and the bar’s «مسح»`, () => {
      const html = screenAt(page, `${PAGES[page].path}?branch=${B1}`, {
        filters: { branchIds: [B1] },
      });
      expect(html.match(/data-fuel-branch-filter=/gu)).toHaveLength(1);
      expect(html).toContain(`data-fuel-branch-filter="${B1}"`);
      const control = html.slice(html.indexOf('data-fuel-branch-filter'));
      expect(control).toContain(ar('recruitment.filters.branch'));
      expect(html, '«مسح» is offered with the branch alone narrowing').toContain(
        ar('common.filters.clear'),
      );
    });

    it(`${page}: takes the branch off on the control and with «مسح»`, () => {
      const src = source(PAGES[page].file);
      expect(src).toContain('onChange={(ids) => patch({ branch: writeList(ids) })}');
      // The bar's «مسح»: from its `onClear` to the first control of the bar.
      const at = src.indexOf('onClear={');
      expect(src.slice(at, src.indexOf('<FilterWithIcon', at))).toMatch(/branch: null/u);
      expect(src).toMatch(/hasActiveFilters=\{[^}]*branchIds\.length > 0\}/u);
    });

    it(`${page}: remembers \`branch\` and reads it in its own source`, () => {
      const src = source(PAGES[page].file);
      expect(remembered(src)).toContain('branch');
      expect(src).toContain("readList(sp, 'branch')");
      expect(src).toContain('branchIds: branchIds.length > 0 ? branchIds : undefined');
    });
  }

  it('the charging screen sends ONE filter object to its list and its totals', () => {
    const src = source(PAGES.charging.file);
    expect(src).toContain('useAllFuelCards(filters)');
    expect(src).toContain('useFuelCardSummary(filters)');
  });
});
