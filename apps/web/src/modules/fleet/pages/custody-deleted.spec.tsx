// «العمليات المحذوفة» — on the owner's approved sample: his 150,000.00 «طلب عهدة» deleted at 09:12 on
// 01/11 (Cairo) because 15,000 was meant, a settlement deleted with the fund going up, a held
// replenishment deleted with the fund unchanged, and a charge deleted with no reason given. The page
// is rendered to markup against a seeded query cache (the suite has no DOM); the drawer opens from
// the address (`?open=<id>`), exactly as a line's eye opens it — in its deleted mode.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyOperationDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatMoneyParts } from '../../../shared/lib/format';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { custodyQueryKeys } = await import('../api/fleet-queries');
const { custodyDeletedKeys } = await import('../api/custody-delete-queries');
const { CustodyDeletedPage } = await import('./CustodyDeletedPage');
const { custodyPlural } = await import('../lib/custody-words');

// ── His deleted operations ───────────────────────────────────────────────────────────────────

const base = {
  status: 'done' as const,
  transfer: null,
  cancellation: null,
  from: null,
  to: null,
  reason: '',
  memos: [],
  parts: [],
  fundBefore: 0,
  chargedTotal: 0,
  letterFigure: null,
  ledger: null,
  version: 1,
};
const DELETED: FleetCustodyOperationDto[] = [
  {
    ...base,
    id: 'op-c1',
    kind: 'charge',
    date: '2026-11-01',
    amount: 150000,
    reason: 'تراخيص',
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.charge,
    // Recorded 09:05, deleted 09:12 — Cairo, UTC+2 in November.
    deletion: {
      reason: 'كُتب المبلغ 150,000 بدلًا من 15,000، فسُجّل الطلب من جديد',
      byName: 'مدير الحركة',
      at: '2026-11-01T07:12:00.000Z',
      fundBefore: 150000,
      fundAfter: 0,
    },
    createdByName: 'محمد حسن',
    createdAt: '2026-11-01T07:05:00.000Z',
    updatedAt: '2026-11-01T07:12:00.000Z',
  },
  {
    ...base,
    id: 'op-s1',
    kind: 'settle',
    date: '2026-10-29',
    amount: 117270.5,
    parts: [
      {
        expenseId: 'lx1',
        part: 'renewal',
        date: '2026-10-29',
        cars: 26,
        codes: ['150'],
        visaTotal: 100000,
        cashTotal: 17270.5,
        amount: 117270.5,
      },
    ],
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.settle,
    letterFigure: 55364.25,
    fundBefore: 55364.25,
    deletion: {
      reason: '',
      byName: 'مدير الحركة',
      // 22:30 UTC on 28/10 — already 29/10 in Cairo (01:30, UTC+3 until the 29th).
      at: '2026-10-28T22:30:00.000Z',
      fundBefore: 55364.25,
      fundAfter: 172634.75,
    },
    createdByName: 'محمد حسن',
    createdAt: '2026-10-28T08:05:00.000Z',
    updatedAt: '2026-10-28T22:30:00.000Z',
  },
  {
    ...base,
    id: 'op-h1',
    kind: 'replenish',
    status: 'held',
    date: '2026-10-26',
    from: '2026-10-16',
    to: '2026-10-25',
    amount: 3660,
    memos: [
      {
        memoId: 'm7',
        no: 7,
        kind: 'maintenance',
        name: '',
        from: '2026-10-16',
        to: '2026-10-25',
        receipts: 4,
        amount: 3660,
      },
    ],
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
    letterFigure: 100000,
    deletion: {
      reason: 'اختيرت مذكرة الصيانة وحدها',
      byName: null,
      at: '2026-10-27T07:15:00.000Z',
      fundBefore: 173383.75,
      fundAfter: 173383.75,
    },
    createdByName: null,
    createdAt: '2026-10-26T10:40:00.000Z',
    updatedAt: '2026-10-27T07:15:00.000Z',
  },
];
const FUND = {
  fundTotal: 150000,
  deleted: { count: 3 },
  held: { count: 0, amount: 0, memos: 0, receipts: 0 },
  operations: 6,
  memos: { count: 6, pending: 0, pendingTotal: 0 },
  outside: [],
} as unknown as FleetCustodyFundSummaryDto;

/** The page's own read, as the address with no filter asks it. */
const LIST = { page: 1, pageSize: 25, sort: 'deletedAt:desc' };

