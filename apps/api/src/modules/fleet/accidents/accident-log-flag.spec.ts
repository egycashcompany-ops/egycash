// «لو السجل فى عمليه واحده على الاقل يخليه باللون الاصفر ... غير كدا تبقى لونها عادى».
//
// Every button on the board turned yellow once ANY car had a transfer: a file that never had a
// `vehicleCode` field read back as `undefined`, `undefined !== null` let it into the set of codes,
// and every other code-less file on the page then "matched" it.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetAccidentModel } from './accident.model';
import { fleetAccidentRepository } from './accident.repository';

afterEach(() => vi.restoreAllMocks());

const answer = (rows: Record<string, unknown>[]) =>
  vi.spyOn(FleetAccidentModel, 'find').mockImplementation((() => ({
    select: () => ({ lean: () => ({ exec: async () => rows }) }),
  })) as unknown as typeof FleetAccidentModel.find);

describe('which cars have a transfer on their log', () => {
  it('names the car that has one, and never an undefined code', async () => {
    const car = new Types.ObjectId();
    answer([{ vehicleId: car }]);
    const found = await fleetAccidentRepository.carsWithTransfers([String(car)], ['150']);
    expect([...found.ids]).toEqual([String(car)]);
    expect(found.codes.size, 'a missing field is not a code').toBe(0);
    expect(found.codes.has(undefined as unknown as string)).toBe(false);
  });

  it('keeps an old-book file’s code', async () => {
    answer([{ vehicleId: null, vehicleCode: '214' }]);
    const found = await fleetAccidentRepository.carsWithTransfers([], ['214']);
    expect([...found.codes]).toEqual(['214']);
    expect(found.ids.size).toBe(0);
  });
});
