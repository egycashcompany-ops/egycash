// «بدل «—» يظهر السبب في سطر آخر قراءة لكل عربية»: WHICH ROW of the odometer register says why a
// car has no «فارق عداد الصيانة».
//
// A row there is one READING and a car has many, so the reason is said ONCE per car — never down
// every reading of it, where one problem would read as several.
//
// Batch 3 (C2, on purpose): the reason is a fact about the car NOW, and so is the figure beside a
// computed car — its level, what is left of the interval, «كيف حُسب الفارق». Both sit on the car's
// NEWEST row on the page (by day, then by entry time; `newestRows`), whatever date range, sort
// or page the reader is on. It used to sit only on the row the server names
// (`latestReadingLogId`), so a page that did not hold that row said nothing at all about why the
// car had no figure. Every other row shows the gap at its own reading (`serviceGapKm`).
//
// A car the projection leaves out because it is not active — out of service, disposed or deleted
// — gets «السيارة غير نشطة» on that same row.
//
// Nothing is said before the projection has answered: while it loads, every car would read as
// absent from it, so as «غير نشطة». The reason itself is the server's (`noAlarmReason`), passed
// through as it came — nothing here infers one.
import {
  type FleetMaintenanceAlarmDto,
  type FleetNoAlarmReason,
  type FleetOdometerLogDto,
} from '@ecms/contracts';

/** What one row of the register says in place of the dash. */
export type ReasonRow =
  | { kind: 'alarm'; alarm: FleetMaintenanceAlarmDto; reason: FleetNoAlarmReason }
  | { kind: 'notActive'; vehicleId: string; code: string | null };

type LogFields = Pick<
  FleetOdometerLogDto,
  'id' | 'vehicleId' | 'vehicleCode' | 'date' | 'createdAt'
>;

/** Is `a` a later reading than `b` — its calendar day, then when it was entered. */
const newer = (a: LogFields, b: LogFields): boolean => {
  const dayA = a.date.slice(0, 10);
  const dayB = b.date.slice(0, 10);
  return dayA > dayB || (dayA === dayB && a.createdAt > b.createdAt);
};

/** Each car's newest row on the page, the row itself. */
const newestLogs = <T extends LogFields>(rows: readonly T[]): Map<string, T> => {
  const newest = new Map<string, T>();
  for (const log of rows) {
    // A row the old book kept for a code the registry did not have is on no car's chain.
    if (log.vehicleId === null) continue;
    const held = newest.get(log.vehicleId);
    if (held === undefined || newer(log, held)) newest.set(log.vehicleId, log);
  }
  return newest;
};

/**
 * Each car's NEWEST row on the page, as car id → row id: the latest day, then the later entry.
 * A row of no car is nobody's newest.
 */
export const newestRows = (rows: readonly LogFields[]): Map<string, string> =>
  new Map([...newestLogs(rows)].map(([vehicleId, log]) => [vehicleId, log.id]));

/**
 * The rows that carry a reason, by row id — each car's newest row on the page, and no other.
 * `projectionLoaded` is the alarms query's SUCCESS — not "has data": a projection still loading or
 * failed says nothing about any car.
 */
export const reasonRows = (
  rows: readonly LogFields[],
  alarmByVehicle: ReadonlyMap<string, FleetMaintenanceAlarmDto>,
  projectionLoaded: boolean,
): Map<string, ReasonRow> => {
  const out = new Map<string, ReasonRow>();
  if (!projectionLoaded) return out;
  for (const [vehicleId, log] of newestLogs(rows)) {
    const alarm = alarmByVehicle.get(vehicleId);
    if (alarm === undefined) {
      out.set(log.id, { kind: 'notActive', vehicleId, code: log.vehicleCode });
      continue;
    }
    // Computed: the figure is the answer, and «كيف حُسب الفارق» explains it — not a reason.
    if (alarm.noAlarmReason === null) continue;
    out.set(log.id, { kind: 'alarm', alarm, reason: alarm.noAlarmReason });
  }
  return out;
};
