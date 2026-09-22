// WHAT THE BOARD'S TICK REACHES, and what the board is allowed to be asked.
//
// «عاوز لما اعمل علامه صح على عربيه يعملى صح برضو على كل السواقيين اللى موجودين على نفس العربيه».
// The violations collection holds two discriminated shapes — the company's yearly statement rows
// (`kind: 'vehicle'`) and the drivers' per-event fines (`kind: 'driver'`) — and the screen shows
// them side by side. The tick does NOT: closing a car for a year closes what the car owes and what
// its drivers owe on it, in one act, because that is how the work is actually done.
//
// It was scoped to the statement rows for a release, and the drivers' half then had to be ticked
// one fine at a time on the board below. These tests pin the two things that has to get right: the
// tick reaches every row of the (vehicle, year) and NOTHING outside it — a fine belonging to
// another year on the same car is another year's business — and the two numbers the board's colour
// is read from count exactly the rows the tick sets.
//
// The second half is the filter that quietly stopped filtering: the rollup took ONE vehicle id,
// so the board sent nothing the moment two codes were picked and answered for the whole fleet
// while its chips read «١٥٠، ١٥١ +٢».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetViolationModel } from './violation.model';
import { fleetViolationRepository, violationYearBranches } from './violation.repository';

const VEHICLE = '650000000000000000000001';

afterEach(() => vi.restoreAllMocks());

