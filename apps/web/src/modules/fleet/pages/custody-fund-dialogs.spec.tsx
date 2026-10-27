// «استعاضة العهدة», «تسوية العهدة», «طلب عهدة» (was «شحن العهدة») — the fund's three dialogs, as the
// approved samples draw them, on the API's real answers. They open on SCREEN 1 «العهدة» — the head
// over «سجل العهدة», «المذكرات» and «لوحة تحكم العهدة» mounts them once.
//
// The suite has no DOM, so nothing here clicks. The dialogs are rendered to markup against a seeded
// query cache, and a press, a tick or a typed amount is played INSIDE the render that draws its
// control: the element's own handler is called as the element is created (`steps`, in order, one
// at a time). That is a render-phase state update, which the server renderer replays at once — the
// markup that comes back is the dialog as it reads after the press. The API is a set of stubs, the
// print window a recorder, the toasts a list.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyMemoRowDto,
  type FleetCustodyOperationDto,
  type FleetCustodyReplenishCandidatesDto,
  type FleetCustodySettleCandidateDto,
  type FleetCustodySettleCandidatesDto,
  type FleetCustodySource,
  type FleetLicenseExpenseDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatMoneyParts } from '../../../shared/lib/format';
import { ApiError } from '../../../shared/lib/api-client';
import type * as JsxRuntime from 'react/jsx-runtime';
import type * as JsxDevRuntime from 'react/jsx-dev-runtime';
import type * as ToastStore from '../../../shared/ui/toast/toast-store';
import type * as FleetApi from '../api/fleet-api';

/** What to do, in order, to the next element created with `attr` (and `value`, when given). */
interface Step {
  attr: string;
  value?: string;
  run: (props: Record<string, unknown>) => void;
}
const steps = vi.hoisted(() => [] as Step[]);
const step = vi.hoisted(() => (props: unknown): void => {
  const head = steps[0];
  if (head === undefined) return;
  const own = (props ?? {}) as Record<string, unknown>;
  if (!(head.attr in own)) return;
  if (head.value !== undefined && own[head.attr] !== head.value) return;
  steps.shift();
  head.run(own);
});
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof JsxDevRuntime>();
  const jsxDEV: typeof actual.jsxDEV = (type, props, ...rest) => {
    step(props);
    return actual.jsxDEV(type, props, ...rest);
  };
  return { ...actual, jsxDEV };
});
vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof JsxRuntime>();
  const keep =
    (create: typeof actual.jsx): typeof actual.jsx =>
    (type, props, key) => {
      step(props);
      return create(type, props, key);
    };
  return { ...actual, jsx: keep(actual.jsx), jsxs: keep(actual.jsxs) };
});

/** Every toast raised, in order. */
const raised = vi.hoisted(() => [] as { variant: string; title: string }[]);
vi.mock('../../../shared/ui/toast/toast-store', async (importOriginal) => {
  const actual = await importOriginal<typeof ToastStore>();
  const record =
    (variant: string) =>
    (title: string): string => {
      raised.push({ variant, title });
      return `toast-${raised.length}`;
    };
  return {
    ...actual,
    toast: {
      info: record('info'),
      success: record('success'),
      warning: record('warning'),
      error: record('error'),
    },
  };
});

/** What happened, in order — the print tab, the API's writes. */
const order = vi.hoisted(() => [] as string[]);
const printed = vi.hoisted(() => ({ open: true, html: [] as string[], closed: 0 }));
vi.mock('../../../shared/lib/print-window', () => ({
  openPrintWindow: () => {
    order.push('tab');
    return printed.open
      ? {
          close: () => {
            printed.closed += 1;
          },
        }
      : null;
  },
  writePrintWindow: (_win: unknown, html: string) => {
    order.push('write');
    printed.html.push(html);
  },
}));

const api = vi.hoisted(() => ({
  charge: [] as unknown[],
  replenish: [] as unknown[],
  settle: [] as unknown[],
  settleReads: 0,
  answer: null as unknown,
  refuse: null as unknown,
}));
vi.mock('../api/fleet-api', async (importOriginal) => {
  const actual = await importOriginal<typeof FleetApi>();
  const write =
    (name: 'charge' | 'replenish' | 'settle') =>
    async (body: unknown): Promise<unknown> => {
      order.push(name);
      api[name].push(body);
      if (api.refuse !== null) throw api.refuse;
      return api.answer;
    };
  return {
    ...actual,
    chargeCustody: write('charge'),
    replenishCustody: write('replenish'),
    settleCustody: write('settle'),
    custodySettleCandidates: async () => {
      api.settleReads += 1;
      return SETTLE_CANDIDATES;
    },
    custodyReplenishCandidates: async () => REPLENISH_CANDIDATES,
    getCustodyFundSummary: async () => FUND,
  };
});
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { custodyQueryKeys } = await import('../api/fleet-queries');
const { CustodyChargeDialog } = await import('../components/CustodyChargeDialog');
const { CustodyReplenishDialog } = await import('../components/CustodyReplenishDialog');
const { CustodySettleDialog } = await import('../components/CustodySettleDialog');
const { CustodyFundDialogs } = await import('../components/CustodyFundDialogs');
const { chargeLetterSentence } = await import('../lib/custody-papers');
const { custodyPlural } = await import('../lib/custody-words');
const forms = await import('../lib/custody-fund-forms');

