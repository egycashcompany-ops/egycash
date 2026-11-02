// «حذف العملية» — the dialog per kind and status, and what a press sends and says: his 150,000.00
// «طلب عهدة» with operations after it (the fund going below zero, said in red), a transferred
// replenishment and its memos, a held one (the fund unchanged), a cancelled one (nothing moves), a
// settlement and its licence parts; done, refused because it changed or went elsewhere (409 /
// 404), or another failure.
//
// The suite has no DOM, so nothing here clicks: a press or a typed value is played INSIDE the
// render that draws its control (`steps`, as custody-hold-dialogs.spec.tsx does). The API is a
// stub, the toasts a list.
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
  type FleetCustodyLedgerRowDto,
  type FleetCustodyOperationDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { formatMoneyParts } from '../../../shared/lib/format';
import type * as JsxRuntime from 'react/jsx-runtime';
import type * as JsxDevRuntime from 'react/jsx-dev-runtime';
import type * as ToastStore from '../../../shared/ui/toast/toast-store';
import type * as DeleteApi from '../api/custody-delete-api';

interface Step {
  attr: string;
  run: (props: Record<string, unknown>) => void;
}
const steps = vi.hoisted(() => [] as Step[]);
const step = vi.hoisted(() => (props: unknown): void => {
  const head = steps[0];
  if (head === undefined) return;
  const own = (props ?? {}) as Record<string, unknown>;
  if (!(head.attr in own)) return;
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

const api = vi.hoisted(() => ({ sent: [] as unknown[], refuse: null as unknown }));
vi.mock('../api/custody-delete-api', async (importOriginal) => {
  const actual = await importOriginal<typeof DeleteApi>();
  return {
    ...actual,
    deleteCustodyOperation: async (id: string, body: unknown): Promise<void> => {
      api.sent.push({ id, body });
      if (api.refuse !== null) throw api.refuse;
    },
  };
});
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { custodyQueryKeys } = await import('../api/fleet-queries');
const { CustodyDeleteOperationDialog } = await import('../components/CustodyDeleteOperationDialog');
const { CustodyFundDialogs } = await import('../components/CustodyFundDialogs');
const { laterOperationsQuery } = await import('../lib/custody-delete');
const { custodyPlural } = await import('../lib/custody-words');

// ── His fund ─────────────────────────────────────────────────────────────────────────────────

const STAMP = '2026-11-01T07:12:00.000Z';
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
  deletion: null,
  createdByName: 'محمد حسن',
  version: 3,
  createdAt: STAMP,
  updatedAt: STAMP,
};
const MEMOS: FleetCustodyOperationDto['memos'] = [
  {
    memoId: 'm7',
    no: 7,
    kind: 'maintenance',
    name: '',
    from: '2026-10-16',
    to: '2026-10-25',
    receipts: 4,
    amount: 3000,
  },
  {
    memoId: 'm8',
    no: 8,
    kind: 'wash',
    name: 'غسيل أكتوبر',
    from: '2026-10-01',
    to: '2026-10-25',
    receipts: 3,
    amount: 660,
  },
];
const OPS: Record<string, FleetCustodyOperationDto> = {
  // His «طلب عهدة» of 01/11 «نظير تراخيص» — five operations after it.
  'op-c': {
    ...base,
    id: 'op-c',
    kind: 'charge',
    date: '2026-10-01',
    amount: 200000,
    reason: 'تراخيص',
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.charge,
  },
  'op-r': {
    ...base,
    id: 'op-r',
    kind: 'replenish',
    date: '2026-10-26',
    from: '2026-10-01',
    to: '2026-10-31',
    amount: 3660,
    memos: MEMOS,
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
  },
  'op-h': {
    ...base,
    id: 'op-h',
    kind: 'replenish',
    status: 'held',
    date: '2026-10-27',
    amount: 3660,
    memos: MEMOS,
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
  },
  'op-x': {
    ...base,
    id: 'op-x',
    kind: 'replenish',
    status: 'cancelled',
    date: '2026-10-28',
    amount: 3660,
    memos: MEMOS,
    cancellation: { reason: '', byName: null, at: STAMP },
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
  },
  'op-s': {
    ...base,
    id: 'op-s',
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
  },
};
const FUND = { fundTotal: 150000, deleted: { count: 0 } } as unknown as FleetCustodyFundSummaryDto;

const row = (
  id: string,
  op: FleetCustodyLedgerRowDto['op'],
): Pick<FleetCustodyLedgerRowDto, 'id' | 'op'> => ({
  id,
  op,
});
/**
 * The log from each operation's day on, oldest first (each operation on its own day, so each reads
 * its own page): the charge has five operations after it.
 */
const LATER: Record<string, Pick<FleetCustodyLedgerRowDto, 'id' | 'op'>[]> = {
  'op-c': [
    row('op-c', 'charge'),
    row('a1', 'charge'),
    row('a2', 'replenish'),
    row('a3', 'settle'),
    row('a4', 'charge'),
    row('a5', 'replenish'),
  ],
  'op-r': [row('op-r', 'replenish'), row('b1', 'settle')],
  'op-h': [row('op-h', 'replenish'), row('b1', 'settle')],
  'op-x': [row('op-x', 'replenish')],
  'op-s': [row('op-s', 'settle')],
};

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;
const DELETER = ['fleetCustody.view', 'fleetReceipt.delete'];

const render = (
  node: ReactNode,
  {
    fund = FUND,
    path = '/fleet/custody/log',
    permissions = DELETER,
  }: { fund?: FleetCustodyFundSummaryDto; path?: string; permissions?: readonly string[] } = {},
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(custodyQueryKeys.fund(), fund);
  for (const [id, op] of Object.entries(OPS)) {
    qc.setQueryData(custodyQueryKeys.operation(id), op);
    const items = LATER[id] ?? [];
    qc.setQueryData(custodyQueryKeys.ledger(laterOperationsQuery(op)), {
      items,
      meta: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
    });
  }
  return renderToStaticMarkup(
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
};

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
const settled = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (attr: string, times = 1): Step => ({
  attr,
  run: (p) => {
    for (let i = 0; i < times; i += 1) (p.onClick as () => void)();
  },
});
const type = (attr: string, value: string): Step => ({
  attr,
  run: (p) => (p.onChange as (e: unknown) => void)({ target: { value } }),
});
const dialog = (id: string, opts?: Parameters<typeof render>[1]): string =>
  element(
    render(<CustodyDeleteOperationDialog id={id} onClose={vi.fn()} />, opts),
    `data-custody-delete="${id}"`,
  );

beforeEach(() => {
  steps.length = 0;
  raised.length = 0;
  api.sent.length = 0;
  api.refuse = null;
});
afterEach(() => {
  vi.useRealTimers();
});

// ── What it says, per kind and status ────────────────────────────────────────────────────────

describe('«حذف طلب العهدة» — a charge with operations after it', () => {
  it('names it, says what the click does, and warns in red: five operations recalculated', () => {
    const html = dialog('op-c');
    expect(text(html)).toContain(ar('fleet.custody.delete.title.charge'));
    expect(text(element(html, 'data-custody-delete-body="true"'))).toBe(
      ar('fleet.custody.delete.body.charge'),
    );
    const later = text(element(html, 'data-custody-delete-later="5"'));
    expect(later).toContain(
      ar('fleet.custody.delete.laterTitle', { operations: count('operation', 5) }),
    );
    expect(later).toContain(ar('fleet.custody.delete.laterBody'));
    expect(later).toContain(ar('fleet.custody.delete.allowed'));
    expect(html).not.toContain('data-custody-delete-held-or-cancel');
  });

  it('the fund now → after the delete: 150,000.00 − 200,000.00 = −50,000.00, red, and said', () => {
    const html = dialog('op-c');
    const strip = element(html, 'data-custody-delete-strip="true"');
    expect(text(element(strip, 'data-delete-fund="now"'))).toContain(figure(150000));
    const after = element(strip, 'data-delete-fund="after"');
    expect(text(after)).toContain(`−${figure(50000)}`);
    expect(after).toContain('text-red-600');
    expect(strip).toContain('data-custody-delete-delta="-200000"');
    const negative = text(element(html, 'data-custody-delete-negative="true"'));
    expect(negative).toContain(`−${figure(50000)}`);
    expect(negative).toContain(
      ar('fleet.custody.delete.negative', { amount: '' })
        .replace(/[:\s]+$/u, '')
        .trim(),
    );
    // Letters printed after it keep their figures.
    expect(text(element(html, 'data-custody-delete-letters="true"'))).toBe(
      ar('fleet.custody.delete.lettersKept'),
    );
  });

  it('the fund staying above zero: no negative line', () => {
    const html = dialog('op-c', { fund: { ...FUND, fundTotal: 260000 } });
    expect(html).toContain('data-custody-delete-later="5"');
    expect(html).not.toContain('data-custody-delete-negative');
    expect(text(element(html, 'data-delete-fund="after"'))).toContain(figure(60000));
  });

  it('the reason is optional, at most 500, and «رجوع» is the way back', () => {
    const html = dialog('op-c');
    const reason = element(html, 'data-custody-delete-reason="true"');
    expect(reason).not.toContain('required');
    expect(reason).toContain('maxLength="500"');
    expect(text(html)).toContain(ar('fleet.custody.delete.reason'));
    expect(text(html)).toContain(ar('fleet.custody.delete.back'));
    expect(text(element(html, 'data-custody-delete-save="true"'))).toBe(
      ar('fleet.custody.delete.save'),
    );
  });
});

describe('«حذف الاستعاضة» — transferred, held, cancelled', () => {
  it('transferred: the fund less its amount, its memos back to «لم تُستعَض بعد»', () => {
    const html = dialog('op-r');
    expect(text(element(html, 'data-custody-delete-body="true"'))).toBe(
      ar('fleet.custody.delete.body.replenish', { memos: count('memo', 2) }),
    );
    expect(element(html, 'data-custody-delete-strip="true"')).toContain(
      'data-custody-delete-delta="-3660"',
    );
    expect(text(element(html, 'data-delete-fund="after"'))).toContain(figure(146340));
    expect(text(html)).toContain(ar('fleet.custody.delete.memosBack'));
    expect(element(html, 'data-memo-cancel-list="true"')).toContain('data-memo-cancel-row="7"');
    expect(html).toContain('data-custody-delete-memo-cards="true"');
    // Only a charge carries the red warning; the letters note still stands.
    expect(html).not.toContain('data-custody-delete-later=');
    expect(html).toContain('data-custody-delete-letters="true"');
  });

  it('held: «حذف الاستعاضة المعلّقة», the fund unchanged, and how to keep it as cancelled', () => {
    const html = dialog('op-h');
    expect(text(html)).toContain(ar('fleet.custody.delete.title.replenishHeld'));
    const body = text(element(html, 'data-custody-delete-body="true"'));
    expect(body).toContain(
      ar('fleet.custody.delete.body.replenishHeld', { memos: count('memo', 2) }),
    );
    expect(body).toContain(ar('fleet.custody.delete.heldOrCancel'));
    const strip = text(element(html, 'data-custody-delete-strip="true"'));
    expect(strip).toContain(ar('fleet.custody.delete.fundUnchanged'));
    expect(strip).toContain(figure(150000));
    expect(html).toContain('data-delete-fund="same"');
    expect(html).not.toContain('data-delete-fund="after"');
    // Nothing moved: no letters note, but its memos still go back.
    expect(html).not.toContain('data-custody-delete-letters');
    expect(html).toContain('data-memo-cancel-list="true"');
  });

  it('cancelled: nothing changes — no memo listed, the fund the same', () => {
    const html = dialog('op-x');
    expect(text(element(html, 'data-custody-delete-body="true"'))).toBe(
      ar('fleet.custody.delete.body.replenishCancelled'),
    );
    expect(text(element(html, 'data-custody-delete-strip="true"'))).toContain(
      ar('fleet.custody.delete.fundUnchanged'),
    );
    expect(html).not.toContain('data-memo-cancel-list');
    expect(html).not.toContain(ar('fleet.custody.delete.memosBack'));
  });
});

describe('«حذف التسوية»', () => {
  it('the fund plus its amount, in emerald; its licence parts back to «لم تُسوَّ بعد»', () => {
    const html = dialog('op-s');
    expect(text(html)).toContain(ar('fleet.custody.delete.title.settle'));
    expect(text(element(html, 'data-custody-delete-body="true"'))).toContain(
      ar('fleet.custody.delete.body.settle', { parts: '' }).split('()')[0] ?? '',
    );
    const delta = element(html, 'data-custody-delete-delta="117270.5"');
    expect(delta).toContain('text-emerald-700');
    expect(text(element(html, 'data-delete-fund="after"'))).toContain(figure(267270.5));
    expect(text(html)).toContain(ar('fleet.custody.delete.partsBack'));
    expect(element(html, 'data-custody-delete-parts="true"')).toContain(
      'data-custody-delete-part="renewal"',
    );
    expect(html).not.toContain('data-memo-cancel-list');
  });
});

// ── What a press sends and says ──────────────────────────────────────────────────────────────

describe('«حذف العملية» pressed', () => {
  it('sends the version read and no reason — once for a double press — says done, and closes', async () => {
    const closed = vi.fn();
    steps.push(press('data-custody-delete-save', 2));
    render(<CustodyDeleteOperationDialog id="op-c" onClose={closed} />);
    await settled();
    expect(api.sent).toEqual([{ id: 'op-c', body: { reason: '', version: 3 } }]);
    expect(raised).toEqual([{ variant: 'success', title: ar('fleet.custody.delete.done') }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('sends the reason typed, trimmed', async () => {
    steps.push(
      type('data-custody-delete-reason', '  كُتب المبلغ 15,000 بدلًا من 150,000  '),
      press('data-custody-delete-save'),
    );
    render(<CustodyDeleteOperationDialog id="op-h" onClose={vi.fn()} />);
    await settled();
    expect(api.sent).toEqual([
      { id: 'op-h', body: { reason: 'كُتب المبلغ 15,000 بدلًا من 150,000', version: 3 } },
    ]);
  });

  it.each([
    ['changed meanwhile (409)', new ApiError('STALE_DOCUMENT', 'changed', 409)],
    ['deleted meanwhile (404)', new ApiError('NOT_FOUND', 'gone', 404)],
  ])('%s: says nothing was deleted, and closes', async (_, refusal) => {
    api.refuse = refusal;
    const closed = vi.fn();
    steps.push(press('data-custody-delete-save'));
    render(<CustodyDeleteOperationDialog id="op-r" onClose={closed} />);
    await settled();
    expect(raised).toEqual([{ variant: 'error', title: ar('fleet.custody.delete.taken') }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('any other failure: its usual message, and the dialog stays open', async () => {
    api.refuse = new ApiError('FORBIDDEN', 'You may not delete', 403);
    const closed = vi.fn();
    steps.push(press('data-custody-delete-save'));
    render(<CustodyDeleteOperationDialog id="op-r" onClose={closed} />);
    await settled();
    expect(raised).toHaveLength(1);
    expect(raised[0]?.variant).toBe('error');
    expect(raised[0]?.title).not.toBe(ar('fleet.custody.delete.taken'));
    expect(closed).not.toHaveBeenCalled();
  });

  it('while the operation loads, Save is busy and sends nothing', async () => {
    steps.push(press('data-custody-delete-save'));
    const html = render(<CustodyDeleteOperationDialog id="op-loading" onClose={vi.fn()} />);
    await settled();
    expect(api.sent).toEqual([]);
    expect(/<button[^>]*data-custody-delete-save="true"[^>]*>/u.exec(html)?.[0]).toContain(
      'disabled=""',
    );
  });
});

// ── Where the address opens it, and for whom ─────────────────────────────────────────────────

describe('`?deleteOp=` opens in the fund’s head — for whoever may delete', () => {
  it('opens for `fleetReceipt.delete`, even without `fleetReceipt.create`', () => {
    const html = render(<CustodyFundDialogs />, { path: '/fleet/custody/log?deleteOp=op-c' });
    expect(html).toContain('data-custody-delete="op-c"');
  });

  it('nothing for a writer who may not delete', () => {
    expect(
      render(<CustodyFundDialogs />, {
        path: '/fleet/custody/log?deleteOp=op-c',
        permissions: ['fleetCustody.view', 'fleetReceipt.create'],
      }),
    ).toBe('');
  });

  it('a delete-only reader never sees the fund’s dialogs', () => {
    for (const query of ['fund=charge', 'fund=replenish', 'confirm=op-h', 'cancelHeld=op-h']) {
      expect(render(<CustodyFundDialogs />, { path: `/fleet/custody/log?${query}` })).toBe('');
    }
  });
});
