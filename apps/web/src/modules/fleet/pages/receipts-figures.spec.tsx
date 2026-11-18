// The fuel and receipts screens' own figures, the ones the fleet dashboard's «الوقود والمصروفات»
// opens or stands beside (audit-10 D04, D09, D35), rendered for real:
//   D04 — «بطاقات الوقود» «استهلاك الوقود الحالي (الشهر)» asks the receipts summary for THIS Cairo
//         month up to Cairo today, in the screen's branch (and cars): the dashboard's «الوقود كله»
//         for «هذا الشهر» (R2 `opex.fuel`) — 520.54 for the company, 420.55 under B1 — never the
//         company's month with a later paper day in it (595.54), never the browser's month;
//   D09 — the KPI tiles of «شحن الكروت» and «بطاقات الوقود» write money to the piastre, as their
//         own rows and the dashboard do (250.75, never 251);
//   D35 — «خصم الإيصالات» has a «الإجمالي» tile over the screen's filters: card + custody, the
//         figure the dashboard's «مصروف التشغيل» shows and opens the screen on (755.54 / 655.55).
//
// The world is the audit's (audit-10 fuel.md, clock 2026-10-31T23:30Z = Cairo 2026-11-01 01:30).
// Each case seeds the cache ONLY under the key the screen must ask: a screen that asked another
// question looks up another key and paints something else, and the case fails.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FleetSettingKeys,
  type FleetFuelCardDto,
  type FleetFuelCardTotalsDto,
  type FleetReceiptTotalsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { FuelCardsPage } from './FuelCardsPage';
import { FuelChargingPage } from './FuelChargingPage';
import { ReceiptFigures, receiptsGrandTotal } from './ReceiptsPage';
import { expiryWindowQuery } from '../lib/vehicle-set-params';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string => readFileSync(join(HERE, file), 'utf8');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const B1 = '650000000000000000000101';
const B2 = '650000000000000000000102';
/** The audit's instant: 2026-10-31 23:30 UTC — already 1 November, 01:30, in Cairo. */
const NOW = '2026-10-31T23:30:00.000Z';

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    branchId: null,
    branchIds: [],
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
  }) as unknown as MeDto;

const SETTINGS = [
  { key: FleetSettingKeys.FuelCardExpiryWarnDays, value: 30, resolvedFrom: 'default' },
  { key: FleetSettingKeys.FuelCardBalanceYellow, value: 300, resolvedFrom: 'default' },
  { key: FleetSettingKeys.FuelCardBalanceRed, value: 100, resolvedFrom: 'default' },
];

const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

