// The roster's day rules, as pure functions (fleet dashboard plan R-02…R-06).
//
// ONE PLACE FOR EACH RULE, because three readers ask the same questions: the board marks its rows
// with these answers, planning refuses with them, and the dashboard counts the marked rows. A rule
// that lived in two of those would be two rules the day somebody changed one.
//
// Nothing here reads the database or a clock. The board's DATE is passed in as the 'YYYY-MM-DD'
// the board describes (the UTC date part of its UTC-midnight `Date`, which for the dashboard is the
// Cairo day it was asked for), and every verdict about a driver arrives as a function — the seam
// (`driver-availability.ts`) stays the only availability authority, and this module only combines
// what it already said.
import {
  expiryStateOn,
  type FleetDriverLicenceState,
  type FleetDriverUnavailableReason,
  type FleetRosterCrewGapDto,
} from '@ecms/contracts';

/**
 * R-02 on a day: a licence is EXPIRED on its expiry day and every day after (Q-02). A missing date
 * is not recorded, which is never expired — a null date never blocks anybody.
 *
 * `expiryStateOn` with a zero warning window is exactly that question, asked through the contracts'
 * one definition rather than a second comparison spelled out here.
 */
export const licenceExpiredOn = (
  expiresAt: Date | string | null | undefined,
  day: string,
): boolean => expiryStateOn(expiresAt, day, 0) === 'expired';

/**
 * A driver's licence on a day, from the profile Fleet recorded about them (R-04's flag).
 *
 * `noProfile` — nobody has recorded a profile; `notRecorded` — a profile with no expiry date.
 * Neither is expired: both count as available and are only flagged.
 */
export const driverLicenceStateOn = (
  profile: { licenseExpiresAt?: Date | null } | null | undefined,
  day: string,
): FleetDriverLicenceState => {
  if (profile === null || profile === undefined) return 'noProfile';
  if (profile.licenseExpiresAt === null || profile.licenseExpiresAt === undefined) {
    return 'notRecorded';
  }
  return licenceExpiredOn(profile.licenseExpiresAt, day) ? 'expired' : 'valid';
};

/**
 * R-03 · a vehicle is ASSIGNABLE (ready) on a day when it is active, no open workshop visit covers
 * the day, and its licence has not expired on it. Out-of-service and disposed vehicles never are.
 */
export const vehicleAssignableOn = (
  vehicle: { status: string; licenseExpiresAt?: Date | string | null },
  inMaintenance: boolean,
  day: string,
): boolean =>
  vehicle.status === 'active' && !inMaintenance && !licenceExpiredOn(vehicle.licenseExpiresAt, day);

/**
 * Why a driver is not available on the board's day under R-04, or `null` when they are.
 *
 * R-04 INCLUDES the licence: a driver whose licence has expired is not «available today» for any
 * of the counts below, even while `fleet.roster.refuseExpiredLicence` is off and planning still
 * accepts them. The seam's flag becomes the reason `licenceExpired` here, after its own reasons.
 */
export type DriverReasonOn = (employeeId: string) => FleetDriverUnavailableReason | null;

/**
 * R-05 · the reasons that make a driver ABSENT — التمامات and HR leave. A crew gap for one of these
 * is the dashboard's «غياب الطاقم الثابت» (T1.6) and the roster's `view=crewGap`; a gap for any
 * other reason (an expired licence, a suspended or switched-off driver) is counted on its own line.
 */
export const ROSTER_ABSENCE_REASONS: readonly FleetDriverUnavailableReason[] = [
  'fleetUnavailability',
  'hrLeave',
];

export const isAbsenceReason = (reason: FleetDriverUnavailableReason): boolean =>
  ROSTER_ABSENCE_REASONS.includes(reason);

/** R-06 · a seat is MANNED when it names a driver who is available on the day. */
export const seatManned = (employeeId: string | null, reasonOf: DriverReasonOn): boolean =>
  employeeId !== null && reasonOf(employeeId) === null;

/** Today's two seats, or the standing crew's two seats, in seat order. */
export type Seats = readonly [string | null, string | null];

/** R-06 · a row is manned when at least one of its seats is. */
export const rowMannedOn = (seats: Seats, reasonOf: DriverReasonOn): boolean =>
  seats.some((employeeId) => seatManned(employeeId, reasonOf));

/**
 * R-06 · the crew gaps of one row, seat by seat.
 *
 * Only a READY vehicle with a fixed crew can have one: a car the workshop holds, or one whose own
 * licence has expired, is not short of a driver — it is not going out. For each seat whose FIXED
 * driver is not available on the day:
 *   - the seat is a GAP when it is not manned — empty, or naming an unavailable driver (most often
 *     the fixed driver himself, planned before his absence was recorded);
 *   - the seat is COVERED when an available substitute is planned in it.
 * A fixed driver who is available is never a gap, wherever the day has put him.
 */
export const crewGapsOf = (input: {
  ready: boolean;
  seats: Seats;
  fixed: Seats | null;
  reasonOf: DriverReasonOn;
}): { crewGaps: FleetRosterCrewGapDto[]; crewCovered: number } => {
  const crewGaps: FleetRosterCrewGapDto[] = [];
  let crewCovered = 0;
  if (!input.ready || input.fixed === null) return { crewGaps, crewCovered };
  input.fixed.forEach((fixedId, index) => {
    if (fixedId === null) return;
    const reason = input.reasonOf(fixedId);
    if (reason === null) return;
    if (seatManned(input.seats[index] ?? null, input.reasonOf)) {
      crewCovered += 1;
    } else {
      crewGaps.push({ seat: index === 0 ? 1 : 2, employeeId: fixedId, reason });
    }
  });
  return { crewGaps, crewCovered };
};

/**
 * A STALE PLAN: a stored (planned) row names a driver who is unavailable on the day and who is not
 * one of this car's fixed crew. That is not a crew gap — the standing crew is not involved — but
 * the plan no longer holds, so it is counted on its own line.
 */
export const stalePlanOf = (input: {
  planned: boolean;
  seats: Seats;
  fixed: Seats | null;
  reasonOf: DriverReasonOn;
}): boolean => {
  if (!input.planned) return false;
  const crew = new Set((input.fixed ?? []).filter((id): id is string => id !== null));
  return input.seats.some(
    (employeeId) =>
      employeeId !== null && !crew.has(employeeId) && input.reasonOf(employeeId) !== null,
  );
};
