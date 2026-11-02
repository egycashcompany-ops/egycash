// The two done pages — /atm/replenishments/done and /atm/maintenance/done — rendered from a
// pre-filled query cache. They pin, from 2026-11-02:
//
//   · the range and its Excel/PDF on the title's line — «عايز تطلع الصف بتاع الـ Form يبقي بجانب
//     العنوان عشان نستفيد بالمساحة»;
//   · a filter under every text column — «فلتر لكل عمود», then «لأ عايز الفلتر الكبير اللى فوق
//     الجداول يكون Drop Down بـ Multi select»: a multi-select list of the values the column's cells
//     show, that narrows the range's rows before the reader's order — a row kept when its cell IS
//     one of the picks, the columns adding up — and says so when it hides every row.
//
// Every code and name below is synthetic.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  type AtmMaintenanceDto,
  type AtmReplenishmentDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { ReplenishmentsDonePage } from './pages/ReplenishmentsDonePage';
import { MaintenanceDonePage } from './pages/MaintenanceDonePage';
import { maintenanceColumns, replenishmentColumns } from './lib/operation-sheet';
import { cairoToday } from './lib/operation-view';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

/** The column lists' picks — a static render cannot open a list. Empty unless a test sets it. */
let columnValues: Record<string, string[]> = {};
vi.mock('../../shared/ui/useColumnFilters', () => ({
  useColumnFilters: () => ({
    values: columnValues,
    set: () => {},
    clear: () => {},
    active: Object.values(columnValues).some((value) => value.length > 0),
    generation: 0,
  }),
}));

const t = (key: string): string => translate('ar', key);
const TODAY = cairoToday();
const OPENED = new Date(`${TODAY}T08:00:00+02:00`).toISOString();
const CLOSED = new Date(`${TODAY}T10:05:00+02:00`).toISOString();

const common = (n: number, area: string) => ({
  id: `650000000000000000000f0${String(n)}`,
  branchId: '650000000000000000000104',
  machineId: `650000000000000000000b0${String(n)}`,
  machineCode: `9999030${String(n)}`,
  bankName: n === 3 ? 'SYN CIB' : 'SYN NBE',
  machineName: `SYN ${String(n)}`,
  zone: '',
  area,
  openedAt: OPENED,
  closedAt: CLOSED,
  leaderName: null,
  openedByName: 'SYN OPERATOR',
  closedByName: 'SYN CLOSER',
  version: 1,
  createdAt: OPENED,
  updatedAt: CLOSED,
});
const rep = (n: number, area: string): AtmReplenishmentDto => ({
  ...common(n, area),
  scheduleTime: '10:30',
});
const maint = (n: number, area: string): AtmMaintenanceDto => ({
  ...common(n, area),
  serviceType: 'SYN SERVICE',
  notes: null,
  referenceNumber: null,
  source: 'manual',
  mailTicketId: null,
  leaderEmployeeId: null,
});

const render = (kind: 'replenishments' | 'maintenances', values: Record<string, string[]> = {}) => {
  columnValues = values;
  try {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rows =
      kind === 'replenishments'
        ? [rep(1, 'الدقي'), rep(2, 'زايد'), rep(3, 'الدقي')]
        : [maint(1, 'الدقي'), maint(2, 'زايد'), maint(3, 'الدقي')];
    const page: Paginated<AtmReplenishmentDto | AtmMaintenanceDto> = {
      items: rows,
      meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: rows.length, totalPages: 1 },
    };
    qc.setQueryData(
      listKey('atm', kind, { kind: 'done', whole: true, from: TODAY, to: TODAY }),
      page,
    );
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: {
          me: {
            id: 'u1',
            permissions: { atmReplenishment: 'organization', atmMaintenance: 'organization' },
          } as unknown as MeDto,
          status: 'signedIn' as const,
        },
        ui: { theme: 'light' as const, sidebarOpen: false },
      },
    });
    const Page = kind === 'replenishments' ? ReplenishmentsDonePage : MaintenanceDonePage;
    return renderToStaticMarkup(
      <Provider store={store}>
        <QueryClientProvider client={qc}>
          <MemoryRouter
            initialEntries={[
              `/atm/${kind === 'replenishments' ? 'replenishments' : 'maintenance'}/done`,
            ]}
          >
            <Page />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
  } finally {
    columnValues = {};
  }
};
/** The header's toolbar slot alone, from its `<div` to the `</div>` that closes it. */
const toolbarOf = (html: string): string => {
  const at = html.indexOf('data-page-toolbar="true"');
  if (at < 0) return '';
  const open = html.lastIndexOf('<div', at);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  return '';
};

