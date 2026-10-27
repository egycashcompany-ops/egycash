// The open boards, one day at a time (2026-10-27): «هنا يظهر فقط الماكينات اللى المفروض يتغذى أو
// يتعمله صيانه في اليوم دا مش عموماً · وتعمل زرار Toggle يظهر اللى … اليوم اللى بعده أو متجدول في
// المستقبل عموماً». These pin, on both boards, as drawn from a cache already holding the board:
//
//   · the board opens on TODAY's rows only, with the live timer; the switch shows tomorrow,
//     everything scheduled ahead, and the earlier days left open — each view counted on its button;
//   · an earlier day's row keeps the close control and the checkbox (D4), as today's does;
//   · the head's «select all» is not drawn until F8 asks for it; the row boxes stay;
//   · only the copy columns take a text selection — bank, code, name, and the schedule time
//     (replenishment) or the open time (maintenance);
//   · the leader edit carries the «الوردية» box, ticked;
//   · Excel and PDF sit above the table.
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
import { formatNumber } from '../../shared/lib/format';
import { ReplenishmentsPage } from './pages/ReplenishmentsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { LeaderField } from './components/ReplenishmentDialogs';
import { atmBoardKeys } from './api/atm-queries';
import { addDays } from './lib/board-day';
import { cairoToday } from './lib/operation-view';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const t = (key: string): string => translate('ar', key);

const DAY = 24 * 3600 * 1000;
const NOW = new Date().toISOString();
const THREE_DAYS_AGO = new Date(Date.now() - 3 * DAY).toISOString();
// Days ahead by the CALENDAR, at Cairo noon: now + 24 h is still today on the 25-hour day Cairo
// leaves summer time.
const cairoNoonIn = (days: number): string =>
  new Date(`${addDays(cairoToday(), days)}T12:00:00+02:00`).toISOString();
const TOMORROW = cairoNoonIn(1);
const IN_FIVE_DAYS = cairoNoonIn(5);

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
  scheduleTime: '10:30',
});

