// HOW A ROW FROM THE OLD BOOKS NAMES ITS CAR — by the registry's id when the registry has the
// car, and by the code the book wrote when it does not.
//
// «لو … عربيات مش موجوده لا ضيفها عشان احنا بنبقى محتاجين الداتا دى نرجع ليها». The four books
// hold readings, visits, fines and files for a handful of cars the handover never had — «194»,
// «كوستر», «تويوتا1». The owner wants those rows kept, not the cars invented: a vehicle needs a
// plate, a chassis, a motor and a branch, and none of that is in the books. So such a row carries
// `vehicleId: null` and `vehicleCode: <the code as written>`, and this is the one place that
// spells how a step finds the rows it already wrote for either kind of car.
import { Types, type FilterQuery } from 'mongoose';

/** The car a book row belongs to: a registry vehicle, or a code the registry does not have. */
export type BookRef = { vehicleId: string; vehicleCode?: undefined } | { vehicleId: null; vehicleCode: string };

/** The rows already written for this car, live ones only — what a take-over checks before writing. */
export const bookRefFilter = <T>(ref: BookRef): FilterQuery<T> =>
  (ref.vehicleId === null
    ? { vehicleId: null, vehicleCode: ref.vehicleCode, isDeleted: false }
    : { vehicleId: new Types.ObjectId(ref.vehicleId), isDeleted: false }) as FilterQuery<T>;

/** The two fields a written row carries for its car, from the ref. */
export const bookRefFields = (
  ref: BookRef,
): { vehicleId: Types.ObjectId | null; vehicleCode: string | null } =>
  ref.vehicleId === null
    ? { vehicleId: null, vehicleCode: ref.vehicleCode }
    : { vehicleId: new Types.ObjectId(ref.vehicleId), vehicleCode: null };

/** How the run names the car in a report — the code either way. */
export const bookRefOf = (code: string, vehicleIdByCode: ReadonlyMap<string, string>): BookRef => {
  const vehicleId = vehicleIdByCode.get(code);
  return vehicleId === undefined ? { vehicleId: null, vehicleCode: code } : { vehicleId };
};

/**
 * Rows already written, grouped by the key a step tells rows apart with. A LIST per key rather
 * than one row, because the old statement legitimately holds two identical rows for one car.
 */
export const groupByKey = <T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
};
