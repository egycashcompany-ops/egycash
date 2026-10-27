// «مكان اشوف فيه المذكرات» / «فين الهيستورى بتاع كل حاجه من دول» / «خلاص افصلهم»: three tabs on
// SCREEN 1 «العهدة» — «سجل العهدة», «المذكرات», «لوحة تحكم العهدة» — each its own address, the
// active one in the site's purple, the operations' and the memos' counts beside theirs once the
// fund's summary has said them. The board «مصروفات العهدة» (SCREEN 2) has none. Rendered to markup
// against a seeded cache, as every Fleet screen spec.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetCustodyFundSummaryDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { custodyFundKey } from '../api/fleet-queries';
import { CustodyTabs, custodyTabOf } from '../components/CustodyTabs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const ar = (key: string): string => translate('ar', key);

const me = (): MeDto =>
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
    permissions: { 'fleetCustody.view': 'organization' },
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

/** The fund as the server answers: 6 memos saved, 3 operations made. */
const fund: FleetCustodyFundSummaryDto = {
  fundTotal: 175_260.54,
  charged: { count: 2, amount: 300_000 },
  spent: { count: 152, amount: 97_794 },
  replenished: { count: 1, amount: 81_908, memos: 5 },
  settled: { count: 1, amount: 124_139.46, parts: 3 },
  held: { count: 0, amount: 0, memos: 0, receipts: 0 },
  cancelled: { count: 0, amount: 0 },
  operations: 4,
  memos: { count: 6, pending: 1, pendingTotal: 600 },
  outside: [
    {
      kind: 'maintenance',
      count: 3,
      total: 5720,
      oldest: '2026-10-06',
      stale: { count: 0, total: 0 },
    },
    { kind: 'fuel', count: 12, total: 7876, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
    { kind: 'tyres', count: 2, total: 1690, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
    { kind: 'wash', count: 0, total: 0, oldest: null, stale: { count: 0, total: 0 } },
  ],
};

const draw = (path: string, summary?: FleetCustodyFundSummaryDto): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (summary !== undefined) qc.setQueryData(custodyFundKey, summary);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <CustodyTabs />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** Each tab's opening tag, by its `data-custody-tab`. */
const tabs = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<a [^>]*data-custody-tab="(\w+)"[^>]*>/gu)].map((m) => [m[1], m[0]]),
  );
const text = (part: string): string =>
  part
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

