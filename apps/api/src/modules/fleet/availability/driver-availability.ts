// The availability seam (fleet design §2.4/§4.5, owner decision Q1) — ONE function answers
// "may this driver be assigned on date D", and FL-5's roster is its consumer. Four checks, each a
// different authority:
//   1. the ORG CHART: is this person in a driving seat at all (the `requiresDrivingTest` flag the
//      drivers registry is itself made of),
//   2. the fleet-side profile switch and the HR employment gate (a profile deliberately switched
//      off, or a non-working employee, is ineligible regardless of anything else, design §6),
//   3. the fleet operational overlay (التمامات),
//   4. HR leave, read through the platform seam when `fleet.availability.useHrLeave` is on.
//
// WHY THE FIRST CHECK IS THE SEAT AND NOT THE PROFILE. It used to be «does a `fleet_driver_profile`
// document exist», and the answer for a house that has hired drivers but recorded none of them was
// «nobody is available» — on a screen whose sibling, the registry, listed all of them. A profile is
// what Fleet has WRITTEN DOWN about a driver (a licence number, an expiry, an area); it is not what
// makes them a driver, and its absence is not a statement about today. The seat is. A profile that
// EXISTS and has been switched off still speaks, because that is a decision somebody made.
import {
  FleetSettingKeys,
  ymdOf,
  type FleetDriverLicenceState,
  type FleetDriverUnavailableReason,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import {
  approvedLeaveEmployeeIds,
  getDirectoryEmployee,
  isOnApprovedLeave,
} from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { type FleetDriverProfileDoc } from '../driver-profiles/driver-profile.model';
import { drivingSeatEmployeeIds } from '../driver-profiles/driving-seat-roster';
import { driverLicenceStateOn } from '../roster/roster-rules';
import { fleetUnavailabilityRepository } from './unavailability.repository';

/**
 * The seam's reasons, in its precedence — the contracts' list, so the board, planning and the
 * dashboard name them with one vocabulary. `licenceExpired` is the last of them (R-04).
 */
export type DriverUnavailableReason = FleetDriverUnavailableReason;

export interface DriverAvailability {
  available: boolean;
  reason: DriverUnavailableReason | null;
  /**
   * The driver's licence on the date (R-02: expired ON the expiry day), whatever the verdict.
   *
   * While `fleet.roster.refuseExpiredLicence` is off this is only a FLAG: an expired licence leaves
   * the driver available and planning accepts them, and the roster shows the flag so the clerks can
   * correct stale dates first. On, it becomes the reason `licenceExpired`. `notRecorded` (a profile
   * with no date) and `noProfile` never block anybody.
   */
  licence: FleetDriverLicenceState;
}

/** The four checks' answer, before the licence is looked at. */
type SeamVerdict = Omit<DriverAvailability, 'licence'>;

/** `fleet.roster.refuseExpiredLicence`, as the seam applies it: off → flag, on → refuse. */
export type RosterLicenceRule = 'flag' | 'refuse';

/**
 * The organisation's licence rule (Q-01). Read through the settings service, which caches it, and
 * read ONCE per board — the board passes the answer down rather than asking per driver.
 */
export const rosterLicenceRule = async (): Promise<RosterLicenceRule> =>
  (await settingsService.resolve<boolean>(FleetSettingKeys.RosterRefuseExpiredLicence, {
    userId: null,
    branchId: null,
  })) === true
    ? 'refuse'
    : 'flag';

/**
 * R-04's last check, after the four: an otherwise available driver whose licence has expired is
 * refused only while the rule says so. Every unavailable driver keeps exactly one reason — an
 * absent driver whose licence has also expired answers his absence.
 */
const withLicence = (
  verdict: SeamVerdict,
  licence: FleetDriverLicenceState,
  rule: RosterLicenceRule,
): DriverAvailability =>
  verdict.available && licence === 'expired' && rule === 'refuse'
    ? { available: false, reason: 'licenceExpired', licence }
    : { ...verdict, licence };

/** Employment states that keep a driver assignable. `onLeave` is handled by the leave read —
 * HR flips the status for LONG leaves only, while the leave collection knows every span. */
const WORKING_STATUSES = new Set(['probation', 'active', 'onLeave']);

/**
 * The four checks, in their unchanged precedence. The profile is read at most once, and only once
 * the seat has answered: the licence below needs the same document, so it is handed in as a
 * memoised read rather than fetched twice.
 */
const seamVerdictOn = async (
  employeeId: string,
  date: Date,
  seats: ReadonlySet<string>,
  readProfile: () => Promise<FleetDriverProfileDoc | null>,
): Promise<SeamVerdict> => {
  if (!seats.has(employeeId)) return { available: false, reason: 'notADriver' };

  // A profile is OPTIONAL — see the note at the top. Only one that exists and has been switched
  // off is a verdict; one that was never written is silence, and silence is not «unavailable».
  const profile = await readProfile();
  if (profile !== null && !profile.isActive) {
    return { available: false, reason: 'profileInactive' };
  }

  const employee = await getDirectoryEmployee(employeeId);
  if (employee === null || !WORKING_STATUSES.has(employee.status)) {
    return { available: false, reason: 'notEmployed' };
  }

  if (await fleetUnavailabilityRepository.existsCovering(employeeId, date)) {
    return { available: false, reason: 'fleetUnavailability' };
  }

  const useHrLeave = await settingsService.resolve<boolean>(FleetSettingKeys.UseHrLeave, {
    userId: null,
    branchId: null,
  });
  if (useHrLeave && (await isOnApprovedLeave(employeeId, date))) {
    return { available: false, reason: 'hrLeave' };
  }

  return { available: true, reason: null };
};

export const driverAvailabilityOn = async (
  employeeId: string,
  date: Date,
  /**
   * Who holds a driving seat, when the caller already knows.
   *
   * A board asks this seam once per driver in a loop, and the seat roster is one answer for the
   * whole loop — passing it is what keeps a hundred drivers from costing a hundred org-chart
   * reads. Omitted, the seam fetches it itself: a caller that has not asked the question is not
   * allowed to skip it.
   */
  drivingSeats?: ReadonlySet<string>,
  /**
   * `fleet.roster.refuseExpiredLicence`, when the caller has already read it. Omitted, the seam
   * reads it itself — and only when it matters: for a driver who is otherwise available and whose
   * licence has expired.
   */
  licenceRule?: RosterLicenceRule,
): Promise<DriverAvailability> => {
  const seats = drivingSeats ?? new Set(await drivingSeatEmployeeIds());
  let profileRead: Promise<FleetDriverProfileDoc | null> | null = null;
  const readProfile = (): Promise<FleetDriverProfileDoc | null> =>
    (profileRead ??= fleetDriverProfileRepository.findDriverByEmployeeId(employeeId));

  const verdict = await seamVerdictOn(employeeId, date, seats, readProfile);
  // R-02 on the seam's own date: the UTC date part of the day it was asked about, the reading the
  // board and planning already give their `utcDay`. Somebody whose id is not even an ObjectId has
  // no profile to read — the seat already said they are not a driver.
  const licence = Types.ObjectId.isValid(employeeId)
    ? driverLicenceStateOn(await readProfile(), ymdOf(date))
    : 'noProfile';
  if (!verdict.available || licence !== 'expired') return { ...verdict, licence };
  return withLicence(verdict, licence, licenceRule ?? (await rosterLicenceRule()));
};

/**
 * The same checks, asked ONCE for a whole board.
 *
 * `driverAvailabilityOn` above is the seam for a HANDFUL of drivers — a save validating the rows
 * it was handed. A board asks about every driver in the fleet, and asking one at a time cost four
 * round trips per driver (profile, directory, overlay, setting) issued serially inside a `for`
 * loop: three hundred drivers meant twelve hundred sequential queries, and the setting was
 * re-resolved for every one of them.
 *
 * Widening the pool from «enrolled drivers» to «the whole registry» made that cost grow with the
 * fix, which is why this exists. Same verdicts, same precedence, four queries plus one leave read
 * per driver only where the flag is on and the driver is otherwise free. The licence comes from
 * the profiles already in hand, and the licence rule is read once (or handed in by the board).
 */
export const driverAvailabilityForRoster = async (
  roster: readonly { employeeId: string; status: string }[],
  date: Date,
  licenceRule?: RosterLicenceRule,
): Promise<Map<string, DriverAvailability>> => {
  const out = new Map<string, DriverAvailability>();
  if (roster.length === 0) return out;
  const ids = roster.map((employee) => employee.employeeId);
  const day = ymdOf(date);

  const [profiles, covered, useHrLeave, rule] = await Promise.all([
    fleetDriverProfileRepository.findForEmployeesSystem(ids),
    fleetUnavailabilityRepository.coveredOn(ids, date),
    settingsService.resolve<boolean>(FleetSettingKeys.UseHrLeave, { userId: null, branchId: null }),
    licenceRule ?? rosterLicenceRule(),
  ]);
  const byEmployee = new Map(profiles.map((doc) => [String(doc.employeeId), doc]));
  const settle = (employeeId: string, verdict: SeamVerdict): void => {
    out.set(
      employeeId,
      withLicence(verdict, driverLicenceStateOn(byEmployee.get(employeeId) ?? null, day), rule),
    );
  };

  // Everyone still standing after the cheap checks — only these cost an HR leave read, and only
  // when the setting is on.
  const stillFree: string[] = [];
  for (const employee of roster) {
    const profile = byEmployee.get(employee.employeeId) ?? null;
    if (profile !== null && !profile.isActive) {
      settle(employee.employeeId, { available: false, reason: 'profileInactive' });
    } else if (!WORKING_STATUSES.has(employee.status)) {
      settle(employee.employeeId, { available: false, reason: 'notEmployed' });
    } else if (covered.has(employee.employeeId)) {
      settle(employee.employeeId, { available: false, reason: 'fleetUnavailability' });
    } else {
      stillFree.push(employee.employeeId);
    }
  }

  if (!useHrLeave) {
    for (const employeeId of stillFree) settle(employeeId, { available: true, reason: null });
    return out;
  }
  // One batched leave read for everyone still free (the platform seam's `approvedLeaveEmployeeIds`),
  // never one per driver: the roster board, and the dashboard on every refresh, asks this for the
  // whole driving-seat roster.
  const onLeave = await approvedLeaveEmployeeIds(stillFree, date);
  for (const employeeId of stillFree) {
    settle(
      employeeId,
      onLeave.has(employeeId)
        ? { available: false, reason: 'hrLeave' }
        : { available: true, reason: null },
    );
  }
  return out;
};
