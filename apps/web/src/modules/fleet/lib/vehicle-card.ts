// What the car card says — «عاوز لما اماوس يقف على كود عربيه يجيب بيانات زى اما اقف على اسم السواق
// نفس الموضوع كدا» / «تمام وزود اخر عداد».
//
// The driver card's sibling (`driver-card.ts`), with the same discipline: every fact from a list
// every Fleet screen already shares, not one request per code —
//   • the code, plate, state, licence date, branch id, make and operation — the whole registry
//     (`useAllVehicles({ anyStatus: true })`), every lifecycle status, since a board may show a car
//     disposed of since;
//   • the make's name — the vehicle types; the operation's name — the «التشغيل» catalog;
//   • the branch's name — the branch names WITH the inactive ones (`useBranchNames`): «الفرع اللى
//     العربيه متعينه عليه» is the car's own `branchId`, which may be a branch closed since;
//   • today's drivers — TODAY's «تعيين السيارات» (the roster board's own Cairo day) under
//     `fleetRoster.view`, named from Fleet's people under `fleetDriver.view`;
//   • the last odometer reading — every registry car's last reading, ANY status
//     (`GET /fleet/odometer/latest-readings`, the alarms' own figure), under the alarms' own
//     permissions. Not the alarms list itself: that covers ACTIVE cars only, so a car out of
//     service after an accident read «—» («none on file») although its log has readings.
//
// Kept pure, out of the component, so every way a fact can be missing is testable without a
// browser — and so a missing fact is always said as missing, never filled with a guess.
import {
  cairoYmd,
  expiryStateOn,
  normalizeVehicleCode,
  type FleetPersonDto,
  type FleetRosterDayDto,
  type FleetVehicleDto,
  type FleetVehicleLatestReadingDto,
  type FleetVehicleStatus,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import type { ExpiryState } from '../components/FuelCardBoard';

/** The registry fields the card reads. */
export type CardVehicle = Pick<
  FleetVehicleDto,
  | 'id'
  | 'code'
  | 'typeId'
  | 'plateNumber'
  | 'branchId'
  | 'operationId'
  | 'licenseExpiresAt'
  | 'status'
  | 'inWorkshop'
>;

/** Anything named in both languages by id — a make, a catalog item, a branch option. */
export interface NamedById {
  id: string;
  name: LocalizedString;
}

/**
 * Which car a code on a board is.
 *
 * - `vehicleId` given (even `null`): the row's own link to the registry decides. `null` — a row
 *   from the old books on a car the registry never had — gets no card, whatever its code says.
 * - Only `code`: a chip that carries nothing but the code (the dashboard's car chips, custody's
 *   and fuel's code chips) — the car is looked up by its code, spelled as the registry means it.
 */
export interface VehicleCardRef {
  vehicleId?: string | null;
  code?: string | null;
}

/** How a ref names its car — by id, by code — or `null`: it names none, and gets no card. */
export const vehicleCardRefKind = (ref: VehicleCardRef): 'id' | 'code' | null => {
  if (ref.vehicleId !== undefined)
    return ref.vehicleId === null || ref.vehicleId === '' ? null : 'id';
  return ref.code === undefined || ref.code === null || ref.code.trim() === '' ? null : 'code';
};

/** A code as the registry compares it: `normalizeVehicleCode`, a Latin letter's case ignored. */
export const vehicleCodeKey = (code: string): string => normalizeVehicleCode(code).toLowerCase();

/**
 * The registry's car for a ref; `undefined` when it names none or the registry has no such car (a
 * car deleted since). By code, an ACTIVE car wins over a retired one that once wore the same code.
 */
export const findCardVehicle = <V extends Pick<FleetVehicleDto, 'id' | 'code' | 'status'>>(
  vehicles: readonly V[],
  ref: VehicleCardRef,
): V | undefined => {
  const kind = vehicleCardRefKind(ref);
  if (kind === 'id') return vehicles.find((vehicle) => vehicle.id === ref.vehicleId);
  if (kind === 'code') {
    const key = vehicleCodeKey(ref.code ?? '');
    const matches = vehicles.filter((vehicle) => vehicleCodeKey(vehicle.code) === key);
    return matches.find((vehicle) => vehicle.status === 'active') ?? matches[0];
  }
  return undefined;
};

/**
 * Today's drivers.
 * - `names`: the car's row on today's «تعيين السيارات» — the first and second driver, in order;
 *   none seated → an empty list, drawn as a dash.
 * - `loading`: the day (or the people who name it) still on its way.
 * - `hidden`: the reader may not read the roster, or the people who name it (or either failed) —
 *   the line is left out, so a missing grant never reads as «no driver».
 */
export type VehicleCardDrivers =
  { kind: 'names'; names: string[] } | { kind: 'loading' } | { kind: 'hidden' };

/**
 * The last odometer reading.
 * - `reading`: the car's current reading and its day.
 * - `none`: the projection has no reading for the car — drawn as a dash. (It covers the ACTIVE
 *   cars; a car out of service or disposed of reads as none here.)
 * - `loading`, `hidden` (no alarms permission, or the read failed — the line is left out).
 */
export type VehicleCardReading =
  | { kind: 'reading'; km: number; at: string }
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'hidden' };

