// «عايز فى شاشة الأصول /it/assets تزودلى بعد الحالة لو متسلم اسم الشخص اللى متسلمله الحاجة» — the
// asset register, proven against what it renders: the holder's column sits right after the status,
// names the person with a link to what they hold and their code under it, and is a dash for an
// asset in stock.
//
// «عايز فلتر الأسم يبقي بعد الفئات (فى الفلتر فقط) والبيانات اللى فى فلتر الفئات هي نفسها تتفلتر بناء
// على الفئات وعايز الأتنين دول يبقوا Multiselect» — in the bar the categories come after the
// statuses and the names right after the categories, both taking several answers; the lists in the
// URL are what the register asks for, a name holding a comma among them; the table's own columns
// keep their order.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { joinNameList, type ItAssetDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { AssetsListPage } from './AssetsListPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string): string => translate('ar', key);

const me: MeDto = {
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
  permissions: { 'itAsset.view': 'organization' },
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
} as unknown as MeDto;

const asset = (over: Partial<ItAssetDto> = {}): ItAssetDto => ({
  id: 'asset-1',
  assetCode: 'AST-00012',
  name: 'Lenovo ThinkCentre neo 50a 24',
  description: null,
  categoryId: 'c-pc',
  status: 'assigned',
  serialNumber: 'MP30EPER',
  model: null,
  manufacturer: null,
  externalTag: null,
  branchId: 'b-oct',
  location: null,
  purchase: null,
  warranty: null,
  currentAssignmentId: 'a-1',
  disposal: null,
  notes: null,
  specs: null,
  accessories: [],
  holder: {
    employeeId: 'e-1',
    employeeCode: '0100052',
    employeeName: 'محمد أحمد علي',
    assignedAt: '2026-10-07T09:00:00.000Z',
  },
  hasActiveMaintenance: false,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

const HELD = asset();
// HR has no name for this holder: the row still names them, by the id it carries.
const UNNAMED = asset({
  id: 'asset-2',
  assetCode: 'AST-00013',
  currentAssignmentId: 'a-2',
  holder: {
    employeeId: 'e-9',
    employeeCode: null,
    employeeName: null,
    assignedAt: '2026-10-08T09:00:00.000Z',
  },
});
const IN_STOCK = asset({
  id: 'asset-3',
  assetCode: 'AST-00014',
  status: 'inStock',
  currentAssignmentId: null,
  holder: null,
});

const NAME = 'Lenovo ThinkCentre neo 50a 24';
// Free text, so it may hold a comma — and must reach the filter whole.
const COMMA_NAME = 'Raml, Station';
const PRINTER = asset({
  id: 'asset-4',
  assetCode: 'AST-00015',
  name: COMMA_NAME,
  categoryId: 'c-printer',
  status: 'inStock',
  currentAssignmentId: null,
  holder: null,
});
const FIRST_PAGE = { page: 1, pageSize: 25, sortBy: 'assetCode', sortDir: 'asc' };

const category = (id: string, ar: string) => ({
  id,
  kind: 'assetCategory' as const,
  code: null,
  name: { ar, en: ar },
  description: null,
  sortOrder: 0,
  isActive: true,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
});

const render = (path = '/it/assets'): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const page = (items: ItAssetDto[]) => ({
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
  });
  // The register's first page as the screen asks for it — unfiltered, narrowed to one name (a
  // link from when the filter took one), and narrowed to two categories and two names, one of
  // them holding a comma: the request carries the names as ONE escaped list.
  qc.setQueryData(listKey('it', 'assets', FIRST_PAGE), page([HELD, UNNAMED, IN_STOCK]));
  qc.setQueryData(listKey('it', 'assets', { ...FIRST_PAGE, name: NAME }), page([HELD]));
  // A remembered or linked name from the single filter, which kept it raw: one name, comma and all.
  qc.setQueryData(
    listKey('it', 'assets', { ...FIRST_PAGE, name: joinNameList([COMMA_NAME]) }),
    page([PRINTER]),
  );
  qc.setQueryData(listKey('it', 'assets', { ...FIRST_PAGE, categoryId: 'c-pc' }), page([HELD]));
  // «الضمان»: the bar's own window, and the dashboard's when its setting is another.
  qc.setQueryData(
    listKey('it', 'assets', { ...FIRST_PAGE, warrantyEndsWithinDays: 30 }),
    page([HELD]),
  );
  qc.setQueryData(
    listKey('it', 'assets', { ...FIRST_PAGE, warrantyEndsWithinDays: 45 }),
    page([IN_STOCK]),
  );
  qc.setQueryData(
    listKey('it', 'assets', {
      ...FIRST_PAGE,
      name: joinNameList([COMMA_NAME, NAME]),
      categoryId: 'c-printer,c-pc',
    }),
    page([HELD, PRINTER]),
  );
  // The names each choice of categories holds — every name when none is chosen.
  qc.setQueryData(listKey('it', 'assets', { names: true, categoryId: [] }), {
    names: [NAME, COMMA_NAME, 'طابعة HP'],
    truncated: false,
  });
  qc.setQueryData(listKey('it', 'assets', { names: true, categoryId: ['c-pc', 'c-printer'] }), {
    names: [NAME, COMMA_NAME],
    truncated: false,
  });
  qc.setQueryData(listKey('it', 'catalogs', { kind: 'assetCategory', select: true }), {
    items: [category('c-pc', 'كمبيوتر'), category('c-printer', 'طابعات')],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/it/assets" element={<AssetsListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const text = (markup: string): string => markup.replace(/<[^>]*>/gu, '').trim();

/** The table's column headings, in order. */
const headings = (html: string): string[] =>
  [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map((m) => text(m[1] ?? ''));

/** The cells of the row that carries `assetCode`, as markup. */
const rowOf = (html: string, assetCode: string): string[] => {
  const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gu)].find((m) =>
    (m[1] ?? '').includes(assetCode),
  );
  expect(row, assetCode).toBeDefined();
  return [...(row?.[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gu)].map((m) => m[1] ?? '');
};

describe('the holder’s column', () => {
  const html = render();
  const columns = headings(html);
  const holderAt = columns.indexOf(ar('it.custody.holder'));

  it('comes right after the status — «بعد الحالة»', () => {
    expect(holderAt).toBeGreaterThan(-1);
    expect(columns[holderAt - 1]).toBe(ar('it.assets.columns.status'));
  });

  it('names the holder with a link to what they hold, and their code under the name', () => {
    const cell = rowOf(html, 'AST-00012')[holderAt] ?? '';
    expect(cell).toContain('href="/it/employees/e-1"');
    expect(cell).toContain('محمد أحمد علي');
    expect(cell).toContain('0100052');
  });

  it('shows a holder HR cannot name by the id the row carries — still a link', () => {
    const cell = rowOf(html, 'AST-00013')[holderAt] ?? '';
    expect(cell).toContain('href="/it/employees/e-9"');
    expect(text(cell)).toBe('e-9');
  });

  it('is a dash for an asset nobody holds', () => {
    expect(text(rowOf(html, 'AST-00014')[holderAt] ?? '')).toBe('—');
  });
});

/** Where a multi-select's trigger sits in the markup — by the question it asks. */
const multiSelectAt = (html: string, label: string): number =>
  html.indexOf(`aria-haspopup="listbox" aria-expanded="false" aria-label="${label}"`);

describe('the category and name filters', () => {
  const categoryLabel = ar('it.assets.columns.category');
  const nameLabel = ar('it.assets.columns.name');

  it('stand after the status, the category FIRST and the name right after it — «بعد الفئات»', () => {
    const html = render();
    const status = html.indexOf(`aria-label="${ar('it.assets.columns.status')}"`);
    const category = multiSelectAt(html, categoryLabel);
    const name = multiSelectAt(html, nameLabel);
    const branch = html.indexOf(`aria-label="${ar('it.assets.columns.branch')}"`);
    expect(status).toBeGreaterThan(-1);
    expect(category).toBeGreaterThan(status);
    expect(name).toBeGreaterThan(category);
    expect(branch).toBeGreaterThan(name);
  });

  it('both take several answers — «Multiselect» — and the old single-name box is gone', () => {
    const html = render();
    expect(multiSelectAt(html, categoryLabel)).toBeGreaterThan(-1);
    expect(multiSelectAt(html, nameLabel)).toBeGreaterThan(-1);
    expect(html).not.toContain(`role="combobox" aria-label="${nameLabel}"`);
  });

  it('change the bar only — the table’s columns keep their order, the name before the category', () => {
    const columns = headings(render());
    expect(columns.indexOf(nameLabel)).toBeGreaterThan(-1);
    expect(columns.indexOf(nameLabel)).toBeLessThan(columns.indexOf(categoryLabel));
  });

  it('read a link from when each took one value — a list of one', () => {
    const byName = render(`/it/assets?name=${encodeURIComponent(NAME)}`);
    // Only the one asset by that name — the request carried `name`; the trigger names the pick.
    expect(byName).toContain('AST-00012');
    expect(byName).not.toContain('AST-00014');
    expect(byName).toContain(`title="${NAME}"`);
    expect(byName).toContain(`aria-label="${ar('common.filters.clear')}"`);

    const byCategory = render('/it/assets?category=c-pc');
    expect(byCategory).toContain('AST-00012');
    expect(byCategory).not.toContain('AST-00014');
    expect(byCategory).toContain('title="كمبيوتر"');
  });

  it('ask for every category and every name in the URL — a name holding a comma, whole', () => {
    const query = new URLSearchParams({
      category: 'c-printer,c-pc',
      names: joinNameList([COMMA_NAME, NAME]),
    });
    const html = render(`/it/assets?${query.toString()}`);
    // The request carried both lists: the two assets they match, and none they do not.
    expect(html).toContain('AST-00012');
    expect(html).toContain('AST-00015');
    expect(html).not.toContain('AST-00014');
    // The triggers name the picks, in the order they were picked — the comma's name in one piece.
    expect(html).toContain('title="طابعات, كمبيوتر"');
    expect(html).toContain(`title="${COMMA_NAME}, ${NAME}"`);
  });

  it('read the single filter’s raw name whole — its comma never splits it', () => {
    const html = render(`/it/assets?name=${encodeURIComponent(COMMA_NAME)}`);
    expect(html).toContain('AST-00015');
    expect(html).not.toContain('AST-00012');
    expect(html).toContain(`title="${COMMA_NAME}"`);
  });

  it('offers no reset while nothing is filtered', () => {
    expect(render()).not.toContain(`aria-label="${ar('common.filters.clear')}"`);
  });
});

// The `/it` dashboard's «ضمان ينتهي خلال ٣٠ يومًا» opens this register with
// `warrantyEndsWithinDays` set — so the register reads it, asks for it, and shows it in its bar.
describe('«الضمان»', () => {
  const label = ar('it.assets.warranty.label');

  it('offers every warranty, then 30 and 90 days', () => {
    const html = render();
    const select = html.slice(html.indexOf(`aria-label="${label}"`));
    expect(select).toMatch(
      /^[^>]*>\s*<option value="" selected="">الضمان: الكل<\/option><option value="30">ينتهي خلال ٣٠ يومًا<\/option><option value="90">ينتهي خلال ٩٠ يومًا<\/option><\/select>/u,
    );
  });

  it('reads the window from the URL and asks the register for it', () => {
    const html = render('/it/assets?warrantyEndsWithinDays=30');
    expect(html).toContain('AST-00012');
    expect(html).not.toContain('AST-00014');
    expect(html).toMatch(/<option value="30" selected="">ينتهي خلال ٣٠ يومًا<\/option>/u);
    expect(html).toContain(`aria-label="${ar('common.filters.clear')}"`);
  });

  it('shows a linked window the bar does not offer, rather than reading «الكل» while narrowed', () => {
    const html = render('/it/assets?warrantyEndsWithinDays=45');
    expect(html).toContain('AST-00014');
    expect(html).not.toContain('AST-00012');
    expect(html).toMatch(/<option value="45" selected="">ينتهي خلال ٤٥ يومًا<\/option>/u);
  });

  it('reads a window the API would refuse as none', () => {
    const html = render('/it/assets?warrantyEndsWithinDays=999');
    expect(html).toContain('AST-00012');
    expect(html).toContain('AST-00014');
  });
});
