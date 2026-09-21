// WHAT THE COMPANY BOARD'S TICK IS ALLOWED TO TOUCH, and what the board is allowed to be asked.
//
// «لما اعمل علامه صح فى الصف بتاع الشركه ملوش علاقه بالسواقيين». The violations collection holds
// two discriminated shapes — the company's yearly statement rows (`kind: 'vehicle'`) and the
// drivers' per-event fines (`kind: 'driver'`) — and they are TWO ACCOUNTS. The screen shows them
// side by side for exactly that reason, and the owner settles each on its own side.
//
// The group tick used to set EVERY row of a (vehicle, year), so closing off a car's statement
// marked that car's drivers' fines as received in the same click: money owed by a person, written
// off because somebody finished with a different account. Nothing on the screen said it had
// happened, and the only way back was to find each fine and untick it.
//
// The second half is the filter that quietly stopped filtering: the rollup took ONE vehicle id,
// so the board sent nothing the moment two codes were picked and answered for the whole fleet
// while its chips read «١٥٠، ١٥١ +٢».
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetViolationModel } from './violation.model';
import { fleetViolationRepository } from './violation.repository';

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

describe('the company board’s tick settles the COMPANY’s rows and nothing else', () => {
  it('names the company shape explicitly — the drivers’ fines are not in the filter', async () => {
    const filter = await tickFilter();
    expect(filter['kind'], 'the statement rows, by name').toBe('vehicle');
    expect(filter['year'], 'of that one year').toBe(2026);
    expect(String(filter['vehicleId']), 'of that one car').toBe(VEHICLE);
  });

  it('asks the year the way a STATEMENT row carries it — no date branch at all', async () => {
    // The `$or` that used to be here had two branches: a stored `year` for the statement rows and
    // a date range for the drivers' events. The second branch existed only to reach the rows this
    // must never touch, so keeping it would be keeping the bug in a filter that says it is fixed.
    const filter = await tickFilter();
    expect(filter['$or'], 'a driver branch is how the fines got settled').toBeUndefined();
    expect(JSON.stringify(filter), 'and no date window either').not.toContain('date');
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

describe('the two numbers the tick is read from count the COMPANY’s rows', () => {
  it('counts a statement row and skips a driver fine, collected or not', async () => {
    const group = (await sumsPipeline())[1]?.['$group'] as Record<string, unknown>;
    // Were the drivers' fines counted here, a car whose statement was fully settled would still
    // report «بعضها» because a driver had not paid — and clicking the tick could never turn it
    // green, because the tick cannot reach those rows any more.
    expect(JSON.stringify(group['rowCount'])).toContain('"$kind","vehicle"');
    expect(JSON.stringify(group['collectedCount'])).toContain('"$kind","vehicle"');
    expect(JSON.stringify(group['collectedCount'])).toContain('$collected');
  });

  it('still sums the DRIVERS’ money — the board reports it, it just does not tick it', async () => {
    const group = (await sumsPipeline())[1]?.['$group'] as Record<string, unknown>;
    expect(JSON.stringify(group['driverAmount'])).toContain('"$kind","driver"');
    expect(JSON.stringify(group['driverCount'])).toContain('"$kind","driver"');
  });
});

/** Every `$and` clause the aggregate's `$match` ended up carrying. */
const andClauses = (match: Record<string, unknown>): Record<string, unknown>[] =>
  (match['$and'] as Record<string, unknown>[] | undefined) ?? [];

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
