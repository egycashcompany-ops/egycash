// The owner's rule (2026-10-13, port doc OD-1) made an open operation of ANY day block its machine:
// a second open, a reopen and a mail accept are all refused while it stays open. So a row in the
// grey carried-over group — opened on an earlier Cairo day, or still open after midnight — must be
// closable where it is shown. These pin that both live boards give that group the close control
// and the checkbox (D4), and that each table's "select all" stays inside its own group.
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
import { type TableSelection } from '../../shared/ui/useTableSelection';
import { ReplenishmentsPage } from './pages/ReplenishmentsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { groupSelection } from './lib/operation-view';
import { atmBoardKeys } from './api/atm-queries';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const t = (key: string): string => translate('ar', key);

const TODAY = new Date().toISOString();
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

const common = (id: string, code: string, openedAt: string) => ({
  id,
  branchId: '650000000000000000000104',
  machineId: `650000000000000000000b${id.slice(-2)}`,
  machineCode: code,
  bankName: 'SYN BANK',
  machineName: `SYN ${code}`,
  zone: '',
  area: 'SYN AREA',
  openedAt,
  closedAt: null,
  leaderName: null,
  openedByName: 'SYN OPERATOR',
  closedByName: null,
  version: 1,
  createdAt: openedAt,
  updatedAt: openedAt,
});

const rep = (id: string, code: string, openedAt: string): AtmReplenishmentDto => ({
  ...common(id, code, openedAt),
  scheduleTime: null,
});

const maint = (id: string, code: string, openedAt: string): AtmMaintenanceDto => ({
  ...common(id, code, openedAt),
  serviceType: null,
  notes: null,
  referenceNumber: null,
  source: 'manual',
  mailTicketId: null,
  leaderEmployeeId: null,
});

const page = <T,>(items: T[]): Paginated<T> => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const store = (permissions: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const renderBoard = (
  kind: 'replenishments' | 'maintenances',
  rows: (AtmReplenishmentDto | AtmMaintenanceDto)[],
  permissions: readonly string[],
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmBoardKeys.open(kind, { banks: [], areas: [] }), page(rows));
  qc.setQueryData(atmBoardKeys.facets(kind, []), { banks: [], areas: [] });
  const Board = kind === 'replenishments' ? ReplenishmentsPage : MaintenancePage;
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/atm/${kind}`]}>
          <Board />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The markup from the carried-over heading to the end of its table. */
const carriedGroup = (markup: string): string => {
  const at = markup.indexOf(t('atm.replenishments.carriedGroup'));
  expect(at, 'the carried-over group is rendered').toBeGreaterThan(-1);
  return markup.slice(at, markup.indexOf('</table>', at));
};
/** The markup of today's group: from its heading to the end of its table. */
const todayGroup = (markup: string): string => {
  const at = markup.indexOf(t('atm.replenishments.todayGroup'));
  return markup.slice(at, markup.indexOf('</table>', at));
};

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const closeButton = `title="${t('atm.common.close')}"`;

describe.each([
  {
    kind: 'replenishments' as const,
    rows: [
      rep('650000000000000000000a01', '99990001', TODAY),
      rep('650000000000000000000a02', '99990002', THREE_DAYS_AGO),
    ],
    keys: [
      'atmReplenishment.view',
      'atmReplenishment.complete',
      'atmReplenishment.edit',
      'atmReplenishment.delete',
    ],
    complete: 'atmReplenishment.complete',
  },
  {
    kind: 'maintenances' as const,
    rows: [
      maint('650000000000000000000a03', '99990003', TODAY),
      maint('650000000000000000000a04', '99990004', THREE_DAYS_AGO),
    ],
    keys: [
      'atmMaintenance.view',
      'atmMaintenance.complete',
      'atmMaintenance.edit',
      'atmMaintenance.delete',
    ],
    complete: 'atmMaintenance.complete',
  },
])(
  'the $kind board: a carried-over row can be closed where it is shown',
  ({ kind, rows, keys, complete }) => {
    it('offers the close control and the checkbox on the carried-over row, as on today’s', () => {
      const markup = renderBoard(kind, rows, keys);
      const carried = carriedGroup(markup);
      expect(carried).toContain(rows[1]?.machineCode);
      expect(count(carried, closeButton)).toBe(1);
      expect(carried).toContain('type="checkbox"');
      // Today's group is unchanged: its row still closes, its checkbox still there.
      const today = todayGroup(markup);
      expect(today).toContain(rows[0]?.machineCode);
      expect(count(today, closeButton)).toBe(1);
      expect(today).toContain('type="checkbox"');
    });

    it('still hides close from a reader without the complete permission, in both groups', () => {
      const markup = renderBoard(
        kind,
        rows,
        keys.filter((key) => key !== complete),
      );
      expect(count(markup, closeButton)).toBe(0);
    });
  },
);

describe('the carried-over heading no longer says the group cannot be closed', () => {
  it('in both languages', () => {
    expect(translate('en', 'atm.replenishments.carriedGroup')).toBe('Other days (no timer)');
    expect(translate('ar', 'atm.replenishments.carriedGroup')).toBe('أيام أخرى (بدون عدّاد)');
  });
});

describe('one selection, two tables', () => {
  const spy = (): TableSelection & { calls: [readonly string[], boolean][] } => {
    const calls: [readonly string[], boolean][] = [];
    return {
      selectedIds: new Set(),
      toggleRow: () => undefined,
      toggleAll: () => {
        throw new Error('the shared toggleAll would reach the other group');
      },
      toggleMany: (ids, checked) => {
        calls.push([ids, checked]);
      },
      clear: () => undefined,
      ids: [],
      count: 0,
      calls,
    };
  };

  it('a table’s "select all" reaches only its own group; the bulk bar keeps the whole selection', () => {
    const shared = spy();
    const carried = groupSelection(shared, ['c1', 'c2']);
    carried.toggleAll(true);
    carried.toggleAll(false);
    expect(shared.calls).toEqual([
      [['c1', 'c2'], true],
      [['c1', 'c2'], false],
    ]);
    expect(carried.ids).toBe(shared.ids);
    expect(carried.toggleRow).toBe(shared.toggleRow);
  });
});
