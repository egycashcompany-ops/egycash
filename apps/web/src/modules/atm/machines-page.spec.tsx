// /atm/machines «كل الماكينات», rendered — «عايز فلتر كامل بكل حاجة فى الجدول زى فلتر الحركة كدا
// فى السيارات … وكمان عدد الماكينات والبنوك والمناطق يظهر فوق بجانب جملة كل الماكينات».
//
//   · the vehicles registry's dark bar: one control per column of the table, IN the table's column
//     order, each in its icon frame;
//   · the three counts beside the title come from the server's summary — never the page's rows;
//   · the address bar's filters, order and page reach the list the screen asks for, and the
//     summary is asked the same filters without the page;
//   · a filter matching nothing says so; the pager is under a list longer than one page.
// The rules underneath are `lib/machine-directory.spec.ts`; the API's answers are
// tests/integration/atm-machines-filter.spec.ts.
//
// Every bank, area, code and name below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  ATM_MACHINE_CODES_MAX,
  type AtmMachineDto,
  type AtmMachinesSummaryDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { formatNumber } from '../../shared/lib/format';
import { DARK_FILTER_BAR } from '../../shared/ui/dark-filter-bar';
import { MachinesPage } from './pages/MachinesPage';
import { atmMachineDirectoryQuery } from './api/atm-queries';
import type * as AtmApiModule from './api/atm-api';

/** The list's next answer waits on this gate — so a suite can look while it is on its way. */
let listGate: Promise<void> = Promise.resolve();
vi.mock('./api/atm-api', async () => {
  const actual = await vi.importActual<typeof AtmApiModule>('./api/atm-api');
  return {
    ...actual,
    listMachines: async (params: Record<string, unknown>): Promise<Paginated<AtmMachineDto>> => {
      await listGate;
      const page = Number(params['page'] ?? 1);
      return {
        items: [machine(page * 100, { name: `SYN ATM PAGE ${String(page)}` })],
        meta: { page, pageSize: 25, totalItems: 2634, totalPages: 106 },
      };
    },
  };
});

const t = (key: string): string => translate('ar', key);

const machine = (n: number, over: Partial<AtmMachineDto> = {}): AtmMachineDto => ({
  id: `66000000000000000000${String(n).padStart(4, '0')}`,
  branchId: '660000000000000000000001',
  bankName: n % 2 === 0 ? 'SYN NBE' : 'SYN Bank, Ltd',
  machineCode: String(10000 + n),
  name: `SYN ATM ${String(n)}`,
  zone: '',
  area: 'SYN Smouha',
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: { id: 'u1', permissions: { 'atmMachine.view': 'branch' } } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

/** The screen at an address, its cache already holding the list page and the summary it asks. */
const render = ({
  search = '',
  list,
  listParams,
  summary,
  summaryParams,
}: {
  search?: string;
  list: Paginated<AtmMachineDto>;
  listParams: Record<string, unknown>;
  summary?: AtmMachinesSummaryDto;
  summaryParams?: Record<string, unknown>;
}): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('atm', 'machines', listParams), list);
  if (summary !== undefined) {
    qc.setQueryData(listKey('atm', 'machines', { kind: 'summary', ...summaryParams }), summary);
  }
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/atm/machines${search === '' ? '' : `?${search}`}`]}>
          <MachinesPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const paged = (
  items: AtmMachineDto[],
  meta: Partial<Paginated<AtmMachineDto>['meta']> = {},
): Paginated<AtmMachineDto> => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1, ...meta },
});

/** What the screen asks when nothing is narrowed: active machines, by code, page one of 25. */
const OPENING = {
  isActive: 'true',
  sortBy: 'machineCode',
  sortDir: 'asc',
  page: 1,
  pageSize: 25,
};

const SUMMARY: AtmMachinesSummaryDto = {
  counts: { machines: 2634, banks: 12, areas: 41 },
  options: { banks: ['SYN Bank, Ltd', 'SYN NBE'], areas: ['SYN Smouha'] },
};

describe('the filter bar', () => {
  const html = render({
    list: paged(Array.from({ length: 25 }, (_unused, i) => machine(i + 1)), {
      totalItems: 2634,
      totalPages: 106,
    }),
    listParams: OPENING,
    summary: SUMMARY,
    summaryParams: { isActive: 'true' },
  });
  const bar = html.slice(html.indexOf('data-machine-filters="true"'), html.indexOf('<table'));

  it('wears the vehicles registry’s dark bar', () => {
    const open = html.slice(html.lastIndexOf('<div', html.indexOf('data-machine-filters="true"')));
    const escaped = (cls: string): string => cls.replaceAll('&', '&amp;').replaceAll('>', '&gt;');
    expect(open).toContain(`class="${escaped(DARK_FILTER_BAR)} `);
  });

  it('holds one control per column, in the table’s column order, each in its icon frame', () => {
    const headers = [
      t('atm.common.bank'),
      t('atm.common.machineId'),
      t('atm.common.machineName'),
      t('atm.common.area'),
    ];
    // The table's own order of headings…
    const thead = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const columnAt = headers.map((header) => thead.indexOf(header));
    expect(columnAt.every((at) => at > -1)).toBe(true);
    expect([...columnAt].sort((a, b) => a - b)).toEqual(columnAt);
    // …is the bar's order of controls, one each.
    const controlAt = headers.map((header) => bar.indexOf(`aria-label="${header}"`));
    expect(controlAt.every((at) => at > -1)).toBe(true);
    expect([...controlAt].sort((a, b) => a - b)).toEqual(controlAt);
    for (const header of headers) {
      expect(bar.split(`aria-label="${header}"`).length - 1, header).toBe(1);
    }
    // Every control in its icon frame: the gutter that keeps its text clear of the icon.
    expect(bar.split('rtl:[&amp;&amp;_button[aria-haspopup]]:!pr-6').length - 1).toBe(4);
  });

  it('sorts by every column, and shows no arrow for the screen’s own order (by code)', () => {
    const thead = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(thead.split('<button type="button"').length - 1).toBe(4);
    expect(thead).not.toContain('opacity-100');
  });

  it('shows no reset while nothing is filtered', () => {
    expect(bar).not.toContain(`aria-label="${t('common.filters.clear')}"`);
  });
});