const mount = (qc: QueryClient, route: string, permissions: readonly string[]): string => {
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

/** The text of one board KPI tile (`data-fuel-kpi=<id>`), tags stripped. */
const kpi = (html: string, id: string): string => {
  const at = html.indexOf(`data-fuel-kpi="${id}"`);
  if (at < 0) return '';
  return html
    .slice(at, at + 2500)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const card = (over: Partial<FleetFuelCardDto> = {}): FleetFuelCardDto => ({
  id: 'k1',
  vehicleId: 'v-c1',
  vehicleCode: 'c1',
  label: null,
  company: 'wataniya',
  name: 'كارت وطنية c1',
  number: '7045 1120 0098 2231',
  expiresAt: '2099-03-31T00:00:00.000Z',
  hasPassword: true,
  balance: 500.25,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

/** The receipts summary over the audit's world, by the question asked. */
const fuelReceipts = (fuelTotal: number, count: number): FleetReceiptTotalsDto => ({
  count,
  custodyTotal: 0,
  cardTotal: 0,
  fuelTotal,
  fuelLitres: 0,
  tyresTotal: 0,
  washTotal: 0,
  maintenanceTotal: 0,
  fuelCustodyTotal: 0,
  fuelUnpriced: 0,
  custodyCount: 0,
});
/** The company's fuel of 1 November: 300.15 by card + 120.40 + 99.99 from the fund. */
const COMPANY_FUEL = fuelReceipts(520.54, 3);
/** B1's: the receipts of its cars (c1) — 300.15 + 120.40. */
const B1_FUEL = fuelReceipts(420.55, 2);
/** What the old question («from the month's 1st», nothing more) got: + the 75 dated 11-05. */
const UNBOUNDED_FUEL = fuelReceipts(595.54, 4);

const RECEIPT_READER = ['fleetFuelCard.view', 'fleetReceipt.view'] as const;
/** The card list's bound for `?expiresBefore=2026-11-01` — the LAST instant of that day. */
const EXPIRED_BY_TODAY = expiryWindowQuery('', '2026-11-01').before;

/**
 * «بطاقات الوقود» at `route` for a reader who may see receipts, its whole card list seeded under
 * `cardFilters` and the receipts summary ONLY under `{ summary, kind: 'fuel', ...receiptQuery }`.
 */
const fuelCardsAt = (
  route: string,
  {
    cardFilters = {},
    receiptQuery,
    receipts,
    permissions = RECEIPT_READER,
    cards = [card()],
  }: {
    cardFilters?: Record<string, unknown>;
    receiptQuery?: Record<string, unknown>;
    receipts?: FleetReceiptTotalsDto;
    permissions?: readonly string[];
    cards?: FleetFuelCardDto[];
  },
): string => {
  const qc = client();
  qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true, ...cardFilters }), {
    items: cards,
    meta: { page: 1, pageSize: 100, totalItems: cards.length, totalPages: 1 },
  });
  if (receiptQuery !== undefined && receipts !== undefined) {
    qc.setQueryData(
      listKey('fleet', 'receipts', { summary: true, kind: 'fuel', ...receiptQuery }),
      receipts,
    );
  }
  qc.setQueryData(['settings', 'me'], SETTINGS);
  return mount(qc, route, permissions);
};

describe('D04 — «استهلاك الوقود الحالي (الشهر)» asks what «الوقود كله» asks for «هذا الشهر»', () => {
  const TZ = process.env['TZ'];
  afterEach(() => {
    vi.useRealTimers();
    if (TZ === undefined) delete process.env['TZ'];
    else process.env['TZ'] = TZ;
  });
  const at = (instant: string, zone: string): void => {
    process.env['TZ'] = zone;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(instant) });
  };

  it('the company: the 1st of the Cairo month to Cairo today — 520.54, as the dashboard', () => {
    at(NOW, 'Africa/Cairo');
    const html = fuelCardsAt('/fleet/fuel-cards', {
      receiptQuery: { from: '2026-11-01', to: '2026-11-01' },
      receipts: COMPANY_FUEL,
    });
    const tile = kpi(html, 'consumption');
    expect(tile).toContain(ar('fleet.fuelCards.board.kpi.consumption'));
    expect(tile).toContain('520.54');
    expect(tile).toContain(ar('fleet.fuelCards.board.kpi.consumptionNote', { count: '3' }));
  });

  it('under a branch (the dashboard’s «ومنتهية» with branch=B1): B1’s receipts — 420.55', () => {
    at(NOW, 'Africa/Cairo');
    const html = fuelCardsAt(`/fleet/fuel-cards?expiresBefore=2026-11-01&branch=${B1}`, {
      cardFilters: { expiresBefore: EXPIRED_BY_TODAY, branchIds: [B1] },
      receiptQuery: { from: '2026-11-01', to: '2026-11-01', branchIds: [B1] },
      receipts: B1_FUEL,
    });
    expect(kpi(html, 'consumption')).toContain('420.55');
  });

  it('carries every branch of «كل فروعي» and the cars the screen is narrowed to', () => {
    at(NOW, 'Africa/Cairo');
    const html = fuelCardsAt(`/fleet/fuel-cards?branch=${B1},${B2}&vehicleCodes=c1,c3`, {
      cardFilters: { branchIds: [B1, B2], vehicleCodes: ['c1', 'c3'] },
      receiptQuery: {
        from: '2026-11-01',
        to: '2026-11-01',
        branchIds: [B1, B2],
        vehicleCodes: ['c1', 'c3'],
      },
      receipts: COMPANY_FUEL,
    });
    expect(kpi(html, 'consumption')).toContain('520.54');
  });

  it('is never answered from the old question — no `to`, no branch (595.54 with the 11-05 receipt)', () => {
    at(NOW, 'Africa/Cairo');
    const html = fuelCardsAt(`/fleet/fuel-cards?expiresBefore=2026-11-01&branch=${B1}`, {
      cardFilters: { expiresBefore: EXPIRED_BY_TODAY, branchIds: [B1] },
      receiptQuery: { from: '2026-11-01' },
      receipts: UNBOUNDED_FUEL,
    });
    // The summary it asks for is not in the cache: the tile waits (the balances stand in its
    // place), and 595.54 is nowhere.
    expect(kpi(html, 'consumption')).toBe('');
    expect(html).not.toContain('595.54');
    expect(html).not.toContain('596');
  });

  it('a browser on UTC at the same instant asks Cairo’s month too — never 1 October', () => {
    at(NOW, 'UTC');
    const html = fuelCardsAt('/fleet/fuel-cards', {
      receiptQuery: { from: '2026-11-01', to: '2026-11-01' },
      receipts: COMPANY_FUEL,
    });
    expect(kpi(html, 'consumption')).toContain('520.54');
    const october = fuelCardsAt('/fleet/fuel-cards', {
      receiptQuery: { from: '2026-10-01' },
      receipts: UNBOUNDED_FUEL,
    });
    expect(kpi(october, 'consumption')).toBe('');
  });

  it('later in the month: from the 1st up to today, the paper days after today left out', () => {
    at('2026-11-17T10:00:00.000Z', 'Africa/Cairo');
    const html = fuelCardsAt('/fleet/fuel-cards', {
      receiptQuery: { from: '2026-11-01', to: '2026-11-17' },
      receipts: UNBOUNDED_FUEL,
    });
    expect(kpi(html, 'consumption')).toContain('595.54');
  });

  it('asks it in the screen’s own source with the dashboard’s period rule, not the browser’s month', () => {
    const src = source('FuelCardsPage.tsx');
    expect(src).toContain("periodOf('thisMonth', cairoYmd(new Date()))");
    expect(src).not.toContain('now.getFullYear()');
    expect(src).not.toContain('Date.UTC(');
  });
});

