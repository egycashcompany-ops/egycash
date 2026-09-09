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
import { FleetSettingKeys } from '@ecms/contracts';
import { getDirectoryEmployee, isOnApprovedLeave } from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { drivingSeatEmployeeIds } from '../driver-profiles/driving-seat-roster';
import { fleetUnavailabilityRepository } from './unavailability.repository';

export type DriverUnavailableReason =
  'notADriver' | 'profileInactive' | 'notEmployed' | 'fleetUnavailability' | 'hrLeave';

export interface DriverAvailability {
  available: boolean;
  reason: DriverUnavailableReason | null;
}

/** Employment states that keep a driver assignable. `onLeave` is handled by the leave read —
 * HR flips the status for LONG leaves only, while the leave collection knows every span. */
const WORKING_STATUSES = new Set(['probation', 'active', 'onLeave']);

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
): Promise<DriverAvailability> => {
  const seats = drivingSeats ?? new Set(await drivingSeatEmployeeIds());
  if (!seats.has(employeeId)) return { available: false, reason: 'notADriver' };

  // A profile is OPTIONAL — see the note at the top. Only one that exists and has been switched
  // off is a verdict; one that was never written is silence, and silence is not «unavailable».
  const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(employeeId);
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
