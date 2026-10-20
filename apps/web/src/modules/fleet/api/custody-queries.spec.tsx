// The custody memos, the fund and the papers read and write through `fleet-queries.ts` — every key
// under the custody subtree, so a receipt written anywhere refreshes them too, and every write
// throws away exactly what it moves (a settle: the licence screen's «الحالة» as well). The
// realtime registry says the same for somebody ELSE's write (ADR-029).
//
// Driven through the real hooks, over a real QueryClient: each mutation is run against a stood-in
// api, and what it asked the cache to throw away is what is asserted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import { DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES } from '@ecms/contracts';
import { keysForTopic } from '../../../platform/realtime/invalidation-registry';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { store } from '../../../store';
import type * as ToastStore from '../../../shared/ui/toast/toast-store';

const calls = vi.hoisted(() => [] as { fn: string; args: unknown[] }[]);
/** When set, every stood-in write fails with it. */
const refuse = vi.hoisted(() => ({ with: null as unknown }));
/** Every error toast raised, in order — the hooks' own, and `GLOBAL` for the app's global one. */
const raised = vi.hoisted(() => [] as string[]);
vi.mock('../../../shared/ui/toast/toast-store', async (importOriginal) => {
  const actual = await importOriginal<typeof ToastStore>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: (title: string): string => {
        raised.push(title);
        return `toast-${raised.length}`;
      },
    },
  };
});

vi.mock('./fleet-api', async (original) => {
  const actual = await original<Record<string, unknown>>();
  const doc = (fn: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ fn, args });
      if (refuse.with !== null) throw refuse.with;
      return { id: '650000000000000000000001', version: 1 };
    });
  return {
    ...actual,
    createCustodyMemo: doc('createCustodyMemo'),
    updateCustodyMemo: doc('updateCustodyMemo'),
    deleteCustodyMemo: doc('deleteCustodyMemo'),
    chargeCustody: doc('chargeCustody'),
    replenishCustody: doc('replenishCustody'),
    settleCustody: doc('settleCustody'),
    saveCustodyPaperSettings: doc('saveCustodyPaperSettings'),
    createLicenseExpense: doc('createLicenseExpense'),
    updateLicenseExpense: doc('updateLicenseExpense'),
    deleteLicenseExpense: doc('deleteLicenseExpense'),
    createReceipt: doc('createReceipt'),
    updateReceipt: doc('updateReceipt'),
    deleteReceipt: doc('deleteReceipt'),
    uploadReceiptImage: doc('uploadReceiptImage'),
    deleteReceiptImage: doc('deleteReceiptImage'),
  };
});

const queries = await import('./fleet-queries');

type Hook = () => { mutateAsync: (input: never) => Promise<unknown> };

/** Runs one mutation hook's write and answers with every key it invalidated, and the cache. */
const run = async (hook: unknown, input: unknown): Promise<{ keys: string[]; qc: QueryClient }> => {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  let mutation: { mutateAsync: (input: never) => Promise<unknown> } | null = null;
  const Probe = (): null => {
    mutation = (hook as Hook)();
    return null;
  };
  renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  await (mutation as unknown as { mutateAsync: (input: unknown) => Promise<unknown> }).mutateAsync(
    input,
  );
  return { keys: spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey)), qc };
};

afterEach(() => {
  vi.restoreAllMocks();
  calls.length = 0;
  refuse.with = null;
  raised.length = 0;
});

const ID = '650000000000000000000001';
const CUSTODY = JSON.stringify(['fleet', 'custody']);
const RECEIPTS = JSON.stringify(['fleet', 'receipts']);
const LICENCE = JSON.stringify(['fleet', 'licenseExpenses']);

