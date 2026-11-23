// Round 32 — the van pickers of «لوحة التشغيلة» and «الطاقم الثابت»: which Fleet codes name a car,
// and the order the codes are listed in.
//
// THE OWNER, on both pickers (their lists opened on «0», «00», «000», «0000», «00000», then «61»):
// «دى مشكلة بيظهر عربيات ايه الاصفار دى».
//
// WHAT THOSE CARS ARE. Not the legacy fleet: neither export the go-live import read
// (`apps/api/assets/fleet-go-live/cars.json`, `cars-2026-09-29.json` — 213 rows, 4 deleted, 209 live)
// holds a code made only of zeros, and the import invents no code — it refuses an empty one and a
// repeated one, writing nothing (`fleet/go-live/vehicles-import.ts` `parseCars`). The only other
// writer of a Fleet car is the registry's own «إضافة سيارة» / «تعديل» (`POST`/`PATCH /fleet/vehicles`),
// which requires a code and refuses one another car holds (`vehicle.service.ts` `create`, the unique
// index `ux_code`). So each was typed by hand in «الحركة» → «السيارات» for a car with no Fleet code
// yet — «0», then «00» because «0» was taken, and so on. The same form requires a type, a plate, a
// chassis and a motor number, each unique too: such a car has a plate on file, and it is the plate
// that tells it from the others.
//
// So, on both pickers (`vehicleCodeNamesNothing`): a car whose code names nothing is never listed as
// a bare «0000». Its plate names it → listed LAST, under its own heading, by its plate and its make
// (`OperationsUncodedVehicleDto`). Its plate names nothing either → nothing tells it from the next:
// left out, and COUNTED, so the picker can say how many and where they are put right. A van already
// on the board or in the standing crew is never hidden — it is shown as it is.

import { type LocalizedString } from '../common/index.js';

/** The zero of every digit system a Fleet code is typed in: Latin, Arabic-Indic, Persian. */
const ZEROS = /^[0٠۰]+$/u;
/** What is not a mark of the code itself: spaces, punctuation, symbols, invisible format marks. */
const NOT_A_MARK = /[\s\p{P}\p{S}\p{Cf}]/gu;

/**
 * Does this code — or plate — NAME NOTHING? Blank, punctuation only («-», «—»), or zeros and nothing
 * else («0», «00», «0000», «٠٠», «0-0»), once spaces, punctuation and invisible marks are set aside.
 * A code with a digit or a letter besides its zeros names a car («0061», «P0», «ملاكى 0»).
 */
export const vehicleCodeNamesNothing = (code: string | null | undefined): boolean => {
  if (typeof code !== 'string') return true;
  const marks = code.replace(NOT_A_MARK, '');
  return marks === '' || ZEROS.test(marks);
};

/**
 * THE PICKERS' ORDER — codes NATURALLY, numbers in number order: 61, 101, 150, 213 … («9» before
 * «150», «MG 2» before «MG 10»); a code that names nothing after every code that does. Ties are
 * broken by the text itself, so the order is the same on every machine.
 */
export const compareVehicleCodesNaturally = (a: string, b: string): number => {
  const [blankA, blankB] = [vehicleCodeNamesNothing(a), vehicleCodeNamesNothing(b)];
  if (blankA !== blankB) return blankA ? 1 : -1;
  return a.localeCompare(b, 'ar', { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
};

/**
 * THE PICKERS' ORDER OF CARS — Round 32 critic: by code naturally (`compareVehicleCodesNaturally`),
 * and two cars whose codes BOTH name nothing by their PLATE, the thing that names them — never by
 * their count of zeros («0» before «00» said nothing to the planner reading «ن ق ل 4521» above
 * «ب ط 118»). The codes break a tie of plates, so the order is the same on every machine.
 */
export const compareVehiclesForPicker = (
  a: { vehicleCode: string; plateNumber?: string | null },
  b: { vehicleCode: string; plateNumber?: string | null },
): number => {
  const [blankA, blankB] = [
    vehicleCodeNamesNothing(a.vehicleCode),
    vehicleCodeNamesNothing(b.vehicleCode),
  ];
  if (blankA && blankB) {
    const [plateA, plateB] = [a.plateNumber ?? '', b.plateNumber ?? ''];
    const byPlate =
      plateA.localeCompare(plateB, 'ar', { numeric: true }) ||
      (plateA < plateB ? -1 : plateA > plateB ? 1 : 0);
    if (byPlate !== 0) return byPlate;
  }
  return compareVehicleCodesNaturally(a.vehicleCode, b.vehicleCode);
};

/**
 * Round 32 — a car of the fleet whose code names nothing (`vehicleCodeNamesNothing`), as the pickers
 * list it: by what does name it.
 */
export interface OperationsUncodedVehicleDto {
  /** Fleet's «اللوحة», as Fleet holds it. */
  plateNumber: string;
  /** Its make — Fleet's vehicle type («النوع») — or null when that type is gone. */
  typeName: LocalizedString | null;
}
