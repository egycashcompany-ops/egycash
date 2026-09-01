// `computeAlarms` — the ASSEMBLY, not the rule.
//
// `computeAlarm` is pure and exhaustively tested beside this file, but a pure rule proves nothing
// about whether the projection actually feeds it. A guard can be perfect and still never fire,
// because the value it guards on is resolved somewhere else and quietly arrives as `null`. That
// failure is invisible to every test of the rule itself — so this file drives the real
// `computeAlarms` over stubbed repositories and asserts what comes OUT.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const vehicleId = new Types.ObjectId('650000000000000000000001');
const typeId = new Types.ObjectId('650000000000000000000011');
const workTypeId = new Types.ObjectId('650000000000000000000021');

const state = {
  latestReading: { reading: 59_850, date: new Date('2026-09-05T00:00:00.000Z') },
  baseline: {
    vehicleId: String(vehicleId),
    visitId: '650000000000000000000091',
    odometerAtService: 50_000,
    serviceDate: new Date('2026-08-31T00:00:00.000Z'),
  },
  lowerBound: null as { reading: number; date: Date } | null,
};

const lowerBoundsAt = vi.fn(async (pairs: readonly { vehicleId: string; on: Date }[]) =>
  state.lowerBound === null
    ? new Map<string, { reading: number; date: Date }>()
    : new Map(pairs.map((p) => [p.vehicleId, state.lowerBound as { reading: number; date: Date }])),
);

vi.mock('../../../platform/settings', () => ({
  settingsService: { resolve: async (key: string) => (key.endsWith('yellowKm') ? 1000 : 300) },
}));
vi.mock('../catalogs/catalog-item.repository', () => ({
  fleetCatalogItemRepository: {
    list: async () => ({ items: [{ _id: workTypeId }], meta: {} }),
  },
}));
vi.mock('../vehicle-types/vehicle-type.repository', () => ({
  fleetVehicleTypeRepository: { findById: async () => ({ maintenanceIntervalKm: 5000 }) },
}));
vi.mock('../vehicles/vehicle.repository', () => ({
  fleetVehicleRepository: {
    list: async () => ({ items: [{ _id: vehicleId, code: '200', typeId }], meta: {} }),
  },
}));
vi.mock('../odometer/odometer.repository', () => ({
  fleetOdometerRepository: {
    latestReadings: async () =>
      new Map([[String(vehicleId), { vehicleId: String(vehicleId), ...state.latestReading }]]),
    lowerBoundsAt: (pairs: readonly { vehicleId: string; on: Date }[]) => lowerBoundsAt(pairs),
  },
}));
vi.mock('./maintenance.repository', () => ({
  fleetMaintenanceRepository: {
    alarmBaselines: async () => new Map([[String(vehicleId), state.baseline]]),
  },
}));

const { computeAlarms } = await import('./maintenance-alarm');

const only = async () => {
  const rows = await computeAlarms();
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

beforeEach(() => {
  lowerBoundsAt.mockClear();
  state.lowerBound = null;
});

describe('the projection actually resolves the bracket bound and passes it on', () => {
  it('asks the chain about each baseline ON ITS OWN SERVICE DATE', () => {
    // The date is the whole point. Asking on "today" would compare a visit closed months ago
    // against a chain it never met, and every historical baseline would look broken.
    return computeAlarms().then(() => {
      expect(lowerBoundsAt).toHaveBeenCalledTimes(1);
      expect(lowerBoundsAt.mock.calls[0]![0]).toEqual([
        { vehicleId: String(vehicleId), on: state.baseline.serviceDate },
      ]);
    });
  });

  it('with NO reading before the service, the cycle measures normally', async () => {
    state.lowerBound = null;
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    expect(row.sinceServiceKm).toBe(9850);
  });

  it('with a reading the chain already held ABOVE the baseline, it refuses', async () => {
    // The car-200 shape. If the projection stopped resolving the bound — or resolved it and
    // dropped it — this row would come back as a measured 9,850 km and a red alarm instead.
    state.lowerBound = { reading: 59_800, date: new Date('2026-08-20T00:00:00.000Z') };
    const row = await only();
    expect(row.noAlarmReason).toBe('baselineBelowChain');
    expect(row.level).toBe('none');
    expect(row.sinceServiceKm).toBeNull();
    expect(row.remainingKm).toBeNull();
  });

  it('with a reading at or below the baseline, it measures — the boundary, through the assembly', async () => {
    state.lowerBound = { reading: 50_000, date: new Date('2026-08-20T00:00:00.000Z') };
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    expect(row.sinceServiceKm).toBe(9850);
  });

  it('and the visit the baseline came from still travels with the answer', async () => {
    state.lowerBound = { reading: 59_800, date: new Date('2026-08-20T00:00:00.000Z') };
    const row = await only();
    // A refused cycle still names the service it could not measure from — that is the record an
    // operator has to go and look at.
    expect(row.lastServiceVisitId).toBe(state.baseline.visitId);
    expect(row.lastServiceAt).toBe(state.baseline.serviceDate.toISOString());
  });
});
