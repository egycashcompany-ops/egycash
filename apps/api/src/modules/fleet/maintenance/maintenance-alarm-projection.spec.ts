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

const SERVICE_DATE = new Date('2026-08-31T00:00:00.000Z');

const state = {
  latestReading: { reading: 59_850, date: new Date('2026-09-05T00:00:00.000Z') },
  baseline: {
    vehicleId: String(vehicleId),
    visitId: '650000000000000000000091',
    odometerAtService: 50_000 as number | null,
    serviceDate: SERVICE_DATE,
    // An exit counter by default: read the day the car left, which is the service date.
    counterDate: SERVICE_DATE,
  },
  lowerBound: null as { reading: number; date: Date } | null,
  /** Per asked-on day, when a case needs the chain to answer differently by date. */
  lowerBoundOn: null as ((on: Date) => { reading: number; date: Date } | null) | null,
};

/** Days the car ran with nobody writing the counter — see the DTO field; no days by default. */
const daysWithoutReadingSince = vi.fn(
  async (_pairs: readonly { vehicleId: string; since: Date | null }[]) => new Map<string, number>(),
);
const lowerBoundsAt = vi.fn(async (pairs: readonly { vehicleId: string; on: Date }[]) => {
  const answers = new Map<string, { reading: number; date: Date }>();
  for (const pair of pairs) {
    const bound = state.lowerBoundOn === null ? state.lowerBound : state.lowerBoundOn(pair.on);
    if (bound !== null) answers.set(pair.vehicleId, bound);
  }
  return answers;
});

