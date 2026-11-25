// Round 34 B — «البيانات المرجعية» in the boards' look, and the search on the big lists. The owner:
// «وعاوز أغير اللي اوت بتاع بيانات المراجعة يكون بروفيشنال أكتر من كده، وعاوز الداتا اللي تبقى كبيرة
// زي الفروع والمناطق والبنوك وهكذا يكون في سيرش اقدر اسيرش بيه».
//
// Rendered against the real Arabic catalog, a real store and query client, as the currencies' and
// the types' tabs are: the cache is seeded under the EXACT key the screen must ask for, so a row on
// screen proves the screen asked the server that question (the search folded, the status, the
// bank). The rules themselves — the address bar, the fold, the arrows, the clock — are pinned in
// lib/catalog-filters.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  type Locale,
  type MeDto,
  type OperationsAreaDto,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { SHIFT_TYPE_LIST } from '../lib/crew-plan';
import {
  BANK_OPTIONS,
  COUNT_READ,
  CURRENCY_TAB_PARAMS,
  CatalogsPage,
  OPERATIONS_CATALOG_KINDS,
} from './CatalogsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const MANAGE = ['operationsCatalog.manage'];
const T = '2026-01-01T00:00:00.000Z';

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

const bank = (id: string, code: number, opsName: string, isActive = true): OperationsBankDto => ({
  id,
  code,
  opsName,
  name: { ar: opsName, en: `${opsName} EN` },
  slogan: null,
  sortOrder: null,
  isActive,
  version: 1,
  createdAt: T,
  updatedAt: T,
});
// Ids as the server's are — 24 hex digits — since the screen reads a `?bank=` that is no id as no
// filter (Round 34 critic: the server refuses it, and the whole list failed).
const NBE = '64b0c0ffee00000000000010';
const MISR = '64b0c0ffee00000000000020';
const CIB = '64b0c0ffee00000000000030';
const BANKS = [bank(NBE, 10, 'الأهلي'), bank(MISR, 20, 'بنك مصر'), bank(CIB, 30, 'CIB')];

const branch = (
  id: string,
  code: string,
  name: string,
  opsAreaName: string | null,
  isActive = true,
): OperationsBankBranchDto =>
  ({
    id,
    bankId: NBE,
    code,
    name,
    opsAreaName,
    financeAreaName: opsAreaName,
    address: null,
    location: id === 'br-1' ? { type: 'Point', coordinates: [31.25, 29.96] } : null,
    isActive,
    version: 1,
    createdAt: T,
    updatedAt: T,
  }) as unknown as OperationsBankBranchDto;
const MAADI = [
  branch('br-1', '104', 'المعادي', 'المعادي'),
  branch('br-2', '212', 'المعادي - شارع 9', 'المعادي'),
  branch('br-3', '220', 'دجلة المعادي', 'المعادي', false),
];

const area = (id: string, name: string): OperationsAreaDto => ({
  id,
  name,
  nameEn: null,
  governorate: 'القاهرة',
  isActive: true,
  version: 1,
  createdAt: T,
  updatedAt: T,
});
const currency = (id: string, code: string): OperationsCurrencyDto => ({
  id,
  code,
  name: code,
  legacyAliases: [],
  sortOrder: null,
  isActive: true,
  version: 1,
  createdAt: T,
  updatedAt: T,
});
const shiftType = (id: string, name: string): OperationsShiftTypeDto => ({
  id,
  name,
  nameEn: null,
  colour: 'rose',
  sortOrder: null,
  isActive: true,
  version: 1,
  createdAt: T,
  updatedAt: T,
});

const page = <T,>(items: T[], totalItems = items.length, pageSize = 25) => ({
  items,
  meta: {
    page: 1,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  },
});

type Seed = readonly [feature: string, params: Record<string, unknown>, data: unknown];
/** A read that failed — the query in the cache holds an error and no data. */
type Failure = readonly [feature: string, params: Record<string, unknown>];