describe('the counts beside the title', () => {
  it('are the summary’s — the whole filtered set — not the 25 rows on the page', () => {
    const html = render({
      list: paged(Array.from({ length: 25 }, (_unused, i) => machine(i + 1)), {
        totalItems: 2634,
        totalPages: 106,
      }),
      listParams: OPENING,
      summary: SUMMARY,
      summaryParams: { isActive: 'true' },
    });
    const header = html.slice(html.indexOf('<h1'), html.indexOf('data-machine-filters'));
    // Beside the title: after it, in the header, before the bar.
    expect(header).toContain(t('atm.machines.title'));
    expect(header).toContain('data-machine-figures="true"');
    const value = (key: string): string => {
      const at = header.indexOf(`data-machine-figure-value="${key}"`);
      return header.slice(header.indexOf('>', at) + 1, header.indexOf('<', at));
    };
    expect(value('machines')).toBe(formatNumber(2634, 'ar'));
    expect(value('banks')).toBe(formatNumber(12, 'ar'));
    expect(value('areas')).toBe(formatNumber(41, 'ar'));
    expect(value('machines')).not.toBe(formatNumber(25, 'ar'));
    for (const key of ['machines', 'banks', 'areas']) {
      expect(header).toContain(t(`atm.machines.figures.${key}`));
    }
  });

  it('say nothing rather than zero until the summary has answered', () => {
    const html = render({ list: paged([machine(1)]), listParams: OPENING });
    const header = html.slice(html.indexOf('<h1'), html.indexOf('data-machine-filters'));
    expect(header).toContain('data-machine-figures="true"');
    expect(header).not.toContain(`>${formatNumber(0, 'ar')}<`);
  });
});

