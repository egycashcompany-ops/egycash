// «إعداد النماذج» of «مصروفات التراخيص», proven against what it renders and what it writes: the
// picked memo's two templates in the memo's own groups, the memo as it prints beside them, ONE save
// carrying the names and all four templates, the list's button by grant, and «يظهر في» for every
// item — the same field «قوائم الحركة» writes. No DOM here: what the page does between clicks is
// held in the pure steps it is built from, and those are run in the order a user's clicks run them.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import {
  type FleetCatalogItemDto,
  type FleetLicenseExpenseSettingsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { LicenseExpensesPage } from './LicenseExpensesPage';
import {
  LicenseExpenseSetupPage,
  savedElsewhere,
  setupBody,
  setupEntriesOf,
  setupLinesOf,
  showsInBody,
  withLines,
  withWritten,
} from './LicenseExpenseSetupPage';
import { PaidGroup } from '../components/LicenseExpensePaidGroup';
import { licenseExpenseSettingsKey } from '../api/fleet-queries';
import { DEFAULT_SIGNATURES, type LicenseExpenseItemLine } from '../lib/license-expense-memo';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string): string => translate('ar', key);

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

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const EDIT = ['fleetLicenseExpense.view', 'fleetLicenseExpense.create', 'fleetLicenseExpense.edit'];
const MANAGE = [...EDIT, 'fleetCatalog.manage'];

const catalogItem = (
  id: string,
  name: string,
  licenseExpenseKind: 'renewal' | 'extension' | null,
  version: number,
  isActive = true,
): FleetCatalogItemDto =>
  ({
    id,
    kind: 'licenseExpenseItem',
    name: { ar: name, en: name },
    licenseExpenseKind,
    isActive,
    version,
  }) as unknown as FleetCatalogItemDto;

const ITEMS = [
  catalogItem('i-1', 'براءة ذمة', 'renewal', 4),
  catalogItem('i-2', 'استعلام أمني', 'extension', 7),
  catalogItem('i-3', 'ضرائب', null, 1),
  catalogItem('i-4', 'بند مؤرشف', null, 2, false),
];

const SETTINGS: FleetLicenseExpenseSettingsDto = {
  signatures: {
    agent: 'مندوب محفوظ',
    director: 'مدير محفوظ',
    generalManager: 'مدير عام محفوظ',
  },
  templates: {
    renewal: {
      visa: [{ itemId: 'i-1', label: 'براءة ذمة', amount: 600, count: 1, receipt: true }],
      cash: [{ itemId: null, label: 'تصوير مستندات', amount: 18, count: 2, receipt: false }],
    },
    extension: {
      visa: [],
      cash: [{ itemId: 'i-2', label: 'استعلام أمني', amount: 75, count: 1, receipt: true }],
    },
  },
  version: 3,
};

type Queries = NonNullable<NonNullable<QueryClientConfig['defaultOptions']>['queries']>;

