// Round 32 — the van pickers and the cars whose Fleet code names nothing.
//
// THE OWNER, on «لوحة التشغيلة»'s «بدون سيارة» and «الطاقم الثابت»'s «إضافة سيارة», both opening on
// «0», «00», «000», «0000», «00000»: «دى مشكلة بيظهر عربيات ايه الاصفار دى».
//
// Those codes were typed by hand in Fleet's registry for cars that had no Fleet code yet (no legacy
// export the go-live import read holds one — see `operations-vehicle-codes.ts` in the contracts for
// the evidence), each one zero longer because the last was taken. Fleet requires a plate, unique, on
// every car, so such a car is named by its PLATE: the lists put it last, under its own heading, by
// its plate and its make. One whose plate names nothing either cannot be told from the next: left
// out of the lists and counted, to be put right in «الحركة» → «السيارات». Fleet's data is never
// written here.
import {
  compareVehicleCodesNaturally,
  vehicleCodeNamesNothing,
  type LocalizedString,
  type OperationsUncodedVehicleDto,
} from '@ecms/contracts';

/** What of a Fleet car names it: its code, its plate, its type. */
export interface NamedVehicle {
  vehicleCode: string;
  plateNumber: string;
  typeId: string;
}

/**
 * The car named by its plate and its make when its code names nothing — null for a car with a
 * code (it is named by its code, as always).
 */
export const uncodedOf = (
  vehicle: NamedVehicle,
  typeNames: ReadonlyMap<string, LocalizedString>,
): OperationsUncodedVehicleDto | null =>
  vehicleCodeNamesNothing(vehicle.vehicleCode)
    ? { plateNumber: vehicle.plateNumber.trim(), typeName: typeNames.get(vehicle.typeId) ?? null }
    : null;

/** Neither its code nor its plate names it: nothing on a list would tell it from the next. */
export const isUnidentified = (vehicle: NamedVehicle): boolean =>
  vehicleCodeNamesNothing(vehicle.vehicleCode) && vehicleCodeNamesNothing(vehicle.plateNumber);

/** Codes naturally — 61, 101, 150 … — a code that names nothing last (the contracts' rule). */
export const byVehicleCodeNaturally = (a: string, b: string): number =>
  compareVehicleCodesNaturally(a, b);
