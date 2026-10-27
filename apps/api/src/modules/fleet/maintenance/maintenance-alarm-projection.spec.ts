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
const VISIT = '650000000000000000000091';
const LOG = '650000000000000000000071';

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const IN = D('2026-08-30');
const SERVICE_DATE = D('2026-08-31');

interface Point {
  reading: number;
  date: Date;
}
interface Baseline {
  vehicleId: string;
  visitId: string;
  odometerAtService: number | null;
  serviceDate: Date;
  counterDate: Date;
  inDate: Date;
  entryCounter: number | null;
  exitCounter: number | null;
}
interface Newest {
  visitId: string;
  inDate: Date;
  outDate: Date | null;
  workTypeId: string;
}

/** A visit as `alarmBaselines` answers it — its derived fields worked out the way the repository does. */
const visit = (over: Partial<Baseline> = {}): Baseline => {
  const merged = {
    vehicleId: String(vehicleId),
    visitId: VISIT,
    serviceDate: SERVICE_DATE,
    inDate: IN,
    entryCounter: null,
    exitCounter: 50_000,
    ...over,
  };
  return {
    ...merged,
    odometerAtService: merged.exitCounter ?? merged.entryCounter,
    counterDate:
      merged.exitCounter !== null
        ? merged.serviceDate
        : merged.entryCounter !== null
          ? merged.inDate
          : merged.serviceDate,
  };
};

const state = {
  latestReading: { reading: 59_850, date: D('2026-09-05'), logId: LOG },
  baseline: visit() as Baseline | null,
  /** The car's chain — the stubbed `lowerBoundsAt` cuts it by day, as the repository does. */
  chain: [] as Point[],
  newest: null as Newest | null,
};

const dayOf = (on: Date): number =>
  Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
/** The highest point dated before the day `on` names — or on it too, with `includeDay`. */
const boundOf = (on: Date, includeDay: boolean): Point | null => {
  const cut = dayOf(on) + (includeDay ? 86_400_000 : 0);
  const before = state.chain.filter((point) => point.date.getTime() < cut);
  return before.reduce<Point | null>(
    (best, point) => (best === null || point.reading > best.reading ? point : best),
    null,
  );
};

type Pair = { vehicleId: string; on: Date };
type Options = { includeDay?: boolean } | undefined;
/** Days the car ran with nobody writing the counter — see the DTO field; no days by default. */
const daysWithoutReadingSince = vi.fn(
  async (_pairs: readonly { vehicleId: string; since: Date | null }[]) => new Map<string, number>(),
);
const lowerBoundsAt = vi.fn(async (pairs: readonly Pair[], options?: Options) => {
  const answers = new Map<string, Point>();
  for (const pair of pairs) {
    const bound = boundOf(pair.on, options?.includeDay ?? true);
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
    lowerBoundsAt: (pairs: readonly Pair[], options?: Options) => lowerBoundsAt(pairs, options),
    daysWithoutReadingSince: (pairs: readonly { vehicleId: string; since: Date | null }[]) =>
      daysWithoutReadingSince(pairs),
  },
}));
vi.mock('./maintenance.repository', () => ({
  fleetMaintenanceRepository: {
    alarmBaselines: async () =>
      state.baseline === null ? new Map() : new Map([[String(vehicleId), state.baseline]]),
    newestVisits: async () =>
      state.newest === null ? new Map() : new Map([[String(vehicleId), state.newest]]),
  },
}));

const { computeAlarms } = await import('./maintenance-alarm');