/** The cards' counts as the server answers them — 10 banks, 1,340 branches, 120 areas, 8, 9. */
const COUNTS: Seed[] = [
  ['banks', BANK_OPTIONS, page(BANKS, 10, MAX_PAGE_SIZE)],
  ['bankBranches', COUNT_READ, page([MAADI[0]], 1340, 1)],
  ['areas', COUNT_READ, page([area('a-1', 'المعادي')], 120, 1)],
  [
    'currencies',
    CURRENCY_TAB_PARAMS,
    page(
      ['EGP', 'USD', 'EUR', 'SAR', 'GBP', 'AED', 'KWD', 'CHF'].map((c) => currency(c, c)),
      8,
      MAX_PAGE_SIZE,
    ),
  ],
  [
    'shiftTypes',
    SHIFT_TYPE_LIST,
    page(
      ['يومي', 'احتياطي', 'سفر', 'أسوان', 'إيباج', 'شلاتين', 'محصنة', 'مسائي', 'احتياطي سفر'].map(
        (name, i) => shiftType(`t-${i}`, name),
      ),
      9,
      MAX_PAGE_SIZE,
    ),
  ],
];

const render = (
  url: string,
  {
    permissions = MANAGE,
    seeds = [],
    failures = [],
    counts = true,
    locale = 'ar' as Locale,
  } = {} as {
    permissions?: string[];
    seeds?: Seed[];
    failures?: Failure[];
    counts?: boolean;
    locale?: Locale;
  },
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    // `retryOnMount: false` — a failed read is drawn as failed, not as asked again (which no
    // render here could finish).
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, retryOnMount: false },
    },
  });
  for (const [feature, params, data] of [...(counts ? COUNTS : []), ...seeds]) {
    qc.setQueryData(listKey('operations', feature, params), data);
  }
  for (const [feature, params] of failures) {
    qc.getQueryCache()
      .build(qc, { queryKey: listKey('operations', feature, params) })
      .setState({
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('Invalid bankId'),
        errorUpdatedAt: 1,
      });
  }
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/operations/catalogs" element={<CatalogsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The opening tag carrying `attr`. */
const tagWith = (html: string, attr: string): string => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('the kinds as a row of cards — still a real tab list', () => {
  const html = render('/operations/catalogs?kind=branches');

  it('is a tablist of the five kinds, in the screen’s order', () => {
    expect(tagWith(html, 'data-catalog-kinds="true"')).toContain('role="tablist"');
    expect(tagWith(html, 'data-catalog-kinds="true"')).toContain(
      `aria-label="${ar('operations.catalogs.kinds')}"`,
    );
    const kinds = [...html.matchAll(/data-catalog-kind="(\w+)"/g)].map((m) => m[1]);
    expect(kinds).toEqual([...OPERATIONS_CATALOG_KINDS]);
    for (const kind of OPERATIONS_CATALOG_KINDS) {
      expect(html).toContain(`>${ar(`operations.catalogs.tab.${kind}`)}<`);
    }
  });

  it('marks the kind in the address bar chosen — the one tab in the Tab order', () => {
    for (const kind of OPERATIONS_CATALOG_KINDS) {
      const tab = tagWith(html, `data-catalog-kind="${kind}"`);
      expect(tab).toContain('role="tab"');
      expect(tab).toContain(`id="catalog-tab-${kind}"`);
      expect(tab).toContain('aria-controls="catalog-panel"');
      expect(tab).toContain(`aria-selected="${kind === 'branches'}"`);
      expect(tab).toContain(`tabindex="${kind === 'branches' ? '0' : '-1'}"`);
    }
    const panel = tagWith(html, 'data-catalog-panel="branches"');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain('aria-labelledby="catalog-tab-branches"');
  });

  it('counts each kind’s rows in the boards’ figures — Latin digits, isolated left to right', () => {
    const count = (kind: string): string | undefined =>
      new RegExp(`<bdi dir="ltr" data-catalog-count="${kind}">([^<]*)</bdi>`).exec(html)?.[1];
    expect(count('banks')).toBe('10');
    expect(count('branches')).toBe('1,340');
    expect(count('currencies')).toBe('8');
    expect(count('areas')).toBe('120');
    expect(count('shiftTypes')).toBe('9');
  });

  it('says «—» for a count still on its way, never a 0', () => {
    const cold = render('/operations/catalogs?kind=banks', { counts: false });
    for (const kind of OPERATIONS_CATALOG_KINDS) {
      expect(cold).toContain(`data-catalog-count="${kind}">—</bdi>`);
    }
  });

  it('an unknown kind in the address bar opens the banks, chosen', () => {
    const odd = render('/operations/catalogs?kind=cities');
    expect(tagWith(odd, 'data-catalog-kind="banks"')).toContain('aria-selected="true"');
  });

  // Round 34 verifier — measured on the built web at 768 and 820: the five cards share the row from
  // `md` at 134–145px each, and with the icon BESIDE the name «أنواع التشغيل» had 56px and was cut
  // («أنواع التـ…»). From `md` to `lg` the icon sits ABOVE the name (the name has the card's whole
  // width, 110px at 768); from `lg` (171px at 1024) it is beside it again; on a phone the row
  // scrolls and each card keeps its own 176px, the icon beside.
  it('from md to lg the icon sits above the name, so «أنواع التشغيل» is not cut on a tablet', () => {
    for (const kind of OPERATIONS_CATALOG_KINDS) {
      const card = tagWith(html, `data-catalog-kind="${kind}"`);
      const classes = (/class="([^"]*)"/.exec(card)?.[1] ?? '').split(' ');
      // A phone: one row, scrolling, the card its own width with the icon beside the name.
      expect(classes).toEqual(expect.arrayContaining(['flex', 'w-44', 'items-center']));
      // A tablet: the five share the row — the icon above the name.
      expect(classes).toEqual(
        expect.arrayContaining(['md:w-auto', 'md:flex-col', 'md:items-start']),
      );
      // A computer: beside it again.
      expect(classes).toEqual(expect.arrayContaining(['lg:flex-row', 'lg:items-center']));
    }
  });
});

