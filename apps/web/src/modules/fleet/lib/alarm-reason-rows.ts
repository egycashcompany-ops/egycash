// «بدل «—» يظهر السبب في سطر آخر قراءة لكل عربية»: WHICH ROW of the odometer register says why a
// car has no «فارق عداد الصيانة».
//
// A row there is one READING and a car has many, so the reason is said ONCE per car — never down
// every reading of it, where one problem would read as several. The row is the server's: the
// projection names the odometer row its latest reading came from (`latestReadingLogId`), and the
// reason sits on exactly that row when this page holds it, and on no other. A page that does not
// hold it (another date range, another sort, another page) shows the dash on all of that car's
// rows; the reason never moves to an older reading, where it would describe the wrong number.
//
// Two cars have no such row, and use their NEWEST row on the page instead (by day, then by entry
// time): a car with no reading at all (`noReading`), and a car the projection leaves out because
// it is not active — out of service, disposed or deleted — which gets «السيارة غير نشطة».
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

/** Is `a` a later reading than `b` — its day, then when it was entered. */
const newer = (a: LogFields, b: LogFields): boolean =>
  a.date > b.date || (a.date === b.date && a.createdAt > b.createdAt);

/**
 * The rows that carry a reason, by row id. `projectionLoaded` is the alarms query's SUCCESS — not
 * "has data": a projection still loading or failed says nothing about any car.
 */
export const reasonRows = (
  rows: readonly LogFields[],
  alarmByVehicle: ReadonlyMap<string, FleetMaintenanceAlarmDto>,
  projectionLoaded: boolean,
): Map<string, ReasonRow> => {
  const out = new Map<string, ReasonRow>();
  if (!projectionLoaded) return out;
  const newest = new Map<string, LogFields>();
  for (const log of rows) {
    if (log.vehicleId === null) continue;
    const held = newest.get(log.vehicleId);
    if (held === undefined || newer(log, held)) newest.set(log.vehicleId, log);
  }
  for (const log of rows) {
    // A row the old book kept for a code the registry did not have is on no car's chain.
    if (log.vehicleId === null) continue;
    const isNewest = newest.get(log.vehicleId)?.id === log.id;
    const alarm = alarmByVehicle.get(log.vehicleId);
    if (alarm === undefined) {
      if (isNewest) {
        out.set(log.id, { kind: 'notActive', vehicleId: log.vehicleId, code: log.vehicleCode });
      }
      continue;
    }
    // Computed: the figure is the answer, and there is nothing to explain.
    if (alarm.noAlarmReason === null) continue;
    const here = alarm.latestReadingLogId !== null ? alarm.latestReadingLogId === log.id : isNewest;
    if (here) out.set(log.id, { kind: 'alarm', alarm, reason: alarm.noAlarmReason });
  }
  return out;
};
