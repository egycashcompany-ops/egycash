// Ordering a register by a figure about the CAR — «فارق عداد الصيانة», «منذ الخدمة», «المتبقي».
//
// These are not facts about a reading or a visit at all. They are facts about the vehicle, derived
// at query time from its readings and its last counted service (§FR-3, `computeAlarms`), and a row
// in either register is one reading or one visit — a car has many. So there is nothing on the
// document to sort by and nothing a `$lookup` can find.
//
// WHAT TRAVELS IS THE FIGURES, NOT THE ROWS. The honest alternative was to fetch every row the
// filter matches, rank them in hand and cut the page here, the way the drivers registry does. That
// registry is the company's drivers — hundreds of rows. An odometer register is a reading per car
// per day, so the same trade would pull tens of thousands of documents across to answer one arrow.
// The figures exist for two hundred cars either way, so they are handed to the query instead, as a
// lookup table an aggregation expression can read.
//
// It lives HERE rather than beside the other sort keys because building it reads the registers,
// and a repository that imported it would import itself back.
import { Types } from 'mongoose';
import { type SortDerivedField } from '../../../shared/base/base.repository';
import { computeAlarms } from './maintenance-alarm';

/** The two per-vehicle maintenance figures a register may be ordered by. */
export const ALARM_SORT_KEYS = ['alarmSinceService', 'alarmRemaining'] as const;
export type AlarmSortKey = (typeof ALARM_SORT_KEYS)[number];

export const isAlarmSortKey = (key: string): key is AlarmSortKey =>
  (ALARM_SORT_KEYS as readonly string[]).includes(key);

/**
 * The per-vehicle figures, as an expression the database can sort a register by.
 *
 * TWO PARALLEL ARRAYS and an index — the cheapest lookup table an aggregation expression can
 * hold. A row's vehicle is found in `ids`, and its figure read from the same position in
 * `figures`; a row whose car the projection has no answer for (no service on file, no reading
 * since the last one) answers `null`, which is what `$arrayElemAt` must NOT be left to do on its
 * own — an index of −1 reads the LAST element, so a car with no alarm would inherit another
 * car's kilometres. Hence the `$cond`.
 *
 * Returns `null` when the projection has nothing to say about any car, so the caller publishes no
 * key rather than an order over a column of nulls.
 */
export const alarmSort = async (key: AlarmSortKey): Promise<SortDerivedField | null> => {
  const alarms = await computeAlarms();
  const figure = (alarm: { sinceServiceKm: number | null; remainingKm: number | null }):
    | number
    | null => (key === 'alarmSinceService' ? alarm.sinceServiceKm : alarm.remainingKm);
  const answered = alarms.filter((alarm) => figure(alarm) !== null);
  if (answered.length === 0) return null;
  return {
    key,
    expression: {
      $let: {
        vars: { at: { $indexOfArray: [answered.map((a) => new Types.ObjectId(a.vehicleId)), '$vehicleId'] } },
        in: {
          $cond: [
            { $eq: ['$$at', -1] },
            null,
            { $arrayElemAt: [answered.map((a) => figure(a)), '$$at'] },
          ],
        },
      },
    },
  };
};

/**
 * Every alarm key the reader's order actually names, computed once.
 *
 * Nothing is computed for a register nobody has ordered that way — which is every request but the
 * one that clicked the column, and is what keeps a whole-fleet projection off the ordinary path.
 */
export const alarmSortsFor = async (
  sorts: readonly { by: string }[],
): Promise<SortDerivedField[]> => {
  const wanted = [...new Set(sorts.map((entry) => entry.by).filter(isAlarmSortKey))];
  const built = await Promise.all(wanted.map(async (key) => alarmSort(key)));
  return built.filter((entry): entry is SortDerivedField => entry !== null);
};