// ── His scenario ─────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const STAMP = '2026-09-29T10:00:00.000Z';
const memo = (
  no: number,
  kind: FleetCustodySource,
  name: string,
  from: string,
  to: string,
  receipts: number,
  total: number,
): FleetCustodyMemoRowDto => ({
  id: `m${no}`,
  no,
  kind,
  name,
  date: to,
  from,
  to,
  receipts,
  total,
  replenishment: null,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
});
/** Memos 1–5 of September, before the 29/09 replenishment. */
const MEMOS = [
  memo(1, 'tyres', 'كاوتش النصف الأول من سبتمبر', '2026-09-01', '2026-09-15', 18, 1690),
  memo(2, 'tyres', '', '2026-09-16', '2026-09-27', 6, 960),
  memo(3, 'fuel', 'وقود سبتمبر', '2026-09-01', '2026-09-28', 55, 49844),
  memo(4, 'maintenance', 'صيانة أول سبتمبر', '2026-09-04', '2026-09-13', 3, 5720),
  memo(5, 'maintenance', 'صيانة آخر سبتمبر', '2026-09-15', '2026-09-27', 11, 23694),
];
const outside = (
  counts: Partial<Record<FleetCustodySource, [number, number]>>,
): FleetCustodyReplenishCandidatesDto['outside'] =>
  (['maintenance', 'fuel', 'tyres', 'wash'] as const).map((kind) => ({
    kind,
    count: counts[kind]?.[0] ?? 0,
    total: counts[kind]?.[1] ?? 0,
    oldest: counts[kind] === undefined ? null : '2026-10-06',
    stale: { count: 0, total: 0 },
  }));
const REPLENISH_CANDIDATES: FleetCustodyReplenishCandidatesDto = {
  memos: MEMOS,
  outside: outside({ wash: [4, 600] }),
  fundTotal: 17492,
  chargedTotal: 100000,
};
const FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 17492,
  charged: { count: 1, amount: 100000 },
  spent: { count: 97, amount: 82508 },
  replenished: { count: 0, amount: 0, memos: 0 },
  settled: { count: 0, amount: 0, parts: 0 },
  held: { count: 0, amount: 0, memos: 0, receipts: 0 },
  cancelled: { count: 0, amount: 0 },
  operations: 1,
  memos: { count: 5, pending: 5, pendingTotal: 81908 },
  outside: outside({ wash: [4, 600] }),
};

const codes = (n: number, start = 150): string[] =>
  Array.from({ length: n }, (_, i) => String(start + i));
const part = (n: number, start: number, visa: number, cash: number) => ({
  vehicles: codes(n, start).map((code) => ({ vehicleId: `v${code}`, code, plate: `ص ${code}` })),
  items: [
    { itemId: null, label: 'رسوم', amount: visa, count: 1, paidBy: 'visa' as const, receipt: true },
    {
      itemId: null,
      label: 'نقدي',
      amount: cash,
      count: 1,
      paidBy: 'cash' as const,
      receipt: false,
    },
  ],
  settlement: null,
});
/** One record holding a renewal of 5 cars and an extension of 23 — two licensing memos. */
const RECORD: FleetLicenseExpenseDto = {
  id: 'lx1',
  date: '2026-10-01',
  renewal: part(5, 150, 33450, 6282.19),
  extension: part(23, 160, 34500, 6750),
  signatures: { agent: 'أ', director: 'ب', generalManager: 'ج' },
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
};
const candidate = (
  partKind: 'renewal' | 'extension',
  visa: number,
  cash: number,
): FleetCustodySettleCandidateDto => {
  const held = RECORD[partKind];
  const cars = held?.vehicles.length ?? 0;
  return {
    expenseId: RECORD.id,
    part: partKind,
    date: RECORD.date,
    cars,
    codes: held?.vehicles.map((v) => v.code ?? v.plate) ?? [],
    visaTotal: visa,
    cashTotal: cash,
    total: Math.round((visa + cash) * 100) / 100,
    expense: RECORD,
  };
};
const SETTLE_CANDIDATES: FleetCustodySettleCandidatesDto = {
  parts: [candidate('renewal', 33450, 6282.19), candidate('extension', 34500, 6750)],
  fundTotal: 17492,
};

