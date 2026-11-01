// «استعاضة معلّقة لحين التحويل» on «سجل العهدة», as the approved samples draw it (hold-2…5c and
// batch 2's b2-hold-*): a held line, a transferred one, a cancelled one; the drawer of each; and the
// two dialogs the head opens from the address (`?confirm=`, `?cancelHeld=`). Rendered to markup
// against a seeded query cache (the suite has no DOM) — the presses themselves are in
// custody-hold-dialogs.spec.tsx.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyLedgerRowDto,
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
const { CustodyLedgerPage } = await import('./CustodyLedgerPage');
const { readSorts, sortQuery } = await import('../lib/table-sort');
const { custodyPlural } = await import('../lib/custody-words');

const STAMP = '2026-10-19T10:00:00.000Z';
const GRANTS = ['fleetCustody.view', 'fleetReceipt.create'];

const row = (over: Partial<FleetCustodyLedgerRowDto>): FleetCustodyLedgerRowDto => ({
  id: 'x',
  op: 'replenish',
  status: 'done',
  date: '2026-09-01',
  dateTo: null,
  letterDate: null,
  amount: 0,
  before: 0,
  after: 0,
  latest: false,
  reason: null,
  from: null,
  to: null,
  memos: { count: 2, kinds: ['fuel', 'wash'] },
  licence: null,
  receipts: null,
  byKind: null,
  memoNos: null,
  transfer: null,
  cancellation: null,
  ...over,
});

const TRANSFER = {
  date: '2026-10-01',
  reference: 'TRF-2026-4471',
  note: '',
  byName: 'مدير الحركة',
  at: '2026-10-01T09:00:00.000Z',
};
const CANCELLATION = {
  reason: 'أُلغي الخطاب ليُعاد إصداره مع مذكرة وقود أكتوبر',
  byName: 'مدير الحركة',
  at: '2026-10-14T08:00:00.000Z',
};

/** Newest first: a held letter on top («الآن»), a cancelled one, a transferred one. */
const ROWS: FleetCustodyLedgerRowDto[] = [
  row({
    id: 'op-h1',
    status: 'held',
    date: '2026-10-19',
    amount: 8476,
    before: 159974.54,
    after: 159974.54,
    latest: true,
  }),
  row({
    id: 'op-x1',
    status: 'cancelled',
    date: '2026-10-12',
    amount: 600,
    before: 164819.54,
    after: 164819.54,
    memos: { count: 1, kinds: ['wash'] },
    cancellation: CANCELLATION,
  }),
  row({
    id: 'op-r1',
    date: '2026-10-01',
    letterDate: '2026-09-29',
    amount: 81908,
    before: 17492,
    after: 99400,
    memos: { count: 5, kinds: ['maintenance', 'fuel', 'tyres'] },
    transfer: TRANSFER,
  }),
];

const FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 159974.54,
  charged: { count: 2, amount: 300000 },
  spent: { count: 126, amount: 97794 },
  replenished: { count: 1, amount: 81908, memos: 5 },
  held: { count: 1, amount: 8476, memos: 2, receipts: 12 },
  cancelled: { count: 1, amount: 600 },
  settled: { count: 1, amount: 124139.46, parts: 3 },
  operations: 6,
  memos: { count: 8, pending: 1, pendingTotal: 5720 },
  outside: [],
};

const memo = (memoId: string, no: number, kind: 'fuel' | 'wash', amount: number) => ({
  memoId,
  no,
  kind,
  name: '',
  from: '2026-10-01',
  to: '2026-10-17',
  receipts: 6,
  amount,
});
const op = (over: Partial<FleetCustodyOperationDto>): FleetCustodyOperationDto => ({
  id: 'op-h1',
  kind: 'replenish',
  status: 'held',
  transfer: null,
  cancellation: null,
  date: '2026-10-19',
  from: '2026-09-07',
  to: '2026-10-17',
  amount: 8476,
  reason: '',
  memos: [memo('m6', 6, 'fuel', 7876), memo('m7', 7, 'wash', 600)],
  parts: [],
  fundBefore: 159974.54,
  chargedTotal: 300000,
  letterFigure: 300000,
  signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
  // The log's place of the letter — the drawer shows the fund NOW instead while it is held.
  ledger: { before: 150000, after: 150000 },
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});
const OPERATIONS: FleetCustodyOperationDto[] = [
  op({}),
  op({
    id: 'op-x1',
    status: 'cancelled',
    date: '2026-10-12',
    amount: 600,
    memos: [memo('m7', 7, 'wash', 600)],
    cancellation: CANCELLATION,
    ledger: { before: 164819.54, after: 164819.54 },
  }),
  op({
    id: 'op-r1',
    status: 'done',
    date: '2026-09-29',
    amount: 81908,
    transfer: TRANSFER,
    ledger: { before: 17492, after: 99400 },
  }),
];

