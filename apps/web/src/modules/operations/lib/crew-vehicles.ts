// «لوحة التشغيلة» — what the «بدون سيارة» cell of a row offers (Round 24).
//
// THE OWNER: «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات و مكان بدون سيارة دا لما ادوس عليه
// يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم». Until Round 24 the cell offered only the day's
// FLEET ROSTER vans nobody had planned on — and on the live system the roster is often empty for the
// day, so it offered nothing. Now it offers EVERY car with no crew that day: the server's
// `freeVehicles` (every ACTIVE Fleet car holding no live crew row), seen through the draft.
//
// THROUGH THE DRAFT, because the planner's unsaved work changes what is free:
//   · a ROSTER van is a row of the board already: it is offered while its row is BLANK in the draft
//     (`vanKey` — picking it merges the row into the van's, as `attachVan` always did). For a SAVED
//     row only when the server lists it free too: the save cannot both empty the van's saved crew and
//     give the van to another row, and a van the planner emptied here is still crewed on the server;
//   · any OTHER car (off the roster) is offered from `freeVehicles` unless a row of the draft holds
//     it already — another row given it a moment ago. Picking it turns the row into that car's row
//     where it stands (`takeVehicle`);
//   · a car whose off-roster row the planner deleted here is free again in the draft: offered too;
//   · IN THE WORKSHOP that day: listed, marked «في الصيانة», and — off the roster — not pickable: the
//     save refuses it (`OPERATIONS_CREW_VEHICLE_IN_WORKSHOP`). A roster van in the workshop stays
//     pickable: the server does not ask, the roster being Fleet's decision.
//
// ORDER: the roster's vans first, with their drivers' names, then the server's groups as it orders
// them (the cash-transfer operations' cars, the standing crew's, the rest), each by code with the
// numbers in number order. A search narrows by the code («١٥٠» finds 150, «150 - 151» both) or by a
// roster van's driver.
import {
  OPERATIONS_CREW_FREE_VEHICLE_GROUPS,
  type OperationsCrewBoardFreeVehicleDto,
  type OperationsCrewFreeVehicleGroup,
  type OperationsDayBoardDriverDto,
} from '@ecms/contracts';
import { foldIncludes } from '../../../shared/lib/fold';
import { matchesVehicleCode } from '../../fleet/lib/vehicle-code-match';
import { attachVan, isBlankRow, takeVehicle, type PlanRow } from './crew-plan';

/** One car the «بدون سيارة» list offers. */
export interface VehicleChoice {
  vehicleId: string;
  vehicleCode: string;
  group: OperationsCrewFreeVehicleGroup;
  onRoster: boolean;
  inWorkshop: boolean;
  /** A roster van's drivers by name; empty for any other car (Fleet's round-5 rule). */
  drivers: OperationsDayBoardDriverDto[];
  /** The board's BLANK row of this roster van, merged into on a pick — or null: the row takes it. */
  vanKey: string | null;
  /** False for a car off the roster in the workshop that day: the save would refuse it. */
  pickable: boolean;
}

/** Codes in number order — «P9» before «P10», «9» before «150» — as the server orders its groups. */
export const byVehicleCode = (a: { vehicleCode: string }, b: { vehicleCode: string }): number =>
  a.vehicleCode.localeCompare(b.vehicleCode, 'ar', { numeric: true });

/**
 * What the «بدون سيارة» cell of row `forKey` offers, in the order it lists them (see the head of
 * this file). `rows` is the draft, `original` the server's answer it was made from, `free` the
 * answer's `freeVehicles`, `workshop` the ids of the day's vans in the workshop.
 */