const operation = (over: Partial<FleetCustodyOperationDto>): FleetCustodyOperationDto => ({
  id: 'op-1',
  kind: 'replenish',
  status: 'done',
  transfer: null,
  cancellation: null,
  date: '2026-09-29',
  from: '2026-09-01',
  to: '2026-09-30',
  amount: 81908,
  reason: '',
  memos: MEMOS.map((m) => ({
    memoId: m.id,
    no: m.no,
    kind: m.kind,
    name: m.name,
    from: m.from,
    to: m.to,
    receipts: m.receipts,
    amount: m.total,
  })),
  parts: [],
  fundBefore: 17492,
  chargedTotal: 100000,
  letterFigure: 100000,
  signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
  ledger: { before: 17492, after: 99400 },
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

// ── Rendering ────────────────────────────────────────────────────────────────────────────────

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;
const WRITER = ['fleetCustody.view', 'fleetReceipt.create'];

const client = (seed: { fund?: FleetCustodyFundSummaryDto } = {}): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(custodyQueryKeys.fund(), seed.fund ?? FUND);
  qc.setQueryData(custodyQueryKeys.candidates('replenish'), REPLENISH_CANDIDATES);
  qc.setQueryData(custodyQueryKeys.candidates('settle'), SETTLE_CANDIDATES);
  return qc;
};

const render = (
  node: ReactNode,
  { qc = client(), path = '/fleet/custody/log', permissions = WRITER } = {},
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
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** The words a reader sees: every tag a gap, entities read. */
const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
/** The element that carries `attr` — its opening tag to its matching close. */
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
/** «مذكرتان», «4 إيصالات» — the custody count, as the screens write it. */
const count = (noun: string, n: number): string =>
  ar(`fleet.custody.count.${noun}.${custodyPlural('ar', n)}`, { count: LATIN.format(n) });
const figure = (value: number): string => {
  const { figure: f } = formatMoneyParts(Math.abs(value), 'EGP', 'ar');
  return value < 0 ? `−${f}` : f;
};
/** Let the stubbed request, its answer and what follows it run out. */
const settled = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
/** A sentence's spaces as the markup's words read them. */
const squash = (words: string): string => words.replace(/\s+/gu, ' ').trim();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
  steps.length = 0;
  raised.length = 0;
  order.length = 0;
  printed.open = true;
  printed.html.length = 0;
  printed.closed = 0;
  api.charge.length = 0;
  api.replenish.length = 0;
  api.settle.length = 0;
  api.settleReads = 0;
  api.answer = null;
  api.refuse = null;
});
afterEach(() => {
  vi.useRealTimers();
});

// ── The pure parts ───────────────────────────────────────────────────────────────────────────