describe('the custody keys', () => {
  it('all sit under the custody subtree — a receipt written refreshes every one of them', () => {
    for (const key of [
      queries.custodyFundKey,
      queries.custodyLedgerKey,
      queries.custodyMemosKey,
      queries.custodyPaperSettingsKey,
    ]) {
      expect(key.slice(0, 2)).toEqual(['fleet', 'custody']);
    }
    expect(queries.custodyFundKey).toEqual(['fleet', 'custody', 'fund']);
    expect(queries.custodyLedgerKey).toEqual(['fleet', 'custody', 'ledger']);
    expect(queries.custodyMemosKey).toEqual(['fleet', 'custody', 'memos']);
    expect(queries.custodyPaperSettingsKey).toEqual(['fleet', 'custody', 'paper-settings']);
    const k = queries.custodyQueryKeys;
    const all = [
      k.fund(),
      k.ledger({ page: 1 }),
      k.ledgerTotals({}),
      k.operation(ID),
      k.candidates('replenish'),
      k.candidates('settle'),
      k.memos({ page: 1 }),
      k.memoTotals({}),
      k.memosOutside(),
      k.memo(ID),
      k.memoCandidates({ kind: 'fuel' }),
      k.paperSettings(),
    ];
    for (const key of all)
      expect(key.slice(0, 2), JSON.stringify(key)).toEqual(['fleet', 'custody']);
    // No two readers share a key.
    expect(new Set(all.map((key) => JSON.stringify(key))).size).toBe(all.length);
  });

  it('never shows another kind’s candidates while this kind’s are on their way', () => {
    // Another kind's receipts under this kind's tab would be ticked as this kind's.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const fuel = { nextNo: 7, receipts: [], missionOptions: [], truncated: false };
    qc.setQueryData(queries.custodyQueryKeys.memoCandidates({ kind: 'fuel' }), fuel);
    const observer = new QueryObserver(
      qc,
      queries.custodyMemoCandidatesOptions({ kind: 'fuel' }, false),
    );
    const stop = observer.subscribe(() => undefined);
    expect(observer.getCurrentResult().data).toEqual(fuel);
    observer.setOptions(queries.custodyMemoCandidatesOptions({ kind: 'tyres' }, false));
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    stop();
  });
});

describe('every custody write throws away what it moves', () => {
  it.each([
    ['a memo saved', queries.useCreateCustodyMemo, { kind: 'tyres', lines: [] }],
    ['a memo changed', queries.useUpdateCustodyMemo, { id: ID, body: { version: 0 } }],
    ['a memo deleted', queries.useDeleteCustodyMemo, ID],
    ['a replenish', queries.useReplenishCustody, { memoIds: [ID] }],
  ])('%s — the custody subtree and the receipts (each says its memo)', async (_, hook, input) => {
    const { keys } = await run(hook, input);
    expect(keys).toContain(CUSTODY);
    expect(keys).toContain(RECEIPTS);
  });

  it('a charge — the custody subtree', async () => {
    const { keys } = await run(queries.useChargeCustody, { amount: 100, reason: '' });
    expect(keys).toEqual([CUSTODY]);
  });

  it('a settle — the custody subtree and the licence screen’s «الحالة»', async () => {
    const { keys } = await run(queries.useSettleCustody, {
      parts: [{ expenseId: ID, part: 'renewal' }],
    });
    expect(keys).toContain(CUSTODY);
    expect(keys).toContain(LICENCE);
  });

  it.each([
    ['created', queries.useCreateLicenseExpense, { date: new Date() }],
    ['changed', queries.useUpdateLicenseExpense, { id: ID, body: { version: 0 } }],
    ['deleted', queries.useDeleteLicenseExpense, ID],
  ])(
    'a licence record %s — its screen and the fund’s settle candidates',
    async (_, hook, input) => {
      const { keys } = await run(hook, input);
      expect(keys).toContain(LICENCE);
      expect(keys).toContain(CUSTODY);
    },
  );

  it('a receipt written refreshes the custody subtree, as it did', async () => {
    const { keys } = await run(queries.useCreateReceipt, {});
    expect(keys).toContain(CUSTODY);
    expect(keys).toContain(RECEIPTS);
  });

  it('the papers’ names go straight into the cache, then are read again', async () => {
    const { keys, qc } = await run(queries.useSaveCustodyPaperSettings, { papers: {} });
    expect(qc.getQueryData(queries.custodyPaperSettingsKey)).toEqual({
      id: ID,
      version: 1,
    });
    expect(keys).toEqual([JSON.stringify(queries.custodyPaperSettingsKey)]);
  });

  it('calls the api with what it was handed', async () => {
    await run(queries.useUpdateCustodyMemo, { id: ID, body: { version: 3 } });
    expect(calls).toEqual([{ fn: 'updateCustodyMemo', args: [ID, { version: 3 }] }]);
  });
});

describe('and so is a screen left open when somebody ELSE makes that write', () => {
  const keys = (topic: string): string[] => keysForTopic(topic).map((key) => JSON.stringify(key));

  it('a memo: the custody subtree and the receipts', () => {
    expect(keys('fleet.custodyMemo')).toEqual([CUSTODY, RECEIPTS]);
  });
  it('an operation: the custody subtree and the licence screen', () => {
    expect(keys('fleet.custodyOperation')).toEqual([CUSTODY, LICENCE]);
  });
  it('the papers’ names: the custody subtree', () => {
    expect(keys('fleet.custodyPaperSettings')).toEqual([CUSTODY]);
  });
  it('a licence record: its screen and the custody subtree', () => {
    expect(keys('fleet.licenseExpense')).toEqual([LICENCE, CUSTODY]);
  });
});

