// /atm/mail-tickets without the head's «select all» — the owner (2026-10-28): «عايزك هنا كمان
// /atm/mail-tickets تلغي الـ Select All». Rendered from a pre-filled query cache, the way the
// data-edit page is pinned (data-edit-gating.spec.tsx). It pins what was taken away and what must
// survive it:
//   · no head box — and, unlike the boards, nothing that brings it back; the head keeps an empty
//     cell, so the columns stay where they were;
//   · every row keeps its own box: checking rows is the only way a mail is decided;
//   · a checked row still brings up the accept/reject bar for a holder of `atmMailTicket.decide`.
//
// Every code below is synthetic.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  type AtmMailTicketDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { MailTicketsPage } from './pages/MailTicketsPage';
import type * as SelectionModule from '../../shared/ui/useTableSelection';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

/** The rows a test has checked — the suite has no DOM to click them in. */
let checked: readonly string[] = [];
vi.mock('../../shared/ui/useTableSelection', async () => {
  const actual = await vi.importActual<typeof SelectionModule>('../../shared/ui/useTableSelection');
  return {
    ...actual,
    useTableSelection: (rowIds: string[]): SelectionModule.TableSelection => {
      const real = actual.useTableSelection(rowIds);
      const ids = rowIds.filter((id) => checked.includes(id));
      return { ...real, ids, selectedIds: new Set(ids), count: ids.length };
    },
  };
});

const t = (key: string): string => translate('ar', key);
const STAMP = '2026-10-28T08:00:00.000Z';

const ticket = (n: number, duplication = false): AtmMailTicketDto => ({
  id: `650000000000000000000e0${String(n)}`,
  branchId: '650000000000000000000201',
  machineId: `650000000000000000000b0${String(n)}`,
  machineCode: `9999000${String(n)}`,
  bankName: 'SYN BANK',
  machineName: `Synthetic ATM 0${String(n)}`,
  area: 'SYN AREA',
  receivedAt: STAMP,
  status: 'pending',
  issueText: 'CASH OUT',
  senderEmail: 'sender@example.com',
  foundInMaster: true,
  duplication,
  actionByName: null,
  actionAt: null,
  providerMessageId: `syn-${String(n)}`,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
});

const TICKETS = [ticket(1), ticket(2, true), ticket(3)];

const render = (permissions: readonly string[], picked: readonly string[] = []): string => {
  checked = picked;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page: Paginated<AtmMailTicketDto> = {
    items: TICKETS,
    meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: TICKETS.length, totalPages: 1 },
  };
  qc.setQueryData(
    listKey('atm', 'mailTickets', { kind: 'pending', pageSize: MAX_PAGE_SIZE }),
    page,
  );
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
        <MemoryRouter initialEntries={['/atm/mail-tickets']}>
          <MailTicketsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const DECIDE = ['atmMailTicket.view', 'atmMailTicket.decide'];
const count = (markup: string, needle: string): number => markup.split(needle).length - 1;

describe('/atm/mail-tickets has no «select all»', () => {
  it('draws no head box, and keeps the head cell so the columns stay in place', () => {
    const markup = render(DECIDE);
    for (const row of TICKETS) expect(markup).toContain(row.machineCode);
    expect(markup).not.toContain('data-table-select-all');
    expect(markup).not.toContain('aria-label="select all"');
    expect(markup).toContain('<th class="w-10 px-4 py-3"></th>');
  });

  it('keeps one box on every row — the way a mail is chosen', () => {
    expect(count(render(DECIDE), 'aria-label="select row"')).toBe(TICKETS.length);
  });

  it('nothing on the page brings the head box back (the boards’ F8 reveal is theirs alone)', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './pages/MailTicketsPage.tsx'),
      'utf8',
    );
    expect(source).toContain('selectAll={false}');
    expect(source).not.toContain('useSelectAllReveal');
  });
});

describe('a checked mail is still decided from the bar', () => {
  it('offers accept and reject to a holder of atmMailTicket.decide', () => {
    const markup = render(DECIDE, [TICKETS[0]?.id ?? '']);
    expect(markup).toContain('role="toolbar"');
    expect(count(markup, `>${t('atm.mail.accept')}</button>`)).toBe(1);
    expect(count(markup, `>${t('atm.mail.reject')}</button>`)).toBe(1);
    expect(count(markup, 'checked=""')).toBe(1);
  });

  it('shows the count but no decision without the key', () => {
    const markup = render(['atmMailTicket.view'], [TICKETS[0]?.id ?? '']);
    expect(markup).toContain('role="toolbar"');
    expect(count(markup, `>${t('atm.mail.accept')}</button>`)).toBe(0);
    expect(count(markup, `>${t('atm.mail.reject')}</button>`)).toBe(0);
  });

  it('shows no bar while nothing is checked', () => {
    expect(render(DECIDE)).not.toContain('role="toolbar"');
  });
});