describe('the fund forms’ arithmetic and bodies', () => {
  it('the letter’s period is the whole months of what is picked — his 01/09 to 30/09', () => {
    expect(forms.monthBounds(['2026-09-04', '2026-09-28', '2026-09-15'])).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(forms.monthBounds(['2026-10-03', '2026-09-15'])).toEqual({
      from: '2026-09-01',
      to: '2026-10-31',
    });
    expect(forms.monthBounds(['2028-02-10'])).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(forms.monthBounds(['2026-09-29T00:00:00.000Z'])).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(forms.monthBounds([])).toBeNull();
    expect(forms.monthBounds(['', 'nonsense'])).toBeNull();
  });

  it('dates the letter by the clerk’s own calendar day, not the UTC one', () => {
    // 01:30 on 1 October by the local clock — still 30 September in UTC east of Greenwich.
    expect(forms.todayDay(new Date(2026, 9, 1, 1, 30))).toBe('2026-10-01');
    expect(forms.freshLetterHead(new Date(2026, 9, 1, 23, 59)).date).toBe('2026-10-01');
  });

  it('follows what is picked until a box is typed in', () => {
    const head = forms.freshLetterHead(new Date('2026-09-29T10:00:00Z'));
    expect(head).toEqual({ date: '2026-09-29', from: null, to: null });
    expect(forms.letterPeriod(head, ['2026-09-04'])).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(forms.letterPeriod({ ...head, to: '2026-09-25' }, ['2026-09-04'])).toEqual({
      from: '2026-09-01',
      to: '2026-09-25',
    });
    expect(forms.letterPeriod(head, [])).toEqual({ from: '', to: '' });
  });

  it('adds money in whole piastres, and lets the fund go below zero', () => {
    expect(forms.fundAfter(0.1, 0.2)).toBe(0.3);
    expect(forms.fundAfter(17492, 81908)).toBe(99400);
    expect(forms.fundAfter(299400, -124139.46)).toBe(175260.54);
    expect(forms.fundAfter(17492, -124139.46)).toBe(-106647.46);
    expect(forms.sumMoney([39732.19, 36768.85, 47638.42])).toBe(124139.46);
  });

  it('reads «المبلغ» as an amount only when it is one above zero', () => {
    expect(forms.chargeAmountOf('200000')).toBe(200000);
    expect(forms.chargeAmountOf('0.5')).toBe(0.5);
    for (const raw of ['', '  ', '0', '-5', 'abc']) expect(forms.chargeAmountOf(raw)).toBeNull();
  });

  it('sends a day as its UTC midnight, and leaves an emptied box out (never `""`)', () => {
    const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
    expect(
      forms.replenishBody({
        date: '2026-09-29',
        period: { from: '2026-09-01', to: '2026-09-30' },
        memoIds: ['m1', 'm2'],
      }),
    ).toEqual({
      date: day('2026-09-29'),
      from: day('2026-09-01'),
      to: day('2026-09-30'),
      memoIds: ['m1', 'm2'],
    });
    expect(
      forms.replenishBody({ date: '', period: { from: '', to: '' }, memoIds: ['m1'] }),
    ).toEqual({ memoIds: ['m1'] });
    expect(
      forms.settleBody({
        date: '2026-10-05',
        period: { from: '', to: '2026-09-30' },
        parts: [{ expenseId: 'lx1', part: 'extension' }],
      }),
    ).toEqual({
      date: day('2026-10-05'),
      to: day('2026-09-30'),
      parts: [{ expenseId: 'lx1', part: 'extension' }],
    });
    expect(forms.chargeBody({ date: '', amount: 200000, reason: '  نظير شيء  ' })).toEqual({
      amount: 200000,
      reason: 'نظير شيء',
    });
  });

  it('tiles the memos per kind in his letter’s order, empty kinds kept', () => {
    const shares = forms.byKindInLetterOrder(MEMOS);
    expect(shares.map((s) => s.kind)).toEqual(['tyres', 'fuel', 'maintenance', 'wash']);
    expect(shares.map((s) => s.total)).toEqual([2650, 49844, 29414, 0]);
    expect(shares.map((s) => s.nos)).toEqual([[1, 2], [3], [4, 5], []]);
    expect(forms.inLetterOrder(['maintenance', 'fuel', 'tyres'])).toEqual([
      'tyres',
      'fuel',
      'maintenance',
    ]);
  });

  it('shows five codes, or four and how many more', () => {
    expect(forms.codesShown(codes(5))).toEqual({ shown: codes(5), more: 0 });
    expect(forms.codesShown(codes(23))).toEqual({ shown: codes(4), more: 19 });
  });

  it('names a refusal it can explain, and leaves the rest to the usual message', () => {
    expect(forms.fundRefusalOf(new ApiError('DUPLICATE', 'memo replenished', 409))).toBe('taken');
    expect(forms.fundRefusalOf(new ApiError('NOT_FOUND', 'gone', 404))).toBe('taken');
    expect(forms.fundRefusalOf(new ApiError('STALE_DOCUMENT', 'moved', 409))).toBe('stale');
    expect(forms.fundRefusalOf(new ApiError('BUSINESS_RULE_VIOLATION', 'locked', 422))).toBe(
      'locked',
    );
    expect(forms.fundRefusalOf(new ApiError('VALIDATION_FAILED', 'bad', 400))).toBeNull();
    expect(forms.fundRefusalOf(new TypeError('network'))).toBeNull();
  });
});

// ── «استعاضة العهدة» ─────────────────────────────────────────────────────────────────────────

