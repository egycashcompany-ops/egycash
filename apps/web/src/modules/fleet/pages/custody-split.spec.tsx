// «خلاص افصلهم»: «العهدة» split in two. SCREEN 1 «العهدة» is the money itself — `/fleet/custody`
// only redirects, and its three tabs («سجل العهدة», «المذكرات», «لوحة تحكم العهدة») share one head:
// the fund now, «استعاضة معلّقة», the three actions and their dialogs. SCREEN 2 «مصروفات العهدة»
// (`/fleet/custody-expenses`) is the board, a menu row of its own, its «كل الحركات» showing the memo
// a receipt is a line of under «من». Rendered to markup against seeded caches (the suite has no
// DOM), as every Fleet screen spec; the redirect's target is read from the pure helper.
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
  type FleetCustodyFundSummaryDto,
  type FleetCustodyMovementDto,
  type FleetCustodySummaryDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { resolveNavIcon } from '../../../platform/navigation/app-icon';
import type * as RouterDom from 'react-router-dom';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});
// `<Navigate>` acts in an effect, which a markup render never runs: draw where it would go instead.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof RouterDom>();
  const Navigate = ({ to, replace }: { to: string; replace?: boolean }): JSX.Element => (
    <a data-navigate={to} data-replace={String(replace === true)} />
  );
  return { ...actual, Navigate };
});

const { CUSTODY_BOARD_PARAMS, custodyEntryTarget } = await import('../lib/custody-entry');
const { CustodyEntry } = await import('../components/CustodyEntry');
const { CustodyFundHeader, CustodyHeldChip } = await import('../components/CustodyFundHeader');
const { CUSTODY_NEGATIVE_INK } = await import('../components/CustodyFigures');
const { custodyFundKey } = await import('../api/fleet-queries');
const { CustodyPage } = await import('./CustodyPage');
const { CustodyMemosPage } = await import('./CustodyMemosPage');
const { CustodyFundDashboardPage } = await import('./CustodyFundDashboardPage');

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const text = (part: string): string =>
  part
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
/** The opening tag that carries `attr`. */
const tagOf = (html: string, attr: string): string => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

const VIEW = ['fleetCustody.view'] as const;
const WRITER = ['fleetCustody.view', 'fleetReceipt.create', 'fleetReceipt.edit'] as const;

const me = (permissions: readonly string[]): MeDto =>
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

const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

/** `node` at `path` (its route `route`), for a reader holding `permissions`. */
const mount = (
  qc: QueryClient,
  node: JSX.Element,
  path: string,
  permissions: readonly string[] = WRITER,
  route = path.split('?')[0] ?? path,
): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: { me: me(permissions), status: 'signedIn' as const },
          ui: { theme: 'light' as const, sidebarOpen: false },
        },
      })}
    >
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** The fund as the server answers — 159,974.54 in it, nothing held unless `over` says so. */
const FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 159_974.54,
  charged: { count: 2, amount: 300_000 },
  spent: { count: 126, amount: 97_794 },
  replenished: { count: 1, amount: 81_908, memos: 5 },
  settled: { count: 1, amount: 124_139.46, parts: 3 },
  held: { count: 0, amount: 0, memos: 0, receipts: 0 },
  cancelled: { count: 0, amount: 0 },
  operations: 4,
  memos: { count: 5, pending: 0, pendingTotal: 0 },
  outside: [],
};
const seeded = (over: Partial<FleetCustodyFundSummaryDto> = {}): QueryClient => {
  const qc = client();
  qc.setQueryData(custodyFundKey, { ...FUND, ...over });
  return qc;
};
const head = (qc: QueryClient, path = '/fleet/custody/log', permissions?: readonly string[]) =>
  mount(qc, <CustodyFundHeader />, path, permissions);