describe('D09 — the fuel screens’ KPI tiles write money to the piastre', () => {
  // The R1 figures of the audit's company view.
  const TOTALS: FleetFuelCardTotalsDto = {
    wataniyaBalance: 580.25,
    chilloutBalance: 2450.75,
    requestedCount: 1,
    requestedAmount: 150.5,
    chargedTodayAmount: 3753.37,
    cardCount: 6,
    wataniyaCards: 3,
    chilloutCards: 3,
    noCarCards: 1,
    noCarBalance: 80,
  };

  const chargingAt = (route: string, filters: Record<string, unknown>): string => {
    const qc = client();
    qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true, ...filters }), {
      items: [],
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 },
    });
    qc.setQueryData(listKey('fleet', 'fuelCards', { summary: true, ...filters }), TOTALS);
    qc.setQueryData(['settings', 'me'], SETTINGS);
    return mount(qc, route, ['fleetFuelCharge.view']);
  };

  it('«شحن الكروت»: the balances, the requests’ amount and «شُحن اليوم» — 580.25 · 2,450.75 · 150.50 · 3,753.37', () => {
    const html = chargingAt('/fleet/fuel-cards/charging', {
      vehicleCodes: undefined,
      company: undefined,
      requested: undefined,
      balanceBelow: undefined,
    });
    expect(kpi(html, 'wataniya')).toContain('580.25');
    expect(kpi(html, 'chillout')).toContain('2,450.75');
    expect(kpi(html, 'requested')).toContain('150.50');
    expect(kpi(html, 'charged')).toContain('3,753.37');
    // Never the whole pounds the tiles used to write.
    expect(kpi(html, 'chillout')).not.toMatch(/2,451(?!\.)/u);
    expect(kpi(html, 'charged')).not.toMatch(/3,753(?!\.)/u);
    expect(kpi(html, 'requested')).not.toMatch(/151(?!\.)/u);
  });

  it('opened by «أرصدة وطنية» (?company=wataniya): the tile is 580.25, not 580', () => {
    const html = chargingAt('/fleet/fuel-cards/charging?company=wataniya', {
      company: 'wataniya',
    });
    const tile = kpi(html, 'wataniya');
    expect(tile).toContain('580.25');
    expect(tile).not.toMatch(/580(?!\.)/u);
  });

  it('a whole pound still carries its piastres, as the rows write it — 0.00, 1,000.00', () => {
    const qc = client();
    const filters = {
      vehicleCodes: undefined,
      company: undefined,
      requested: undefined,
      balanceBelow: undefined,
    };
    qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true, ...filters }), {
      items: [],
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 },
    });
    qc.setQueryData(listKey('fleet', 'fuelCards', { summary: true, ...filters }), {
      ...TOTALS,
      wataniyaBalance: 1000,
      chargedTodayAmount: 0,
    });
    qc.setQueryData(['settings', 'me'], SETTINGS);
    const html = mount(qc, '/fleet/fuel-cards/charging', ['fleetFuelCharge.view']);
    expect(kpi(html, 'wataniya')).toContain('1,000.00');
    expect(kpi(html, 'charged')).toContain('0.00');
  });

  it('«بطاقات الوقود»: «إجمالي أرصدة الكروت» and its note by company, to the piastre', () => {
    // A reader without the receipts grant sees the cards' balances in the month's place.
    const html = fuelCardsAt('/fleet/fuel-cards', {
      permissions: ['fleetFuelCard.view'],
      cards: [
        card({ id: 'k1', company: 'wataniya', balance: 500.25 }),
        card({
          id: 'k2',
          vehicleId: 'v-c2',
          vehicleCode: 'c2',
          company: 'chillout',
          balance: 250.5,
        }),
      ],
    });
    const tile = kpi(html, 'balance');
    expect(tile).toContain('750.75');
    expect(tile).toContain(
      ar('fleet.fuelCards.board.kpi.balanceNote', { wataniya: '500.25', chillout: '250.50' }),
    );
    expect(tile).not.toMatch(/751(?!\.)/u);
  });

  it('«استهلاك الوقود الحالي (الشهر)» to the piastre too — 420.55, never 421', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
    try {
      const html = fuelCardsAt(`/fleet/fuel-cards?branch=${B1}`, {
        cardFilters: { branchIds: [B1] },
        receiptQuery: { from: '2026-11-01', to: '2026-11-01', branchIds: [B1] },
        receipts: B1_FUEL,
      });
      const tile = kpi(html, 'consumption');
      expect(tile).toContain('420.55');
      expect(tile).not.toMatch(/421(?!\.)/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it('neither screen rounds a tile to the pound any more; both write through `formatMoneyParts`', () => {
    for (const file of ['FuelChargingPage.tsx', 'FuelCardsPage.tsx']) {
      const src = source(file);
      expect(src, file).not.toContain('Math.round(value).toLocaleString');
      expect(src, file).toContain("formatMoneyParts(value, 'EGP', locale).figure");
    }
  });
});

describe('D35 — «خصم الإيصالات» has a «الإجمالي» tile over the screen’s filters', () => {
  /**
   * B1's receipts of 1 November: c1's card fuel 300.15; the fund 355.40 — c1's fuel 120.40 and
   * tyres 200, and the wash 35 on c4 (deleted since, still B1's by its last branch).
   */
  const B1_TOTALS: FleetReceiptTotalsDto = {
    count: 4,
    custodyTotal: 355.4,
    cardTotal: 300.15,
    fuelTotal: 420.55,
    fuelLitres: 27.13,
    tyresTotal: 200,
    washTotal: 35,
    maintenanceTotal: 0,
    fuelCustodyTotal: 120.4,
    fuelUnpriced: 0,
    custodyCount: 3,
  };

  const figures = (totals: FleetReceiptTotalsDto): string => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: { me: me(['fleetReceipt.view']), status: 'signedIn' as const },
        ui: { theme: 'light' as const, sidebarOpen: false },
      },
    });
    return renderToStaticMarkup(
      <Provider store={store}>
        <ReceiptFigures totals={totals} />
      </Provider>,
    );
  };
  const tile = (html: string): string => {
    const at = html.indexOf('data-receipt-figure="all"');
    return at < 0 ? '' : html.slice(at, html.indexOf('</div>', at));
  };

  it('the company: card 300.15 + the fund 455.39 = 755.54 — the dashboard’s «مصروف التشغيل»', () => {
    const html = figures(COMPANY_TOTALS);
    const all = tile(html);
    expect(all).toContain(ar('fleet.receipts.totals.all'));
    // The figure and «ج.م.» in spans of their own, as the other tiles write them.
    expect(all).toMatch(/>755\.54<\/span><span[^>]*>ج\.م\.<\/span>/u);
  });

  it('under B1: 300.15 + 355.40 = 655.55', () => {
    expect(tile(figures(B1_TOTALS))).toContain('>655.55<');
  });

  it('heads the tiles — the total, then the fund, the cards, fuel and the fund’s other kinds', () => {
    const html = figures(COMPANY_TOTALS);
    const order = [
      'data-receipt-figure="all"',
      ar('fleet.receipts.totals.custody'),
      ar('fleet.receipts.totals.card'),
      ar('fleet.receipts.totals.fuel'),
      ar('fleet.receipts.totals.tyresWash'),
    ].map((needle) => html.indexOf(needle));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The parts are unchanged beside it.
    expect(html).toContain('>455.39<');
    expect(html).toContain('>300.15<');
    expect(html).toContain('>520.54<');
  });

  it('adds in whole piastres — never a float tail (0.10 + 0.20 = 0.30)', () => {
    expect(receiptsGrandTotal({ ...COMPANY_TOTALS, cardTotal: 0.1, custodyTotal: 0.2 })).toBe(0.3);
    expect(receiptsGrandTotal(COMPANY_TOTALS)).toBe(755.54);
    expect(receiptsGrandTotal(B1_TOTALS)).toBe(655.55);
  });

  it('is laid out on a row of its own up to `lg`, the four parts under it, all five in one row from `xl`', () => {
    const html = figures(COMPANY_TOTALS);
    expect(html).toContain('grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5');
    expect(html).toContain('class="col-span-2 lg:col-span-4 xl:col-span-1"');
    // A sum too long for its tile puts «ج.م.» under it rather than off the tile.
    expect(html).toContain('[&amp;_.items-baseline]:flex-wrap');
  });

  it('is named «الإجمالي»', () => {
    expect(ar('fleet.receipts.totals.all')).toBe('الإجمالي');
    expect(translate('en', 'fleet.receipts.totals.all')).toBe('Total');
  });

  it('reads the same summary as the other tiles — the screen’s filters, over every page', () => {
    const src = source('ReceiptsPage.tsx');
    expect(src).toContain('const summary = useReceiptSummary(filters);');
    expect(src).toContain('<ReceiptFigures totals={summary.data} />');
    expect(src).toContain('{...moneyChip(receiptsGrandTotal(totals), locale)}');
  });
});

/** The company's receipts of 1 November (audit-10 fuel.md): card 300.15; the fund 455.39. */
const COMPANY_TOTALS: FleetReceiptTotalsDto = {
  count: 5,
  custodyTotal: 455.39,
  cardTotal: 300.15,
  fuelTotal: 520.54,
  fuelLitres: 32.93,
  tyresTotal: 200,
  washTotal: 35,
  maintenanceTotal: 0,
  fuelCustodyTotal: 220.39,
  fuelUnpriced: 0,
  custodyCount: 4,
};
