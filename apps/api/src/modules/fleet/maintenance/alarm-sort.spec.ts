// Ordering a register by a figure about the CAR — the lookup table, and the trap inside it.
//
// `$arrayElemAt` with an index of −1 reads the LAST element. So a car the maintenance projection
// has no answer for — no interval on its type, no counted service, no reading since the last one —
// would silently inherit another car's kilometres and sort among cars it has nothing to do with.
// That is the one thing here that cannot be seen by reading the register afterwards: the figure is
// never displayed, only sorted by, so a wrong one looks exactly like a right one.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const computeAlarms = vi.hoisted(() => vi.fn());
vi.mock('./maintenance-alarm', () => ({ computeAlarms }));

const { ALARM_SORT_KEYS, alarmSort, alarmSortsFor, isAlarmSortKey } = await import('./alarm-sort');

const CAR_A = new Types.ObjectId();
const CAR_B = new Types.ObjectId();
const CAR_NONE = new Types.ObjectId();

const alarm = (
  vehicleId: Types.ObjectId,
  sinceServiceKm: number | null,
  remainingKm: number | null,
) => ({ vehicleId: String(vehicleId), sinceServiceKm, remainingKm });

/** The expression's two arrays and the `$cond` around them, as this test reads them. */
interface Built {
  key: string;
  expression: {
    $let: {
      vars: { at: { $indexOfArray: [Types.ObjectId[], string] } };
      in: { $cond: [unknown, null, { $arrayElemAt: [(number | null)[], string] }] };
    };
  };
}

beforeEach(() => {
  computeAlarms.mockReset();
});

describe('which keys exist at all', () => {
  it('publishes exactly the two figures the boards print', () => {
    expect([...ALARM_SORT_KEYS]).toEqual(['alarmSinceService', 'alarmRemaining']);
    expect(isAlarmSortKey('alarmRemaining')).toBe(true);
    expect(isAlarmSortKey('remainingKm'), 'not the DTO’s field name').toBe(false);
  });
});

describe('the lookup table handed to the query', () => {
  it('carries a figure per car, in the same positions as the ids', () => {
    computeAlarms.mockResolvedValue([alarm(CAR_A, 4000, 1000), alarm(CAR_B, 9000, -500)]);
    return alarmSort('alarmSinceService').then((built) => {
      const parts = (built as unknown as Built).expression.$let;
      expect(parts.vars.at.$indexOfArray[0], 'one id per car').toHaveLength(2);
      expect(parts.in.$cond[2].$arrayElemAt[0], 'and the figures beside them').toEqual([
        4000, 9000,
      ]);
    });
  });

  it('reads the OTHER figure for the other key', async () => {
    computeAlarms.mockResolvedValue([alarm(CAR_A, 4000, 1000), alarm(CAR_B, 9000, -500)]);
    const built = (await alarmSort('alarmRemaining')) as unknown as Built;
    expect(built.expression.$let.in.$cond[2].$arrayElemAt[0]).toEqual([1000, -500]);
  });

  it('compares ObjectIds, not strings — the projection answers in strings', () => {
    computeAlarms.mockResolvedValue([alarm(CAR_A, 4000, 1000)]);
    return alarmSort('alarmSinceService').then((built) => {
      const ids = (built as unknown as Built).expression.$let.vars.at.$indexOfArray[0];
      expect(ids[0]).toBeInstanceOf(Types.ObjectId);
      expect(String(ids[0])).toBe(String(CAR_A));
    });
  });

  it('leaves out a car the projection could not answer for', async () => {
    // It must not appear in the table with a null figure either: `$arrayElemAt` would still be
    // asked for a position, and the row would sort among cars that HAVE a figure.
    computeAlarms.mockResolvedValue([
      alarm(CAR_A, 4000, 1000),
      alarm(CAR_NONE, null, null),
      alarm(CAR_B, 9000, -500),
    ]);
    const built = (await alarmSort('alarmSinceService')) as unknown as Built;
    const ids = built.expression.$let.vars.at.$indexOfArray[0].map(String);
    expect(ids).toEqual([String(CAR_A), String(CAR_B)]);
    expect(built.expression.$let.in.$cond[2].$arrayElemAt[0]).toEqual([4000, 9000]);
  });

  it('answers NULL for a row whose car is not in the table — never the last car’s figure', () => {
    // The trap. `$arrayElemAt(arr, -1)` is the LAST element, so without the `$cond` a car with no
    // alarm would be ordered as though it were the last car in the list.
    computeAlarms.mockResolvedValue([alarm(CAR_A, 4000, 1000)]);
    return alarmSort('alarmSinceService').then((built) => {
      const cond = (built as unknown as Built).expression.$let.in.$cond;
      expect(cond[0], 'the guard asks whether the car was found').toEqual({ $eq: ['$$at', -1] });
      expect(cond[1], 'and answers nothing when it was not').toBeNull();
    });
  });

  it('publishes no key at all when the projection can answer for nobody', async () => {
    // A fleet with no service intervals configured: an order over a column of nulls is not an
    // order, and publishing the key would make the arrow look as though it had worked.
    computeAlarms.mockResolvedValue([alarm(CAR_NONE, null, null)]);
    expect(await alarmSort('alarmSinceService')).toBeNull();
    expect(await alarmSort('alarmRemaining')).toBeNull();
  });
});

describe('what a request actually pays for', () => {
  it('computes NOTHING when the reader has not asked for one of these columns', async () => {
    // The whole-fleet projection is the cost here, and it must not ride along on every page of
    // every register — only on the request that clicked the column.
    expect(await alarmSortsFor([{ by: 'date' }, { by: 'vehicleCode' }])).toEqual([]);
    expect(computeAlarms).not.toHaveBeenCalled();
  });

  it('computes it ONCE for an order that names the same column twice', async () => {
    computeAlarms.mockResolvedValue([alarm(CAR_A, 4000, 1000)]);
    const built = await alarmSortsFor([
      { by: 'alarmSinceService' },
      { by: 'date' },
      { by: 'alarmSinceService' },
    ]);
    expect(built).toHaveLength(1);
    expect(computeAlarms).toHaveBeenCalledTimes(1);
  });

  it('builds both when the reader ordered by both', async () => {
    computeAlarms.mockResolvedValue([alarm(CAR_A, 4000, 1000)]);
    const built = await alarmSortsFor([{ by: 'alarmRemaining' }, { by: 'alarmSinceService' }]);
    expect(built.map((entry) => entry.key)).toEqual(['alarmRemaining', 'alarmSinceService']);
  });
});