describe('`/fleet/custody` — «العهدة» opens «سجل العهدة»; an old board link lands on SCREEN 2', () => {
  it('opens «سجل العهدة» with nothing asked', () => {
    expect(custodyEntryTarget('')).toBe('/fleet/custody/log');
    expect(custodyEntryTarget('?')).toBe('/fleet/custody/log');
    // A parameter the board never wrote is no board link.
    expect(custodyEntryTarget('?open=650000000000000000000001')).toBe('/fleet/custody/log');
  });

  it('sends an old board link to «مصروفات العهدة», its whole query kept', () => {
    expect(custodyEntryTarget('?from=2026-09-01&to=2026-09-30')).toBe(
      '/fleet/custody-expenses?from=2026-09-01&to=2026-09-30',
    );
    for (const key of CUSTODY_BOARD_PARAMS) {
      expect(custodyEntryTarget(`?${key}=x`), key).toBe(`/fleet/custody-expenses?${key}=x`);
    }
    expect(custodyEntryTarget('?source=fuel%2Cwash&page=3&size=50')).toBe(
      '/fleet/custody-expenses?source=fuel%2Cwash&page=3&size=50',
    );
  });

  it('opens a `?fund=` dialog on «سجل العهدة» — the board’s filters left behind', () => {
    for (const op of ['settle', 'replenish', 'charge']) {
      expect(custodyEntryTarget(`?fund=${op}`), op).toBe(`/fleet/custody/log?fund=${op}`);
      expect(custodyEntryTarget(`?from=2026-09-01&fund=${op}&page=2`), op).toBe(
        `/fleet/custody/log?fund=${op}`,
      );
    }
    // A `fund` it does not know opens nothing: the rest decides.
    expect(custodyEntryTarget('?fund=refund')).toBe('/fleet/custody/log');
    expect(custodyEntryTarget('?fund=refund&from=2026-09-01')).toBe(
      '/fleet/custody-expenses?fund=refund&from=2026-09-01',
    );
  });

  it('knows every parameter the board writes into its own address', () => {
    const board = read('CustodyPage.tsx');
    const written = [...board.matchAll(/sp\.get\('(\w+)'\)/gu)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(5);
    for (const key of written) expect(CUSTODY_BOARD_PARAMS, key).toContain(key);
  });

  it('redirects in place, so Back never returns to the bare address', () => {
    const go = (search: string): string => {
      const html = mount(client(), <CustodyEntry />, `/fleet/custody${search}`, VIEW);
      return tagOf(html, 'data-navigate=');
    };
    expect(go('')).toContain('data-navigate="/fleet/custody/log"');
    expect(go('')).toContain('data-replace="true"');
    expect(go('?from=2026-10-01')).toContain(
      'data-navigate="/fleet/custody-expenses?from=2026-10-01"',
    );
    expect(go('?fund=settle&to=2026-10-31')).toContain('data-navigate="/fleet/custody/log?fund=settle"');
  });
});

describe('SCREEN 1’s head — the fund now, «استعاضة معلّقة», the actions, the tabs', () => {
  it('writes the fund now, «ج.م.» apart, with the held chip beside it and the actions after', () => {
    const html = head(seeded());
    const now = html.slice(html.indexOf('data-custody-fund-now="head"'));
    expect(text(now.slice(0, now.indexOf('data-custody-held')))).toContain(
      `${ar('fleet.custody.ledger.tiles.fundNow')} 159,974.54 ج.م.`,
    );
    expect(tagOf(html, 'data-custody-fund-value=')).toContain('data-custody-fund-value="159974.54"');
    expect(html).not.toContain('data-custody-fund-negative');
    // Right to left: the fund now, its chip, the three — in the bar — then the tabs under it.
    const order = [
      'data-custody-fund-bar="true"',
      'data-custody-fund-now="head"',
      'data-custody-held=',
      'data-custody-fund-actions="true"',
      'data-custody-tabs="true"',
    ].map((attr) => html.indexOf(attr));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('writes a fund below zero «−X» in red, left to right — never clamped to 0', () => {
    const html = head(seeded({ fundTotal: -4_335.5 }));
    const negative = tagOf(html, 'data-custody-fund-negative="true"');
    expect(negative).toContain('dir="ltr"');
    expect(negative).toContain(`class="${CUSTODY_NEGATIVE_INK}"`);
    expect(html).toMatch(/data-custody-fund-negative="true"[^>]*>−4,335\.50</u);
  });

  it('shows «استعاضة معلّقة» muted at 0 and amber while a replenishment waits for its transfer', () => {
    const none = tagOf(head(seeded()), 'data-custody-held=');
    expect(none).toContain('data-custody-held="0"');
    expect(none).toContain(`title="${ar('fleet.custody.hold.heldNone')}"`);
    expect(none).toContain('text-slate-500');
    expect(none).not.toContain('amber');
    // The amount is the fund summary's own `held`, not a figure of the screen's.
    const waitingHtml = head(seeded({ held: { count: 1, amount: 12_500, memos: 2, receipts: 9 } }));
    const waiting = tagOf(waitingHtml, 'data-custody-held=');
    expect(waiting).toContain('data-custody-held="12500"');
    expect(waiting).toContain(`title="${ar('fleet.custody.hold.heldTileNote')}"`);
    expect(waiting).toContain('bg-amber-50');
    expect(waiting).toContain('dark:text-amber-300');
    const chip = waitingHtml.slice(waitingHtml.indexOf('data-custody-held='));
    expect(text(chip.slice(0, chip.indexOf('</span></span>') + 14))).toBe(
      'استعاضة معلّقة: 12,500.00 ج.م.',
    );
    expect(chip).toMatch(/<span dir="ltr" class="[^"]*">12,500\.00<\/span>/u);
    expect(ar('fleet.custody.hold.heldTile', { amount: 'X' })).toBe('استعاضة معلّقة: X');
  });

  it('draws the chip from any amount it is handed', () => {
    const html = mount(client(), <CustodyHeldChip amount={300} />, '/fleet/custody/log');
    expect(text(html)).toBe('استعاضة معلّقة: 300.00 ج.م.');
  });

  it('shimmers while the fund is on its way, and says «—» if it cannot be read', () => {
    const loading = head(client());
    expect(loading).not.toContain('data-custody-fund-now');
    expect(loading).not.toContain('data-custody-held');
    // The tabs and the actions do not wait for it.
    expect(loading).toContain('data-custody-tabs="true"');
    expect(loading).toContain('data-custody-fund-actions="true"');
    const qc = client();
    qc.getQueryCache()
      .build(qc, { queryKey: custodyFundKey })
      .setState({ status: 'error', error: new Error('down'), fetchStatus: 'idle' });
    const failed = head(qc);
    console.log('DBG', failed.slice(0, 1500));
    const strip = failed.slice(failed.indexOf('data-custody-fund-failed="true"'));
    expect(text(strip.slice(0, strip.indexOf('data-custody-fund-actions')))).toContain(
      `${ar('fleet.custody.ledger.tiles.fundNow')} —`,
    );
    expect(failed).not.toContain('data-custody-held');
  });

  it('offers the actions only to a reader who may write custody money', () => {
    const viewer = head(seeded(), '/fleet/custody/log?fund=charge', VIEW);
    expect(viewer).toContain('data-custody-fund-now="head"');
    expect(viewer).toContain('data-custody-held=');
    expect(viewer).not.toContain('data-custody-fund-actions');
    expect(viewer).not.toContain('data-memo-charge="true"');
  });

  it.each([
    ['/fleet/custody/memos', <CustodyMemosPage key="memos" />],
    ['/fleet/custody/dashboard', <CustodyFundDashboardPage key="dashboard" />],
  ])('opens the `?fund=` dialog on %s too — mounted once, in the head', (path, page) => {
    const html = mount(seeded(), page, `${path}?fund=charge`);
    expect(html.match(/data-custody-fund-header="true"/gu)).toHaveLength(1);
    expect(html.match(/data-memo-charge="true"/gu)).toHaveLength(1);
    expect(html.match(/data-memo-(?:settle|replenish|charge)="true"/gu)).toHaveLength(1);
    expect(html.indexOf('data-memo-charge="true"')).toBeGreaterThan(
      html.indexOf('data-custody-tabs="true"'),
    );
  });
});

describe('«لوحة تحكم العهدة» — the third tab', () => {
  it('draws the head, then the fund’s part of the dashboard, its tab lit', () => {
    const html = mount(seeded(), <CustodyFundDashboardPage />, '/fleet/custody/dashboard');
    const headAt = html.indexOf('data-custody-fund-header="true"');
    expect(headAt).toBeGreaterThan(-1);
    expect(html.indexOf('data-custody-fund-dashboard="true"')).toBeGreaterThan(headAt);
    expect(tagOf(html, 'data-custody-tab="dashboard"')).toContain('aria-selected="true"');
    // «العهدة الآن» over the whole history: no filters on this tab, so no «ولا تتأثر بالفلاتر».
    const heading = html.slice(html.indexOf('data-custody-dashboard-heading="fund"'));
    expect(text(heading.slice(0, heading.indexOf('</h2>') + 5))).toContain(
      ar('fleet.custody.dashboard.fund.scopeSince'),
    );
    expect(ar('fleet.custody.dashboard.fund.scopeSince')).toBe('من بداية العهدة');
    // No spend line, no filter bar: those are «لوحة تحكم المصروفات»'s.
    expect(html).not.toContain('data-custody-alert="audit"');
    expect(html).not.toContain('data-custody-dashboard-section="kpis"');
  });
});

/** The board «مصروفات العهدة» over no filter, «كل الحركات» the `rows` given. */
const FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  source: undefined,
  driver: undefined,
};
const SUMMARY: FleetCustodySummaryDto = {
  count: 3,
  total: 450,
  maintenance: 0,
  fuel: 450,
  tyres: 0,
  wash: 0,
  vehicles: [],
  fundTotal: 1000,
  fundCharged: 1450,
  fundSpent: 450,
};
const movement = (over: Partial<FleetCustodyMovementDto>): FleetCustodyMovementDto => ({
  id: 'm',
  ref: 'receipt',
  source: 'fuel',
  date: '2026-10-05T08:00:00.000Z',
  vehicleId: 'v-150',
  vehicleCode: '150',
  driverEmployeeId: 'e-1',
  driverName: 'إبراهيم جميل رمضان داود',
  fuelType: 'petrol92',
  company: 'chillout',
  detail: null,
  amount: 150,
  memo: null,
  ...over,
});
const ROWS: FleetCustodyMovementDto[] = [
  movement({ id: 'r1' }),
  movement({ id: 'r2', memo: { id: 'memo-5', no: 5, replenishedAt: null, held: false } }),
  movement({ id: 'r3', memo: { id: 'memo-7', no: 7, replenishedAt: '2026-09-29', held: false } }),
];
const board = (permissions: readonly string[]): string => {
  const qc = client();
  qc.setQueryData(listKey('fleet', 'custody', { summary: true, ...FILTERS }), SUMMARY);
  qc.setQueryData(
    listKey('fleet', 'custody', {
      ...FILTERS,
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
    }),
    { items: ROWS, meta: { page: 1, pageSize: 25, totalItems: ROWS.length, totalPages: 1 } },
  );
  return mount(qc, <CustodyPage />, '/fleet/custody-expenses', permissions);
};
/** A memo's chip under «من», by its number. */
const chipOf = (html: string, no: number): string => {
  const at = html.indexOf(`data-custody-memo-link="${no}"`);
  expect(at, `memo ${no}`).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</span></span>', at));
};

describe('SCREEN 2 «مصروفات العهدة» — the memo a receipt is a line of, under «من»', () => {
  it('links the memo for whoever may open it — «مذكرة رقم N», under the row’s «من»', () => {
    const html = board(WRITER);
    expect([...html.matchAll(/data-custody-memo-link="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '5',
      '7',
    ]);
    const pending = chipOf(html, 5);
    // «من» first, the chip under it.
    expect(pending.indexOf('data-custody-from="receipt"')).toBeLessThan(
      pending.indexOf('data-receipt-memo="5"'),
    );
    expect(tagOf(pending, 'data-receipt-memo="5"')).toMatch(/^<a [^>]*href="\/fleet\/custody\/memos\/memo-5"/u);
    expect(tagOf(pending, 'data-receipt-memo="5"')).toContain('data-receipt-memo-state="pending"');
    expect(text(pending)).toContain(ar('fleet.receipts.memo.chip', { no: 5 }));
    expect(tagOf(chipOf(html, 7), 'data-receipt-memo="7"')).toContain(
      'data-receipt-memo-state="replenished"',
    );
  });

  it('writes a plain chip for a reader who may not open the memo — and nothing for a receipt in none', () => {
    const html = board(VIEW);
    const chip = tagOf(chipOf(html, 5), 'data-receipt-memo="5"');
    expect(chip).toMatch(/^<span /u);
    expect(chip).not.toContain('href=');
    // Three receipts, two memo chips: the first is in no memo.
    expect(html.match(/data-custody-from="receipt"/gu)).toHaveLength(3);
    expect(html.match(/data-receipt-memo="/gu)).toHaveLength(2);
  });

  it('titles its Excel and PDF «مصروفات العهدة» — the export columns as they were', () => {
    const page = read('CustodyPage.tsx');
    expect(page).toContain("name: t('fleet.nav.custodyExpenses'),");
    expect(page).toContain("title: t('fleet.nav.custodyExpenses'),");
    expect(page).not.toContain("t('fleet.nav.custody')");
    expect(ar('fleet.nav.custodyExpenses')).toBe('مصروفات العهدة');
  });
});

describe('the menu row «مصروفات العهدة»', () => {
  const NAV = readFileSync(join(HERE, '../../../../../api/src/seed-navigation.ts'), 'utf8');
  /** The menu row whose route is exactly `route`. */
  const rowOf = (route: string): { at: number; row: string } => {
    const at = NAV.indexOf(`route: '${route}',`);
    expect(at, route).toBeGreaterThan(-1);
    return { at, row: NAV.slice(NAV.lastIndexOf('{', at), NAV.indexOf('}', at) + 1) };
  };

  it('stands directly after «العهدة», behind the custody grant, with a price tag', () => {
    const custody = rowOf('/fleet/custody');
    const expenses = rowOf('/fleet/custody-expenses');
    expect(expenses.row).toContain("ar: 'مصروفات العهدة'");
    expect(expenses.row).toContain("permission: 'fleetCustody.view'");
    expect(expenses.row).toContain("icon: 'tag'");
    // The next row after «العهدة» is this one.
    const between = NAV.slice(custody.at, expenses.at);
    expect(between.match(/route: '/gu)).toHaveLength(1);
    const SENTINEL = (() => null) as unknown as ReturnType<typeof resolveNavIcon>;
    expect(resolveNavIcon('tag', SENTINEL)).not.toBe(SENTINEL);
    // «العهدة» keeps its own name, icon and grant.
    expect(custody.row).toContain("ar: 'العهدة'");
    expect(custody.row).toContain("permission: 'fleetCustody.view'");
  });
});