describe('the address bar is the filter', () => {
  it('sends every column, the chosen order and the page to the list; the summary the filters alone', () => {
    const search = [
      'banks=SYN+Bank%5C%2C+Ltd%2CSYN+NBE',
      'codes=0101%2C10002',
      'name=ATM',
      'areas=SYN+Smouha',
      'sort=bankName%3Adesc',
      'page=2',
      'size=50',
    ].join('&');
    const filters = {
      isActive: 'true',
      banks: 'SYN Bank\\, Ltd,SYN NBE',
      codes: '101,10002',
      name: 'ATM',
      areas: 'SYN Smouha',
    };
    const html = render({
      search,
      list: paged([machine(2, { name: 'SYN ATM SENT' })], { page: 2, pageSize: 50, totalItems: 51, totalPages: 2 }),
      listParams: { ...filters, sortBy: 'bankName', sortDir: 'desc', page: 2, pageSize: 50 },
      summary: { ...SUMMARY, counts: { machines: 51, banks: 2, areas: 1 } },
      summaryParams: filters,
    });
    // The list the screen asked for is the one it drew…
    expect(html).toContain('SYN ATM SENT');
    // …with the summary it asked for beside the title.
    expect(html).toContain(`>${formatNumber(51, 'ar')}<`);
    // A filter is set: the red reset of the vehicles registry's bar is offered.
    expect(html).toContain(`aria-label="${t('common.filters.clear')}"`);
    expect(html).toContain('border-red-300');
    // The reader's order lights its own column — descending — and no other.
    const thead = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const bankHeading = thead.slice(0, thead.indexOf('</th>'));
    expect(bankHeading).toContain(t('atm.common.bank'));
    expect(bankHeading).toContain('opacity-100');
    expect(bankHeading).not.toContain('rotate-180');
    expect(thead.split('opacity-100').length - 1).toBe(1);
    // The pager is under a list of two pages, on the page and the size the address bar named.
    expect(html).toContain('data-page-size');
    expect(html).toContain('<option value="50" selected="">');
  });

  // MACH-3: the API takes at most ATM_MACHINE_CODES_MAX codes. A link or a remembered view
  // holding more asked for all of them, and the list and the counts both came back 400.
  it('asks for no more codes than the API takes, however many the address bar holds', () => {
    const many = Array.from({ length: 230 }, (_unused, i) => String(20000 + i));
    const kept = many.slice(0, ATM_MACHINE_CODES_MAX);
    const html = render({
      search: `codes=${many.join('%2C')}`,
      list: paged([machine(7, { name: 'SYN ATM WITHIN LIMIT' })]),
      listParams: { ...OPENING, codes: kept.join(',') },
    });
    // The list drawn is the one asked with the first two hundred codes — not a request refused.
    expect(html).toContain('SYN ATM WITHIN LIMIT');
  });

  it('a filter matching nothing says so, instead of the empty directory’s words', () => {
    const html = render({
      search: 'name=NOTHING',
      list: paged([]),
      listParams: { ...OPENING, name: 'NOTHING' },
    });
    expect(html).toContain(t('atm.machines.emptyFiltered'));
    expect(html).not.toContain('data-page-size');
  });
});

describe('the pager', () => {
  // MACH-2: a hundred pages and more of the directory — reachable at once, as on the vehicles
  // registry, not one «next» at a time.
  it('numbers the pages — the first, the last, the current one and its neighbours', () => {
    const html = render({
      search: 'page=50',
      list: paged([machine(1)], { page: 50, totalItems: 2634, totalPages: 106 }),
      listParams: { ...OPENING, page: 50 },
    });
    expect(html).toContain('data-pager="true"');
    const pager = html.slice(html.indexOf('data-pager="true"'));
    const numbered = [...pager.matchAll(/data-pager-page="(\d+)"/gu)].map((m) => Number(m[1]));
    expect(numbered).toEqual([1, 49, 50, 51, 106]);
    expect(pager).toContain('aria-current="page" data-pager-page="50"');
    expect(pager.split('…').length - 1).toBe(2);
    expect(pager).toContain(t('common.pager.perPage'));
    // Not the «page X of Y» pager it replaced.
    expect(html).not.toContain(
      translate('ar', 'common.pagination.page', {
        page: formatNumber(50, 'ar'),
        total: formatNumber(106, 'ar'),
      }),
    );
  });
});

describe('moving between pages', () => {
  // MACH-4: each new page, order or filter is a new query; without the page before standing in,
  // the table dropped to skeleton rows and the pager — drawn under the data — went with it.
  it('keeps the page in hand on screen while the next one is read', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = { ...OPENING, page: 1 };
    const observer = new QueryObserver<Paginated<AtmMachineDto>>(qc, atmMachineDirectoryQuery(first));
    const stop = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(observer.getCurrentResult().data?.items[0]?.name).toBe('SYN ATM PAGE 1');

    let release = (): void => undefined;
    listGate = new Promise((resolve) => {
      release = resolve;
    });
    observer.setOptions(atmMachineDirectoryQuery({ ...OPENING, page: 2 }));
    const reading = observer.getCurrentResult();
    expect(reading.isLoading).toBe(false);
    expect(reading.isPlaceholderData).toBe(true);
    expect(reading.data?.items[0]?.name).toBe('SYN ATM PAGE 1');
    expect(reading.data?.meta.totalPages).toBe(106);

    release();
    await vi.waitFor(() => expect(observer.getCurrentResult().isPlaceholderData).toBe(false));
    expect(observer.getCurrentResult().data?.items[0]?.name).toBe('SYN ATM PAGE 2');
    stop();
    listGate = Promise.resolve();
  });
});