export interface VehicleCardFacts {
  vehicleId: string;
  code: string;
  /** The make's name; `loading`; null for none on file, or one not listed. */
  type: string | 'loading' | null;
  plate: string | null;
  status: FleetVehicleStatus;
  inWorkshop: boolean;
  /** The CAR's branch (`vehicle.branchId`) — never the branch of a workshop it sits in. */
  branch: string | 'loading' | null;
  operation: string | 'loading' | null;
  drivers: VehicleCardDrivers;
  licence: { date: string | null; state: ExpiryState };
  reading: VehicleCardReading;
}

/** A list the card names from: the list; `loading` while it loads; null when it could not be read. */
export type CardList<T> = readonly T[] | 'loading' | null;

const nameIn = (
  list: CardList<NamedById>,
  id: string | null,
  locale: Locale,
): string | 'loading' | null => {
  if (id === null || id === '') return null;
  if (list === 'loading') return 'loading';
  if (list === null) return null;
  const found = list.find((item) => item.id === id);
  return found === undefined ? null : found.name[locale] || found.name.ar || found.name.en;
};

/**
 * Where a licence stands TODAY — the vehicles board's rule (`expiryState` there): the Cairo day,
 * expired ON its expiry day, «soon» inside thirty days.
 */
export const licenceState = (expiresAt: string | null, now = Date.now()): ExpiryState => {
  const state = expiryStateOn(expiresAt, cairoYmd(new Date(now)), 30);
  return state === 'notRecorded' ? 'unknown' : state === 'expiring' ? 'soon' : state;
};

/** The car's drivers on one roster day, named; an id Fleet's people do not carry is left out. */
const driversOn = (
  day: FleetRosterDayDto,
  people: readonly FleetPersonDto[],
  vehicleId: string,
): string[] => {
  const row = day.rows.find((r) => r.vehicleId === vehicleId);
  if (row === undefined) return [];
  return [row.driver1EmployeeId, row.driver2EmployeeId]
    .filter((id): id is string => id !== null)
    .map((id) => people.find((person) => person.employeeId === id)?.fullNameAr)
    .filter((name): name is string => name !== undefined && name !== '');
};

export const vehicleCardFacts = ({
  vehicle,
  types,
  operations,
  branches,
  roster,
  people,
  readings,
  locale,
  now = Date.now(),
}: {
  vehicle: CardVehicle;
  types: CardList<NamedById>;
  operations: CardList<NamedById>;
  /** Every branch's name, the inactive ones too. */
  branches: CardList<NamedById>;
  /** Today's board; `loading`; or `hidden` — no `fleetRoster.view`, or the read failed. */
  roster: FleetRosterDayDto | 'loading' | 'hidden';
  /** Fleet's people, who name the drivers; `loading`; `hidden` — no `fleetDriver.view`, or failed. */
  people: readonly FleetPersonDto[] | 'loading' | 'hidden';
  /**
   * Every car's last reading, any status (no row = no reading on file); `loading`; `hidden` — no
   * odometer/workshop permission, or the read failed. A null reading reads as none, too.
   */
  readings:
    | readonly (Pick<FleetVehicleLatestReadingDto, 'vehicleId'> & {
        latestReading: number | null;
        latestReadingAt: string | null;
      })[]
    | 'loading'
    | 'hidden';
  locale: Locale;
  now?: number;
}): VehicleCardFacts => {
  let drivers: VehicleCardDrivers;
  if (roster === 'hidden' || people === 'hidden') drivers = { kind: 'hidden' };
  else if (roster === 'loading' || people === 'loading') drivers = { kind: 'loading' };
  else drivers = { kind: 'names', names: driversOn(roster, people, vehicle.id) };

  let reading: VehicleCardReading;
  if (readings === 'hidden' || readings === 'loading') reading = { kind: readings };
  else {
    const row = readings.find((r) => r.vehicleId === vehicle.id);
    reading =
      row === undefined || row.latestReading === null || row.latestReadingAt === null
        ? { kind: 'none' }
        : { kind: 'reading', km: row.latestReading, at: row.latestReadingAt };
  }

  const plate = vehicle.plateNumber.trim();
  const licence = vehicle.licenseExpiresAt === '' ? null : vehicle.licenseExpiresAt;
  return {
    vehicleId: vehicle.id,
    code: vehicle.code,
    type: nameIn(types, vehicle.typeId, locale),
    plate: plate === '' ? null : plate,
    status: vehicle.status,
    inWorkshop: vehicle.inWorkshop,
    branch: nameIn(branches, vehicle.branchId, locale),
    operation: nameIn(operations, vehicle.operationId, locale),
    drivers,
    licence: { date: licence, state: licenceState(licence, now) },
    reading,
  };
};