describe('a failure is said once — by the screen when it names it, by the usual toast when not', () => {
  const REFUSALS = {
    locked: new ApiError('BUSINESS_RULE_VIOLATION', 'Settled memos cannot change', 422),
    stale: new ApiError('STALE_DOCUMENT', 'Document was modified', 409),
    duplicate: new ApiError('DUPLICATE', 'Receipt already on a memo', 409),
    gone: new ApiError('NOT_FOUND', 'Not found', 404),
    lines: new ApiError('VALIDATION_FAILED', 'Invalid', 400, [
      { field: 'lines.0.receiptId', code: 'custom', message: 'changed' },
    ]),
    server: new ApiError('INTERNAL', 'Boom', 500),
    network: new TypeError('Failed to fetch'),
  } as const;
  type Refusal = keyof typeof REFUSALS;
  const ALL = Object.keys(REFUSALS) as Refusal[];

  /**
   * Runs one write that fails with `refusal`, over a client whose global handler is the app's
   * (query-client.ts): it toasts `GLOBAL` for any mutation that declares no `onError` of its own.
   */
  const fail = async (hook: unknown, input: unknown, refusal: Refusal): Promise<string[]> => {
    raised.length = 0;
    refuse.with = REFUSALS[refusal];
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
      mutationCache: new MutationCache({
        onError: (_error, _variables, _context, mutation) => {
          if (mutation.options.onError === undefined) raised.push('GLOBAL');
        },
      }),
    });
    let mutation: { mutateAsync: (input: unknown) => Promise<unknown> } | null = null;
    const Probe = (): null => {
      mutation = (hook as Hook)() as unknown as typeof mutation;
      return null;
    };
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    await expect(
      (mutation as unknown as { mutateAsync: (i: unknown) => Promise<unknown> }).mutateAsync(input),
    ).rejects.toBe(REFUSALS[refusal]);
    return [...raised];
  };
  const usual = (refusal: Refusal): string =>
    errorMessage(REFUSALS[refusal], store.getState().locale.locale);

  it.each([
    ['a memo saved', queries.useCreateCustodyMemo, { kind: 'tyres', lines: [] }],
    ['a memo changed', queries.useUpdateCustodyMemo, { id: ID, body: { version: 0 } }],
    ['a memo deleted', queries.useDeleteCustodyMemo, ID],
    ['a replenish', queries.useReplenishCustody, { memoIds: [ID] }],
    ['a settle', queries.useSettleCustody, { parts: [{ expenseId: ID, part: 'renewal' }] }],
    ['a charge', queries.useChargeCustody, { amount: 100, reason: '' }],
    ['a licence record added', queries.useCreateLicenseExpense, { date: new Date() }],
    ['a licence record changed', queries.useUpdateLicenseExpense, { id: ID, body: { version: 0 } }],
    ['a licence record deleted', queries.useDeleteLicenseExpense, ID],
    [
      'the papers’ names saved',
      queries.useSaveCustodyPaperSettings,
      { papers: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES },
    ],
  ])('%s — its screen words every failure, so nothing else does', async (_, hook, input) => {
    // The editor, «المذكرات», the three fund dialogs and the licence screens each say a refusal in
    // so many words and every other failure with the usual sentence: a second toast would repeat it.
    for (const refusal of ALL) expect(await fail(hook, input, refusal), refusal).toEqual([]);
  });

  it('a receipt changed — the form names a memo’s lock and a stale receipt; the rest as usual', async () => {
    const input = { id: ID, body: { version: 0 } };
    for (const refusal of ['locked', 'stale'] as const) {
      expect(await fail(queries.useUpdateReceipt, input, refusal), refusal).toEqual([]);
    }
    for (const refusal of ['duplicate', 'gone', 'lines', 'server', 'network'] as const) {
      expect(await fail(queries.useUpdateReceipt, input, refusal), refusal).toEqual([
        usual(refusal),
      ]);
    }
  });

  it('a receipt deleted — the board names a memo’s lock; the rest as usual', async () => {
    expect(await fail(queries.useDeleteReceipt, ID, 'locked')).toEqual([]);
    for (const refusal of ['stale', 'gone', 'server', 'network'] as const) {
      expect(await fail(queries.useDeleteReceipt, ID, refusal), refusal).toEqual([usual(refusal)]);
    }
  });

  it.each([
    ['a receipt added', queries.useCreateReceipt, {}],
    ['a receipt’s photo uploaded', queries.useUploadReceiptImage, { id: ID, file: null }],
    ['a receipt’s photo deleted', queries.useDeleteReceiptImage, ID],
  ])('%s — names no refusal, and keeps the global toast', async (_, hook, input) => {
    for (const refusal of ['locked', 'server'] as const) {
      expect(await fail(hook, input, refusal), refusal).toEqual(['GLOBAL']);
    }
  });
});