const LIST = { page: 1, pageSize: 25, ...sortQuery(readSorts(null, 'date:desc')) };
const client = (): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(custodyQueryKeys.fund(), FUND);
  qc.setQueryData(custodyQueryKeys.ledger(LIST), {
    items: ROWS,
    meta: { page: 1, pageSize: 25, totalItems: ROWS.length, totalPages: 1 },
  });
  qc.setQueryData(custodyQueryKeys.ledgerTotals({}), { operations: 3, spendLines: 0 });
  qc.setQueryData(custodyQueryKeys.memosOutside(), []);
  for (const operation of OPERATIONS) {
    qc.setQueryData(custodyQueryKeys.operation(operation.id), operation);
  }
  return qc;
};

const page = (path = '/fleet/custody/log', permissions: readonly string[] = GRANTS): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: {
            me: {
              id: 'u-1',
              permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
            } as unknown as MeDto,
            status: 'signedIn' as const,
          },
          ui: { theme: 'light' as const, sidebarOpen: false },
        },
      })}
    >
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/custody/log" element={<CustodyLedgerPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
/** Words compared with every space dropped — the figures sit in tags of their own. */
const flat = (value: string): string => value.replace(/\s/gu, '');
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
const count = (noun: string, n: number): string =>
  ar(`fleet.custody.count.${noun}.${custodyPlural('ar', n)}`, { count: String(n) });
const figure = (value: number): string => formatMoneyParts(value, 'EGP', 'ar').figure;

describe('«سجل العهدة» — a held line', () => {
  const html = page();
  const held = element(html, 'data-ledger-row="op-h1"');

  it('says «معلّقة» under its operation, its amount amber and not counted, the fund unchanged', () => {
    expect(held).toContain('bg-amber-50/70');
    expect(held).toContain('data-ledger-held="true"');
    expect(held).toContain(`title="${ar('fleet.custody.hold.chipTitle')}"`);
    expect(element(held, 'data-ledger-amount="held"')).toContain('border-dashed');
    expect(text(element(held, 'data-ledger-held-amount="8476"'))).toContain(
      ar('fleet.custody.hold.notCounted'),
    );
    expect(text(held)).toContain(ar('fleet.custody.hold.unchanged'));
    expect(text(element(held, 'data-ledger-held-note="op-h1"'))).toBe(
      ar('fleet.custody.hold.waitingSince', { date: '2026/10/19' }),
    );
    // «الآن» stays on it: its «بعدها» is the fund.
    expect(held).toContain('data-ledger-now="true"');
  });

  it('offers «تأكيد التحويل» between the eye and the printer — only to whoever may record it', () => {
    const actions = element(held, 'data-row-actions="custody-ledger"');
    const at = (mark: string): number => actions.indexOf(mark);
    expect(at('data-ledger-view="op-h1"')).toBeLessThan(at('data-ledger-confirm="op-h1"'));
    expect(at('data-ledger-confirm="op-h1"')).toBeLessThan(at('data-ledger-print="op-h1"'));
    expect(text(element(actions, 'data-ledger-confirm="op-h1"'))).toBe(
      ar('fleet.custody.hold.confirm'),
    );
    const reader = page('/fleet/custody/log', ['fleetCustody.view']);
    expect(reader).not.toContain('data-ledger-confirm=');
    expect(element(reader, 'data-ledger-row="op-h1"')).toContain('data-ledger-print="op-h1"');
  });
});

