// /atm/mail-tickets, rendered from a pre-filled query cache the way the data-edit page is pinned
// (data-edit-gating.spec.tsx). It pins:
//
//   · no head «select all» until F8 asks for it, as on the boards — «في رسائل الصيانة
//     /atm/mail-tickets عايزك تزود موضوع الـ Select All من خلال F8» (2026-11-02; on 2026-10-28 it
//     had been removed outright); every row keeps its own box;
//   · (2026-11-02) the filter row on the title's line, and a filter under every text column —
//     «فلتر لكل عمود», then «لأ عايز الفلتر الكبير اللى فوق الجداول يكون Drop Down بـ Multi
//     select»: a multi-select list of the values the column's cells show, that narrows the rows the
//     filters kept (a cell that IS one of the picks; the columns adding up) — the selection follows
//     what is shown;
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

/** Whether F8 has revealed the head box — the suite has no keyboard to press it with. */
let revealed = false;
vi.mock('./lib/select-all-reveal', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./lib/select-all-reveal');
  return { ...actual, useSelectAllReveal: (enabled: boolean) => enabled && revealed };
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
const title = (key: string): string => `title="${t(key)}"`;

/** One row's markup, from its `<tr` to its end, found by the machine code it shows. */
const rowOf = (markup: string, code: string): string => {
  const at = markup.indexOf(`>${code}<`);
  expect(at, `the row of ${code} is rendered`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<tr', at), markup.indexOf('</tr>', at));
};

describe('/atm/mail-tickets has «select all» on F8 only', () => {
  it('draws no head box until F8, and keeps the head cell so the columns stay in place', () => {
    const markup = render(DECIDE);
    for (const row of TICKETS) expect(markup).toContain(row.machineCode);
    expect(markup).not.toContain('data-table-select-all');
    expect(markup).not.toContain('aria-label="select all"');
    expect(markup).toContain('<th class="w-10 px-4 py-3"></th>');
  });

  it('keeps one box on every row — how one button decides several mails', () => {
    expect(count(render(DECIDE), 'aria-label="select row"')).toBe(TICKETS.length);
  });

  it('F8 draws the head box, as on the boards — never while a decision is being confirmed', () => {
    revealed = true;
    try {
      const markup = render(DECIDE);
      expect(markup).toContain('data-table-select-all="true"');
      expect(markup).toContain('aria-label="select all"');
      expect(count(markup, 'aria-label="select row"')).toBe(TICKETS.length);
    } finally {
      revealed = false;
    }
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './pages/MailTicketsPage.tsx'),
      'utf8',
    );
    expect(source).toContain('useSelectAllReveal(accepting === null && rejecting === null)');
    expect(source).toContain('selectAll={selectAllShown}');
    expect(source).not.toContain('selectAll={false}');
  });
});

