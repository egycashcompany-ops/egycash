// The odometer list filter, where the questions the collection cannot answer by itself land.
//
// Three of these filters name something an odometer document does not store — a vehicle CODE, a
// driver by either slot, and a day rather than an instant — so each is a small translation, and
// each has a way of being subtly wrong that no type catches: an empty match that reads as "no
// filter", a driver found in only one slot, a day bound that stops at midnight.
import { type Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { fleetOdometerRepository } from './odometer.repository';

const oid = (n: number): string => `64b1f0dddddddddddd${String(n).padStart(6, '0')}`;
const clauses = (filter: Record<string, unknown>): Record<string, unknown>[] =>
  (filter.$and as Record<string, unknown>[]) ?? [];

describe('the odometer list filter', () => {
  it('is empty for an unfiltered list, rather than matching nothing', () => {
    expect(fleetOdometerRepository.logFilter({})).toEqual({});
  });

  it('narrows to the resolved vehicles', () => {
    const filter = fleetOdometerRepository.logFilter({ vehicleIds: [oid(1), oid(2)] });
    const clause = clauses(filter)[0] as { vehicleId: { $in: Types.ObjectId[] } };
    expect(clause.vehicleId.$in.map(String)).toEqual([oid(1), oid(2)]);
  });

  it('an EMPTY resolved set matches nothing — it must never read as "no filter"', () => {
    // This is the whole reason the service resolves ids rather than the repository: a code that
    // matches no vehicle, or an alarm level no vehicle is in, is a real answer. Dropping the
    // clause here would answer a narrowed question with every reading in the system.
    const filter = fleetOdometerRepository.logFilter({ vehicleIds: [] });
    const clause = clauses(filter)[0] as { vehicleId: { $in: unknown[] } };
    expect(clause.vehicleId.$in).toEqual([]);
    expect(filter).not.toEqual({});
  });

  it('matches a driver in EITHER slot, because a person drives mornings and evenings', () => {
    const filter = fleetOdometerRepository.logFilter({ driverEmployeeIds: [oid(7)] });
    const clause = clauses(filter)[0] as { $or: Record<string, { $in: Types.ObjectId[] }>[] };
    expect(clause.$or).toHaveLength(2);
    expect(Object.keys(clause.$or[0] ?? {})).toEqual(['driver1EmployeeId']);
    expect(Object.keys(clause.$or[1] ?? {})).toEqual(['driver2EmployeeId']);
    for (const slot of clause.$or) {
      expect(Object.values(slot)[0]?.$in.map(String)).toEqual([oid(7)]);
    }
  });

  it('covers the WHOLE of the day `to` names, not the instant midnight', () => {
    // `$lte` against a bare date stops at 00:00, so a reading stamped at any time that day fell
    // outside "up to the 18th" — and the single-day case (from = to) matched only readings saved
    // at exactly midnight.
    const filter = fleetOdometerRepository.logFilter({ to: new Date('2026-08-18T00:00:00.000Z') });
    const clause = clauses(filter)[0] as { date: { $lt: Date } };
    expect(clause.date.$lt.toISOString()).toBe('2026-08-19T00:00:00.000Z');
  });

  it('a single day is from = to, and spans that day end to end', () => {
    const day = new Date('2026-08-18T00:00:00.000Z');
    const filter = fleetOdometerRepository.logFilter({ from: day, to: day });
    const [fromClause, toClause] = clauses(filter) as [
      { date: { $gte: Date } },
      { date: { $lt: Date } },
    ];
    expect(fromClause.date.$gte.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(toClause.date.$lt.toISOString()).toBe('2026-08-19T00:00:00.000Z');
    // A reading stamped mid-afternoon on the 18th sits inside the bounds.
    const noon = new Date('2026-08-18T14:30:00.000Z');
    expect(noon >= fromClause.date.$gte && noon < toClause.date.$lt).toBe(true);
  });

  it('a `to` that already carries a time still means the whole of its day', () => {
    const filter = fleetOdometerRepository.logFilter({ to: new Date('2026-08-18T09:15:00.000Z') });
    const clause = clauses(filter)[0] as { date: { $lt: Date } };
    expect(clause.date.$lt.toISOString()).toBe('2026-08-19T00:00:00.000Z');
  });

  it('ANDs every filter together — they narrow, they do not compete', () => {
    const filter = fleetOdometerRepository.logFilter({
      vehicleIds: [oid(1)],
      driverEmployeeIds: [oid(7)],
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-18T00:00:00.000Z'),
    });
    expect(clauses(filter)).toHaveLength(4);
  });
});