/** The filter the group tick sent to mongo. */
const tickFilter = async (): Promise<Record<string, unknown>> => {
  const updateMany = vi
    .spyOn(FleetViolationModel, 'updateMany')
    .mockReturnValue({ exec: async () => ({ modifiedCount: 0 }) } as never);
  // `updateMany` is awaited directly in the repository, so the mock resolves as a thenable.
  updateMany.mockResolvedValue({ modifiedCount: 0 } as never);
  await fleetViolationRepository.setCollectedForYear(VEHICLE, 2026, true);
  return (updateMany.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
};

describe('the company board’s tick settles the WHOLE group — «يعملى صح برضو على كل السواقيين»', () => {
  it('reaches the car’s statement rows AND the drivers’ fines on it, for that year', async () => {
    // Closing a car for a year closes what the car owes and what its drivers owe on it, together.
    // It was scoped to the statement rows for a while, and that made the clerk settle the drivers'
    // half one row at a time on the board below — the same decision, asked twice.
    const filter = await tickFilter();
    expect(String(filter['vehicleId']), 'of that one car').toBe(VEHICLE);
    const branches = filter['$or'] as Record<string, unknown>[];
    expect(branches, 'both shapes are named').toHaveLength(3);
    expect(branches[0]).toEqual({ kind: 'vehicle', year: 2026 });
    expect(branches[1], 'carried ONTO this year, whatever its date').toEqual({
      kind: 'driver',
      filedYear: 2026,
    });
    expect(branches[2]?.['kind'], 'and the ordinary case, by its own date').toBe('driver');
    expect(branches[2]?.['filedYear'], 'unless it was carried away').toBeNull();
  });

  it('asks the year the way the BOARD asks it, so the tick cannot reach a row the group omits', async () => {
    // Which fines belong to a (car, year) is not a date range: one carried onto this statement
    // belongs to it however old it is, and one carried away does not whatever its date says.
    // `violationYearBranches` is that rule, and the group's own figures are summed through it —
    // so using anything else here would let the tick settle a row the reader cannot see, or skip
    // one they can.
    const filter = await tickFilter();
    expect(filter['$or']).toEqual(violationYearBranches([2026]));
  });

  it('writes only `collected`, and writes it as it was asked', async () => {
    const updateMany = vi
      .spyOn(FleetViolationModel, 'updateMany')
      .mockResolvedValue({ modifiedCount: 0 } as never);
    await fleetViolationRepository.setCollectedForYear(VEHICLE, 2026, false);
    expect(updateMany.mock.calls[0]?.[1]).toEqual({ $set: { collected: false } });
  });
});

/** The aggregate the board's rows, tick colour and «الحالة» filter are all computed from. */
const sumsPipeline = async (
  scope?: Parameters<typeof fleetViolationRepository.yearSums>[1],
): Promise<Record<string, unknown>[]> => {
  const aggregate = vi
    .spyOn(FleetViolationModel, 'aggregate')
    .mockResolvedValue([] as never);
  await fleetViolationRepository.yearSums([2026], scope);
  return (aggregate.mock.calls[0]?.[0] ?? []) as unknown as Record<string, unknown>[];
};

describe('the two numbers the tick is read from count EVERY row the tick reaches', () => {
  it('counts the whole group, statement rows and drivers’ fines alike', async () => {
    const group = (await sumsPipeline())[1]?.['$group'] as Record<string, unknown>;
    // These two are the tick's colour and the «الحالة» filter, so they have to count exactly what
    // the tick sets. Counting less would leave a fully settled group reporting «بعضها» for ever;
    // counting more would leave one that can never turn green.
    expect(group['rowCount']).toEqual({ $sum: 1 });
    expect(JSON.stringify(group['rowCount']), 'no shape is singled out').not.toContain('$kind');
    expect(JSON.stringify(group['collectedCount'])).toContain('$collected');
    expect(JSON.stringify(group['collectedCount']), 'nor here').not.toContain('$kind');
  });

  it('still sums the two halves SEPARATELY — one tick, but two lines on the board', async () => {
    const group = (await sumsPipeline())[1]?.['$group'] as Record<string, unknown>;
    expect(JSON.stringify(group['driverAmount'])).toContain('"$kind","driver"');
    expect(JSON.stringify(group['driverCount'])).toContain('"$kind","driver"');
  });
});

/** Every `$and` clause the aggregate's `$match` ended up carrying. */
const andClauses = (match: Record<string, unknown>): Record<string, unknown>[] =>
  (match['$and'] as Record<string, unknown>[] | undefined) ?? [];

describe('a fine carried onto another year is counted THERE, and only there', () => {
  it('the grouping key asks `filedYear` FIRST, then the stored year, then the date', () => {
    // «يتنقلوا ... يبقوا تبع العربيه دى». The same order `violationYearBranches` narrows by: a row
    // that filtered into one block and grouped under another would go missing from both.
    const repository = readFileSync(join(__dirname, 'violation.repository.ts'), 'utf8');
    // From the grouping key to the first figure after it. `vehicleCount:` appears earlier as an
    // aggregate type annotation, so the end is searched FROM the key rather than from the top.
    const keyAt = repository.indexOf("vehicleCode: { $ifNull: ['$vehicleCode', null] },");
    const group = repository.slice(keyAt, repository.indexOf('vehicleCount:', keyAt));
    const filedAt = group.indexOf("'$filedYear'");
    const storedAt = group.indexOf("'$year'");
    const dateAt = group.indexOf('$year: { date:');
    expect(filedAt, 'the carried-onto year is asked').toBeGreaterThan(-1);
    expect(filedAt, 'before the stored one').toBeLessThan(storedAt);
    expect(storedAt, 'and that before the event date').toBeLessThan(dateAt);
  });

  /** The `$set` stage of a pipeline update — `fileUnder` and `fileBackHome` both write one. */
  const stageOf = (update: unknown): Record<string, unknown> =>
    ((update as { $set: Record<string, unknown> }[])[0] as { $set: Record<string, unknown> }).$set;

  it('the fine itself is untouched — only the car it hangs on and the block it counts in move', async () => {
    const updateMany = vi
      .spyOn(FleetViolationModel, 'updateMany')
      .mockResolvedValue({ modifiedCount: 2 } as never);
    await fleetViolationRepository.fileUnder(
      ['650000000000000000000031', '650000000000000000000032'],
      VEHICLE,
      2026,
      { by: null },
    );
    const [filter, update] = updateMany.mock.calls[0] ?? [];
    // A STATEMENT ROW CANNOT BE CARRIED: it stores its own year, so a second answer beside it
    // would be a contradiction rather than an override.
    expect((filter as Record<string, unknown>)['kind']).toBe('driver');
    const set = stageOf(update);
    expect(Object.keys(set).sort(), 'the car, where it came from, the block, who, and the version').toEqual(
      ['__v', 'filedYear', 'homeVehicleId', 'updatedBy', 'vehicleId'].sort(),
    );
    // WHERE IT CAME FROM, KEPT — and kept only the FIRST time. `$ifNull` is the whole guard: a
    // fine carried 150 → 151 and then 151 → 152 still goes home to 150, because the second carry
    // finds a home already recorded and leaves it alone.
    expect(set['homeVehicleId'], 'home is where it started, not where it last stopped').toEqual({
      $ifNull: ['$homeVehicleId', '$vehicleId'],
    });
    for (const untouched of ['date', 'collected', 'amount', 'driverEmployeeId']) {
      expect(set[untouched], `${untouched} is the fine's own fact`).toBeUndefined();
    }
  });

  it('putting them back sends each fine to the car it came from — «لو رجعتها هتكون 150 زى ما كانت»', async () => {
    const updateMany = vi
      .spyOn(FleetViolationModel, 'updateMany')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    // NO CAR IS PASSED. Naming one could only name the car it is sitting on NOW — which is the
    // defect: the badge went away and the fine stayed on 151.
    await fleetViolationRepository.fileBackHome(['650000000000000000000031'], { by: null });
    const set = stageOf(updateMany.mock.calls[0]?.[1]);
    expect(set['vehicleId'], 'back onto the car it left').toEqual({
      $ifNull: ['$homeVehicleId', '$vehicleId'],
    });
    expect(set['filedYear'], 'back under its own date').toBeNull();
    expect(set['homeVehicleId'], 'and it is home, so it remembers nowhere else').toBeNull();
  });

  it('a row carried BEFORE any home was recorded stays where it is rather than falling off every board', async () => {
    // `$ifNull` is doing two jobs at once, and this is the second: a row moved before the field
    // existed has no home, and sending it to `null` would leave it on no car at all — invisible
    // on every block. It keeps its current car; the backfill is what gives it 150 back.
    const updateMany = vi
      .spyOn(FleetViolationModel, 'updateMany')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    await fleetViolationRepository.fileBackHome(['650000000000000000000031'], { by: null });
    const fallback = (stageOf(updateMany.mock.calls[0]?.[1])['vehicleId'] as {
      $ifNull: string[];
    }).$ifNull[1];
    expect(fallback, 'the fallback is the car it is on, never null').toBe('$vehicleId');
  });
});

describe('the board can be asked about SEVERAL cars — the filter that stopped filtering', () => {
  it('narrows by every id it was given, not by the first of them', async () => {
    const a = '650000000000000000000011';
    const b = '650000000000000000000012';
    const match = (await sumsPipeline({ vehicleIds: [a, b] }))[0]?.['$match'] as Record<
      string,
      unknown
    >;
    expect(andClauses(match)).toContainEqual({
      vehicleId: { $in: [new Types.ObjectId(a), new Types.ObjectId(b)] },
    });
  });

  it('narrows by the cars AND the years — neither clause eats the other', async () => {
    // Both speak `$or`, so written as two keys of one object the second would overwrite the
    // first: picking a car would silently widen the board to every year it has ever had.
    const match = (await sumsPipeline({ vehicleIds: [VEHICLE] }))[0]?.['$match'] as Record<
      string,
      unknown
    >;
    const clauses = andClauses(match);
    expect(clauses, 'the years and the cars, side by side').toHaveLength(2);
    expect(JSON.stringify(clauses), 'the year survives the car').toContain('2026');
    expect(JSON.stringify(clauses), 'and the car survives the year').toContain(VEHICLE);
  });

  it('keeps the old book’s own codes reachable beside the registry’s ids', async () => {
    const match = (await sumsPipeline({ vehicleIds: [VEHICLE], vehicleCodes: ['كوستر'] }))[0]?.[
      '$match'
    ] as Record<string, unknown>;
    // A (code, year) kept from the old book on a car the registry never had has no `vehicleId`,
    // so an id-only filter would hide it from the very code the reader typed.
    expect(JSON.stringify(andClauses(match))).toContain('كوستر');
  });

  it('asks about EVERY car when nothing was picked — and about none when the codes matched none', async () => {
    const whole = (await sumsPipeline())[0]?.['$match'] as Record<string, unknown>;
    expect(andClauses(whole), 'no cars picked is not a clause').toHaveLength(1);
    expect(JSON.stringify(whole), 'and nothing names a car').not.toContain('vehicleId');

    // `[]` is «the codes you typed match no car in the registry», which narrows to nothing rather
    // than dropping the filter and answering for the whole fleet — the failure this whole suite
    // is about.
    const none = (await sumsPipeline({ vehicleIds: [] }))[0]?.['$match'] as Record<string, unknown>;
    expect(andClauses(none)).toContainEqual({ vehicleId: { $in: [] } });
  });
});
