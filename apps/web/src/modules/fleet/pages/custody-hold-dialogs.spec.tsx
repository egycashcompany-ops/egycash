// «تأكيد التحويل» and «إلغاء الاستعاضة المعلّقة» pressed — what each sends, once per press, and
// what each says: done, refused because it was confirmed or cancelled elsewhere (409 / 404), or a
// transfer day before the letter's (422, and refused before sending).
//
// The suite has no DOM, so nothing here clicks: a press or a typed value is played INSIDE the
// render that draws its control (`steps`, as custody-fund-dialogs.spec.tsx does). The API is a set
// of stubs, the toasts a list.
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
  type FleetCustodyOperationDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import type * as JsxRuntime from 'react/jsx-runtime';
import type * as JsxDevRuntime from 'react/jsx-dev-runtime';
import type * as ToastStore from '../../../shared/ui/toast/toast-store';
import type * as FleetApi from '../api/fleet-api';

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

const api = vi.hoisted(() => ({
  confirm: [] as unknown[],
  cancel: [] as unknown[],
  refuse: null as unknown,
}));
vi.mock('../api/fleet-api', async (importOriginal) => {
  const actual = await importOriginal<typeof FleetApi>();
  const write =
    (name: 'confirm' | 'cancel') =>
    async (id: string, body: unknown): Promise<unknown> => {
      api[name].push({ id, body });
      if (api.refuse !== null) throw api.refuse;
      return {};
    };
  return {
    ...actual,
    confirmCustodyTransfer: write('confirm'),
    cancelCustodyReplenishment: write('cancel'),
  };
});
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { custodyQueryKeys } = await import('../api/fleet-queries');
const { CustodyConfirmTransferDialog } = await import('../components/CustodyConfirmTransferDialog');
const { CustodyCancelHeldDialog } = await import('../components/CustodyCancelHeldDialog');

const STAMP = '2026-10-19T10:00:00.000Z';
const OP: FleetCustodyOperationDto = {
  id: 'op-h1',
  kind: 'replenish',
  status: 'held',
  transfer: null,
  cancellation: null,
  date: '2026-10-19',
  from: null,
  to: null,
  amount: 600,
  reason: '',
  memos: [
    {
      memoId: 'm7',
      no: 7,
      kind: 'wash',
      name: '',
      from: '2026-10-01',
      to: '2026-10-17',
      receipts: 4,
      amount: 600,
    },
  ],
  parts: [],
  fundBefore: 17492,
  chargedTotal: 100000,
  letterFigure: 100000,
  signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
  ledger: { before: 17492, after: 17492 },
  deletion: null,
  createdByName: null,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
};
const FUND = {
  fundTotal: 17492,
  held: { count: 1, amount: 600, memos: 1, receipts: 4 },
} as unknown as FleetCustodyFundSummaryDto;