const client = (
  seed: { rows?: FleetCustodyOperationDto[]; params?: Record<string, unknown> } = {},
): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const rows = seed.rows ?? DELETED;
  qc.setQueryData(custodyQueryKeys.fund(), FUND);
  qc.setQueryData(custodyDeletedKeys.list({ ...LIST, ...seed.params }), {
    items: rows,
    meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
  });
  for (const op of rows) qc.setQueryData(custodyDeletedKeys.one(op.id), op);
  return qc;
};

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;

const page = (
  path = '/fleet/custody/log/deleted',
  qc: QueryClient = client(),
  permissions: readonly string[] = [
    'fleetCustody.view',
    'fleetReceipt.create',
    'fleetReceipt.delete',
  ],
): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: { me: me(permissions), status: 'signedIn' as const },
          ui: { theme: 'light' as const, sidebarOpen: false },
        },
      })}
    >
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/custody/log/deleted" element={<CustodyDeletedPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
const element = (html: string, attr: string): string => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/u.exec(html.slice(open))?.[1] ?? 'div';
  let depth = 0;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'gu');
  re.lastIndex = open;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  return html.slice(open);
};
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const LATIN = new Intl.NumberFormat('en-US');
const count = (noun: string, n: number): string =>
  ar(`fleet.custody.count.${noun}.${custodyPlural('ar', n)}`, { count: LATIN.format(n) });
const figure = (value: number): string => formatMoneyParts(value, 'EGP', 'ar').figure;

// ── The table ────────────────────────────────────────────────────────────────────────────────

