// «مطابقة أرصدة الكروت» reads and decides through `fuel-reconcile-queries.ts`. Driven through the
// real hooks over a real QueryClient, with a stood-in api: what each write asked the cache to throw
// away, and which failures it leaves to the global toast — the screen words its own refusals (the
// sheet's layout, an unreadable or oversized file; a card that moved after the read, or was
// already decided), so a second toast with the server's English sentence must never appear.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCodes } from '@ecms/contracts';
import { keysForTopic } from '../../../platform/realtime/invalidation-registry';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { listKey } from '../../../shared/lib/query-keys';
import { store } from '../../../store';
import type * as ToastStore from '../../../shared/ui/toast/toast-store';

const calls = vi.hoisted(() => [] as { fn: string; args: unknown[] }[]);
/** When set, every stood-in call fails with it. */
const refuse = vi.hoisted(() => ({ with: null as unknown }));
/** Every error toast raised, in order — the hook's own, and `GLOBAL` for the app's global one. */
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
vi.mock('./fuel-reconcile-api', () => {
  const stood = (fn: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ fn, args });
      if (refuse.with !== null) throw refuse.with;
      return fn === 'decideFuelReconcile' || fn === 'decideFuelLinks' ? [] : { id: ID };
    });
  return {
    uploadFuelSheet: stood('uploadFuelSheet'),
    decideFuelReconcile: stood('decideFuelReconcile'),
    decideFuelLinks: stood('decideFuelLinks'),
    addSheetCard: stood('addSheetCard'),
  };
});

const queries = await import('./fuel-reconcile-queries');

const ID = '650000000000000000000001';
const CARD = '650000000000000000000002';
const FUEL_CARDS = JSON.stringify(['fleet', 'fuelCards']);
const file = { name: 'wataniya.xlsx' } as unknown as File;

type Mutation = { mutateAsync: (input: unknown) => Promise<unknown> };

/** Mounts one hook over `qc` and hands back its mutation. */
const mount = (hook: () => unknown, qc: QueryClient): Mutation => {
  let mutation: Mutation | null = null;
  const Probe = (): null => {
    mutation = hook() as Mutation;
    return null;
  };
  renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return mutation as unknown as Mutation;
};

afterEach(() => {
  vi.restoreAllMocks();
  calls.length = 0;
  refuse.with = null;
  raised.length = 0;
});

describe('the keys', () => {
  it('a decision throws away the whole fuel-card subtree — cards, boxes, every open card log', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await mount(queries.useDecideFuelReconcile, qc).mutateAsync({
      id: ID,
      body: { decision: 'apply', cardIds: [CARD] },
    });
    expect(spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey))).toEqual([FUEL_CARDS]);
    expect(JSON.stringify(queries.fuelCardsSubtreeKey)).toBe(FUEL_CARDS);
    // The card log and the boxes the screen reads sit under it.
    expect(
      JSON.stringify(listKey('fleet', 'fuelCards', { movements: CARD })).startsWith(
        FUEL_CARDS.slice(0, -1),
      ),
    ).toBe(true);
    expect(calls).toEqual([
      { fn: 'decideFuelReconcile', args: [ID, { decision: 'apply', cardIds: [CARD] }] },
    ]);
  });

  it('reading a sheet writes no balance, so it throws nothing away', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await mount(queries.useUploadFuelSheet, qc).mutateAsync({ company: 'wataniya', file });
    expect(spy).not.toHaveBeenCalled();
    expect(calls).toEqual([{ fn: 'uploadFuelSheet', args: ['wataniya', file] }]);
  });

  it('batch 3: «تاريخ الشيت» rides along with the file only when given', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    await mount(queries.useUploadFuelSheet, qc).mutateAsync({
      company: 'chillout',
      file,
      sheetDate: '2026-11-01',
    });
    await mount(queries.useUploadFuelSheet, qc).mutateAsync({
      company: 'chillout',
      file,
      sheetDate: '',
    });
    expect(calls).toEqual([
      { fn: 'uploadFuelSheet', args: ['chillout', file, '2026-11-01'] },
      { fn: 'uploadFuelSheet', args: ['chillout', file] },
    ]);
  });

  it('batch 3: a link decision and «إضافة» throw the fuel-card subtree away too', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const links = { decision: 'apply', cardIds: [CARD], pick: [], remember: false };
    await mount(queries.useDecideFuelLinks, qc).mutateAsync({ id: ID, body: links });
    const add = {
      sheetRow: 60,
      number: '5485640068837791',
      expiresAt: new Date('2029-05-31T00:00:00.000Z'),
      password: '1234',
      vehicleId: null,
      label: 'سفر 9',
    };
    await mount(queries.useAddSheetCard, qc).mutateAsync({ id: ID, body: add });
    expect(spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey))).toEqual([
      FUEL_CARDS,
      FUEL_CARDS,
    ]);
    expect(calls).toEqual([
      { fn: 'decideFuelLinks', args: [ID, links] },
      { fn: 'addSheetCard', args: [ID, add] },
    ]);
  });

  it('somebody ELSE’s decision reaches an open screen through the fuel card’s own entity', () => {
    expect(keysForTopic('fleet.fuelCard').map((key) => JSON.stringify(key))).toContain(FUEL_CARDS);
  });
});