const maint = (id: string, code: string, openedAt: string): AtmMaintenanceDto => ({
  ...common(id, code, openedAt),
  serviceType: 'SYN SERVICE',
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

type Kind = 'replenishments' | 'maintenances';

const renderBoard = (
  kind: Kind,
  rows: (AtmReplenishmentDto | AtmMaintenanceDto)[],
  permissions: readonly string[],
  search = '',
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmBoardKeys.open(kind, { banks: [], areas: [] }), page(rows));
  qc.setQueryData(atmBoardKeys.facets(kind, []), { banks: [], areas: [] });
  const Board = kind === 'replenishments' ? ReplenishmentsPage : MaintenancePage;
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/atm/${kind}${search === '' ? '' : `?${search}`}`]}>
          <Board />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The table's own markup, from its wrapper to its end. */
const table = (markup: string): string => {
  const at = markup.indexOf('data-board-view=');
  expect(at, 'the board table is rendered').toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<div', at), markup.indexOf('</table>', at));
};
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const closeButton = `title="${t('atm.common.close')}"`;
/** One day-view button, from its tag to its end. */
const dayButton = (markup: string, view: string): string => {
  const at = markup.indexOf(`data-board-day="${view}"`);
  expect(at, `the ${view} button is rendered`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('</button>', at));
};

describe.each([
  {
    kind: 'replenishments' as const,
    rows: [
      rep('650000000000000000000a01', '99990001', NOW),
      rep('650000000000000000000a02', '99990002', THREE_DAYS_AGO),
      rep('650000000000000000000a03', '99990003', TOMORROW),
      rep('650000000000000000000a04', '99990004', IN_FIVE_DAYS),
    ],
    keys: [
      'atmReplenishment.view',
      'atmReplenishment.create',
      'atmReplenishment.complete',
      'atmReplenishment.edit',
      'atmReplenishment.delete',
    ],
    complete: 'atmReplenishment.complete',
    copyHeaders: [
      'atm.common.bank',
      'atm.common.machineId',
      'atm.common.machineName',
      'atm.replenishments.scheduleTime',
    ],
    plainHeaders: [
      'atm.common.area',
      'atm.common.openTime',
      'atm.common.leader',
      'atm.common.addedBy',
    ],
  },
  {
    kind: 'maintenances' as const,
    rows: [
      maint('650000000000000000000a05', '99990005', NOW),
      maint('650000000000000000000a06', '99990006', THREE_DAYS_AGO),
      maint('650000000000000000000a07', '99990007', TOMORROW),
      maint('650000000000000000000a08', '99990008', IN_FIVE_DAYS),
    ],
    keys: [
      'atmMaintenance.view',
      'atmMaintenance.create',
      'atmMaintenance.complete',
      'atmMaintenance.edit',
      'atmMaintenance.delete',
    ],
    complete: 'atmMaintenance.complete',
    copyHeaders: [
      'atm.common.bank',
      'atm.common.machineId',
      'atm.common.machineName',
      'atm.common.openTime',
    ],
    plainHeaders: [
      'atm.common.area',
      'atm.maintenance.serviceType',
      'atm.common.leader',
      'atm.common.addedBy',
    ],
  },
])(
  'the $kind board, one day at a time',
  ({ kind, rows, keys, complete, copyHeaders, plainHeaders }) => {
    const [today, earlier, tomorrow, ahead] = rows.map((row) => `>${row.machineCode}<`) as [
      string,
      string,
      string,
      string,
    ];

    it('opens on TODAY only — with the timer, the close control and the row checkbox', () => {
      const board = table(renderBoard(kind, rows, keys));
      expect(board).toContain('data-board-view="today"');
      expect(board).toContain(today);
      for (const other of [earlier, tomorrow, ahead]) expect(board).not.toContain(other);
      expect(board).toContain(`>${t('atm.common.takenTime')}<`);
      expect(count(board, closeButton)).toBe(1);
      expect(board).toContain('type="checkbox"');
    });

    it('switches to tomorrow, to everything scheduled ahead, and to the earlier days left open', () => {
      const onTomorrow = table(renderBoard(kind, rows, keys, 'day=tomorrow'));
      expect(onTomorrow).toContain(tomorrow);
      for (const other of [today, earlier, ahead]) expect(onTomorrow).not.toContain(other);
      // A day not begun has no timer.
      expect(onTomorrow).not.toContain(`>${t('atm.common.takenTime')}<`);

      const onUpcoming = table(renderBoard(kind, rows, keys, 'day=upcoming'));
      expect(onUpcoming).toContain(tomorrow);
      expect(onUpcoming).toContain(ahead);
      for (const other of [today, earlier]) expect(onUpcoming).not.toContain(other);

      const onEarlier = table(renderBoard(kind, rows, keys, 'day=earlier'));
      expect(onEarlier).toContain(earlier);
      for (const other of [today, tomorrow, ahead]) expect(onEarlier).not.toContain(other);
      // D4, kept: an earlier day's open row is closable where it is shown.
      expect(count(onEarlier, closeButton)).toBe(1);
      expect(onEarlier).toContain('type="checkbox"');
    });

    it('counts each view on its button, in the reader’s digits, and presses the one shown', () => {
      const markup = renderBoard(kind, rows, keys);
      const one = `>${formatNumber(1, 'ar')}<`;
      expect(one).toBe('>١<');
      expect(dayButton(markup, 'today')).toContain('aria-pressed="true"');
      expect(dayButton(markup, 'today')).toContain(one);
      expect(dayButton(markup, 'tomorrow')).toContain('aria-pressed="false"');
      expect(dayButton(markup, 'tomorrow')).toContain(one);
      expect(dayButton(markup, 'upcoming')).toContain(`>${formatNumber(2, 'ar')}<`);
      expect(dayButton(markup, 'earlier')).toContain(one);
    });

    it('draws no «select all» until F8 asks for it — the row boxes stay', () => {
      const board = table(renderBoard(kind, rows, keys));
      expect(board).not.toContain('aria-label="select all"');
      expect(board).toContain('aria-label="select row"');
    });

    it('lets only the copy columns take a text selection', () => {
      const board = table(renderBoard(kind, rows, keys));
      expect(board.startsWith('<div class="select-none" data-board-view="today"')).toBe(true);
      // Every body cell of a copy column says so; the cells of the others do not.
      expect(count(board, 'select-text')).toBe(copyHeaders.length);
      for (const header of [...copyHeaders, ...plainHeaders]) expect(board).toContain(t(header));
    });

    it('every text column sorts', () => {
      const board = table(renderBoard(kind, rows, keys));
      for (const header of [...copyHeaders, ...plainHeaders]) {
        expect(board, header).toMatch(new RegExp(`<button type="button"[^>]*>${t(header)}<svg`));
      }
    });

    it('offers Excel and PDF of the view once its rows are in, and a reset only while a filter narrows it', () => {
      const plain = renderBoard(kind, rows, keys);
      expect(plain).toContain('data-export="');
      expect(plain).toContain('data-print="');
      expect(plain).not.toContain('data-board-reset');
      // The day is a view, not a filter — the Fleet day boards' rule.
      expect(renderBoard(kind, rows, keys, 'day=earlier')).not.toContain('data-board-reset');
      // A bank chosen: the reset is offered; its board is still being read, so no file is offered
      // yet — a statement of «nothing» made while loading would read as the truth.
      const narrowed = renderBoard(kind, rows, keys, 'banks=SYN+OTHER');
      expect(narrowed).toContain('data-board-reset');
      expect(narrowed).not.toContain('data-export="');
    });

    it('still hides close from a reader without the complete permission, on every view', () => {
      const without = keys.filter((key) => key !== complete);
      for (const search of ['', 'day=earlier', 'day=upcoming']) {
        expect(count(renderBoard(kind, rows, without, search), closeButton)).toBe(0);
      }
    });
  },
);

describe('the leader field carries the «الوردية» box, ticked by default', () => {
  const field = (shiftWide: boolean, many: boolean): string =>
    renderToStaticMarkup(
      <Provider store={store([])}>
        <LeaderField
          value=""
          onChange={() => undefined}
          shiftWide={shiftWide}
          onShiftWideChange={() => undefined}
          many={many}
        />
      </Provider>,
    );

  it('names the shift beside the label, and says what each state does', () => {
    const ticked = field(true, false);
    expect(ticked).toContain(t('atm.common.leader'));
    expect(ticked).toContain(`${t('atm.common.shift')}</label>`);
    expect(ticked).toMatch(
      /data-leader-shift="true"[^>]*checked=""|checked=""[^>]*data-leader-shift="true"/u,
    );
    expect(ticked).toContain(t('atm.common.leaderShiftHint'));
    expect(field(false, false)).toContain(t('atm.common.leaderRowOnlyHint'));
    expect(field(true, true)).toContain(t('atm.common.leaderShiftManyHint'));
    expect(field(false, true)).toContain(t('atm.common.leaderSelectedOnlyHint'));
  });

  it('in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      for (const key of [
        'atm.common.shift',
        'atm.common.leaderShiftHint',
        'atm.common.leaderShiftManyHint',
        'atm.common.leaderRowOnlyHint',
        'atm.common.leaderSelectedOnlyHint',
      ]) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
    expect(translate('ar', 'atm.common.shift')).toBe('الوردية');
  });
});
