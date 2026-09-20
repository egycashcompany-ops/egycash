// What the odometer's unique index does and does NOT forbid.
//
// The legacy recorded a vehicle on every day it ran (`POST /cars_log` — a submitted reading became
// the new row's `out_num` and the previous row's `in_num`), and the new model keeps that. The one
// constraint on the collection is easy to misread as "one reading per vehicle", so it is pinned
// here: `ux_open_period` is unique on the vehicle only among rows whose period is still OPEN. A
// closed row falls out of the partial filter, which is exactly what lets the next day's reading in.
import { describe, expect, it } from 'vitest';
import { FleetOdometerLogModel } from './odometer.model';

type IndexSpec = [Record<string, unknown>, Record<string, unknown> | undefined];

const indexes = (): IndexSpec[] => FleetOdometerLogModel.schema.indexes() as IndexSpec[];
const byName = (name: string): IndexSpec | undefined =>
  indexes().find(([, options]) => options?.name === name);

describe('the odometer collection constrains OPEN periods, not readings', () => {
  it('has exactly one unique index, and it is the open-period guard', () => {
    const unique = indexes().filter(([, options]) => options?.unique === true);
    expect(unique).toHaveLength(1);
    expect(unique[0]?.[1]?.name).toBe('ux_open_period');
  });

  it('scopes that uniqueness to rows whose period is still open', () => {
    // Without `inReading: null` in the filter this index WOULD mean one reading per vehicle, and
    // the second day's recording would collide. The partial filter is the whole difference.
    const [fields, options] = byName('ux_open_period') as IndexSpec;
    expect(fields).toEqual({ vehicleId: 1 });
    // …and to rows that HAVE a vehicle: a reading kept from the old book for a car the registry
    // never had is on no chain, and two such cars must not collide on the one value `null`.
    //
    // …and to rows that ARE readings. A day recorded WITHOUT a reading carries `inReading: null`
    // too — it closes nothing — and without `outReading` in this filter it would read as a second
    // open period and the car's real open one would be refused.
    expect(options?.partialFilterExpression).toEqual({
      isDeleted: false,
      inReading: null,
      vehicleId: { $type: 'objectId' },
      outReading: { $type: 'number' },
    });
  });

  it('constrains nothing about the DATE — a vehicle may run on any number of days', () => {
    // A unique index touching `date` would forbid two readings on one day, or worse. The date
    // indexes exist to order the chain, and neither is unique.
    for (const [fields, options] of indexes()) {
      if ('date' in fields)
        expect(options?.unique, `${String(options?.name)} is not unique`).not.toBe(true);
    }
    expect(byName('ix_vehicle_date')?.[1]?.unique).not.toBe(true);
    expect(byName('ix_vehicle_reading')?.[1]?.unique).not.toBe(true);
  });

  it('a CLOSED row sits outside the guard, which is what admits the next reading', () => {
    // The filter is a plain equality on `inReading`, so a row carrying a number is not indexed by
    // it at all — any number of closed periods may pile up behind the one open period.
    const filter = byName('ux_open_period')?.[1]?.partialFilterExpression as {
      inReading: number | null;
    };
    expect(filter.inReading).toBeNull();
    const closedRow = { inReading: 10_250 };
    expect(closedRow.inReading === filter.inReading, 'a closed row is not covered').toBe(false);
  });
});