const only = async () => {
  const rows = await computeAlarms();
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

/** The three `lowerBoundsAt` questions, by what they are asked for. */
const asked = () => {
  const calls = lowerBoundsAt.mock.calls;
  expect(calls, 'exit counters, entry counters and stand-ins — three questions').toHaveLength(3);
  const cut = calls.filter(([, options]) => options?.includeDay === false);
  const kept = calls.filter(([, options]) => options?.includeDay !== false);
  expect(cut).toHaveLength(2);
  expect(kept).toHaveLength(1);
  return { cut: cut.map(([pairs]) => pairs), standIns: kept[0]![0] };
};

beforeEach(() => {
  lowerBoundsAt.mockClear();
  daysWithoutReadingSince.mockClear();
  state.chain = [];
  state.newest = null;
  state.latestReading = { reading: 59_850, date: D('2026-09-05'), logId: LOG };
  state.baseline = visit();
});

describe('the projection actually resolves the bracket bound and passes it on', () => {
  it('asks the chain about each counter BEFORE THE DAY IT WAS TAKEN', async () => {
    // The date is the whole point. Asking on "today" would compare a visit closed months ago
    // against a chain it never met, and every historical baseline would look broken.
    state.baseline = visit({ entryCounter: 49_900 });
    await computeAlarms();
    const { cut, standIns } = asked();
    // Exit on the check-out day, entry on the check-in day — both with that day's readings cut (R4).
    expect(cut).toEqual(
      expect.arrayContaining([
        [{ vehicleId: String(vehicleId), on: SERVICE_DATE }],
        [{ vehicleId: String(vehicleId), on: IN }],
      ]),
    );
    expect(standIns, 'a visit with counters needs no stand-in').toEqual([]);
  });

  it('with NO reading before the service, the cycle measures normally', async () => {
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    expect(row.sinceServiceKm).toBe(9850);
  });

  it('with a reading the chain already held ABOVE the baseline, it refuses', async () => {
    // The car-200 shape. If the projection stopped resolving the bound — or resolved it and
    // dropped it — this row would come back as a measured 9,850 km and a red alarm instead.
    state.chain = [{ reading: 59_800, date: D('2026-08-20') }];
    const row = await only();
    expect(row.noAlarmReason).toBe('baselineBelowChain');
    expect(row.level).toBe('none');
    expect(row.sinceServiceKm).toBeNull();
    expect(row.remainingKm).toBeNull();
    expect(row.baseline?.judgedAgainst).toEqual({
      reading: 59_800,
      date: D('2026-08-20').toISOString(),
    });
  });

  it('with a reading at or below the baseline, it measures — the boundary, through the assembly', async () => {
    state.chain = [{ reading: 50_000, date: D('2026-08-20') }];
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    expect(row.sinceServiceKm).toBe(9850);
  });

  it('and the visit the baseline came from still travels with the answer', async () => {
    state.chain = [{ reading: 59_800, date: D('2026-08-20') }];
    const row = await only();
    // A refused cycle still names the service it could not measure from — that is the record an
    // operator has to go and look at.
    expect(row.lastServiceVisitId).toBe(VISIT);
    expect(row.lastServiceAt).toBe(SERVICE_DATE.toISOString());
    expect(row.baseline?.visitId).toBe(VISIT);
    expect(row.baseline?.outDate).toBe(row.lastServiceAt);
  });
});

/**
 * C1 — an ENTRY counter is judged on the day the car went IN.
 *
 * Car 219: in on 25 June at 84,080, out on 28 June. The chain stood at 84,037 on the 24th and at
 * 84,189 by the 27th — the car was driven in between. Asked on the check-out day the counter read
 * as «below the chain» and the alarm refused it; asked on its own day it is a true reading.
 */
describe('each counter is checked on its OWN day', () => {
  const IN_219 = D('2026-06-25');
  const OUT_219 = D('2026-06-28');
  const chain219 = [
    { reading: 84_037, date: D('2026-06-24') },
    { reading: 84_189, date: D('2026-06-27') },
  ];
  const at219 = (over: Partial<Baseline>) =>
    visit({ inDate: IN_219, serviceDate: OUT_219, entryCounter: null, exitCounter: null, ...over });

  it('an entry counter is asked on the check-in day, not the check-out day', async () => {
    state.baseline = at219({ entryCounter: 84_080 });
    await computeAlarms();
    expect(asked().cut).toEqual(
      expect.arrayContaining([[{ vehicleId: String(vehicleId), on: IN_219 }], []]),
    );
  });

  it('the 219 shape computes: 84,080 is above the 84,037 the chain held on 24 June', async () => {
    state.baseline = at219({ entryCounter: 84_080 });
    state.chain = chain219;
    state.latestReading = { reading: 90_246, date: D('2026-10-11'), logId: LOG };
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    // The owner's own figure: today's reading less the counter at that maintenance.
    expect(row.sinceServiceKm).toBe(6166);
    expect(row.baseline).toMatchObject({
      source: 'entry',
      counter: 84_080,
      counterDate: IN_219.toISOString(),
      judgedAgainst: { reading: 84_037, date: D('2026-06-24').toISOString() },
      exitSetAside: null,
    });
  });

  it('the same number as an EXIT counter is still refused — the check-out day sees 84,189', async () => {
    // What the projection used to do to the entry counter: an exit-day question.
    state.baseline = at219({ exitCounter: 84_080 });
    state.chain = chain219;
    state.latestReading = { reading: 90_246, date: D('2026-10-11'), logId: LOG };
    const row = await only();
    expect(row.noAlarmReason).toBe('baselineBelowChain');
  });

  it('a counter still below the chain on its own day stays refused — car 249', async () => {
    // 113,325 on 5 September, with the chain already at 114,871 by the 3rd. Moving the question to
    // the counter's own day does not make every refusal go away: this pair still disagrees.
    const day = D('2026-09-05');
    state.baseline = visit({ inDate: day, serviceDate: day, exitCounter: 113_325 });
    state.chain = [{ reading: 114_871, date: D('2026-09-03') }];
    state.latestReading = { reading: 117_647, date: D('2026-10-11'), logId: LOG };
    const row = await only();
    expect(row.noAlarmReason).toBe('baselineBelowChain');
  });

  it('a visit with no counter is measured from the reading the car LEFT on — its day kept', async () => {
    state.baseline = at219({});
    state.chain = [...chain219, { reading: 84_200, date: OUT_219 }];
    state.latestReading = { reading: 90_246, date: D('2026-10-11'), logId: LOG };
    const row = await only();
    expect(asked().standIns).toEqual([{ vehicleId: String(vehicleId), on: OUT_219 }]);
    // The reading OF the check-out day stands in: the stand-in keeps the day, R4 does not apply.
    expect(row.sinceServiceKm).toBe(90_246 - 84_200);
    expect(row.baseline).toMatchObject({
      source: 'reading',
      counter: 84_200,
      counterDate: OUT_219.toISOString(),
      judgedAgainst: null,
    });
  });

  it('the cycle still starts on the check-out day — only the counter check moved', async () => {
    // A reading taken between check-in and check-out is still «older than the service»: the
    // window the alarm measures did not move, only the day the counter is checked on.
    state.baseline = at219({ entryCounter: 84_080 });
    state.chain = chain219;
    state.latestReading = { reading: 84_150, date: D('2026-06-27'), logId: LOG };
    const row = await only();
    expect(row.noAlarmReason).toBe('readingOlderThanService');
    expect(row.lastServiceAt).toBe(OUT_219.toISOString());
    expect(daysWithoutReadingSince.mock.calls[0]![0]).toEqual([
      { vehicleId: String(vehicleId), since: OUT_219 },
    ]);
  });
});

/** Car 295: in and out on 6 October at 22,790; a reading of that same day is 22,830. */
describe('R4 and R3, through the assembly', () => {
  const DAY = D('2026-10-06');
  const before = { reading: 22_400, date: D('2026-10-05') };
  beforeEach(() => {
    state.latestReading = { reading: 25_631, date: D('2026-10-20'), logId: LOG };
  });

  it('R4: a reading of the service day itself does not judge the counter', async () => {
    state.baseline = visit({
      inDate: DAY,
      serviceDate: DAY,
      entryCounter: 22_790,
      exitCounter: null,
    });
    state.chain = [before, { reading: 22_830, date: DAY }];
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    expect(row.sinceServiceKm).toBe(2841);
    expect(row.baseline?.judgedAgainst).toEqual({
      reading: 22_400,
      date: before.date.toISOString(),
    });
  });

  it('R3: a late closure is measured from the entry counter, the exit counter set aside', async () => {
    // Out on the 15th at 22,795, with 23,500 typed in afterwards for the 10th.
    const out = D('2026-10-15');
    state.baseline = visit({
      inDate: DAY,
      serviceDate: out,
      entryCounter: 22_790,
      exitCounter: 22_795,
    });
    const late = { reading: 23_500, date: D('2026-10-10') };
    state.chain = [before, late];
    const row = await only();
    expect(row.noAlarmReason).toBeNull();
    expect(row.sinceServiceKm).toBe(2841);
    expect(row.lastServiceAt, 'the cycle still starts when the car came out').toBe(
      out.toISOString(),
    );
    expect(row.baseline).toMatchObject({
      source: 'entry',
      counter: 22_790,
      entryCounter: 22_790,
      exitCounter: 22_795,
      exitSetAside: {
        because: 'belowChain',
        conflict: { reading: 23_500, date: late.date.toISOString() },
      },
    });
  });
});

describe('the facts the screens read', () => {
  it('the latest reading carries its day and its row', async () => {
    const row = await only();
    expect(row.latestReading).toBe(59_850);
    expect(row.latestReadingAt).toBe(D('2026-09-05').toISOString());
    expect(row.latestReadingLogId).toBe(LOG);
  });

  it('the invariants the DTO promises hold on a computed row', async () => {
    const row = await only();
    expect(row.baseline?.visitId).toBe(row.lastServiceVisitId);
    expect(row.baseline?.outDate).toBe(row.lastServiceAt);
    expect(row.sinceServiceKm).toBe((row.latestReading ?? 0) - (row.baseline?.counter ?? 0));
  });

  it('no baseline, no facts — and the newest visit says why when it is still open', async () => {
    state.baseline = null;
    state.newest = {
      visitId: 'v-open',
      inDate: D('2026-09-01'),
      outDate: null,
      workTypeId: String(workTypeId),
    };
    const row = await only();
    expect(row.noAlarmReason).toBe('noService');
    expect(row.baseline).toBeNull();
    expect(row.lastServiceVisitId).toBeNull();
    expect(row.newerUncountedVisit).toEqual({
      visitId: 'v-open',
      inDate: D('2026-09-01').toISOString(),
      outDate: null,
      why: 'open',
    });
  });

  it('a newer closed visit of a work type that does not count is named «not counting»', async () => {
    const out = D('2026-09-03');
    state.newest = {
      visitId: 'v-wash',
      inDate: D('2026-09-02'),
      outDate: out,
      workTypeId: 'not-counting',
    };
    const row = await only();
    expect(row.newerUncountedVisit).toMatchObject({
      visitId: 'v-wash',
      outDate: out.toISOString(),
      why: 'notCounting',
    });
  });

  it('nothing is named when the newest visit IS the baseline, or counts and is closed', async () => {
    state.newest = {
      visitId: VISIT,
      inDate: IN,
      outDate: SERVICE_DATE,
      workTypeId: 'not-counting',
    };
    expect((await only()).newerUncountedVisit).toBeNull();
    state.newest = { visitId: 'v-other', inDate: IN, outDate: IN, workTypeId: String(workTypeId) };
    expect((await only()).newerUncountedVisit).toBeNull();
  });
});