vi.mock('../../../platform/settings', () => ({
  settingsService: { resolve: async (key: string) => (key.endsWith('yellowKm') ? 1000 : 300) },
}));
vi.mock('../catalogs/catalog-item.repository', () => ({
  fleetCatalogItemRepository: {
    // The projection asks ONE question about the catalog — which work types count — and the
    // repository owns the filter. Stubbing that method rather than `list` keeps the mock honest
    // about the seam the engine actually uses.
    countingWorkTypeIds: async () => [String(workTypeId)],
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
    daysWithoutReadingSince: (pairs: readonly { vehicleId: string; since: Date | null }[]) =>
      daysWithoutReadingSince(pairs),
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
  daysWithoutReadingSince.mockClear();
  state.lowerBound = null;
  state.lowerBoundOn = null;
  state.latestReading = { reading: 59_850, date: new Date('2026-09-05T00:00:00.000Z') };
  state.baseline = {
    vehicleId: String(vehicleId),
    visitId: '650000000000000000000091',
    odometerAtService: 50_000,
    serviceDate: SERVICE_DATE,
    counterDate: SERVICE_DATE,
  };
});

describe('the projection actually resolves the bracket bound and passes it on', () => {
  it('asks the chain about each baseline ON THE DAY ITS COUNTER WAS TAKEN', () => {
    // The date is the whole point. Asking on "today" would compare a visit closed months ago
    // against a chain it never met, and every historical baseline would look broken.
    return computeAlarms().then(() => {
      expect(lowerBoundsAt).toHaveBeenCalledTimes(1);
      expect(lowerBoundsAt.mock.calls[0]![0]).toEqual([
        { vehicleId: String(vehicleId), on: state.baseline.counterDate },
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

/**
 * C1 — an ENTRY counter is judged on the day the car went IN.
 *
 * Car 219: in on 25 June at 84,080, out on 28 June. The chain stood at 84,037 on the 25th and at
 * 84,189 by the 28th — the car was driven in between. Asked on the check-out day the counter read
 * as «below the chain» and the alarm refused it; asked on its own day it is a true reading.
 */
describe('each counter is checked on its OWN day', () => {
  const IN = new Date('2026-06-25T00:00:00.000Z');
  const OUT = new Date('2026-06-28T00:00:00.000Z');
  /** The chain as it stood on each day the projection might ask about. */
  const chain219 = (on: Date) =>
    on.getTime() >= OUT.getTime()
      ? { reading: 84_189, date: new Date('2026-06-28T00:00:00.000Z') }
      : { reading: 84_037, date: new Date('2026-06-24T00:00:00.000Z') };

  it('an entry counter is asked on the check-in day, not the check-out day', async () => {
    state.baseline = { ...state.baseline, serviceDate: OUT, counterDate: IN };
    await computeAlarms();
    expect(lowerBoundsAt.mock.calls[0]![0]).toEqual([{ vehicleId: String(vehicleId), on: IN }]);
  });

  it('the 219 shape computes: 84,080 is above the 84,037 the chain held on 25 June', async () => {
    state.baseline = {
      ...state.baseline,
      odometerAtService: 84_080,
      serviceDate: OUT,
      counterDate: IN,
    };
    state.lowerBoundOn = chain219;
    state.latestReading = { reading: 90_246, date: new Date('2026-10-11T00:00:00.000Z') };
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    // The owner's own figure: today's reading less the counter at that maintenance.
    expect(row.sinceServiceKm).toBe(6166);
  });

  it('the same counter asked on the check-out day would still be refused — the bug, pinned', async () => {
    // What the projection used to do: an exit-day question for an entry-day counter.
    state.baseline = {
      ...state.baseline,
      odometerAtService: 84_080,
      serviceDate: OUT,
      counterDate: OUT,
    };
    state.lowerBoundOn = chain219;
    state.latestReading = { reading: 90_246, date: new Date('2026-10-11T00:00:00.000Z') };
    const row = await only();
    expect(row.noAlarmReason).toBe('baselineBelowChain');
  });

  it('a counter still below the chain on its own day stays refused — car 249', async () => {
    // 113,325 on 5 September, with the chain already at 114,871 by the 3rd. Moving the question to
    // the counter's own day does not make every refusal go away: this pair still disagrees.
    const day = new Date('2026-09-05T00:00:00.000Z');
    state.baseline = {
      ...state.baseline,
      odometerAtService: 113_325,
      serviceDate: day,
      counterDate: day,
    };
    state.lowerBound = { reading: 114_871, date: new Date('2026-09-03T00:00:00.000Z') };
    state.latestReading = { reading: 117_647, date: new Date('2026-10-11T00:00:00.000Z') };
    const row = await only();
    expect(row.noAlarmReason).toBe('baselineBelowChain');
  });

  it('a visit with no counter is measured from the reading the car LEFT on', async () => {
    // No counter: `counterDate` is the check-out day, so the stand-in is the chain on that day.
    state.baseline = {
      ...state.baseline,
      odometerAtService: null,
      serviceDate: OUT,
      counterDate: OUT,
    };
    state.lowerBoundOn = chain219;
    state.latestReading = { reading: 90_246, date: new Date('2026-10-11T00:00:00.000Z') };
    const row = await only();
    expect(lowerBoundsAt.mock.calls[0]![0]).toEqual([{ vehicleId: String(vehicleId), on: OUT }]);
    expect(row.sinceServiceKm).toBe(90_246 - 84_189);
  });

  it('the cycle still starts on the check-out day — only the counter check moved', async () => {
    // A reading taken between check-in and check-out is still «older than the service»: the
    // window the alarm measures did not move, only the day the counter is checked on.
    state.baseline = {
      ...state.baseline,
      odometerAtService: 84_080,
      serviceDate: OUT,
      counterDate: IN,
    };
    state.lowerBoundOn = chain219;
    state.latestReading = { reading: 84_150, date: new Date('2026-06-27T00:00:00.000Z') };
    const row = await only();
    expect(row.noAlarmReason).toBe('readingOlderThanService');
    expect(row.lastServiceAt).toBe(OUT.toISOString());
    expect(daysWithoutReadingSince.mock.calls[0]![0]).toEqual([
      { vehicleId: String(vehicleId), since: OUT },
    ]);
  });
});