const renderSetup = (permissions = MANAGE, settings = SETTINGS, queries: Queries = {}): string => {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, ...queries },
    },
  });
  qc.setQueryData(listKey('fleet', 'catalogs', { kind: 'licenseExpenseItem' }), {
    items: ITEMS,
    meta: { page: 1, pageSize: 100, totalItems: ITEMS.length, totalPages: 1 },
  });
  qc.setQueryData(['fleet', 'licenseExpenses', 'settings'], settings);
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/license-expenses/setup']}>
          <Routes>
            <Route path="/fleet/license-expenses/setup" element={<LicenseExpenseSetupPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const renderList = (permissions: string[]): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'licenseExpenses', { page: 1, pageSize: 25 }), {
    items: [],
    meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
  });
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/license-expenses']}>
          <Routes>
            <Route path="/fleet/license-expenses" element={<LicenseExpensesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The markup from one marker to the next — one group, one card list, one preview. */
const between = (html: string, from: string, to?: string): string => {
  const start = html.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = to === undefined ? html.length : html.indexOf(to, start);
  return html.slice(start, end === -1 ? html.length : end);
};

describe('«إعداد النماذج» of the licensing-expenses memo', () => {
  it('opens on the renewal, its two groups holding the saved lines, and the memo as it prints', () => {
    const html = renderSetup();
    expect(html).toMatch(/aria-pressed="true"[^>]*data-license-expense-setup-kind="renewal"/u);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-license-expense-setup-kind="extension"/u);
    const visa = between(
      html,
      'data-license-expense-group="renewal:visa"',
      'data-license-expense-group="renewal:cash"',
    );
    const cash = between(
      html,
      'data-license-expense-group="renewal:cash"',
      'data-license-expense-setup-preview',
    );
    // The card's line in the card's group, the cash line in the cash group — one card each.
    expect(visa.split('data-license-expense-card=').length - 1).toBe(1);
    expect(visa).toContain('>براءة ذمة</span>');
    expect(cash.split('data-license-expense-card=').length - 1).toBe(1);
    expect(cash).toContain('value="تصوير مستندات"');
    // The counters follow «يظهر في»: the renewal's item and the one in both, not the extension's.
    expect(visa).toContain('data-license-expense-count="renewal:visa:i-1"');
    expect(visa).toContain('data-license-expense-count="renewal:visa:i-3"');
    expect(visa).not.toContain('data-license-expense-count="renewal:visa:i-2"');
    expect(html, 'only the picked memo is on the form').not.toContain(
      'data-license-expense-group="extension:',
    );
    // The page IS the template: no applying one, no saving one per group.
    expect(html).not.toContain('data-license-expense-apply-template');
    expect(html).not.toContain('data-license-expense-save-template');
    expect(html).toContain('data-license-expense-setup-save="true"');

    const preview = between(html, 'data-license-expense-setup-preview="renewal"');
    expect(preview).toContain('مذكرة بمصروفات تجديد تراخيص');
    expect(preview).toContain('ما تم صرفه بفيزا إدارة الحركة');
    expect(preview).toContain('تم صرفه نقدًا');
    expect(preview).toContain('600.00');
    // 18 × 2 in cash.
    expect(preview).toContain('36.00');
    expect(preview).toContain('مندوب محفوظ');
    expect(html).toContain(ar('fleet.licenseExpenses.setup.preview'));
  });

  it('starts from the names the server sends before anybody saved the set-up — as a new memo does', () => {
    const html = renderSetup(MANAGE, {
      signatures: { agent: 'مندوب القسم', director: 'مدير القسم', generalManager: '' },
      templates: { renewal: { visa: [], cash: [] }, extension: { visa: [], cash: [] } },
      version: null,
    });
    expect(html).toContain('value="مندوب القسم"');
    const preview = between(html, 'data-license-expense-setup-preview="renewal"');
    expect(preview, 'no line, no table').not.toContain('ما تم صرفه بفيزا');
    expect(preview).toContain('مدير القسم');
  });

  it('waits for a fresh read when the cached set-up is old — it never starts from one', () => {
    const html = renderSetup(MANAGE, SETTINGS, { staleTime: 0 });
    expect(html).not.toContain('data-license-expense-setup-page');
    expect(html).toContain(ar('common.loading'));
  });

  it('saves the names and all four templates in one write, at the version it was read', () => {
    const lines = setupLinesOf(SETTINGS.templates);
    // Untouched, the page writes back exactly what it read.
    expect(setupBody(SETTINGS.signatures, lines, 3)).toEqual({
      signatures: SETTINGS.signatures,
      templates: SETTINGS.templates,
      version: 3,
    });
    // A hand-written label is kept trimmed; a line's group is how it was paid.
    lines.extension.items.push({
      key: 'k-new',
      itemId: null,
      label: '  دمغة  ',
      amount: null,
      count: 3,
      paidBy: 'visa',
      receipt: false,
    });
    const body = setupBody(SETTINGS.signatures, lines, 3);
    expect(body.templates?.extension.visa).toEqual([
      { itemId: null, label: 'دمغة', amount: null, count: 3, receipt: false },
    ]);
    expect(body.templates?.extension.cash).toEqual(SETTINGS.templates.extension.cash);
    expect(body.templates?.renewal).toEqual(SETTINGS.templates.renewal);
    // Never saved: no version to send.
    expect(setupBody(DEFAULT_SIGNATURES, lines, null)).not.toHaveProperty('version');
  });

  it('saves again at the version its own save left, and overwrites nothing saved elsewhere', () => {
    const qc = new QueryClient();
    const cached = () => qc.getQueryData<FleetLicenseExpenseSettingsDto>(licenseExpenseSettingsKey);
    const lines = setupLinesOf(SETTINGS.templates);
    qc.setQueryData(licenseExpenseSettingsKey, SETTINGS);
    // Read at 3, saved at 3.
    let version: number | null = SETTINGS.version;
    expect(savedElsewhere(version, cached())).toBe(false);
    expect(setupBody(SETTINGS.signatures, lines, version).version).toBe(3);
    // The save comes back at 4 — the hook writes it into the cache, the page keeps it.
    const result = { ...SETTINGS, version: 4 };
    qc.setQueryData(licenseExpenseSettingsKey, result);
    version = result.version;
    expect(savedElsewhere(version, cached()), 'its own save is not somebody else’s').toBe(false);
    expect(setupBody(SETTINGS.signatures, lines, version).version).toBe(4);
    // Another tab's «حفظ كنموذج» comes in by realtime: the page re-reads instead of writing.
    qc.setQueryData(licenseExpenseSettingsKey, { ...SETTINGS, version: 5 });
    expect(savedElsewhere(version, cached())).toBe(true);
    // Never saved when the page opened, saved since: a save without a version would overwrite it.
    expect(savedElsewhere(null, { ...SETTINGS, version: 0 })).toBe(true);
    expect(savedElsewhere(null, { ...SETTINGS, version: null })).toBe(false);
  });

  it('keeps what was written on one memo while the other is edited', () => {
    const line = (label: string): LicenseExpenseItemLine => ({
      key: `k-${label}`,
      itemId: null,
      label,
      amount: 5,
      count: 1,
      paidBy: 'cash',
      receipt: true,
    });
    const add = (label: string) => (held: { items: LicenseExpenseItemLine[] }) => ({
      ...held,
      items: [...held.items, line(label)],
    });
    // On the renewal, then the extension, then the renewal again.
    let lines = setupLinesOf(SETTINGS.templates);
    lines = withLines(lines, 'renewal', add('دمغة'));
    lines = withLines(lines, 'extension', add('رسم مد'));
    lines = withLines(lines, 'renewal', (held) => ({ ...held, items: held.items.slice(1) }));
    const body = setupBody(SETTINGS.signatures, lines, 3);
    expect(body.templates?.renewal.visa).toEqual([]);
    expect(body.templates?.renewal.cash.map((l) => l.label)).toEqual(['تصوير مستندات', 'دمغة']);
    expect(body.templates?.extension.cash.map((l) => l.label)).toEqual(['استعلام أمني', 'رسم مد']);
  });
});

