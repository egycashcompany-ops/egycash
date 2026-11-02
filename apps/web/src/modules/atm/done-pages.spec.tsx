// The two done pages — /atm/replenishments/done and /atm/maintenance/done — rendered from a
// pre-filled query cache. They pin, from 2026-11-02:
//
//   · the range and its Excel/PDF on the title's line — «عايز تطلع الصف بتاع الـ Form يبقي بجانب
//     العنوان عشان نستفيد بالمساحة»;
//   · a box under every text column — «فلتر لكل عمود» — that narrows the range's rows before the
//     reader's order, and says so when it hides every row.
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

/** The column boxes' state — a static render cannot type into them. Empty unless a test sets it. */
let columnValues: Record<string, string> = {};
vi.mock('../../shared/ui/useColumnFilters', () => ({
  useColumnFilters: () => ({
    values: columnValues,
    set: () => {},
    clear: () => {},
    active: Object.values(columnValues).some((value) => value.trim() !== ''),
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

const render = (kind: 'replenishments' | 'maintenances', values: Record<string, string> = {}) => {
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
const codesShown = (markup: string): string[] =>
  [...markup.matchAll(/>(9999\d{4})</g)].map((m) => m[1] as string);

describe.each(['replenishments', 'maintenances'] as const)('the %s done page', (kind) => {
  it('puts the range and its files on the title’s line', () => {
    const markup = render(kind);
    const header = markup.slice(markup.indexOf('<h1'), markup.indexOf('<table'));
    expect(header).toContain('data-page-toolbar="true"');
    expect(header).toContain('type="date"');
    expect(header).toContain('data-export="');
  });

  it('draws a box under every text column — none for the reopen button', () => {
    const columns =
      kind === 'replenishments'
        ? replenishmentColumns(t, 'ar', 'done')
        : maintenanceColumns(t, 'ar', 'done');
    const boxes = [...render(kind).matchAll(/data-column-filter="([^"]+)"/g)].map((m) => m[1]);
    expect(boxes).toEqual(columns.map((column) => column.key));
    expect(boxes).not.toContain('actions');
  });

  it('narrows the rows, the boxes adding up, and says so when none is left', () => {
    expect(codesShown(render(kind))).toEqual(['99990301', '99990302', '99990303']);
    expect(codesShown(render(kind, { area: 'دقي' }))).toEqual(['99990301', '99990303']);
    expect(codesShown(render(kind, { area: 'دقي', bank: 'CIB' }))).toEqual(['99990303']);
    const none = render(kind, { code: '12345678' });
    expect(codesShown(none)).toEqual([]);
    expect(none).toContain(t('atm.common.emptyColumnFiltered'));
    expect(render(kind)).not.toContain(t('atm.common.emptyColumnFiltered'));
  });
});
