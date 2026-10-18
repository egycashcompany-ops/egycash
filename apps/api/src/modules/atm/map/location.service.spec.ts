// The register is read by this feature through ONE helper, with a projection of four fields
// (docs/12-planning/atm-map-zones.md §4.3, §9.2). An entry holds `keys`, `receiptNotes` and
// `handoverNotes` in the clear and the `safeCombination` ref; the projection is what keeps them out
// of this feature's memory. The integration suite (§9.3 #5) checks the rows the database returns.
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtmRegisterEntryModel } from '../register/register.model';
import {
  OPEN_ENTRY_LOCATION_PROJECTION,
  entriesByMachine,
  locationState,
  openEntryLocationTexts,
} from './location.service';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openEntryLocationTexts', () => {
  it('reads the open, live entries of the machines with exactly four fields', async () => {
    const exec = vi.fn(async () => []);
    const find = vi
      .spyOn(AtmRegisterEntryModel, 'find')
      .mockReturnValue({ lean: () => ({ exec }) } as never);
    const ids = [new Types.ObjectId(), new Types.ObjectId()];

    await openEntryLocationTexts(ids);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      { machineId: { $in: ids }, isDeleted: false, status: 'open' },
      { _id: 1, machineId: 1, locationUrl: 1, locationPlusCode: 1 },
    );
    expect(Object.keys(OPEN_ENTRY_LOCATION_PROJECTION).sort()).toEqual([
      '_id',
      'locationPlusCode',
      'locationUrl',
      'machineId',
    ]);
  });
});

describe('entriesByMachine', () => {
  it('groups the rows per machine in the shape the merge reads', () => {
    const machine = new Types.ObjectId();
    const other = new Types.ObjectId();
    const [a, b, c] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
    const grouped = entriesByMachine([
      { _id: a, machineId: machine, locationUrl: 'u', locationPlusCode: null },
      { _id: b, machineId: other, locationPlusCode: 'p' },
      { _id: c, machineId: machine, locationUrl: null, locationPlusCode: null },
    ]);
    expect(grouped.get(String(machine))).toEqual([
      { id: String(a), locationUrl: 'u', locationPlusCode: null },
      { id: String(c), locationUrl: null, locationPlusCode: null },
    ]);
    expect(grouped.get(String(other))).toEqual([
      { id: String(b), locationUrl: null, locationPlusCode: 'p' },
    ]);
  });
});

describe('locationState (§6.4)', () => {
  it('maps a document to the point state, and no document to notSynced', () => {
    expect(locationState(null)).toEqual({ state: 'unlocated', reason: 'notSynced' });
    expect(locationState({ status: 'located', needsReview: false, reason: null })).toEqual({
      state: 'located',
      reason: null,
    });
    expect(locationState({ status: 'located', needsReview: true, reason: null })).toEqual({
      state: 'review',
      reason: null,
    });
    expect(locationState({ status: 'unlocated', needsReview: false, reason: 'shortLink' })).toEqual(
      { state: 'unlocated', reason: 'shortLink' },
    );
  });
});