describe('a failure is said once — by the screen when it names it, by the usual toast when not', () => {
  const REFUSALS = {
    layout: new ApiError(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT, 'Missing header', 422, [
      { field: 'file', code: 'MISSING_HEADER', message: 'Card Balance' },
    ]),
    readCap: new ApiError(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT, 'Too large', 422, [
      { field: 'file', code: 'TOO_LARGE', message: 'rows' },
    ]),
    unreadable: new ApiError(ErrorCodes.VALIDATION_FAILED, 'Unreadable', 422, [
      { field: 'file', code: 'UNREADABLE', message: 'not a workbook' },
    ]),
    noFile: new ApiError(ErrorCodes.VALIDATION_FAILED, 'Invalid', 400, [
      { field: 'file', code: 'REQUIRED', message: 'required' },
    ]),
    tooLarge: new ApiError(ErrorCodes.FILE_TOO_LARGE, 'Too large', 422, [
      { field: 'file', code: 'TOO_LARGE', message: '10 MB' },
    ]),
    moved: new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'Changed', 409, [
      { field: 'cardIds', code: 'CARD_CHANGED', message: CARD },
    ]),
    decided: new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'Decided', 409, [
      { field: 'cardIds', code: 'DECIDED', message: CARD },
    ]),
    company: new ApiError(ErrorCodes.VALIDATION_FAILED, 'Invalid', 400, [
      { field: 'body.company', code: 'invalid_enum_value', message: 'bad' },
    ]),
    notInSheet: new ApiError(ErrorCodes.VALIDATION_FAILED, 'Invalid', 400, [
      { field: 'body.cardIds', code: 'NOT_IN_SHEET', message: CARD },
    ]),
    cancel: new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_CANCEL_REFUSED, 'Refused', 422, [
      { field: 'cancelCharges', code: 'EXCEEDS_DIFFERENCE', message: CARD },
    ]),
    linkChanged: new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'Changed', 409, [
      { field: 'cardIds', code: 'LINK_CHANGED', message: CARD },
    ]),
    slotHeld: new ApiError(ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD, 'Held', 409, [
      { field: 'cardIds', code: 'SLOT_HELD', message: CARD },
    ]),
    inRepair: new ApiError(ErrorCodes.FLEET_FUEL_LINK_IN_REPAIR, 'Repair', 409, [
      { field: 'cardIds', code: 'IN_REPAIR', message: CARD },
    ]),
    noPick: new ApiError(ErrorCodes.VALIDATION_FAILED, 'Invalid', 400, [
      { field: 'body.pick', code: 'REQUIRED', message: CARD },
    ]),
    number: new ApiError(ErrorCodes.FLEET_FUEL_SHEET_CARD_NUMBER, 'Number', 422, [
      { field: 'number', code: 'MISMATCH', message: 'number' },
    ]),
    duplicate: new ApiError(ErrorCodes.DUPLICATE, 'Duplicate', 409),
    gone: new ApiError('NOT_FOUND', 'Not found', 404),
    server: new ApiError('INTERNAL', 'Boom', 500),
    network: new TypeError('Failed to fetch'),
  } as const;
  type Refusal = keyof typeof REFUSALS;

  /** Runs one write that fails with `refusal`, over a client whose global handler is the app's. */
  const fail = async (hook: () => unknown, input: unknown, refusal: Refusal): Promise<string[]> => {
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
    await expect(mount(hook, qc).mutateAsync(input)).rejects.toBe(REFUSALS[refusal]);
    return [...raised];
  };
  const usual = (refusal: Refusal): string =>
    errorMessage(REFUSALS[refusal], store.getState().locale.locale);

  it('reading a sheet — the screen words the sheet’s refusals; the rest as usual', async () => {
    const input = { company: 'wataniya', file };
    for (const refusal of ['layout', 'readCap', 'unreadable', 'noFile', 'tooLarge'] as const) {
      expect(await fail(queries.useUploadFuelSheet, input, refusal), refusal).toEqual([]);
    }
    for (const refusal of ['company', 'gone', 'server', 'network'] as const) {
      expect(await fail(queries.useUploadFuelSheet, input, refusal), refusal).toEqual([
        usual(refusal),
      ]);
    }
  });

  it('a decision — the screen words a moved card and one already decided; the rest as usual', async () => {
    const input = { id: ID, body: { decision: 'apply', cardIds: [CARD] } };
    for (const refusal of ['moved', 'decided'] as const) {
      expect(await fail(queries.useDecideFuelReconcile, input, refusal), refusal).toEqual([]);
    }
    for (const refusal of ['notInSheet', 'layout', 'gone', 'server', 'network'] as const) {
      expect(await fail(queries.useDecideFuelReconcile, input, refusal), refusal).toEqual([
        usual(refusal),
      ]);
    }
    // Batch 3: a refused cancel is the screen's to say.
    expect(await fail(queries.useDecideFuelReconcile, input, 'cancel')).toEqual([]);
  });

  it('batch 3: a link decision — the screen words a changed card, a held slot, the repair, a pick', async () => {
    const input = {
      id: ID,
      body: { decision: 'apply', cardIds: [CARD], pick: [], remember: false },
    };
    for (const refusal of ['linkChanged', 'decided', 'slotHeld', 'inRepair', 'noPick'] as const) {
      expect(await fail(queries.useDecideFuelLinks, input, refusal), refusal).toEqual([]);
    }
    for (const refusal of ['notInSheet', 'gone', 'server', 'network'] as const) {
      expect(await fail(queries.useDecideFuelLinks, input, refusal), refusal).toEqual([
        usual(refusal),
      ]);
    }
  });

  it('batch 3: «إضافة» — the screen words the number and a row already added; the rest as usual', async () => {
    const input = { id: ID, body: { sheetRow: 60 } };
    for (const refusal of ['number', 'decided'] as const) {
      expect(await fail(queries.useAddSheetCard, input, refusal), refusal).toEqual([]);
    }
    for (const refusal of ['duplicate', 'gone', 'server', 'network'] as const) {
      expect(await fail(queries.useAddSheetCard, input, refusal), refusal).toEqual([
        usual(refusal),
      ]);
    }
  });
});
