// /atm/mail-tickets/log, rendered from a pre-filled query cache — «في /atm/mail-tickets/log إسترجاع
// ويقدر يرجعه مفتوح لو قبل أو رفض غلط» and «عايز فلتر» (2026-10-28). It pins:
//
//   · «استرجاع» on an ACCEPTED or REJECTED row only — a pending mail has nothing to go back from —
//     always painted, pinned to the row's end, and only for a holder of `atmMailTicket.decide`;
//   · the filter row: the range and the status select beside it, the pending page's bank, area and
//     code-or-name narrowing, the red reset — over the range read WHOLE, narrowed in the browser;
//   · a range too long to read whole says so, as the done pages do;
//   · the board frame, and the outcome's paint reaching the pinned button's cell.
//
// Every code below is synthetic.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  type AtmMailTicketDto,
  type AtmMailTicketStatus,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { MailLogPage } from './pages/MailLogPage';
import { atmMailKeys } from './api/atm-queries';
import { cairoToday } from './lib/operation-view';
import { MAX_BOARD_PAGES } from './lib/whole-board';
import { MAIL_ROW_PAINT } from './lib/mail-view';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const t = (key: string): string => translate('ar', key);
const STAMP = '2026-10-28T08:00:00.000Z';

const ticket = (
  n: number,
  status: AtmMailTicketStatus,
  bankName = 'SYN NBE',
  area = 'SYN SMOUHA',
): AtmMailTicketDto => ({
  id: `650000000000000000000f0${String(n)}`,
  branchId: '650000000000000000000201',
  machineId: `650000000000000000000b0${String(n)}`,
  machineCode: `9999100${String(n)}`,
  bankName,
  machineName: `Synthetic ATM 1${String(n)}`,
  area,
  receivedAt: STAMP,
  status,
  issueText: 'CASH OUT',
  senderEmail: 'sender@example.com',
  foundInMaster: true,
  duplication: false,
  actionByName: status === 'pending' ? null : 'SYN OPERATOR',
  actionAt: status === 'pending' ? null : STAMP,
  providerMessageId: `syn-log-${String(n)}`,
  version: 2,
  createdAt: STAMP,
  updatedAt: STAMP,
});

const PENDING = ticket(1, 'pending');
const ACCEPTED = ticket(2, 'accepted', 'SYN NBE', 'SYN RAML');
const REJECTED = ticket(3, 'rejected', 'SYN CIB', 'SYN SMOUHA');
const TICKETS = [PENDING, ACCEPTED, REJECTED];

const render = (
  permissions: readonly string[],
  search = '',
  totalPages = 1,
  range = { from: cairoToday(), to: cairoToday() },
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page: Paginated<AtmMailTicketDto> = {
    items: TICKETS,
    meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: TICKETS.length, totalPages },
  };
  // The page reads its range WHOLE — today's unless told otherwise — one cache entry, every page
  // walked into it. A page asking for any other range finds nothing here and shows no row.
  qc.setQueryData(atmMailKeys.log(range), page);
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'branch'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter
          initialEntries={[`/atm/mail-tickets/log${search === '' ? '' : `?${search}`}`]}
        >
          <MailLogPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const DECIDE = ['atmMailTicket.viewLog', 'atmMailTicket.decide'];
const count = (markup: string, needle: string): number => markup.split(needle).length - 1;
const restoreButton = `title="${t('atm.mail.restore')}"`;