/**
 * The codes the table's rows show — its body only: the filter row's triggers name what is picked,
 * and a picked code would otherwise read as a row.
 */
const codesShown = (markup: string): string[] => {
  const at = markup.indexOf('<tbody>');
  expect(at, 'the table body is rendered').toBeGreaterThan(-1);
  return [...markup.slice(at, markup.indexOf('</tbody>', at)).matchAll(/>(9999\d{4})</g)].map(
    (m) => m[1] as string,
  );
};
/** One column's filter, from its marker to the end of its list's trigger. */
const filterTrigger = (markup: string, key: string): string => {
  const at = markup.indexOf(`data-column-filter="${key}"`);
  expect(at, `the ${key} column filter is rendered`).toBeGreaterThan(-1);
  return markup.slice(at, markup.indexOf('</button>', at));
};

describe.each(['replenishments', 'maintenances'] as const)('the %s done page', (kind) => {
  it('puts the range and its files on the title’s line', () => {
    const toolbar = toolbarOf(render(kind));
    expect(toolbar).toContain('type="date"');
    expect(toolbar).toContain('data-export="');
  });

  it('draws a filter list under every text column — none for the reopen button', () => {
    const columns =
      kind === 'replenishments'
        ? replenishmentColumns(t, 'ar', 'done')
        : maintenanceColumns(t, 'ar', 'done');
    const markup = render(kind);
    const lists = [...markup.matchAll(/data-column-filter="([^"]+)"/g)].map((m) => m[1]);
    expect(lists).toEqual(columns.map((column) => column.key));
    expect(lists).not.toContain('actions');
    for (const column of columns) {
      // A drop-down, named for its column, saying «الكل» while nothing is picked.
      const trigger = filterTrigger(markup, column.key);
      expect(trigger).toContain('aria-haspopup="listbox"');
      expect(trigger).toContain(
        `aria-label="${translate('ar', 'atm.common.filterColumn', { column: column.header })}"`,
      );
      expect(trigger).toContain(`>${t('common.filters.all')}<`);
      expect(trigger).not.toContain('<input');
    }
  });

  it('narrows the rows to the values picked — any of them in a column, the columns adding up — and says so when none is left', () => {
    expect(codesShown(render(kind))).toEqual(['99990301', '99990302', '99990303']);
    expect(codesShown(render(kind, { area: ['الدقي'] }))).toEqual(['99990301', '99990303']);
    // Two values in one column: a row whose cell is either.
    expect(codesShown(render(kind, { code: ['99990301', '99990302'] }))).toEqual([
      '99990301',
      '99990302',
    ]);
    expect(codesShown(render(kind, { bank: ['SYN CIB', 'SYN NBE'] }))).toEqual([
      '99990301',
      '99990302',
      '99990303',
    ]);
    // Two columns: a row both keep.
    expect(codesShown(render(kind, { area: ['الدقي'], bank: ['SYN CIB'] }))).toEqual(['99990303']);
    // A pick is the whole cell, not a part of it.
    expect(codesShown(render(kind, { area: ['دقي'] }))).toEqual([]);
    // A code no row has — a pick left from before: nothing is left, and the page says why.
    const none = render(kind, { code: ['99990399'] });
    expect(codesShown(none)).toEqual([]);
    expect(none).toContain(t('atm.common.emptyColumnFiltered'));
    expect(render(kind)).not.toContain(t('atm.common.emptyColumnFiltered'));
  });

  it('names what is picked on the list’s trigger', () => {
    const markup = render(kind, { area: ['الدقي'], bank: ['SYN CIB', 'SYN NBE'] });
    expect(filterTrigger(markup, 'area')).toContain('>الدقي<');
    expect(filterTrigger(markup, 'bank')).toContain('>SYN CIB, SYN NBE<');
    expect(filterTrigger(markup, 'code')).toContain(`>${t('common.filters.all')}<`);
  });
});
