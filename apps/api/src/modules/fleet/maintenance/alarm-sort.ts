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
import { type FleetMaintenanceAlarmDto } from '@ecms/contracts';
import { type SortDerivedField } from '../../../shared/base/base.repository';
import { computeAlarms } from './maintenance-alarm';

/** The two per-vehicle maintenance figures a register may be ordered by. */
export const ALARM_SORT_KEYS = ['alarmSinceService', 'alarmRemaining'] as const;
export type AlarmSortKey = (typeof ALARM_SORT_KEYS)[number];

export const isAlarmSortKey = (key: string): key is AlarmSortKey =>
  (ALARM_SORT_KEYS as readonly string[]).includes(key);

/** What a sort key reads off the projection: the car and its two figures. */
type AlarmFigures = Pick<FleetMaintenanceAlarmDto, 'vehicleId' | 'sinceServiceKm' | 'remainingKm'>;

/** The whole-fleet projection, asked for when — and only when — somebody needs it. */
export type AlarmProjection = () => Promise<FleetMaintenanceAlarmDto[]>;

/**
 * ONE projection for everything a single request asks of it.
 *
 * A register's request can need the projection twice — its «الإنذار» filter picks the cars, its
 * alarm column orders them — and each used to compute the whole fleet's alarms on its own. Handed
 * this instead, both share the first answer; nothing is computed until one of them asks, so a
 * request that needs neither still pays nothing. Per request, never kept: the next request sees
 * the readings and the visits as they are by then.
 */
export const sharedAlarmProjection = (): AlarmProjection => {
  let pending: Promise<FleetMaintenanceAlarmDto[]> | undefined;
  return () => (pending ??= computeAlarms());
};

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
 * Built from a projection the caller already holds: the figures for both keys come off the same
 * answer, so a reader ordering by both columns costs one projection, not one per column.
 *
 * Returns `null` when the projection has nothing to say about any car, so the caller publishes no
 * key rather than an order over a column of nulls.
 */
export const alarmSort = (
  key: AlarmSortKey,
  alarms: readonly AlarmFigures[],
): SortDerivedField | null => {
  const figure = (alarm: AlarmFigures): number | null =>
    key === 'alarmSinceService' ? alarm.sinceServiceKm : alarm.remainingKm;
  const answered = alarms.filter((alarm) => figure(alarm) !== null);
  if (answered.length === 0) return null;
  return {
    key,
    expression: {
      $let: {
        vars: {
          at: {
            $indexOfArray: [answered.map((a) => new Types.ObjectId(a.vehicleId)), '$vehicleId'],
          },
        },
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
 * Every alarm key the reader's order actually names, from ONE projection.
 *
 * Nothing is computed for a register nobody has ordered that way — which is every request but the
 * one that clicked the column, and is what keeps a whole-fleet projection off the ordinary path.
 * When the order names both columns, both are read off the same answer; it used to be computed
 * once per column. `projection` is the request's shared one when the request may need it again
 * (the odometer register's «الإنذار» filter); otherwise this asks for its own.
 */
export const alarmSortsFor = async (
  sorts: readonly { by: string }[],
  projection: AlarmProjection = computeAlarms,
): Promise<SortDerivedField[]> => {
  const wanted = [...new Set(sorts.map((entry) => entry.by).filter(isAlarmSortKey))];
  if (wanted.length === 0) return [];
  const alarms = await projection();
  return wanted
    .map((key) => alarmSort(key, alarms))
    .filter((entry): entry is SortDerivedField => entry !== null);
};
