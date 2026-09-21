// Replaying a carried fine's audit trail to find the car it came from.
//
// This is the whole correctness of the backfill: everything else is a query and an `updateOne`.
// A wrong answer here does not fail loudly — it sends a fine home to a car it was never on, and
// the only way anyone would find out is by reading the trail themselves.
import { describe, expect, it } from 'vitest';
import { homeFromTrail } from './carried-home-backfill';

const CAR_150 = '650000000000000000000150';
const CAR_151 = '650000000000000000000151';
const CAR_152 = '650000000000000000000152';

/** One audit entry, in the shape `diffChanges` writes. */
const entry = (...changes: { field: string; old: unknown; new: unknown }[]) => ({ changes });
const carry = (from: string, to: string, year: number) =>
  entry(
    { field: 'vehicleId', old: from, new: to },
    { field: 'filedYear', old: null, new: year },
  );
const goHome = (from: string, to: string, year: number) =>
  entry(
    { field: 'vehicleId', old: from, new: to },
    { field: 'filedYear', old: year, new: null },
  );

describe('the car a carried fine came from, read back out of its trail', () => {
  it('is the car the carry left', () => {
    expect(homeFromTrail([carry(CAR_150, CAR_151, 2026)])).toBe(CAR_150);
  });

  it('is where it STARTED, not where it last stopped', () => {
    // 150 → 151 → 152. The second carry finds a home already open and leaves it alone, exactly as
    // `$ifNull` does on the live write — otherwise the way back would stop halfway, on 151.
    expect(homeFromTrail([carry(CAR_150, CAR_151, 2026), carry(CAR_151, CAR_152, 2026)])).toBe(
      CAR_150,
    );
  });

  it('is nothing at all once the fine has been returned', () => {
    // It went home. There is nothing it is away from, and a row like this has no home to write.
    expect(homeFromTrail([carry(CAR_150, CAR_151, 2026), goHome(CAR_151, CAR_150, 2026)])).toBeNull();
  });

  it('starts again after a return — a second carry is not the first one continued', () => {
    expect(
      homeFromTrail([
        carry(CAR_150, CAR_151, 2026),
        goHome(CAR_151, CAR_150, 2026),
        carry(CAR_150, CAR_152, 2026),
      ]),
    ).toBe(CAR_150);
  });

  it('ignores the writes that are not moves', () => {
    // Ticking the money in, correcting an amount, renaming a driver — a trail is mostly these,
    // and only an entry that changed `filedYear` says anything about where a fine is carried.
    expect(
      homeFromTrail([
        entry({ field: 'collected', old: false, new: true }),
        entry({ field: 'amount', old: 100, new: 200 }),
        carry(CAR_150, CAR_151, 2026),
        entry({ field: 'collected', old: true, new: false }),
      ]),
    ).toBe(CAR_150);
  });

  it('gives nothing where the carry did not change the car', () => {
    // Dropped onto the block of the car it was already on: the year moved, the car did not, and
    // there is nothing to give back. Answering with a car here would be inventing one.
    expect(homeFromTrail([entry({ field: 'filedYear', old: null, new: 2026 })])).toBeNull();
  });

  it('gives nothing for a fine whose trail holds no carry at all', () => {
    expect(homeFromTrail([])).toBeNull();
    expect(homeFromTrail([entry({ field: 'collected', old: false, new: true })])).toBeNull();
  });

  it('refuses a stored value that is not an id rather than writing it onto a row', () => {
    expect(homeFromTrail([entry({ field: 'vehicleId', old: '—', new: CAR_151 }, { field: 'filedYear', old: null, new: 2026 })])).toBeNull();
  });
});