describe('«استعاضة العهدة»', () => {
  const dialog = (qc?: QueryClient): string =>
    render(
      <CustodyReplenishDialog open onClose={() => undefined} />,
      qc === undefined ? {} : { qc },
    );

  it('lists every memo not replenished yet, all ticked, the head tick full', () => {
    const html = dialog();
    expect(html).toContain('data-memo-replenish="true"');
    const list = element(html, 'data-memo-replenish-list="true"');
    expect([...list.matchAll(/data-memo-replenish-row="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(list.match(/role="checkbox" aria-checked="true"/gu)).toHaveLength(6);
    // A memo saved with no name reads «مذكرة كاوتش رقم 2», muted.
    expect(list).toContain('data-memo-name="fallback"');
    expect(list.match(/data-memo-name="typed"/gu)).toHaveLength(4);
    // The sample's mark on each name, which the shoot scripts read.
    expect([...list.matchAll(/data-memo-replenish-name="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    // Each has its eye.
    expect(list.match(/data-memo-replenish-view="m\d"/gu)).toHaveLength(5);
  });

  it('the eye opens that memo’s own paper over the dialog, which stays under it', () => {
    const qc = client();
    const third = MEMOS[2] as FleetCustodyMemoRowDto;
    qc.setQueryData(custodyQueryKeys.memo(third.id), {
      ...third,
      lines: [],
      signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.fuel,
    });
    steps.push({
      attr: 'data-memo-replenish-view',
      value: third.id,
      run: (p) => (p.onClick as () => void)(),
    });
    const html = dialog(qc);
    // The list is still there, and over it the memo's view with its paper.
    expect(html).toContain('data-memo-replenish-list="true"');
    const view = element(html, `data-memo-view="${third.no}"`);
    expect(view).toContain('data-paper-sheet="true"');
    expect(html).toContain(`data-memo-view-print="${third.no}"`);
  });

  it('tiles the replenishment per kind in his letter’s order, a kind with none «—» and its outside receipts', () => {
    const kinds = element(dialog(), 'data-memo-replenish-kinds="true"');
    expect([...kinds.matchAll(/data-memo-replenish-kind="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'tyres',
      'fuel',
      'maintenance',
      'wash',
      'total',
    ]);
    const tile = (kind: string): string => element(kinds, `data-memo-replenish-kind="${kind}"`);
    expect(text(tile('tyres'))).toContain(figure(2650));
    expect(text(tile('tyres'))).toContain(
      ar('fleet.custody.fundForm.replenish.nos', { memos: count('memo', 2), nos: '1، 2' }),
    );
    expect(text(tile('maintenance'))).toContain(figure(29414));
    expect(text(tile('wash'))).toContain('—');
    expect(text(tile('wash'))).toContain(
      ar('fleet.custody.fundForm.replenish.outsideMemos', {
        receipts: count('receipt', 4),
        amount: figure(600),
      }),
    );
    expect(text(tile('total'))).toContain(figure(81908));
  });

  it('says «لا مذكرات» for a kind with nothing ticked and nothing outside', () => {
    const qc = client();
    qc.setQueryData(custodyQueryKeys.candidates('replenish'), {
      ...REPLENISH_CANDIDATES,
      outside: outside({}),
    });
    const wash = element(dialog(qc), 'data-memo-replenish-kind="wash"');
    expect(text(wash)).toContain(ar('fleet.custody.fundForm.replenish.noMemos'));
  });

  it('adds up: the fund now, plus the memos, is the fund after', () => {
    const result = element(dialog(), 'data-memo-replenish-result="true"');
    const cell = (mark: string): string => text(element(result, `data-fund-cell="${mark}"`));
    expect(cell('before')).toContain(figure(17492));
    expect(cell('change')).toContain(figure(81908));
    expect(cell('after')).toContain(figure(99400));
    expect(result).not.toContain('data-fund-negative');
  });

  it('warns for EVERY kind with receipts in no memo, each with the way to make its memo', () => {
    const qc = client();
    qc.setQueryData(custodyQueryKeys.candidates('replenish'), {
      ...REPLENISH_CANDIDATES,
      outside: outside({ wash: [4, 600], fuel: [8, 7876] }),
    });
    const html = dialog(qc);
    expect([...html.matchAll(/data-memo-replenish-outside="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'fuel',
      'wash',
    ]);
    expect(html).toContain('href="/fleet/custody/memos/new/wash"');
    expect(html).toContain('href="/fleet/custody/memos/new/fuel"');
    expect(text(element(html, 'data-memo-replenish-outside="fuel"'))).toContain(
      ar('fleet.custody.fundForm.replenish.outsideWarn', {
        kind: ar('fleet.custody.source.fuel'),
        amount: figure(7876),
      }),
    );
  });

  it('a memo unticked leaves the sum, its kind’s tile and the head tick half', () => {
    steps.push({
      attr: 'data-memo-replenish-tick',
      value: '3',
      run: (p) => (p.onClick as () => void)(),
    });
    const html = dialog();
    expect(element(html, 'data-memo-replenish-tick-all="true"')).toContain('aria-checked="mixed"');
    expect(text(element(html, 'data-memo-replenish-kind="fuel"'))).toContain('—');
    expect(text(element(html, 'data-memo-replenish-kind="total"'))).toContain(figure(32064));
    expect(text(element(html, 'data-fund-cell="after"'))).toContain(figure(49556));
  });

  it('with nothing ticked, a press names «المذكرات» and records nothing — Save is never disabled', async () => {
    steps.push(
      { attr: 'data-memo-replenish-tick-all', run: (p) => (p.onClick as () => void)() },
      { attr: 'data-memo-replenish-save', run: (p) => (p.onClick as () => void)() },
    );
    const html = dialog();
    const banner = element(html, 'data-missing-fields="true"');
    expect(text(banner)).toContain(ar('fleet.custody.fundForm.required.memos'));
    expect(html).toContain('data-field-missing="true"');
    expect(element(html, 'data-memo-replenish-save="true"')).not.toMatch(/\sdisabled=""/u);
    expect(element(html, 'data-memo-replenish-print="true"')).not.toMatch(/\sdisabled=""/u);
    await settled();
    expect(api.replenish).toEqual([]);
  });

  it('records the ticked memos with the letter’s date and his whole months — once for a double press', async () => {
    api.answer = operation({});
    const closed = vi.fn();
    steps.push({
      attr: 'data-memo-replenish-save',
      run: (p) => {
        (p.onClick as () => void)();
        (p.onClick as () => void)();
      },
    });
    const html = render(<CustodyReplenishDialog open onClose={closed} />);
    // On its way: both saves busy (spinner, not pressable).
    expect(element(html, 'data-memo-replenish-save="true"')).toContain('aria-busy="true"');
    expect(element(html, 'data-memo-replenish-print="true"')).toContain('aria-busy="true"');
    await settled();
    expect(api.replenish).toEqual([
      {
        date: new Date('2026-09-29T00:00:00.000Z'),
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-30T00:00:00.000Z'),
        memoIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
      },
    ]);
    expect(raised).toEqual([
      { variant: 'success', title: ar('fleet.custody.fundForm.replenish.done') },
    ]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('«تنفيذ وطباعة الخطاب» opens the tab FIRST, then records, then prints the RECORDED letter', async () => {
    api.answer = operation({});
    steps.push({ attr: 'data-memo-replenish-print', run: (p) => (p.onClick as () => void)() });
    dialog();
    await settled();
    expect(order).toEqual(['tab', 'replenish', 'write']);
    expect(printed.html).toHaveLength(1);
    // His letter's title is the PDF's name; the sheet is the operation's own.
    expect(printed.html[0]).toContain('<title>استعاضه عهدة</title>');
    expect(printed.html[0]).toContain('data-paper-sheet="true"');
  });

  it('a blocked tab records nothing and says so', async () => {
    printed.open = false;
    steps.push({ attr: 'data-memo-replenish-print', run: (p) => (p.onClick as () => void)() });
    dialog();
    await settled();
    expect(order).toEqual(['tab']);
    expect(api.replenish).toEqual([]);
    expect(raised).toEqual([{ variant: 'error', title: ar('fleet.violations.popupBlocked') }]);
  });
});

// ── «تسوية العهدة» ───────────────────────────────────────────────────────────────────────────

describe('«تسوية العهدة»', () => {
  const dialog = (): string => render(<CustodySettleDialog open onClose={() => undefined} />);

  it('draws a record’s renewal and extension as two lines, both ticked', () => {
    const list = element(dialog(), 'data-memo-settle-list="true"');
    expect([...list.matchAll(/data-memo-settle-row="([\w:]+)"/gu)].map((m) => m[1])).toEqual([
      'lx1:renewal',
      'lx1:extension',
    ]);
    expect(list).toContain('data-memo-settle-part="renewal"');
    expect(list).toContain('data-memo-settle-part="extension"');
    expect(list.match(/role="checkbox" aria-checked="true"/gu)).toHaveLength(3);
  });

  it('shows five codes, or four and how many more', () => {
    const list = element(dialog(), 'data-memo-settle-list="true"');
    const renewal = text(element(list, 'data-memo-settle-codes="lx1:renewal"'));
    expect(renewal.split('·').map((c) => c.trim())).toEqual(codes(5));
    const extension = text(element(list, 'data-memo-settle-codes="lx1:extension"'));
    expect(extension.split('·').map((c) => c.trim())).toEqual(codes(4, 160));
    expect(list).toContain('data-memo-settle-more="19"');
  });

  it('takes the total off the fund — and lets it go below zero, in red, without stopping Save', () => {
    const html = dialog();
    const total = forms.sumMoney(SETTLE_CANDIDATES.parts.map((p) => p.total));
    expect(total).toBe(80982.19);
    const result = element(html, 'data-memo-settle-result="true"');
    expect(text(element(result, 'data-fund-cell="before"'))).toContain(figure(17492));
    expect(text(element(result, 'data-fund-cell="change"'))).toContain(figure(total));
    const after = element(result, 'data-fund-cell="after"');
    expect(text(after)).toContain(figure(forms.fundAfter(17492, -total)));
    expect(text(after)).toContain('−');
    expect(after).toContain('data-fund-negative="true"');
    expect(after).toContain('bg-red-600');
    expect(text(element(html, 'data-memo-settle-selected="true"'))).toContain(
      ar('fleet.custody.fundForm.settle.selected', { memos: count('memo', 2) }),
    );
    expect(element(html, 'data-memo-settle-save="true"')).not.toMatch(/\sdisabled=""/u);
  });

  it('the eye draws the licensing memo itself, from the record the custody router sent', () => {
    steps.push({
      attr: 'data-memo-settle-view',
      value: 'lx1:extension',
      run: (p) => (p.onClick as () => void)(),
    });
    const html = dialog();
    const sheet = element(html, 'data-memo-settle-preview="lx1:extension"');
    expect(sheet).toContain('مد مدة');
    expect(sheet).toContain('182');
  });

  it('a part settled meanwhile (409) is named, nothing else, and the list is read again', async () => {
    api.refuse = new ApiError('DUPLICATE', 'the extension was already settled', 409);
    steps.push({ attr: 'data-memo-settle-save', run: (p) => (p.onClick as () => void)() });
    dialog();
    await settled();
    expect(api.settle).toHaveLength(1);
    expect(raised).toEqual([
      { variant: 'error', title: ar('fleet.custody.fundForm.settle.taken') },
    ]);
    expect(api.settleReads).toBe(1);
  });
});

// ── «طلب عهدة» ───────────────────────────────────────────────────────────────────────────────

describe('«طلب عهدة»', () => {
  const dialog = (onClose: () => void = () => undefined): string =>
    render(<CustodyChargeDialog open onClose={onClose} />);
  const typeAmount = (raw: string): Step => ({
    attr: 'data-memo-charge-amount',
    run: (p) => (p.onChange as (value: string) => void)(raw),
  });
  const typeReason = (raw: string): Step => ({
    attr: 'data-memo-charge-reason',
    run: (p) =>
      (p.onChange as (e: { target: { value: string } }) => void)({ target: { value: raw } }),
  });

  it('opens on today, an empty amount and no reason', () => {
    const html = dialog();
    expect(html).toContain('data-memo-charge="true"');
    // «شحن العهدة» is «طلب عهدة» now: its title, its section and the change it makes; its paper
    // stays «صرف عهدة».
    expect(html).toContain(ar('fleet.custody.actions.request'));
    expect(ar('fleet.custody.actions.request')).toBe('طلب عهدة');
    expect(html).toContain(ar('fleet.custody.fundForm.request.section'));
    expect(ar('fleet.custody.fundForm.request.section')).toBe('بيانات الطلب');
    expect(text(html)).toContain(ar('fleet.custody.fundForm.request.change'));
    expect(ar('fleet.custody.fundForm.request.change')).toBe('مبلغ الطلب');
    expect(html).not.toContain(ar('fleet.custody.actions.charge'));
    expect(element(html, 'data-memo-charge-date="true"')).toContain('value="2026-09-29"');
    expect(html).not.toContain('data-missing-fields');
  });

  it('a press with no amount names «المبلغ» and turns its box red — and records nothing', async () => {
    steps.push({ attr: 'data-memo-charge-save', run: (p) => (p.onClick as () => void)() });
    const html = dialog();
    expect(text(element(html, 'data-missing-fields="true"'))).toContain(
      ar('fleet.custody.fundForm.required.amount'),
    );
    expect(html).toContain('data-field-missing="true"');
    expect(element(html, 'data-memo-charge-save="true"')).not.toMatch(/\sdisabled=""/u);
    await settled();
    expect(api.charge).toEqual([]);
  });

  it('«نص الخطاب» is his letter’s sentence — with no reason it ends at the fund', () => {
    const sentence = text(element(dialog(), 'data-memo-charge-sentence="true"'));
    expect(sentence).toContain(squash(chargeLetterSentence({ amount: 0, reason: '' })));
    expect(sentence).not.toContain('نظير');
  });

  it('with an amount and a reason: the sentence, and the fund after it', () => {
    steps.push(typeAmount('200000'), typeReason('نظير 24 سياره تجديد'));
    const html = dialog();
    const sentence = text(element(html, 'data-memo-charge-sentence="true"'));
    expect(sentence).toContain(
      squash(chargeLetterSentence({ amount: 200000, reason: 'نظير 24 سياره تجديد' })),
    );
    // His figure in his digits; the reason's «نظير» written once.
    expect(sentence).toContain('٢٠٠,٠٠٠');
    expect(sentence.match(/نظير/gu)).toHaveLength(1);
    expect(text(element(html, 'data-fund-cell="after"'))).toContain(figure(217492));
  });

  it('a double press records ONE charge (critique 2) and closes', async () => {
    api.answer = operation({ kind: 'charge', amount: 200000, memos: [], letterFigure: null });
    const closed = vi.fn();
    steps.push(typeAmount('200000'), typeReason('تشغيل السيارات'), {
      attr: 'data-memo-charge-save',
      run: (p) => {
        (p.onClick as () => void)();
        (p.onClick as () => void)();
        (p.onClick as () => void)();
      },
    });
    dialog(closed);
    await settled();
    expect(api.charge).toEqual([
      { date: new Date('2026-09-29T00:00:00.000Z'), amount: 200000, reason: 'تشغيل السيارات' },
    ]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(raised).toEqual([
      { variant: 'success', title: ar('fleet.custody.fundForm.request.done') },
    ]);
    expect(ar('fleet.custody.fundForm.request.done')).toBe('سُجِّل طلب العهدة.');
  });

  it('«حفظ وطباعة الخطاب»: one tab, one charge, his «صرف عهدة» letter', async () => {
    api.answer = operation({
      kind: 'charge',
      from: null,
      to: null,
      amount: 200000,
      reason: '24 سياره تجديد',
      memos: [],
      letterFigure: null,
      signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.charge,
    });
    steps.push(typeAmount('200000'), {
      attr: 'data-memo-charge-print',
      run: (p) => {
        (p.onClick as () => void)();
        (p.onClick as () => void)();
      },
    });
    dialog();
    await settled();
    expect(order).toEqual(['tab', 'charge', 'write']);
    expect(printed.html[0]).toContain('<title>صرف عهدة</title>');
  });
});

// ── Where the address opens them ─────────────────────────────────────────────────────────────

describe('`?fund=` opens one dialog, for a reader who may write custody money', () => {
  it.each([
    ['settle', 'data-memo-settle="true"'],
    ['replenish', 'data-memo-replenish="true"'],
    ['charge', 'data-memo-charge="true"'],
  ])('?fund=%s', (op, panel) => {
    const html = render(<CustodyFundDialogs />, { path: `/fleet/custody/log?fund=${op}` });
    expect(html).toContain(panel);
    expect(html.match(/data-memo-(settle|replenish|charge)="true"/gu)).toHaveLength(1);
  });

  it('nothing without `fleetReceipt.create`, and nothing for an unknown `fund`', () => {
    expect(
      render(<CustodyFundDialogs />, {
        path: '/fleet/custody/log?fund=charge',
        permissions: ['fleetCustody.view'],
      }),
    ).toBe('');
    expect(render(<CustodyFundDialogs />, { path: '/fleet/custody/log?fund=refund' })).toBe('');
    expect(render(<CustodyFundDialogs />, { path: '/fleet/custody/log' })).toBe('');
  });
});

// ── The source, where the markup cannot tell ─────────────────────────────────────────────────

describe('each Save is guarded, busy while on its way, and prints after opening the tab', () => {
  const PARTS = source('../components/custody-fund-form-parts.tsx');

  it.each([
    '../components/CustodyChargeDialog.tsx',
    '../components/CustodyReplenishDialog.tsx',
    '../components/CustodySettleDialog.tsx',
  ])('%s: both saves guarded and busy, neither disabled', (file) => {
    const dialog = source(file);
    expect(
      dialog.match(/onClick=\{required\.guard\(\(\) => send\((true|false)\)\)\}/gu),
    ).toHaveLength(2);
    expect(dialog.match(/busy=\{busy\}/gu)).toHaveLength(2);
    expect(dialog).not.toMatch(/<(DesignSave|PrintButton)[^>]*\sdisabled=/u);
  });

  it('one press at a time: an in-flight ref, then the tab before the save', () => {
    expect(PARTS).toContain('if (sending.current) return;');
    const run = PARTS.slice(PARTS.indexOf('const run = (body: TBody, print: boolean)'));
    expect(run.indexOf('printPaperAfter(')).toBeGreaterThan(-1);
    expect(run.indexOf('printPaperAfter(')).toBeLessThan(
      run.indexOf('await mutation.mutateAsync(body)'),
    );
  });
});

// ── In his words, once the dictionary holds them (the i18n merge) ────────────────────────────

const merged =
  ar('fleet.custody.fundForm.total') !== 'fleet.custody.fundForm.total' &&
  ar('fleet.custody.count.memo.two') !== 'fleet.custody.count.memo.two';

describe.skipIf(!merged)('the dialogs read as the approved samples do', () => {
  it('«ملخص الاستعاضة حسب النوع»: «مذكرتان: 1، 2», «مذكرة واحدة: 3», «4 إيصالات (600.00) خارج المذكرات»', () => {
    const kinds = text(
      element(
        render(<CustodyReplenishDialog open onClose={() => undefined} />),
        'data-memo-replenish-kinds="true"',
      ),
    );
    expect(kinds).toContain('مذكرتان: 1، 2');
    expect(kinds).toContain('مذكرة واحدة: 3');
    expect(kinds).toContain('4 إيصالات (600.00) خارج المذكرات');
  });

  it('«تسوية العهدة»: «تجديد 5 سيارات», «مد مدة 23 سيارة», «و19 سيارة أخرى»', () => {
    const list = text(
      element(
        render(<CustodySettleDialog open onClose={() => undefined} />),
        'data-memo-settle-list="true"',
      ),
    );
    expect(list).toContain('تجديد 5 سيارات');
    expect(list).toContain('مد مدة 23 سيارة');
    expect(list).toContain('و19 سيارة أخرى');
  });

  it('«طلب عهدة»: an empty press names «المبلغ»', () => {
    steps.push({ attr: 'data-memo-charge-save', run: (p) => (p.onClick as () => void)() });
    const html = render(<CustodyChargeDialog open onClose={() => undefined} />);
    expect(text(element(html, 'data-missing-fields="true"'))).toContain('المبلغ');
  });
});