describe('the branches’ search and filters reach the server’s query', () => {
  const ASKED = { page: 1, pageSize: 25, search: 'المعادي', isActive: true, bankId: NBE };
  const html = render(`/operations/catalogs?kind=branches&q=المعادي&status=active&bank=${NBE}`, {
    seeds: [['bankBranches', ASKED, page(MAADI)]],
  });

  it('lists the rows the server answered for the search, the status and the bank', () => {
    expect(html.match(/data-branch-actions="true"/g)).toHaveLength(MAADI.length);
    expect(html).toContain('دجلة');
    expect(html).toContain('شارع 9');
  });

  it('the box holds the search from the address bar, worded for the kind', () => {
    const box = tagWith(html, 'data-catalog-search="true"');
    expect(box).toContain('type="search"');
    expect(box).toContain('value="المعادي"');
    expect(box).toContain(`placeholder="${ar('operations.catalogs.search.branches')}"`);
    expect(html).toContain('data-catalog-search-clear="true"');
  });

  it('the bank and the status say what they hold', () => {
    const bankBox = html.slice(html.indexOf('data-catalog-bank-filter'));
    expect(bankBox.slice(0, 2000)).toContain('الأهلي');
    const statusBox = html.slice(html.indexOf('data-catalog-status-filter'));
    expect(statusBox.slice(0, 2000)).toContain(ar('operations.common.active'));
  });

  it('counts the answer — «3 نتائج», the figure in Latin digits — and offers the reset', () => {
    expect(tagWith(html, 'data-catalog-results=')).toContain('data-catalog-results="3"');
    expect(html).toMatch(/<bdi dir="ltr" class="[^"]*Azeret_Mono[^"]*">3<\/bdi> نتائج/);
    expect(html).toContain(`aria-label="${ar('common.filters.clear')}"`);
  });

  it('marks what the search found in the rows', () => {
    expect(html).toContain('<mark data-catalog-match="true"');
    expect(html).toMatch(/<mark data-catalog-match="true"[^>]*>المعادي<\/mark>/);
  });

  it('writes the codes in the boards’ figures and the status as the boards’ badge', () => {
    expect(html).toMatch(/<bdi dir="ltr" class="[^"]*Azeret_Mono[^"]*"><span>104<\/span><\/bdi>/);
    expect(html).toContain('data-catalog-status="active"');
    expect(html).toContain('data-catalog-status="inactive"');
    expect(html).toContain('data-branch-maps="br-1"');
  });

  it('digits typed on an Arabic keyboard are asked as Latin ones; the box keeps what was typed', () => {
    const typed = render('/operations/catalogs?kind=branches&q=١٠٤', {
      seeds: [['bankBranches', { page: 1, pageSize: 25, search: '104' }, page([MAADI[0]])]],
    });
    expect(tagWith(typed, 'data-catalog-search="true"')).toContain('value="١٠٤"');
    expect(typed).toContain('data-catalog-results="1"');
    expect(typed).toMatch(/<mark data-catalog-match="true"[^>]*>104<\/mark>/);
  });

  it('a page of the plain list asks exactly what the screen always asked — `{ page, pageSize }`', () => {
    const plain = render('/operations/catalogs?kind=branches', {
      seeds: [['bankBranches', { page: 1, pageSize: 25 }, page(MAADI, 60)]],
    });
    expect(plain).toContain('data-catalog-results="60"');
    // No narrowing, no reset.
    expect(plain).not.toContain(`aria-label="${ar('common.filters.clear')}"`);
    expect(plain).not.toContain('data-catalog-match');
  });
});

