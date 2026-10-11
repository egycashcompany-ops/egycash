// Every write that moves the maintenance alarm refreshes the alarms board (C2).
//
// The board's query has a key of its own, outside the odometer and maintenance subtrees — one key
// whichever permission door fills it (`fleet-alarm-permission.spec.tsx`). So the writes that only
// invalidated their own subtree never reached it: a reading recorded or corrected, a visit closed,
// a work type made to count, a car's type changed — and the board kept answering with the figure
// from before, for up to its 30 s, or until the page was reloaded. During the readings fix that
// read as «the fix did not work».
//
// Driven through the real hooks, over a real QueryClient: each mutation is run, and what it asked
// the cache to throw away is what is asserted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ALL_REALTIME_KEY_PREFIXES,
  keysForTopic,
} from '../../platform/realtime/invalidation-registry';

vi.mock('./api/fleet-api', async (original) => {
  const actual = await original<Record<string, unknown>>();
  const doc = async () => ({ id: '650000000000000000000001' });
  return {
    ...actual,
    recordOdometer: vi.fn(doc),
    correctOdometer: vi.fn(doc),
    deleteOdometer: vi.fn(async () => undefined),
    checkInMaintenance: vi.fn(doc),
    checkOutMaintenance: vi.fn(doc),
    reopenMaintenance: vi.fn(doc),
    updateMaintenance: vi.fn(doc),
    deleteMaintenance: vi.fn(async () => undefined),
    createVehicle: vi.fn(doc),
    updateVehicle: vi.fn(doc),
    changeVehicleStatus: vi.fn(doc),
    deleteVehicle: vi.fn(async () => undefined),
    createVehicleType: vi.fn(doc),
    updateVehicleType: vi.fn(doc),
    createCatalogItem: vi.fn(doc),
    updateCatalogItem: vi.fn(doc),
  };
});

// The settings write is the platform's; what Fleet adds is the callback naming its own caches, so
// the platform hook is stood in for by one that runs that callback when the write succeeds.
vi.mock('../../platform/settings/settings-api', () => ({
  useSetSetting: (onSuccessExtra?: () => void) => ({
    mutateAsync: async () => onSuccessExtra?.(),
  }),
}));

const queries = await import('./api/fleet-queries');

const ALARMS = JSON.stringify(['fleet', 'alarms']);

/** Runs one mutation hook's write and answers with every key it invalidated. */
const invalidatedBy = async (
  hook: () => { mutateAsync: (input: never) => Promise<unknown> },
  input: unknown,
): Promise<string[]> => {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  let mutation: { mutateAsync: (input: never) => Promise<unknown> } | null = null;
  const Probe = (): null => {
    mutation = hook();
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
  return spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
};

afterEach(() => {
  vi.restoreAllMocks();
});

const ID = '650000000000000000000001';

describe('the alarms board is refreshed by every write that moves it', () => {
  it.each([
    [
      'recording a reading',
      queries.useRecordOdometer,
      { vehicleId: ID, reading: 1, date: new Date() },
    ],
    ['correcting a reading', queries.useCorrectOdometer, { id: ID, body: { version: 0 } }],
    ['deleting a reading', queries.useDeleteOdometer, ID],
    ['checking a car in', queries.useCheckInMaintenance, {}],
    ['checking a car out', queries.useCheckOutMaintenance, { id: ID, body: {} }],
    ['reopening a visit', queries.useReopenMaintenance, { id: ID, version: 0 }],
    ['editing a visit', queries.useUpdateMaintenance, { id: ID, body: { version: 0 } }],
    ['deleting a visit', queries.useDeleteMaintenance, ID],
    ['adding a car', queries.useCreateVehicle, {}],
    ['editing a car', queries.useUpdateVehicle, { id: ID, body: {} }],
    ['changing a car’s status', queries.useChangeVehicleStatus, { id: ID, body: {} }],
    ['deleting a car', queries.useDeleteVehicle, ID],
    ['adding a vehicle type', queries.useCreateVehicleType, {}],
    ['changing a type’s interval', queries.useUpdateVehicleType, { id: ID, body: {} }],
    ['adding a work type', queries.useCreateCatalogItem, {}],
    ['making a work type count', queries.useUpdateCatalogItem, { id: ID, body: {} }],
    ['changing the yellow or red threshold', queries.useSetFleetSetting, {}],
  ] as const)('%s', async (_name, hook, input) => {
    const keys = await invalidatedBy(
      hook as unknown as () => { mutateAsync: (input: never) => Promise<unknown> },
      input,
    );
    expect(keys, 'the alarms board is thrown away').toContain(ALARMS);
  });

  it('and a reading write still refreshes the odometer screens as it did', async () => {
    const keys = await invalidatedBy(
      queries.useRecordOdometer as unknown as () => {
        mutateAsync: (input: never) => Promise<unknown>;
      },
      { vehicleId: ID, reading: 1, date: new Date() },
    );
    expect(keys).toContain(JSON.stringify(['fleet', 'odometer']));
  });
});

describe('and so is a board left open when somebody ELSE makes that write', () => {
  // The realtime registry says what the local `onSuccess` says (ADR-029): the signal of another
  // session's write reaches the same keys — and the reconnect sweep, built from the registry, too.
  it.each([
    'fleet.odometerLog',
    'fleet.maintenanceVisit',
    'fleet.vehicle',
    'fleet.vehicleType',
    'fleet.catalogItem',
  ])('%s', (topic) => {
    expect(keysForTopic(topic).map((key) => JSON.stringify(key))).toContain(ALARMS);
  });

  it('the reconnect sweep throws it away too', () => {
    expect(ALL_REALTIME_KEY_PREFIXES.map((key) => JSON.stringify(key))).toContain(ALARMS);
  });
});