describe('«العمليات المحذوفة» — the lines', () => {
  it('the columns of the sample, in its order', () => {
    const head = element(page(), '<thead');
    const headers = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map((m) =>
      text(m[1] ?? ''),
    );
    expect(headers).toEqual([
      ar('fleet.custody.deleted.col.deleted'),
      ar('fleet.custody.deleted.col.op'),
      ar('fleet.custody.deleted.col.detail'),
      ar('fleet.custody.deleted.col.amountShort'),
      ar('fleet.custody.deleted.col.fundShort'),
      ar('fleet.custody.deleted.col.recorded'),
      ar('fleet.custody.deleted.col.reason'),
      ar('fleet.vehicles.columns.actions'),
    ]);
  });

  it('one line per deleted operation, in the order the server sent (newest delete first)', () => {
    const html = page();
    const order = [...html.matchAll(/data-deleted-row="([^"]+)"/gu)].map((m) => m[1]);
    expect(order).toEqual(['op-c1', 'op-s1', 'op-h1']);
    expect(text(element(html, 'data-deleted-count="true"'))).toBe(count('operation', 3));
  });

  it('who deleted it and when — Cairo’s date and clock, not UTC’s', () => {
    const line = element(page(), 'data-deleted-row="op-c1"');
    expect(text(line)).toContain('مدير الحركة 2026/11/01 09:12');
    // Recorded by: 09:05 Cairo.
    expect(text(line)).toContain('محمد حسن 2026/11/01 09:05');
    // 22:30 UTC on 28/10 is 01:30 on 29/10 in Cairo.
    expect(text(element(page(), 'data-deleted-row="op-s1"'))).toContain(
      'مدير الحركة 2026/10/29 01:30',
    );
    // Nobody named: a dash, the time still said.
    expect(text(element(page(), 'data-deleted-row="op-h1"'))).toContain('— 2026/10/27 10:15');
  });

  it('the operation’s chip, «محذوفة», and «كانت معلّقة» when it was held', () => {
    const html = page();
    const charge = element(html, 'data-deleted-row="op-c1"');
    expect(charge).toContain('data-ledger-op="charge"');
    expect(text(element(charge, 'data-ledger-deleted-chip="true"'))).toBe(
      ar('fleet.custody.deleted.chip'),
    );
    expect(charge).not.toContain('data-deleted-was=');
    const held = element(html, 'data-deleted-row="op-h1"');
    expect(text(element(held, 'data-deleted-was="held"'))).toBe(
      ar('fleet.custody.deleted.wasHeld'),
    );
  });

  it('its words as the log said them, and its letter’s day', () => {
    const detail = text(element(page(), 'data-deleted-detail="op-c1"'));
    expect(detail).toContain('تراخيص');
    expect(detail).toContain(ar('fleet.custody.hold.letterOf', { date: '2026/11/01' }));
  });

  it('the amount struck through, signed as it moved the fund', () => {
    const html = page();
    // The table's column says «(ج.م.)» once in its head; each figure goes without it.
    const charge = element(
      element(html, 'data-deleted-row="op-c1"'),
      'data-deleted-amount="150000"',
    );
    expect(charge).toContain('line-through');
    expect(text(charge)).toBe(`+${figure(150000)}`);
    expect(
      text(element(element(html, 'data-deleted-row="op-s1"'), 'data-deleted-amount="117270.5"')),
    ).toBe(`−${figure(117270.5)}`);
    // The phone card keeps its unit.
    expect(
      text(element(element(html, 'data-deleted-card="op-c1"'), 'data-deleted-amount="150000"')),
    ).toContain(`+${figure(150000)} `);
  });

  it('the fund just before and just after — one figure, «لم يتغيّر», when nothing moved', () => {
    const html = page();
    // `>` reads `&gt;` in the markup's attribute.
    const charge = text(element(html, 'data-deleted-fund="150000&gt;0"'));
    expect(charge).toContain(ar('fleet.custody.deleted.before'));
    expect(charge).toContain(figure(150000));
    expect(charge).toContain(ar('fleet.custody.deleted.after'));
    expect(charge).toContain(figure(0));
    expect(html).toContain('data-deleted-fund="55364.25&gt;172634.75"');
    const held = text(
      element(element(html, 'data-deleted-row="op-h1"'), 'data-deleted-fund="same"'),
    );
    expect(held).toContain(figure(173383.75));
    expect(held).toContain(ar('fleet.custody.deleted.unchanged'));
  });

  it('why — or «لم يُذكر سبب»', () => {
    const html = page();
    expect(text(element(html, 'data-deleted-reason="op-c1"'))).toBe(
      'كُتب المبلغ 150,000 بدلًا من 15,000، فسُجّل الطلب من جديد',
    );
    expect(text(element(html, 'data-deleted-row="op-s1"'))).toContain(
      ar('fleet.custody.deleted.noReason'),
    );
  });

  it('the eye alone — nothing here prints, confirms, cancels or deletes', () => {
    const html = page();
    const line = element(html, 'data-deleted-row="op-h1"');
    expect(line).toContain('data-deleted-view="op-h1"');
    for (const action of ['data-ledger-print=', 'data-ledger-confirm=', 'data-ledger-delete=']) {
      expect(html).not.toContain(action);
    }
  });

  it('a phone: one card per operation, with the same facts', () => {
    const html = page();
    const cards = element(html, 'data-deleted-cards="true"');
    expect([...cards.matchAll(/data-deleted-card="([^"]+)"/gu)].map((m) => m[1])).toEqual([
      'op-c1',
      'op-s1',
      'op-h1',
    ]);
    const card = text(element(cards, 'data-deleted-card="op-c1"'));
    expect(card).toContain('مدير الحركة 2026/11/01 · 09:12');
    expect(card).toContain('محمد حسن 2026/11/01 · 09:05');
    expect(card).toContain(ar('fleet.custody.deleted.col.reason'));
  });

  // The table that carries loading and failure is hidden on a phone; the phone says them itself.
  const bare = (): QueryClient => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, retryOnMount: false, staleTime: Infinity, refetchOnMount: false },
      },
    });
    qc.setQueryData(custodyQueryKeys.fund(), FUND);
    return qc;
  };

  it('a phone while the list loads: a spinner — not an empty card, not «nothing deleted»', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(custodyQueryKeys.fund(), FUND);
    const html = page('/fleet/custody/log/deleted', qc);
    expect(element(html, 'data-deleted-loading-phone="true"')).toContain('sm:hidden');
    expect(html).not.toContain('data-deleted-cards="true"');
    expect(html).not.toContain('data-deleted-empty-phone="true"');
    expect(html).not.toContain('data-deleted-error-phone="true"');
  });

  it('a phone when the list fails: the failure in words, and a retry', () => {
    const qc = bare();
    qc.getQueryCache()
      .build(qc, { queryKey: custodyDeletedKeys.list(LIST) })
      .setState({ status: 'error', error: new Error('down'), fetchStatus: 'idle' });
    const html = page('/fleet/custody/log/deleted', qc);
    const phone = element(html, 'data-deleted-error-phone="true"');
    expect(phone).toContain('sm:hidden');
    expect(text(phone)).toContain(ar('common.error.title'));
    expect(text(phone)).toContain('down');
    expect(text(phone)).toContain(ar('common.retry'));
    expect(html).not.toContain('data-deleted-cards="true"');
    expect(html).not.toContain('data-deleted-empty-phone="true"');
    expect(html).not.toContain('data-deleted-loading-phone="true"');
  });

  it('a way back to «سجل العهدة», under the fund’s head', () => {
    const html = page();
    const back = element(html, 'data-deleted-back="true"');
    expect(back).toContain('href="/fleet/custody/log"');
    expect(text(back)).toBe(ar('fleet.custody.deleted.back'));
    expect(text(html)).toContain(ar('fleet.custody.deleted.note'));
  });
});

