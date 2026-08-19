// Who can carry a secured load, as the dispatch screen has to offer it.
//
// The vault screen picks ONE crew row and ONE captain, because that is what the two acts take: a
// delivery leg has exactly one captain (`operations_shipment_assignments.captainEmployeeId` is a
// required scalar — one leg, one person answerable for it), while the crew row it rides may now
// carry two.
//
// Two captains on a vehicle therefore produce TWO options, not one option with a hidden choice.
// The alternative — offer the vehicle and silently take the first captain — would have made the
// screen quietly pick which of two people is answerable for a van full of cash, which is exactly
// the kind of decision a UI must not make on an operator's behalf.
import { type OperationsCrewBoardRowDto } from '@ecms/contracts';

export interface DispatchCrewOption {
  /** `crewAssignmentId:captainEmployeeId` — stable, and enough to reconstruct both halves. */
  key: string;
  crewAssignmentId: string;
  captainEmployeeId: string;
  vehicleId: string;
  vehicleCode: string;
}

/**
 * One option per (crew row, captain). Rows with NO captain are dropped: a delivery leg needs a
 * captain, so a captainless vehicle is not dispatchable — the same filter the screen has always
 * applied, now expressed as "produces no options" instead of "fails the null check".
 */
export const dispatchCrewOptions = (
  rows: readonly OperationsCrewBoardRowDto[],
): DispatchCrewOption[] =>
  rows.flatMap((row) =>
    (row.crew?.captainEmployeeIds ?? []).map((captainEmployeeId) => ({
      key: `${row.crew?.id ?? ''}:${captainEmployeeId}`,
      crewAssignmentId: row.crew?.id ?? '',
      captainEmployeeId,
      vehicleId: row.vehicleId,
      vehicleCode: row.vehicleCode,
    })),
  );

export const findDispatchOption = (
  options: readonly DispatchCrewOption[],
  key: string,
): DispatchCrewOption | undefined => options.find((option) => option.key === key);


// ── Choosing a crew by CAPTAIN, with the vehicle following ───────────────────────────────────────
//
// "أعين الشحنة لقائد وتلقائي يختار السيارة اللى القائد عليها اليوم دا وممكن أغير العربية عادي" —
// name the captain, the vehicle fills itself in, and the vehicle stays changeable.
//
// BOTH ARE THE SAME CHOICE. A crew row IS a (operating day, vehicle) pair, and Q11 gives a captain
// at most one vehicle on a day — so "which captain" and "which vehicle" are two ways of naming one
// row, and the form can offer either as the handle. That is why the wire carries no vehicleId: the
// vehicle is a fact of the row the server reads, never a claim the client makes.
//
// The one place they are NOT symmetric is a two-captain crew: a vehicle then has two captains and
// the pair is ambiguous, so picking the vehicle keeps the captain already chosen when he is on it
// and otherwise falls to its first captain — which the captain select then shows, so the operator
// can see who they were given and change it.

/** The vehicle a captain is on that day — Q11 makes this at most one. */
export const vehicleOfCaptain = (
  options: readonly DispatchCrewOption[],
  captainEmployeeId: string,
): DispatchCrewOption | undefined =>
  options.find((option) => option.captainEmployeeId === captainEmployeeId);

/** The vehicles on the board, once each, in the order their options appear. */
export const vehiclesOf = (
  options: readonly DispatchCrewOption[],
): { vehicleId: string; vehicleCode: string }[] => {
  const seen = new Set<string>();
  return options.flatMap((option) =>
    seen.has(option.vehicleId)
      ? []
      : [(seen.add(option.vehicleId), { vehicleId: option.vehicleId, vehicleCode: option.vehicleCode })],
  );
};

/**
 * Re-point the choice at a different vehicle, keeping the captain when he is on it.
 *
 * Returns `undefined` for a vehicle with no crew — the caller clears the choice rather than
 * inventing a captain for a van nobody is planned onto.
 */
export const chooseVehicle = (
  options: readonly DispatchCrewOption[],
  vehicleId: string,
  currentCaptainId: string,
): DispatchCrewOption | undefined => {
  const onVehicle = options.filter((option) => option.vehicleId === vehicleId);
  return onVehicle.find((option) => option.captainEmployeeId === currentCaptainId) ?? onVehicle[0];
};
