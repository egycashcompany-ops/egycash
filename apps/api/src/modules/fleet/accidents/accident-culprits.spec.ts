// «وهو بيسجل الحادث يقدر يختار اكتر من سواق فى المره الواحده» — what a file says about its drivers.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { culpritIdsOf } from '../fleet.mappers';

describe('the drivers a file names', () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();

  it('is the whole list, in the order they were picked', () => {
    expect(culpritIdsOf({ culpritEmployeeId: a, culpritEmployeeIds: [a, b] })).toEqual([
      String(a),
      String(b),
    ]);
  });

  it('reads a file from before the list as its one driver', () => {
    expect(culpritIdsOf({ culpritEmployeeId: a })).toEqual([String(a)]);
    expect(culpritIdsOf({ culpritEmployeeId: a, culpritEmployeeIds: [] })).toEqual([String(a)]);
  });

  it('is empty for a third party', () => {
    expect(culpritIdsOf({ culpritEmployeeId: null, culpritEmployeeIds: [] })).toEqual([]);
  });
});