describe('the licensing-expenses list opens the set-up', () => {
  it('shows «إعداد النماذج» to whoever may edit the memos', () => {
    const html = renderList(EDIT);
    expect(html).toContain('data-license-expense-setup="true"');
    expect(html).toContain('href="/fleet/license-expenses/setup"');
    expect(html).toContain(ar('fleet.licenseExpenses.setup.button'));
  });

  it('hides it without the grant', () => {
    const html = renderList(['fleetLicenseExpense.view', 'fleetLicenseExpense.create']);
    expect(html).not.toContain('data-license-expense-setup=');
    expect(html).toContain('data-license-expense-new="true"');
  });
});

describe('«يظهر في» on the set-up — the same field «قوائم الحركة» writes', () => {
  it("presses each item's current choice, for every active item", () => {
    const html = renderSetup();
    const card = between(html, 'data-license-expense-setup-items="true"');
    expect(card).toMatch(/aria-pressed="true"[^>]*data-license-expense-item-kind="i-1:renewal"/u);
    expect(card).toMatch(/aria-pressed="true"[^>]*data-license-expense-item-kind="i-2:extension"/u);
    expect(card).toMatch(/aria-pressed="true"[^>]*data-license-expense-item-kind="i-3:both"/u);
    expect(card).toMatch(/aria-pressed="false"[^>]*data-license-expense-item-kind="i-1:both"/u);
    expect(card).toMatch(/data-license-expense-item-kind="i-3:both"[^>]*>كليهما</u);
    // Neither a «يظهر في» row nor a counter in the groups.
    expect(html, 'an archived item is not offered').not.toMatch(/i-4[:"]/u);
    expect(card).not.toMatch(/data-license-expense-item-kind="[^"]+" disabled=""/u);
    expect(card).not.toContain(ar('fleet.licenseExpenses.setup.itemsLocked'));
  });

  it('shows the choice but leaves it to whoever manages the lists', () => {
    const html = renderSetup(EDIT);
    const card = between(html, 'data-license-expense-setup-items="true"');
    expect(card).toMatch(/aria-pressed="true"[^>]*data-license-expense-item-kind="i-1:renewal"/u);
    for (const choice of ['i-1:renewal', 'i-1:extension', 'i-1:both', 'i-3:both']) {
      expect(card).toContain(`data-license-expense-item-kind="${choice}" disabled=""`);
    }
    expect(card).toContain(ar('fleet.licenseExpenses.setup.itemsLocked'));
    // Nor is a hand-written line added to the list from here without the grant.
    expect(html).not.toContain('data-license-expense-add-to-list');
  });

  it('writes the picked memo with the version it was read at — and nothing for the same one', () => {
    const [renewal, , both] = ITEMS;
    expect(showsInBody(renewal!, 'extension')).toEqual({
      licenseExpenseKind: 'extension',
      version: 4,
    });
    expect(showsInBody(renewal!, null)).toEqual({ licenseExpenseKind: null, version: 4 });
    expect(showsInBody(both!, 'renewal')).toEqual({ licenseExpenseKind: 'renewal', version: 1 });
    expect(showsInBody(renewal!, 'renewal')).toBeNull();
    expect(showsInBody(both!, null)).toBeNull();
  });

  it('lets what it just wrote stand until the list is read again — and the counters follow it', () => {
    const moved = {
      ...ITEMS[0]!,
      licenseExpenseKind: 'extension',
      version: 5,
    } as FleetCatalogItemDto;
    // Written at 5 over a list read at 4: the write stands, and the next click carries 5.
    const shown = withWritten(ITEMS, { 'i-1': moved });
    expect(shown[0]).toBe(moved);
    expect(showsInBody(shown[0]!, 'renewal')).toEqual({
      licenseExpenseKind: 'renewal',
      version: 5,
    });
    // The list read again at 6 (moved back on «قوائم الحركة»): the list wins.
    const reread = [{ ...ITEMS[0]!, version: 6 }, ...ITEMS.slice(1)];
    expect(withWritten(reread, { 'i-1': moved })[0]).toBe(reread[0]);

    const counters = (lines: LicenseExpenseItemLine[]): string =>
      renderToStaticMarkup(
        <Provider store={store(MANAGE)}>
          <PaidGroup
            kind="renewal"
            paid="visa"
            items={lines}
            setDraft={() => undefined}
            catalogItems={setupEntriesOf(shown, lines, 'ar')}
          />
        </Provider>,
      );
    // Moved to the extension and not counted: off the renewal's counters; the archived one too.
    const html = counters([]);
    expect(html).not.toContain('data-license-expense-count="renewal:visa:i-1"');
    expect(html).toContain('data-license-expense-count="renewal:visa:i-3"');
    expect(html).not.toContain('data-license-expense-count="renewal:visa:i-4"');
    // An archived item the template still counts keeps its counter, so it can be counted out.
    const archived: LicenseExpenseItemLine = {
      key: 'k-old',
      itemId: 'i-4',
      label: 'بند مؤرشف',
      amount: 10,
      count: 1,
      paidBy: 'visa',
      receipt: true,
    };
    expect(counters([archived])).toContain('data-license-expense-count="renewal:visa:i-4"');
  });
});