describe('«العمليات المحذوفة» — the filters and the empty face', () => {
  it('asks the server for the filters the address holds — the delete’s Cairo days and the kinds', () => {
    const params = { from: '2026-11-01', to: '2026-11-01', kind: ['charge'] };
    const qc = client({ rows: [DELETED[0] as FleetCustodyOperationDto], params });
    const html = page(
      '/fleet/custody/log/deleted?from=2026-11-01&to=2026-11-01&op=charge,spend',
      qc,
    );
    expect([...html.matchAll(/data-deleted-row="([^"]+)"/gu)].map((m) => m[1])).toEqual(['op-c1']);
  });

  it('nothing deleted yet: what the page will hold — no «0 عمليات»', () => {
    const html = page('/fleet/custody/log/deleted', client({ rows: [] }));
    const empty = text(element(html, 'data-deleted-empty="true"'));
    expect(empty).toContain(ar('fleet.custody.deleted.empty'));
    expect(empty).toContain(ar('fleet.custody.deleted.emptyHint'));
    expect(html).not.toContain('data-deleted-count=');
    expect(text(element(html, 'data-filtered-count'))).toBe('');
  });

  it('nothing under the filters: said so', () => {
    const qc = client({ rows: [], params: { from: '2026-12-01' } });
    const html = page('/fleet/custody/log/deleted?from=2026-12-01', qc);
    expect(text(html)).toContain(ar('fleet.custody.deleted.emptyFiltered'));
    expect(html).not.toContain('data-deleted-empty="true"');
  });
});

// ── The drawer, deleted ──────────────────────────────────────────────────────────────────────

describe('a deleted operation’s drawer', () => {
  it('says who deleted it, when (Cairo) and why, and who had recorded it', () => {
    const html = page('/fleet/custody/log/deleted?open=op-c1');
    const note = text(element(html, 'data-ledger-deleted-note="true"'));
    expect(note).toContain(ar('fleet.custody.deleted.drawerTitle'));
    expect(note).toContain(
      ar('fleet.custody.deleted.drawerDeleted', {
        by: 'مدير الحركة',
        date: '2026/11/01',
        time: '09:12',
      }),
    );
    expect(note).toContain(
      ar('fleet.custody.deleted.drawerRecorded', {
        by: 'محمد حسن',
        date: '2026/11/01',
        time: '09:05',
      }),
    );
    expect(note).toContain(
      ar('fleet.custody.deleted.drawerReason', {
        reason: 'كُتب المبلغ 150,000 بدلًا من 15,000، فسُجّل الطلب من جديد',
      }),
    );
    expect(text(element(html, 'data-ledger-details="op-c1"'))).toContain(
      ar('fleet.custody.deleted.chip'),
    );
  });

  it('the fund before → the delete → after, in place of its place in the log', () => {
    const html = page('/fleet/custody/log/deleted?open=op-s1');
    const sum = element(html, 'data-ledger-deleted-sum="true"');
    expect(text(element(sum, 'data-ledger-deleted-sum-cell="before"'))).toContain(figure(55364.25));
    expect(text(element(sum, 'data-ledger-deleted-sum-cell="effect"'))).toContain(
      `+${figure(117270.5)}`,
    );
    expect(text(element(sum, 'data-ledger-deleted-sum-cell="after"'))).toContain(figure(172634.75));
    expect(html).not.toContain('data-ledger-sum="true"');
    expect(text(element(html, 'data-ledger-deleted-reason="true"'))).toBe(
      ar('fleet.custody.deleted.noReason'),
    );
  });

  it('a held one: «لم يتغيّر» as its effect', () => {
    const sum = element(
      page('/fleet/custody/log/deleted?open=op-h1'),
      'data-ledger-deleted-sum-cell="effect"',
    );
    expect(text(sum)).toContain(ar('fleet.custody.deleted.unchanged'));
  });

  it('its letter as printed, greyed — and nothing to do but read', () => {
    const html = page('/fleet/custody/log/deleted?open=op-c1');
    expect(html).toContain('data-ledger-letter-greyed="true"');
    expect(text(html)).toContain(ar('fleet.custody.deleted.drawerLetter'));
    for (const action of [
      'data-ledger-details-print=',
      'data-ledger-details-confirm=',
      'data-ledger-details-cancel=',
      'data-ledger-details-delete=',
    ]) {
      expect(html).not.toContain(action);
    }
  });
});