describe('«سجل العهدة · المذكرات · لوحة تحكم العهدة»', () => {
  it('links the three addresses, in that order, inside one tab list', () => {
    const html = draw('/fleet/custody/log', fund);
    expect(html).toContain('data-custody-tabs="true"');
    expect(html).toMatch(/<nav role="tablist" aria-label="[^"]+"/u);
    const found = tabs(html);
    expect(Object.keys(found)).toEqual(['log', 'memos', 'dashboard']);
    expect(found.log).toContain('href="/fleet/custody/log"');
    expect(found.memos).toContain('href="/fleet/custody/memos"');
    expect(found.dashboard).toContain('href="/fleet/custody/dashboard"');
    for (const tag of Object.values(found)) expect(tag).toContain('role="tab"');
    // No tab leads to the board any more: it is a menu row of its own.
    expect(html).not.toContain('href="/fleet/custody"');
    expect(html).not.toContain('href="/fleet/custody-expenses"');
    const words = [...html.matchAll(/data-custody-tab="\w+"[^>]*>([\s\S]*?)<\/a>/gu)].map((m) =>
      text((m[1] ?? '').replace(/<span data-custody-tab-count[\s\S]*?<\/span>/u, '')),
    );
    expect(words).toEqual([
      ar('fleet.custody.tabs.ledger'),
      ar('fleet.custody.tabs.memos'),
      ar('fleet.custody.dashboard.title'),
    ]);
    expect(words[2]).toBe('لوحة تحكم العهدة');
  });

  it.each([
    ['/fleet/custody/dashboard', 'dashboard'],
    ['/fleet/custody/dashboard/', 'dashboard'],
    ['/fleet/custody/memos', 'memos'],
    ['/fleet/custody/memos/new/tyres', 'memos'],
    ['/fleet/custody/memos/setup/fuel', 'memos'],
    ['/fleet/custody/log', 'log'],
    ['/fleet/custody/log?open=650000000000000000000001', 'log'],
  ])('at %s the %s tab is the one in purple', (path, active) => {
    const found = tabs(draw(path, fund));
    for (const [key, tag] of Object.entries(found)) {
      const on = key === active;
      expect(tag.includes('bg-brand-600'), `${path} ${key}`).toBe(on);
      expect(tag, `${path} ${key}`).toContain(`aria-selected="${on}"`);
    }
    // One tab at a time: a memo's page does not light the log too.
    expect(Object.values(found).filter((tag) => tag.includes('bg-brand-600'))).toHaveLength(1);
  });

  it('lights no tab off its three pages — the board «مصروفات العهدة» has none', () => {
    for (const path of ['/fleet/custody', '/fleet/custody-expenses']) {
      const found = tabs(draw(path, fund));
      expect(Object.values(found).filter((tag) => tag.includes('bg-brand-600')), path).toEqual([]);
    }
  });

  it('counts the memos and the operations from the fund’s summary', () => {
    const html = draw('/fleet/custody/log', fund);
    const count = (key: string): string | undefined =>
      new RegExp(`data-custody-tab-count="${key}"[^>]*>([^<]*)<`, 'u').exec(html)?.[1];
    expect(count('memos')).toBe('6');
    expect(count('log')).toBe('4');
    expect(html).not.toContain('data-custody-tab-count="dashboard"');
    // Latin digits, grouped, as every figure.
    const many = draw('/fleet/custody/log', { ...fund, operations: 1234 });
    expect(many).toMatch(/data-custody-tab-count="log"[^>]*>1,234</u);
  });

  it('says no count while the summary is on its way — never a «0» that is not true', () => {
    const html = draw('/fleet/custody/memos');
    expect(html).not.toContain('data-custody-tab-count');
    expect(Object.keys(tabs(html))).toEqual(['log', 'memos', 'dashboard']);
  });

  it('reads which tab an address is on', () => {
    expect(custodyTabOf('/fleet/custody/log')).toBe('log');
    expect(custodyTabOf('/fleet/custody/log/')).toBe('log');
    expect(custodyTabOf('/fleet/custody/memos')).toBe('memos');
    expect(custodyTabOf('/fleet/custody/memos/650000000000000000000001')).toBe('memos');
    expect(custodyTabOf('/fleet/custody/dashboard')).toBe('dashboard');
    expect(custodyTabOf('/fleet/custody')).toBeNull();
    expect(custodyTabOf('/fleet/custody/')).toBeNull();
    expect(custodyTabOf('/fleet/custody-expenses')).toBeNull();
    expect(custodyTabOf('/fleet/custody/memosx')).toBeNull();
    expect(custodyTabOf('/fleet/receipts')).toBeNull();
  });

  it('opens each of the three pages — the log, the memos, the fund dashboard — under the fund’s head', () => {
    for (const page of [
      'CustodyLedgerPage.tsx',
      'CustodyMemosPage.tsx',
      'CustodyFundDashboardPage.tsx',
    ]) {
      const source = read(page);
      expect(source, page).toContain(
        "import { CustodyFundHeader } from '../components/CustodyFundHeader';",
      );
      expect(source.match(/<CustodyFundHeader \/>/gu), page).toHaveLength(1);
      // The head draws the tabs; no page draws them a second time.
      expect(source, page).not.toContain('<CustodyTabs />');
    }
    // First in the page, over its board.
    for (const page of ['CustodyLedgerPage.tsx', 'CustodyMemosPage.tsx']) {
      const source = read(page);
      expect(source.indexOf('<CustodyFundHeader />'), page).toBeLessThan(
        source.indexOf('BOARD_FRAME}'),
      );
    }
    expect(read('../components/CustodyFundHeader.tsx').match(/<CustodyTabs \/>/gu)).toHaveLength(1);
    // The board «مصروفات العهدة» draws neither the head nor the tabs.
    const board = read('CustodyPage.tsx');
    expect(board).not.toContain('CustodyTabs');
    expect(board).not.toContain('CustodyFundHeader');
  });

  it('routes every custody address behind the custody grant — writes behind the receipts’ too', () => {
    const routes = read('../routes.tsx');
    /** The element routed at `path`: its gates, outermost first, and the page inside them. */
    const routed = (path: string): { gates: string[]; page: string } => {
      const at = routes.indexOf(`path="${path}"`);
      expect(at, path).toBeGreaterThan(-1);
      const element = routes.slice(at, routes.indexOf('/>\n', routes.indexOf('<Custody', at)));
      return {
        gates: [...element.matchAll(/<RequirePermission permission="([^"]+)">/gu)].map(
          (m) => m[1] ?? '',
        ),
        page: /<(Custody\w*(?:Page|Entry)) $/u.exec(element)?.[1] ?? '',
      };
    };
    const VIEW = 'fleetCustody.view';
    // «العهدة» redirects (to «سجل العهدة», or an old board link to «مصروفات العهدة»).
    expect(routed('custody')).toEqual({ gates: [VIEW], page: 'CustodyEntry' });
    expect(routed('custody/dashboard')).toEqual({
      gates: [VIEW],
      page: 'CustodyFundDashboardPage',
    });
    expect(routed('custody-expenses')).toEqual({ gates: [VIEW], page: 'CustodyPage' });
    expect(routed('custody/memos')).toEqual({ gates: [VIEW], page: 'CustodyMemosPage' });
    for (const path of ['custody/memos/new', 'custody/memos/new/:kind']) {
      expect(routed(path), path).toEqual({
        gates: [VIEW, 'fleetReceipt.create'],
        page: 'CustodyMemoEditorPage',
      });
    }
    expect(routed('custody/memos/:id')).toEqual({
      gates: [VIEW, 'fleetReceipt.edit'],
      page: 'CustodyMemoEditorPage',
    });
    expect(routed('custody/memos/setup/:paper?')).toEqual({
      gates: [VIEW, 'fleetReceipt.edit'],
      page: 'CustodyPapersSetupPage',
    });
    expect(routed('custody/log')).toEqual({ gates: [VIEW], page: 'CustodyLedgerPage' });
    // Each page imported from its own file.
    for (const page of [
      'CustodyPage',
      'CustodyMemosPage',
      'CustodyMemoEditorPage',
      'CustodyPapersSetupPage',
      'CustodyLedgerPage',
      'CustodyFundDashboardPage',
    ]) {
      expect(routes, page).toContain(`import { ${page} } from './pages/${page}';`);
    }
    expect(routes).toContain("import { CustodyEntry } from './components/CustodyEntry';");
  });

  it('keeps its purple in its own file — `CustodyPage.tsx` stays free of it', () => {
    const purple = /\b(?:[a-z]+:)?(?:bg|text|border|ring)-(?:brand|purple|violet|indigo)-/u;
    expect(read('../components/CustodyTabs.tsx')).toMatch(purple);
    const page = read('CustodyPage.tsx').replace(/const PRESS_BUTTON =\s*'[^']*';/u, '');
    expect(page).not.toMatch(purple);
  });
});
