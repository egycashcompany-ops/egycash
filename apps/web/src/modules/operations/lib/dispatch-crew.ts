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
//
// ROUND 24 — A CREW WITHOUT A VAN. «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»: the
// delivery leg may ride a crew row without a van, so the assign dialog offers those rows too (the
// crew board's `vehiclelessRows`, passed as the second list). They have no van to be told apart by,
// so the «vehicle» list keys every row by `vanKey` — the van's id, or `crew:<row id>` for a row
// without one — and names those «بدون سيارة (n)» in the board's order. The PICKUP leg (the shipment
// form) stays van-only, as the server keeps it: it passes no second list.
import { type OperationsCrewBoardCrewDto, type OperationsCrewBoardRowDto } from '@ecms/contracts';

export interface DispatchCrewOption {
  /** `crewAssignmentId:captainEmployeeId` — stable, and enough to reconstruct both halves. */
  key: string;
  crewAssignmentId: string;
  captainEmployeeId: string;
  /** Null (Round 24) for a crew row without a van. */
  vehicleId: string | null;
  vehicleCode: string | null;
  /** What the vehicle list keys the row by: the van's id, or `crew:<row id>` without one. */
  vanKey: string;
  /** A row without a van: its number among the day's («بدون سيارة (n)»); null for a van. */
  looseNumber: number | null;
}

/**
 * One option per (crew row, captain). Rows with NO captain are dropped: a delivery leg needs a
 * captain, so a captainless vehicle is not dispatchable — the same filter the screen has always
 * applied, now expressed as "produces no options" instead of "fails the null check". The rows
 * without a van (Round 24) after the vans, in the board's order.
 */
export const dispatchCrewOptions = (
  rows: readonly OperationsCrewBoardRowDto[],
  vehicleless: readonly OperationsCrewBoardCrewDto[] = [],
): DispatchCrewOption[] => [
  ...rows.flatMap((row) =>
    (row.crew?.captainEmployeeIds ?? []).map((captainEmployeeId) => ({
      key: `${row.crew?.id ?? ''}:${captainEmployeeId}`,
      crewAssignmentId: row.crew?.id ?? '',
      captainEmployeeId,
      vehicleId: row.vehicleId,
      vehicleCode: row.vehicleCode,
      vanKey: row.vehicleId,
      looseNumber: null,
    })),
  ),
  ...vehicleless.flatMap((crew, index) =>
    crew.captainEmployeeIds.map((captainEmployeeId) => ({
      key: `${crew.id}:${captainEmployeeId}`,
      crewAssignmentId: crew.id,
      captainEmployeeId,
      vehicleId: null,
      vehicleCode: null,
      vanKey: `crew:${crew.id}`,
      looseNumber: index + 1,
    })),
  ),
];

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

/**
 * The vehicles on the board, once each, in the order their options appear — keyed by `vanKey`, so
 * two rows without a van (Round 24) are two entries, never one merged under a missing van.
 */
export const vehiclesOf = (
  options: readonly DispatchCrewOption[],
): Pick<DispatchCrewOption, 'vanKey' | 'vehicleId' | 'vehicleCode' | 'looseNumber'>[] => {
  const seen = new Set<string>();
  return options.flatMap((option) =>
    seen.has(option.vanKey)
      ? []
      : [
          (seen.add(option.vanKey),
          {
            vanKey: option.vanKey,
            vehicleId: option.vehicleId,
            vehicleCode: option.vehicleCode,
            looseNumber: option.looseNumber,
          }),
        ],
  );
};

/**
 * Re-point the choice at a different vehicle (its `vanKey`), keeping the captain when he is on it.
 *
 * Returns `undefined` for a vehicle with no crew — the caller clears the choice rather than
 * inventing a captain for a van nobody is planned onto.
 */
export const chooseVehicle = (
  options: readonly DispatchCrewOption[],
  vanKey: string,
  currentCaptainId: string,
): DispatchCrewOption | undefined => {
  const onVehicle = options.filter((option) => option.vanKey === vanKey);
  return onVehicle.find((option) => option.captainEmployeeId === currentCaptainId) ?? onVehicle[0];
};