export const vehicleChoices = (
  rows: readonly PlanRow[],
  original: readonly PlanRow[],
  free: readonly OperationsCrewBoardFreeVehicleDto[],
  forKey: string,
  workshop: ReadonlySet<string> = new Set(),
): VehicleChoice[] => {
  const asking = rows.find((row) => row.key === forKey);
  if (asking === undefined || asking.vehicleId !== null) return [];
  const saved = asking.crewId !== null;
  const freeById = new Map(free.map((vehicle) => [vehicle.vehicleId, vehicle]));
  const blankRoster = (row: PlanRow): boolean =>
    row.vehicleId !== null && row.onRoster && isBlankRow(row);
  // Every car a row of the draft holds — a roster van's blank row holds nothing.
  const held = new Set(
    rows.flatMap((row) => (row.vehicleId === null || blankRoster(row) ? [] : [row.vehicleId])),
  );
  const inWorkshop = (vehicleId: string): boolean =>
    freeById.get(vehicleId)?.inWorkshop ?? workshop.has(vehicleId);

  const roster: VehicleChoice[] = rows
    .filter(blankRoster)
    .filter((row) => !saved || freeById.has(row.vehicleId as string))
    .map((row) => ({
      vehicleId: row.vehicleId as string,
      vehicleCode: row.vehicleCode ?? '…',
      group: 'roster' as const,
      onRoster: true,
      inWorkshop: inWorkshop(row.vehicleId as string),
      drivers: row.drivers,
      vanKey: row.key,
      pickable: true,
    }))
    .sort(byVehicleCode);
  const offRoster = (vehicle: OperationsCrewBoardFreeVehicleDto): VehicleChoice => ({
    vehicleId: vehicle.vehicleId,
    vehicleCode: vehicle.vehicleCode,
    group: vehicle.group === 'roster' ? 'other' : vehicle.group,
    onRoster: false,
    inWorkshop: vehicle.inWorkshop,
    drivers: [],
    vanKey: null,
    pickable: !vehicle.inWorkshop,
  });
  const others = free
    .filter((vehicle) => !vehicle.onRoster && !held.has(vehicle.vehicleId))
    .map(offRoster);
  // An off-roster car whose row was deleted here: free in the draft, not yet on the server.
  const onScreen = new Set(rows.map((row) => row.key));
  const released = original
    .filter(
      (row) =>
        row.vehicleId !== null &&
        !row.onRoster &&
        !onScreen.has(row.key) &&
        !held.has(row.vehicleId) &&
        !freeById.has(row.vehicleId),
    )
    .map((row) =>
      offRoster({
        vehicleId: row.vehicleId as string,
        vehicleCode: row.vehicleCode ?? '…',
        group: 'other',
        onRoster: false,
        inWorkshop: workshop.has(row.vehicleId as string),
        drivers: [],
      }),
    );
  const rank = (group: OperationsCrewFreeVehicleGroup): number =>
    OPERATIONS_CREW_FREE_VEHICLE_GROUPS.indexOf(group);
  // The server's order inside each group (by code), the released ones placed by code in theirs.
  const rest = [...others, ...released].sort(
    (a, b) => rank(a.group) - rank(b.group) || byVehicleCode(a, b),
  );
  return [...roster, ...rest];
};

/** The list narrowed by what was typed: the code (every vehicle box's rule), or a driver's name. */
export const searchVehicleChoices = (
  choices: readonly VehicleChoice[],
  search: string,
): VehicleChoice[] =>
  search.trim() === ''
    ? [...choices]
    : choices.filter(
        (choice) =>
          matchesVehicleCode(choice.vehicleCode, search) ||
          choice.drivers.some((driver) => foldIncludes(driver.fullNameAr ?? '', search)),
      );

/**
 * The pick: a roster van merges the row into the van's blank row (`attachVan`); any other car is
 * taken by the row where it stands (`takeVehicle`). A car the list would not offer — not pickable,
 * or taken meanwhile — leaves the rows as they were (the same array).
 */
export const giveVehicle = (
  rows: readonly PlanRow[],
  key: string,
  choice: VehicleChoice,
): readonly PlanRow[] => {
  if (!choice.pickable) return rows;
  if (choice.vanKey !== null) return attachVan(rows, key, choice.vanKey);
  return takeVehicle(rows, key, {
    vehicleId: choice.vehicleId,
    vehicleCode: choice.vehicleCode,
    onRoster: false,
    drivers: [],
  });
};