// Round 34 critic — a link is read, not trusted; and a read that failed says so everywhere.
describe('a link from elsewhere, and a read that failed', () => {
  const PLAIN = { page: 1, pageSize: 25 };

  it('a `?bank=` that is no id is no filter — the list is asked without it, never refused', () => {
    // The server refuses `bankId=not-an-id` (contracts `objectId()`): sent, the whole list failed.
    const html = render('/operations/catalogs?kind=branches&bank=not-an-id', {
      seeds: [['bankBranches', PLAIN, page(MAADI)]],
    });
    expect(html.match(/data-branch-actions="true"/g)).toHaveLength(MAADI.length);
    expect(tagWith(html, 'data-catalog-results=')).toContain('data-catalog-results="3"');
    // Nothing narrows, so no reset — and the bank box names no raw id.
    expect(html).not.toContain(`aria-label="${ar('common.filters.clear')}"`);
    const bankBox = html.slice(html.indexOf('data-catalog-bank-filter')).slice(0, 2000);
    expect(bankBox).toContain(ar('operations.catalogs.filter.allBanks'));
    expect(bankBox).not.toContain('not-an-id');
  });

  it('an id that names no bank on the list is no filter once the list is in', () => {
    const html = render('/operations/catalogs?kind=branches&bank=64b0c0ffee00000000000099', {
      seeds: [['bankBranches', PLAIN, page(MAADI)]],
    });
    expect(html.match(/data-branch-actions="true"/g)).toHaveLength(MAADI.length);
    expect(html.slice(html.indexOf('data-catalog-bank-filter')).slice(0, 2000)).not.toContain(
      '64b0c0ffee00000000000099',
    );
  });

  it('a failed read: the table says it failed, the count says «—» (named so) — never «جارٍ التحميل…» — and no pager', () => {
    const html = render('/operations/catalogs?kind=branches', {
      failures: [['bankBranches', PLAIN]],
    });
    // The table's own error, with the way to ask again.
    const frame = html.slice(html.indexOf('data-catalog-frame="branches"'));
    expect(frame).toContain(ar('common.error.title'));
    expect(frame).toContain(ar('common.retry'));
    // The toolbar's count beside it.
    const count = html.slice(html.indexOf('data-catalog-results='));
    const status = count.slice(0, count.indexOf('</span></span>') + 14);
    expect(tagWith(html, 'data-catalog-results=')).toContain('data-catalog-results-failed="true"');
    expect(status).toContain(`aria-label="${ar('common.error.title')}"`);
    expect(status).toContain('>—<');
    expect(status).not.toContain(ar('common.loading'));
    expect(html).not.toContain('data-catalog-refreshing');
    expect(html).not.toContain('data-catalog-pager');
  });

  it('while the first answer is on its way the count says so — and only then', () => {
    const html = render('/operations/catalogs?kind=branches');
    const count = html.slice(html.indexOf('data-catalog-results='));
    expect(count.slice(0, 400)).toContain(ar('common.loading'));
    expect(html).not.toContain('data-catalog-results-failed');
  });
});

