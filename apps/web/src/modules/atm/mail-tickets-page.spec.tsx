// /atm/mail-tickets, rendered from a pre-filled query cache the way the data-edit page is pinned
// (data-edit-gating.spec.tsx). It pins:
//
//   · no head «select all» — «عايزك هنا كمان /atm/mail-tickets تلغي الـ Select All» (2026-10-28) —
//     and, unlike the boards, nothing that brings it back; every row keeps its own box;
//   · accept and reject as the ROW's buttons — «في /atm/mail-tickets يكون 2 قبول ورفض» (2026-10-28):
//     always painted, pinned to the row's end, only for a holder of `atmMailTicket.decide`, and on
//     a CHECKED row they speak for every checked row («… المحدد»); the bar is gone;
//   · the filter row — bank, area, code or name, and the red reset — over the WHOLE pending list,
//     narrowed in the browser from the address bar.
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
import { MailTicketsPage } from './pages/MailTicketsPage';
import { atmMailKeys } from './api/atm-queries';
import { MAIL_ROW_PAINT } from './lib/mail-view';
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

const ticket = (
  n: number,
  duplication = false,
  bankName = 'SYN NBE',
  area = 'SYN SMOUHA',
): AtmMailTicketDto => ({
  id: `650000000000000000000e0${String(n)}`,
  branchId: '650000000000000000000201',
  machineId: `650000000000000000000b0${String(n)}`,
  machineCode: `9999000${String(n)}`,
  bankName,
  machineName: `Synthetic ATM 0${String(n)}`,
  area,
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

const TICKETS = [
  ticket(1),
  ticket(2, true, 'SYN NBE', 'SYN RAML'),
  ticket(3, false, 'SYN CIB', 'SYN SMOUHA'),
];
const [ONE, TWO, THREE] = TICKETS as [AtmMailTicketDto, AtmMailTicketDto, AtmMailTicketDto];

const render = (
  permissions: readonly string[],
  picked: readonly string[] = [],
  search = '',
): string => {
  checked = picked;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page: Paginated<AtmMailTicketDto> = {
    items: TICKETS,
    meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: TICKETS.length, totalPages: 1 },
  };
  // The page reads the WHOLE pending list — one cache entry, every page walked into it.
  qc.setQueryData(atmMailKeys.pending(), page);
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
        <MemoryRouter initialEntries={[`/atm/mail-tickets${search === '' ? '' : `?${search}`}`]}>
          <MailTicketsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const DECIDE = ['atmMailTicket.view', 'atmMailTicket.decide'];
const count = (markup: string, needle: string): number => markup.split(needle).length - 1;
const title = (key: string): string => `title="${t(key)}"`;

/** One row's markup, from its `<tr` to its end, found by the machine code it shows. */
const rowOf = (markup: string, code: string): string => {
  const at = markup.indexOf(`>${code}<`);
  expect(at, `the row of ${code} is rendered`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<tr', at), markup.indexOf('</tr>', at));
};

describe('/atm/mail-tickets has no «select all»', () => {
  it('draws no head box, and keeps the head cell so the columns stay in place', () => {
    const markup = render(DECIDE);
    for (const row of TICKETS) expect(markup).toContain(row.machineCode);
    expect(markup).not.toContain('data-table-select-all');
    expect(markup).not.toContain('aria-label="select all"');
    expect(markup).toContain('<th class="w-10 px-4 py-3"></th>');
  });

  it('keeps one box on every row — how one button decides several mails', () => {
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

describe('accept and reject are the row’s buttons', () => {
  it('paints both on every row, all the time, pinned to its end — and draws no bar', () => {
    const markup = render(DECIDE);
    for (const row of TICKETS) {
      const tr = rowOf(markup, row.machineCode);
      expect(count(tr, title('atm.mail.accept'))).toBe(1);
      expect(count(tr, title('atm.mail.reject'))).toBe(1);
      expect(tr).toContain('data-row-actions="always"');
      expect(tr).toContain('sticky end-0');
    }
    expect(markup).not.toContain('data-row-actions="hover"');
    expect(markup).not.toContain('role="toolbar"');
  });

  it('offers neither to a reader without atmMailTicket.decide', () => {
    const markup = render(['atmMailTicket.view'], [ONE.id, TWO.id]);
    for (const key of [
      'atm.mail.accept',
      'atm.mail.reject',
      'atm.mail.acceptSelected',
      'atm.mail.rejectSelected',
    ]) {
      expect(markup).not.toContain(title(key));
    }
    expect(markup).not.toContain('role="toolbar"');
  });

  it('on a CHECKED row speaks for every checked row; on an unchecked row, for that row', () => {
    const markup = render(DECIDE, [ONE.id, TWO.id]);
    for (const row of [ONE, TWO]) {
      const tr = rowOf(markup, row.machineCode);
      expect(tr).toContain(title('atm.mail.acceptSelected'));
      expect(tr).toContain(title('atm.mail.rejectSelected'));
      expect(tr).toContain('checked=""');
    }
    const unchecked = rowOf(markup, THREE.machineCode);
    expect(unchecked).toContain(title('atm.mail.accept'));
    expect(unchecked).toContain(title('atm.mail.reject'));
    expect(unchecked).not.toContain('checked=""');
  });

  it('one checked row is just that row — its buttons keep their plain names', () => {
    const markup = render(DECIDE, [ONE.id]);
    expect(markup).not.toContain(title('atm.mail.acceptSelected'));
    expect(count(markup, title('atm.mail.accept'))).toBe(TICKETS.length);
  });

  it('sends a button’s targets through the boards’ own rule (`actionTargets`)', () => {
    // The click itself needs a DOM; the rule it runs is `actionTargets`, pinned in
    // `lib/operation-view.spec.ts`. This pins that both buttons run it over the checked rows.
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './pages/MailTicketsPage.tsx'),
      'utf8',
    );
    expect(source).toContain('actionTargets(row, selectedRows)');
    expect(source).toContain('onClick={() => setAccepting(targetIds(row))}');
    expect(source).toContain('onClick={() => setRejecting(targetIds(row))}');
    expect(source).not.toContain('BulkActionBar');
  });

  it('paints a duplicate row yellow to its end — the pinned buttons’ cell included', () => {
    const markup = render(DECIDE);
    // The markup escapes the `&` and `>` of the child selector inside the class attribute.
    const asAttribute = (classes: string): string =>
      classes.replace(/&/g, '&amp;').replace(/>/g, '&gt;');
    expect(rowOf(markup, TWO.machineCode)).toContain(asAttribute(MAIL_ROW_PAINT.duplicate));
    expect(rowOf(markup, ONE.machineCode)).not.toContain('bg-yellow-50');
    expect(MAIL_ROW_PAINT.duplicate).toContain('[&>td:last-child]:bg-yellow-50');
  });
});

describe('the filter row', () => {
  it('offers the bank, the area and a code-or-name search — and no reset while nothing narrows', () => {
    const markup = render(DECIDE);
    expect(markup).toContain(`>${t('atm.common.bank')}<`);
    expect(markup).toContain(`>${t('atm.common.area')}<`);
    expect(markup).toContain(`placeholder="${t('atm.mail.search')}"`);
    expect(markup).not.toContain('data-board-reset');
  });

  it('narrows the whole list in the browser from the address bar, and offers the reset', () => {
    const byCode = render(DECIDE, [], 'q=99990003');
    expect(byCode).toContain('>99990003<');
    expect(byCode).not.toContain('>99990001<');
    expect(byCode).toContain('data-board-reset');

    const byName = render(DECIDE, [], 'q=synthetic+atm+02');
    expect(byName).toContain('>99990002<');
    expect(byName).not.toContain('>99990003<');

    const byBank = render(DECIDE, [], 'banks=SYN+NBE');
    expect(byBank).toContain('>99990001<');
    expect(byBank).toContain('>99990002<');
    expect(byBank).not.toContain('>99990003<');

    const byBoth = render(DECIDE, [], 'banks=SYN+NBE&areas=SYN+SMOUHA');
    expect(byBoth).toContain('>99990001<');
    expect(byBoth).not.toContain('>99990002<');
    expect(byBoth).not.toContain('>99990003<');
  });

  it('says the filters matched nothing, rather than that nothing is pending', () => {
    const markup = render(DECIDE, [], 'q=nothing+like+it');
    expect(markup).toContain(t('atm.mail.emptyFiltered'));
    expect(markup).not.toContain(t('atm.mail.empty'));
  });

  it('keeps a checked row the filters hide out of what a button acts on', () => {
    // Row 1 checked, then filtered away: row 2's buttons are plain — the selection is the rows
    // on screen, so a hidden mail is never decided unseen.
    const markup = render(DECIDE, [ONE.id, TWO.id], 'areas=SYN+RAML');
    expect(markup).not.toContain('>99990001<');
    expect(rowOf(markup, TWO.machineCode)).toContain(title('atm.mail.accept'));
    expect(markup).not.toContain(title('atm.mail.acceptSelected'));
  });

  it('keeps the filters in place: only the table scrolls, under a head that stays', () => {
    const markup = render(DECIDE);
    expect(markup).toContain('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto');
    expect(markup).toContain('h-full overflow-auto');
    expect(markup).toContain('<thead class="sticky top-0 z-10">');
  });
});
