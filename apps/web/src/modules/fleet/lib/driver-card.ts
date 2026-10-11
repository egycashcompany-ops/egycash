// What the driver card says — «اقف على اسم السواق يجيب الاسم كامل والكود ورقم الفون والعربيه
// اللى متعين عليها والفرع».
//
// Five facts, each from a list the screen already shares rather than one request per name:
//   • the name, the code and the phone — Fleet's own people list (`/fleet/people`), the list every
//     driver cell on every Fleet screen already reads;
//   • the branch — the person's `branchId`, named from the branch options any signed-in user may
//     read;
//   • the car — TODAY's «تعيين السيارات», the roster board's own day: the standing crew with the
//     day's changes on it, under `fleetRoster.view`.
//
// Kept pure, out of the component, so every way a fact can be missing is testable without a
// browser — and so a missing fact is always said as missing, never filled with a guess.
import {
  type FleetPersonDto,
  type FleetRosterDayDto,
  type Locale,
  type OrgUnitOptionDto,
} from '@ecms/contracts';

/**
 * The car line.
 * - `car`: the car's code on today's board.
 * - `elsewhere`: today's board seats the driver on a car outside what this reader may see — said
 *   as «سيارة أخرى», never a code the reader's board does not carry.
 * - `none`: on no car today — a day off, a car in the workshop, nobody seated them.
 * - `loading`: the day is still on its way.
 * - `hidden`: the reader may not read the roster (or it failed): the line is left out, so a
 *   missing grant never reads as «no car».
 */
export type DriverCardVehicle =
  | { kind: 'car'; code: string }
  | { kind: 'elsewhere' }
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'hidden' };

export interface DriverCardFacts {
  employeeId: string;
  name: string;
  code: string;
  /** null when HR has none on file — drawn as a dash. */
  phone: string | null;
  /** The branch's name; `loading` while the options load; null for none, or one not listed. */
  branch: string | 'loading' | null;
  vehicle: DriverCardVehicle;
}

/**
 * The driver's car on one roster day. The same two lookups as `vehicleTodayFrom`, for the same
 * reason: the pool says which car holds a free driver, and the rows are the record for one who
 * holds a seat AND is off the pool that day.
 */
export const vehicleOnRoster = (day: FleetRosterDayDto, employeeId: string): DriverCardVehicle => {
  const assignedVehicleId =
    day.availableDrivers.find((d) => d.employeeId === employeeId)?.assignedVehicleId ?? null;
  const row =
    day.rows.find((r) => assignedVehicleId !== null && r.vehicleId === assignedVehicleId) ??
    day.rows.find((r) => r.driver1EmployeeId === employeeId || r.driver2EmployeeId === employeeId);
  if (row !== undefined) return { kind: 'car', code: row.code };
  // Seated, but on a car this reader's board does not carry (another branch's).
  if (assignedVehicleId !== null) return { kind: 'elsewhere' };
  return { kind: 'none' };
};

export const driverCardFacts = ({
  person,
  branches,
  roster,
  locale,
}: {
  person: FleetPersonDto;
  /** The branch options; `loading` while they load; null when they could not be read. */
  branches: readonly OrgUnitOptionDto[] | 'loading' | null;
  /** Today's board; `loading`; or `hidden` — no `fleetRoster.view`, or the read failed. */
  roster: FleetRosterDayDto | 'loading' | 'hidden';
  locale: Locale;
}): DriverCardFacts => {
  const phone = person.phone?.trim() ?? '';
  let branch: DriverCardFacts['branch'] = null;
  if (person.branchId !== null) {
    if (branches === 'loading') branch = 'loading';
    else if (branches !== null) {
      const found = branches.find((option) => option.id === person.branchId);
      if (found !== undefined) branch = found.name[locale] || found.name.ar || found.name.en;
    }
  }
  const vehicle: DriverCardVehicle =
    roster === 'loading'
      ? { kind: 'loading' }
      : roster === 'hidden'
        ? { kind: 'hidden' }
        : vehicleOnRoster(roster, person.employeeId);
  return {
    employeeId: person.employeeId,
    name: person.fullNameAr,
    code: person.code,
    phone: phone === '' ? null : phone,
    branch,
    vehicle,
  };
};