describe('an answer with nothing in it', () => {
  it('a search that found nothing says what was searched for, and offers to clear it', () => {
    const html = render('/operations/catalogs?kind=branches&q=الواحات', {
      seeds: [['bankBranches', { page: 1, pageSize: 25, search: 'الواحات' }, page([])]],
    });
    expect(tagWith(html, 'data-catalog-empty=')).toContain('data-catalog-empty="search"');
    expect(html).toContain(ar('operations.catalogs.empty.search', { term: 'الواحات' }));
    expect(html).toContain('data-catalog-empty-clear="search"');
    expect(html).toContain(ar('operations.catalogs.empty.clearSearch'));
    // Nothing else narrows it, so there is no «مسح كل المرشحات».
    expect(html).not.toContain('data-catalog-empty-clear="all"');
    expect(html).toContain('data-catalog-results="0"');
    expect(html).not.toContain('data-catalog-pager');
  });

  it('with a filter too, both ways back are offered', () => {
    const html = render('/operations/catalogs?kind=areas&q=الواحات&status=inactive', {
      seeds: [['areas', { page: 1, pageSize: 25, search: 'الواحات', isActive: false }, page([])]],
    });
    expect(html).toContain('data-catalog-empty-clear="search"');
    expect(html).toContain('data-catalog-empty-clear="all"');
  });

  it('a filter alone says nothing matches the filters', () => {
    const html = render('/operations/catalogs?kind=banks&status=inactive', {
      seeds: [['banks', { page: 1, pageSize: 25, isActive: false }, page([])]],
    });
    expect(tagWith(html, 'data-catalog-empty=')).toContain('data-catalog-empty="filters"');
    expect(html).toContain(ar('operations.catalogs.empty.filters'));
    expect(html).toContain('data-catalog-empty-clear="all"');
  });

  it('a list that is empty for real says so, with no search to clear', () => {
    const html = render('/operations/catalogs?kind=branches', {
      seeds: [['bankBranches', { page: 1, pageSize: 25 }, page([])]],
    });
    expect(html).toContain(ar('operations.catalogs.branch.empty'));
    expect(html).not.toContain('data-catalog-empty=');
  });
});

describe('the toolbar on each kind', () => {
  it('banks and areas: the search and the status, no bank filter', () => {
    for (const kind of ['banks', 'areas'] as const) {
      const html = render(`/operations/catalogs?kind=${kind}`);
      expect(html).toContain(`data-catalog-toolbar="${kind}"`);
      expect(tagWith(html, 'data-catalog-search="true"')).toContain(
        `placeholder="${ar(`operations.catalogs.search.${kind}`)}"`,
      );
      expect(html).toContain('data-catalog-status-filter="true"');
      expect(html).not.toContain('data-catalog-bank-filter');
    }
  });

  it('branches: the bank filter too', () => {
    expect(render('/operations/catalogs?kind=branches')).toContain(
      'data-catalog-bank-filter="true"',
    );
  });

  it('currencies and «أنواع التشغيل» keep their drag and take NO search', () => {
    for (const kind of ['currencies', 'shiftTypes'] as const) {
      const html = render(`/operations/catalogs?kind=${kind}`);
      expect(html).not.toContain('data-catalog-search');
      expect(html).not.toContain('data-catalog-toolbar');
      expect(html).not.toContain('data-catalog-status-filter');
      // The whole list, the grip on every row, the rows draggable, the note on the toolbar's line.
      expect(html).toContain(`data-catalog-order-bar="${kind}"`);
      expect(html).toContain('data-drag-handle=');
      expect(html).toContain('draggable="true"');
      expect(html).not.toContain('data-catalog-pager');
    }
  });
});