/** One row's markup, from its `<tr` to its end, found by the machine code it shows. */
const rowOf = (markup: string, code: string): string => {
  const at = markup.indexOf(`>${code}<`);
  expect(at, `the row of ${code} is rendered`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<tr', at), markup.indexOf('</tr>', at));
};

describe('«استرجاع» on the log', () => {
  it('is on the accepted and the rejected rows only — never on a pending one', () => {
    const markup = render(DECIDE);
    expect(count(markup, restoreButton)).toBe(2);
    expect(rowOf(markup, ACCEPTED.machineCode)).toContain(restoreButton);
    expect(rowOf(markup, REJECTED.machineCode)).toContain(restoreButton);
    expect(rowOf(markup, PENDING.machineCode)).not.toContain(restoreButton);
  });

  it('is painted all the time and pinned to the row’s end, as the boards’ buttons are', () => {
    const markup = render(DECIDE);
    for (const row of TICKETS) {
      const tr = rowOf(markup, row.machineCode);
      expect(tr).toContain('data-row-actions="always"');
      expect(tr).toContain('sticky end-0');
    }
    expect(markup).not.toContain('data-row-actions="hover"');
  });

  it('is not offered to a reader without atmMailTicket.decide', () => {
    expect(count(render(['atmMailTicket.viewLog']), restoreButton)).toBe(0);
  });

  it('keeps the outcome’s paint across the whole row, the pinned button’s cell included', () => {
    const markup = render(DECIDE);
    // The markup escapes the `&` and `>` of the child selector inside the class attribute.
    const asAttribute = (classes: string): string =>
      classes.replace(/&/g, '&amp;').replace(/>/g, '&gt;');
    expect(rowOf(markup, ACCEPTED.machineCode)).toContain(asAttribute(MAIL_ROW_PAINT.accepted));
    expect(rowOf(markup, REJECTED.machineCode)).toContain(asAttribute(MAIL_ROW_PAINT.rejected));
    expect(rowOf(markup, PENDING.machineCode)).not.toContain('[&amp;&gt;td:last-child]');
  });
});

describe('the log’s filter row', () => {
  it('sets a status select beside the range — all, pending, accepted, rejected', () => {
    const markup = render(DECIDE);
    expect(markup).toContain(`>${t('atm.done.from')}<`);
    expect(markup).toContain(`>${t('atm.done.to')}<`);
    const at = markup.indexOf('id="mail-log-status"');
    expect(at, 'the status select is rendered').toBeGreaterThan(-1);
    const select = markup.slice(markup.lastIndexOf('<select', at), markup.indexOf('</select>', at));
    expect(select).toContain('<option value="all" selected="">الكل</option>');
    for (const status of ['pending', 'accepted', 'rejected'] as const) {
      expect(select).toContain(
        `<option value="${status}">${t(`atm.mail.status.${status}`)}</option>`,
      );
    }
  });

  it('offers the pending page’s bank, area and search — and no reset while nothing narrows', () => {
    const markup = render(DECIDE);
    expect(markup).toContain(`>${t('atm.common.bank')}<`);
    expect(markup).toContain(`>${t('atm.common.area')}<`);
    expect(markup).toContain(`placeholder="${t('atm.mail.search')}"`);
    expect(markup).not.toContain('data-board-reset');
  });

  it('narrows the range in the browser by status, bank, area and code — and offers the reset', () => {
    const accepted = render(DECIDE, 'status=accepted');
    expect(accepted).toContain(`>${ACCEPTED.machineCode}<`);
    expect(accepted).not.toContain(`>${PENDING.machineCode}<`);
    expect(accepted).not.toContain(`>${REJECTED.machineCode}<`);
    expect(accepted).toContain('<option value="accepted" selected="">');
    expect(accepted).toContain('data-board-reset');

    const cib = render(DECIDE, 'banks=SYN+CIB');
    expect(cib).toContain(`>${REJECTED.machineCode}<`);
    expect(cib).not.toContain(`>${ACCEPTED.machineCode}<`);

    const raml = render(DECIDE, 'areas=SYN+RAML');
    expect(raml).toContain(`>${ACCEPTED.machineCode}<`);
    expect(raml).not.toContain(`>${REJECTED.machineCode}<`);

    const code = render(DECIDE, `q=${PENDING.machineCode}`);
    expect(code).toContain(`>${PENDING.machineCode}<`);
    expect(code).not.toContain(`>${ACCEPTED.machineCode}<`);
  });

  it('says the filters matched nothing, rather than that the range is empty', () => {
    const markup = render(DECIDE, 'status=rejected&banks=SYN+NBE');
    expect(markup).toContain(t('atm.mail.emptyFiltered'));
    expect(markup).not.toContain(t('atm.mail.logEmpty'));
  });

  it('reads the range as the done pages do: a cleared date takes the other, a reversed one is put in order', () => {
    // A box cleared in the browser leaves `from=` behind — read as the other day, never sent.
    const cleared = render(DECIDE, `from=&to=${cairoToday()}`);
    expect(cleared).toContain(`>${ACCEPTED.machineCode}<`);
    const reversed = render(DECIDE, 'from=2026-10-28&to=2026-10-01', 1, {
      from: '2026-10-01',
      to: '2026-10-28',
    });
    expect(reversed).toContain(`>${ACCEPTED.machineCode}<`);
    expect(reversed).toContain('value="2026-10-01"');
  });

  it('says so when the range is too long to read whole, as the done pages do', () => {
    expect(render(DECIDE)).not.toContain('data-done-cut-short');
    expect(render(DECIDE, '', MAX_BOARD_PAGES + 1)).toContain('data-done-cut-short="true"');
  });

  it('keeps the range and the filters in place: only the table scrolls, under a head that stays', () => {
    const markup = render(DECIDE);
    expect(markup).toContain('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto');
    expect(markup).toContain('h-full overflow-auto');
    expect(markup).toContain('<thead class="sticky top-0 z-10">');
  });
});