describe('«سجل العهدة» — the tiles', () => {
  it('«استعاضة معلّقة: X» under «إجمالي الاستعاضة» and under «إجمالي العهدة — الآن»', () => {
    const html = page();
    const tiles = element(html, 'data-ledger-figures="true"');
    expect([...tiles.matchAll(/data-ledger-held-line="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'replenished',
      'fund',
    ]);
    expect(flat(text(element(tiles, 'data-ledger-held-line="fund"')))).toBe(
      flat(ar('fleet.custody.hold.heldTile', { amount: figure(8476) })),
    );
    expect(element(tiles, 'data-ledger-held-line="fund"')).toContain(
      `title="${ar('fleet.custody.hold.heldTileNote')}"`,
    );
  });
});

describe('«سجل العهدة» — a transferred and a cancelled line', () => {
  const html = page();

  it('a transferred line sits on its transfer’s day, its letter’s under it, the reference alone', () => {
    const line = element(html, 'data-ledger-row="op-r1"');
    const date = element(line, 'data-ledger-date="transfer"');
    expect(text(date)).toContain('2026/10/01');
    expect(flat(text(date))).toContain(
      flat(ar('fleet.custody.hold.letterOf', { date: '2026/09/29' })),
    );
    const note = element(line, 'data-ledger-transfer-note="op-r1"');
    expect(flat(text(note))).toContain(
      flat(ar('fleet.custody.hold.transferredOn', { date: '2026/10/01' })),
    );
    expect(text(element(note, 'data-ledger-transfer-ref="op-r1"'))).toBe(
      ar('fleet.custody.hold.reference', { ref: 'TRF-2026-4471' }),
    );
    expect(line).not.toContain('data-ledger-held');
  });

  it('a cancelled line is muted «ملغاة», its amount struck through, the eye alone', () => {
    const line = element(html, 'data-ledger-row="op-x1"');
    expect(line).toContain('bg-slate-100/70');
    expect(line).toContain('data-ledger-cancelled="true"');
    expect(element(line, 'data-ledger-amount="cancelled"')).toContain('line-through');
    expect(text(element(line, 'data-ledger-cancelled-note="op-x1"'))).toBe(
      ar('fleet.custody.hold.cancelledTitle'),
    );
    expect(line).toContain('data-ledger-view="op-x1"');
    expect(line).not.toContain('data-ledger-print=');
    expect(line).not.toContain('data-ledger-confirm=');
  });

  it('a phone card says the same — chip, amount, note — and offers the same actions', () => {
    const card = element(html, 'data-ledger-card="op-h1"');
    expect(card).toContain('data-ledger-held="true"');
    expect(card).toContain('data-ledger-amount="held"');
    expect(card).toContain('data-ledger-confirm="op-h1"');
    const gone = element(html, 'data-ledger-card="op-x1"');
    expect(gone).toContain('data-ledger-cancelled="true"');
    expect(gone).not.toContain('data-ledger-print=');
    expect(element(html, 'data-ledger-card="op-r1"')).toContain('data-ledger-date="transfer"');
  });
});

describe('the drawer of a held, a transferred, a cancelled replenishment', () => {
  it('held: the amber note, the fund NOW + the held amount = after the transfer, its two ways out', () => {
    const drawer = element(page('/fleet/custody/log?open=op-h1'), 'data-ledger-details="op-h1"');
    const note = text(element(drawer, 'data-ledger-held-note="true"'));
    expect(flat(note)).toContain(
      flat(ar('fleet.custody.hold.drawerHeldTitle', { date: '2026/10/19' })),
    );
    expect(note).toContain(ar('fleet.custody.hold.drawerHeldNote', { memos: count('memo', 2) }));
    const sum = element(drawer, 'data-ledger-sum="true"');
    const cell = (key: string): string => text(element(sum, `data-ledger-sum-cell="${key}"`));
    // The fund's summary, not the letter's place in the log (150,000.00).
    expect(cell('before')).toContain(ar('fleet.custody.fundForm.before'));
    expect(cell('before')).toContain(figure(159974.54));
    expect(cell('op')).toContain(ar('fleet.custody.hold.changeHeld'));
    expect(cell('after')).toContain(ar('fleet.custody.hold.afterConfirm'));
    expect(cell('after')).toContain(figure(168450.54));
    expect(text(drawer)).toContain(
      ar('fleet.custody.ledger.drawer.intro.replenishHeld', {
        amount: `${figure(8476)} ${formatMoneyParts(8476, 'EGP', 'ar').currency}`,
        memos: ar('fleet.custody.ledger.detail.twoMemosGenitive'),
        kinds: `${ar('fleet.custody.source.fuel')}، ${ar('fleet.custody.source.wash')}`,
        period: ` ${ar('fleet.custody.ledger.detail.period', { from: '2026/09/07', to: '2026/10/17' })}`,
      }).replace(/\s+/gu, ' '),
    );
    expect(drawer).toContain('data-ledger-details-confirm="op-h1"');
    expect(drawer).toContain('data-ledger-details-cancel="op-h1"');
    expect(drawer).toContain('data-ledger-details-print="replenish"');
    expect(drawer).toContain('data-ledger-letter-section="replenish"');
    // The cancel at the footer's other end, the confirm last.
    expect(drawer.indexOf('data-ledger-details-cancel')).toBeLessThan(
      drawer.indexOf('data-ledger-details-print'),
    );
    expect(drawer.indexOf('data-ledger-details-print')).toBeLessThan(
      drawer.indexOf('data-ledger-details-confirm'),
    );
    const reader = page('/fleet/custody/log?open=op-h1', ['fleetCustody.view']);
    expect(reader).not.toContain('data-ledger-details-confirm=');
    expect(reader).not.toContain('data-ledger-details-cancel=');
  });

  it('transferred: the emerald note — when, the reference, who confirmed it — titled by its letter', () => {
    const drawer = element(page('/fleet/custody/log?open=op-r1'), 'data-ledger-details="op-r1"');
    const note = text(element(drawer, 'data-ledger-transfer-note="true"'));
    expect(flat(note)).toContain(
      flat(ar('fleet.custody.hold.reference', { ref: 'TRF-2026-4471' })),
    );
    expect(note).toContain(
      ar('fleet.custody.hold.drawerTransferNote', { by: 'مدير الحركة', letter: '2026/09/29' }),
    );
    expect(flat(text(element(drawer, 'role="dialog"')))).toContain(
      flat(ar('fleet.custody.hold.letterOf', { date: '2026/09/29' })),
    );
    expect(drawer).not.toContain('data-ledger-details-confirm=');
    expect(drawer).not.toContain('data-ledger-details-cancel=');
  });

  it('cancelled: who, when and why; no sum, no letter, no print; its memos greyed; «ملغاة» by the title', () => {
    const drawer = element(page('/fleet/custody/log?open=op-x1'), 'data-ledger-details="op-x1"');
    const note = text(element(drawer, 'data-ledger-cancelled-note="true"'));
    expect(note).toContain(ar('fleet.custody.hold.cancelledTitle'));
    expect(note).toContain(
      ar('fleet.custody.hold.cancelledNote', { by: 'مدير الحركة', date: '2026/10/14' }),
    );
    expect(note).toContain(
      ar('fleet.custody.hold.cancelledReason', { reason: CANCELLATION.reason }),
    );
    expect(drawer).not.toContain('data-ledger-sum=');
    expect(drawer).not.toContain('data-ledger-letter-section=');
    expect(drawer).not.toContain('data-ledger-details-print=');
    expect(drawer).toContain('data-ledger-replenish-muted="true"');
    expect(drawer).toContain('data-ledger-cancelled="true"');
  });
});

describe('the head’s two dialogs, opened from the address', () => {
  it('«تأكيد التحويل»: today’s date (never before the letter’s), the fund now → after, its memos', () => {
    const html = page('/fleet/custody/log?confirm=op-h1');
    const dialog = element(html, 'data-memo-confirm="op-h1"');
    expect(text(dialog)).toContain(
      ar('fleet.custody.hold.confirmSubtitle', { date: '2026/10/19', memos: count('memo', 2) }),
    );
    const date = element(dialog, 'data-memo-confirm-date="true"');
    expect(date).toContain('min="2026-10-19"');
    expect(date).toMatch(/value="\d{4}-\d{2}-\d{2}"/u);
    const result = element(dialog, 'data-memo-confirm-result="true"');
    expect(text(element(result, 'data-fund-cell="before"'))).toContain(figure(159974.54));
    expect(text(element(result, 'data-fund-cell="after"'))).toContain(figure(168450.54));
    const list = element(dialog, 'data-memo-confirm-list="true"');
    expect(list).toContain('data-memo-confirm-row="6"');
    expect(list).toContain('data-memo-confirm-row="7"');
    expect(text(list)).toContain(figure(8476));
  });

  it('«إلغاء الاستعاضة المعلّقة»: what happens, the fund unchanged, an optional reason, «رجوع»', () => {
    const dialog = element(page('/fleet/custody/log?cancelHeld=op-h1'), 'data-memo-cancel="op-h1"');
    expect(text(element(dialog, 'data-memo-cancel-body="true"'))).toBe(
      ar('fleet.custody.hold.cancelBody', { memos: count('memo', 2) }),
    );
    const fund = text(element(dialog, 'data-memo-cancel-fund="159974.54"'));
    expect(fund).toContain(ar('fleet.custody.hold.cancelFund'));
    expect(fund).toContain(figure(159974.54));
    expect(element(dialog, 'data-memo-cancel-reason="true"')).not.toContain('required');
    expect(text(element(dialog, 'data-memo-cancel-save="true"'))).toBe(
      ar('fleet.custody.hold.cancelSave'),
    );
    expect(text(dialog)).toContain(ar('fleet.custody.hold.cancelBack'));
    expect(text(dialog)).toContain(ar('fleet.custody.hold.cancelMemos'));
    expect(element(dialog, 'data-memo-cancel-list="true"')).toContain('data-memo-cancel-row="7"');
  });

  it('neither opens for a reader who may not write custody money', () => {
    for (const param of ['confirm', 'cancelHeld']) {
      const html = page(`/fleet/custody/log?${param}=op-h1`, ['fleetCustody.view']);
      expect(html).not.toContain('data-memo-confirm=');
      expect(html).not.toContain('data-memo-cancel=');
    }
  });
});