describe('the frame and its pager', () => {
  const html = render('/operations/catalogs?kind=branches', {
    seeds: [['bankBranches', { page: 1, pageSize: 25 }, page(MAADI, 60)]],
  });

  it('puts the numbered pager in the frame’s foot, with 25 / 50 / 100 a page', () => {
    const frame = html.indexOf('data-catalog-frame="branches"');
    const pager = html.indexOf('data-catalog-pager="true"');
    expect(frame).toBeGreaterThan(-1);
    expect(pager).toBeGreaterThan(frame);
    const pagerHtml = html.slice(pager);
    expect(pagerHtml).toContain(ar('common.pager.perPage'));
    expect([...pagerHtml.matchAll(/<option value="(\d+)"/g)].map((m) => m[1])).toEqual([
      '25',
      '50',
      '100',
    ]);
  });

  it('keeps the head on screen while the rows scroll', () => {
    expect(html).toContain('<thead class="sticky top-0 z-10">');
  });

  it('a bigger page asks for it', () => {
    const big = render('/operations/catalogs?kind=areas&size=100', {
      seeds: [['areas', { page: 1, pageSize: 100 }, page([area('a-1', 'طنطا')], 120, 100)]],
    });
    expect(big).toContain('طنطا');
    expect(big).toMatch(/<option value="100" selected="">/);
  });
});

describe('who may change the catalog', () => {
  it('a manager gets the add of the kind, the import on the branches, and the pen on every row', () => {
    const branches = render('/operations/catalogs?kind=branches', {
      seeds: [['bankBranches', { page: 1, pageSize: 25 }, page(MAADI)]],
    });
    expect(branches).toContain('data-catalog-add="branches"');
    expect(branches).toContain(ar('operations.catalogs.branch.add'));
    expect(branches).toContain('data-branch-import-open="true"');
    expect(branches).toContain(`aria-label="${ar('common.edit')}"`);
    const banks = render('/operations/catalogs?kind=banks', {
      seeds: [['banks', { page: 1, pageSize: 25 }, page(BANKS)]],
    });
    expect(banks).toContain('data-catalog-add="banks"');
    expect(banks).toContain('data-bank-actions="true"');
    // The import is the branches' alone.
    expect(banks).not.toContain('data-branch-import-open');
  });

  it('without `operationsCatalog.manage` there is no add, no import, no pen and no grip — on any kind', () => {
    const seeds: Seed[] = [
      ['banks', { page: 1, pageSize: 25 }, page(BANKS)],
      ['bankBranches', { page: 1, pageSize: 25 }, page(MAADI)],
      ['areas', { page: 1, pageSize: 25 }, page([area('a-1', 'طنطا')])],
    ];
    for (const kind of OPERATIONS_CATALOG_KINDS) {
      const html = render(`/operations/catalogs?kind=${kind}`, { permissions: [], seeds });
      expect(html, kind).not.toContain('data-catalog-add');
      expect(html, kind).not.toContain('data-branch-import-open');
      expect(html, kind).not.toContain(`aria-label="${ar('common.edit')}"`);
      expect(html, kind).not.toContain('data-drag-handle');
      // The rows are still there to read.
      expect(html, kind).toContain('<tbody>');
    }
  });
});

describe('the words, in both languages', () => {
  const KEYS = [
    'operations.catalogs.kinds',
    'operations.catalogs.search.banks',
    'operations.catalogs.search.branches',
    'operations.catalogs.search.areas',
    'operations.catalogs.filter.status',
    'operations.catalogs.filter.statusAll',
    'operations.catalogs.filter.bank',
    'operations.catalogs.filter.allBanks',
    ...['one', 'two', 'few', 'many', 'other'].map((form) => `operations.catalogs.results.${form}`),
    'operations.catalogs.empty.search',
    'operations.catalogs.empty.filters',
    'operations.catalogs.empty.searchHint',
    'operations.catalogs.empty.clearSearch',
    'operations.catalogs.empty.clearFilters',
  ];

  it('every new word exists in Arabic and in English', () => {
    for (const locale of ['ar', 'en'] as const) {
      for (const key of KEYS) expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
    }
  });

  it('the English screen shows no raw key', () => {
    for (const kind of OPERATIONS_CATALOG_KINDS) {
      const html = render(`/operations/catalogs?kind=${kind}&q=x&status=active`, { locale: 'en' });
      expect(html, kind).not.toMatch(/operations\.catalogs\./);
    }
  });
});