describe('the filter row on the title’s line, and a filter list under every column (2026-11-02)', () => {
  const withPicks = (values: Record<string, string[]>, picked: readonly string[] = []): string => {
    columnValues = values;
    try {
      return render(DECIDE, picked);
    } finally {
      columnValues = {};
    }
  };
  /** The codes the rows show — the body only: the filter row's triggers name what is picked. */
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

  it('puts the bank, area, search and reset in the header’s toolbar', () => {
    const toolbar = toolbarOf(render(DECIDE));
    expect(toolbar).toContain(`>${t('atm.common.bank')}<`);
    expect(toolbar).toContain(`>${t('atm.common.area')}<`);
    expect(toolbar).toContain(`placeholder="${t('atm.mail.search')}"`);
    // The reset sits there too, lit while a column filter narrows the list.
    expect(toolbarOf(withPicks({ bank: ['SYN CIB'] }))).toContain('data-board-reset');
  });

  it('draws a filter list under every text column — none for the buttons', () => {
    const markup = render(DECIDE);
    const headers: [string, string][] = [
      ['bank', 'atm.common.bank'],
      ['code', 'atm.common.machineId'],
      ['name', 'atm.common.machineName'],
      ['issue', 'atm.mail.issue'],
      ['area', 'atm.common.area'],
      ['received', 'atm.mail.receivedAt'],
      ['sender', 'atm.mail.sender'],
    ];
    const lists = [...markup.matchAll(/data-column-filter="([^"]+)"/g)].map((m) => m[1]);
    expect(lists).toEqual(headers.map(([key]) => key));
    for (const [key, header] of headers) {
      // A drop-down, named for its column, saying «الكل» while nothing is picked.
      const trigger = filterTrigger(markup, key);
      expect(trigger).toContain('aria-haspopup="listbox"');
      expect(trigger).toContain(
        `aria-label="${translate('ar', 'atm.common.filterColumn', { column: t(header) })}"`,
      );
      expect(trigger).toContain(`>${t('common.filters.all')}<`);
      expect(trigger).not.toContain('<input');
    }
  });

  it('narrows the rows to the values picked, matching what the cell shows — «مكررة» included', () => {
    expect(codesShown(withPicks({ bank: ['SYN CIB'] }))).toEqual([THREE.machineCode]);
    // The duplicate's issue reads with its badge: a value of its own in the list.
    expect(codesShown(withPicks({ issue: [`CASH OUT ${t('atm.mail.duplicate')}`] }))).toEqual([
      TWO.machineCode,
    ]);
    expect(codesShown(withPicks({ issue: ['CASH OUT'] }))).toEqual([
      ONE.machineCode,
      THREE.machineCode,
    ]);
    // Two values in one column: a row whose cell is either.
    expect(codesShown(withPicks({ code: [ONE.machineCode, THREE.machineCode] }))).toEqual([
      ONE.machineCode,
      THREE.machineCode,
    ]);
    // Two columns: a row both keep.
    expect(codesShown(withPicks({ bank: ['SYN NBE'], area: ['SYN RAML'] }))).toEqual([
      TWO.machineCode,
    ]);
    expect(codesShown(withPicks({ bank: ['SYN CIB', 'SYN NBE'], area: ['SYN SMOUHA'] }))).toEqual([
      ONE.machineCode,
      THREE.machineCode,
    ]);
    // A pick is the whole cell, not a part of it.
    expect(codesShown(withPicks({ bank: ['CIB'] }))).toEqual([]);
  });

  it('names what is picked on the list’s trigger', () => {
    const markup = withPicks({ bank: ['SYN CIB', 'SYN NBE'], area: ['SYN SMOUHA'] });
    expect(filterTrigger(markup, 'bank')).toContain('>SYN CIB, SYN NBE<');
    expect(filterTrigger(markup, 'area')).toContain('>SYN SMOUHA<');
    expect(filterTrigger(markup, 'code')).toContain(`>${t('common.filters.all')}<`);
  });

  it('decides only what is shown: a checked row the column filters hide drops out of the selection', () => {
    // ONE and THREE checked; the bank's pick hides ONE — THREE's buttons speak for itself alone.
    const markup = withPicks({ bank: ['SYN CIB'] }, [ONE.id, THREE.id]);
    expect(rowOf(markup, THREE.machineCode)).toContain(title('atm.mail.accept'));
    expect(rowOf(markup, THREE.machineCode)).not.toContain(title('atm.mail.acceptSelected'));
  });

  it('the reset clears the column filters with the filters', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './pages/MailTicketsPage.tsx'),
      'utf8',
    );
    const reset = source.slice(source.indexOf('<BoardResetButton'));
    expect(reset.slice(0, reset.indexOf('/>'))).toContain('columnFilters.clear();');
  });

  it('lights the reset, and says so when the column filters hide every row', () => {
    // A code no row has: the list would never offer it, but a pick left from before can remain.
    const none = withPicks({ code: ['99990009'] });
    expect(codesShown(none)).toEqual([]);
    expect(none).toContain(t('atm.common.emptyColumnFiltered'));
    expect(none).toContain('data-board-reset');
    expect(render(DECIDE)).not.toContain(t('atm.common.emptyColumnFiltered'));
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

  it('keeps a CHECKED duplicate row yellow to its end — the boards’ tint does not take the pinned cell', () => {
    // A checked row carries the boards' tint, laid on the pinned cell as an image keyed on
    // `data-selected`; the duplicate paint answers that state on the same cell, in both themes,
    // with a more specific rule — so bulk-rejecting the duplicates leaves no off-colour block.
    const asAttribute = (classes: string): string =>
      classes.replace(/&/g, '&amp;').replace(/>/g, '&gt;');
    const row = rowOf(render(DECIDE, [TWO.id]), TWO.machineCode);
    expect(row).toContain('data-selected="true"');
    expect(row).toContain(asAttribute(MAIL_ROW_PAINT.duplicate));
    expect(MAIL_ROW_PAINT.duplicate).toContain('[&[data-selected=true]>td:last-child]:bg-none');
    expect(MAIL_ROW_PAINT.duplicate).toContain(
      'dark:[&[data-selected=true]>td:last-child]:bg-[image:linear-gradient(rgb(66_32_6/0.3),rgb(66_32_6/0.3))]',
    );
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