const render = (node: ReactNode): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(custodyQueryKeys.fund(), FUND);
  qc.setQueryData(custodyQueryKeys.operation('op-h1'), OP);
  return renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: {
            me: {
              id: 'u-1',
              permissions: {
                'fleetCustody.view': 'organization',
                'fleetReceipt.create': 'organization',
              },
            } as unknown as MeDto,
            status: 'signedIn' as const,
          },
          ui: { theme: 'light' as const, sidebarOpen: false },
        },
      })}
    >
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/custody/log?confirm=op-h1']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
  steps.length = 0;
  raised.length = 0;
  api.confirm.length = 0;
  api.cancel.length = 0;
  api.refuse = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('«تأكيد التحويل» pressed', () => {
  it('sends today, the reference typed and the note — once for a double press — and closes', async () => {
    const closed = vi.fn();
    steps.push(
      type('data-memo-confirm-ref', ' TRF-2026-4471 '),
      press('data-memo-confirm-save', 2),
    );
    render(<CustodyConfirmTransferDialog id="op-h1" onClose={closed} />);
    await settled();
    expect(api.confirm).toEqual([
      {
        id: 'op-h1',
        body: { date: new Date('2026-10-20T00:00:00.000Z'), reference: 'TRF-2026-4471', note: '' },
      },
    ]);
    expect(raised).toEqual([{ variant: 'success', title: ar('fleet.custody.hold.confirmDone') }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('while the replenishment loads, Save shows its spinner (busy, not a silent disabled) and sends nothing', async () => {
    steps.push(press('data-memo-confirm-save'));
    const html = render(<CustodyConfirmTransferDialog id="op-loading" onClose={vi.fn()} />);
    await settled();
    expect(api.confirm).toEqual([]);
    expect(/<button[^>]*data-memo-confirm-save="true"[^>]*>/u.exec(html)?.[0]).toContain(
      'aria-busy="true"',
    );
    const loaded = render(<CustodyConfirmTransferDialog id="op-h1" onClose={vi.fn()} />);
    expect(/<button[^>]*data-memo-confirm-save="true"[^>]*>/u.exec(loaded)?.[0]).toContain(
      'aria-busy="false"',
    );
  });

  it('refuses a day before the letter’s, naming it — nothing is sent', async () => {
    steps.push(type('data-memo-confirm-date', '2026-10-18'), press('data-memo-confirm-save'));
    const html = render(<CustodyConfirmTransferDialog id="op-h1" onClose={vi.fn()} />);
    await settled();
    expect(api.confirm).toEqual([]);
    expect(html).toContain('data-missing-fields="true"');
    expect(html).toContain(ar('fleet.custody.hold.transferBeforeLetter', { date: '2026/10/19' }));
  });

  it('confirmed or cancelled elsewhere meanwhile (409): says so and closes', async () => {
    api.refuse = new ApiError('CONFLICT', 'was cancelled', 409);
    const closed = vi.fn();
    steps.push(press('data-memo-confirm-save'));
    render(<CustodyConfirmTransferDialog id="op-h1" onClose={closed} />);
    await settled();
    expect(raised).toEqual([{ variant: 'error', title: ar('fleet.custody.hold.confirmTaken') }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('a day the server finds before the letter’s (422): says so and stays open', async () => {
    api.refuse = new ApiError('BUSINESS_RULE_VIOLATION', 'before the letter', 422);
    const closed = vi.fn();
    steps.push(press('data-memo-confirm-save'));
    render(<CustodyConfirmTransferDialog id="op-h1" onClose={closed} />);
    await settled();
    expect(raised).toEqual([
      {
        variant: 'error',
        title: ar('fleet.custody.hold.transferBeforeLetter', { date: '2026/10/19' }),
      },
    ]);
    expect(closed).not.toHaveBeenCalled();
  });
});

describe('«إلغاء الاستعاضة المعلّقة» pressed', () => {
  it('sends the reason typed — once — says its memos went back, and closes', async () => {
    const closed = vi.fn();
    steps.push(
      type('data-memo-cancel-reason', ' أُلغي الخطاب '),
      press('data-memo-cancel-save', 2),
    );
    render(<CustodyCancelHeldDialog id="op-h1" onClose={closed} />);
    await settled();
    expect(api.cancel).toEqual([{ id: 'op-h1', body: { reason: 'أُلغي الخطاب' } }]);
    expect(raised).toEqual([{ variant: 'success', title: ar('fleet.custody.hold.cancelDone') }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('nothing typed is fine — the reason is optional', async () => {
    steps.push(press('data-memo-cancel-save'));
    render(<CustodyCancelHeldDialog id="op-h1" onClose={vi.fn()} />);
    await settled();
    expect(api.cancel).toEqual([{ id: 'op-h1', body: { reason: '' } }]);
  });

  it('confirmed or cancelled elsewhere meanwhile (404 / 409): says nothing was cancelled, closes', async () => {
    api.refuse = new ApiError('NOT_FOUND', 'gone', 404);
    const closed = vi.fn();
    steps.push(press('data-memo-cancel-save'));
    render(<CustodyCancelHeldDialog id="op-h1" onClose={closed} />);
    await settled();
    expect(raised).toEqual([{ variant: 'error', title: ar('fleet.custody.hold.cancelTaken') }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
