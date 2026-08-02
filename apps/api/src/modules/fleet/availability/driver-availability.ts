// The availability seam (fleet design §2.4/§4.5, owner decision Q1) — ONE function answers
// "may this driver be assigned on date D", and FL-5's roster is its consumer. Three checks,
// cheapest first, each a different authority:
//   1. the fleet-side profile switch and the HR employment gate (an inactive profile or a
//      non-working employee is ineligible regardless of anything else, design §6),
//   2. the fleet operational overlay (التمامات),
//   3. HR leave, read through the platform seam when `fleet.availability.useHrLeave` is on.
import { FleetSettingKeys } from '@ecms/contracts';
import { getDirectoryEmployee, isOnApprovedLeave } from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { fleetUnavailabilityRepository } from './unavailability.repository';

export type DriverUnavailableReason =
  'noProfile' | 'profileInactive' | 'notEmployed' | 'fleetUnavailability' | 'hrLeave';

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
): Promise<DriverAvailability> => {
  const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(employeeId);
  if (profile === null) return { available: false, reason: 'noProfile' };
  if (!profile.isActive) return { available: false, reason: 'profileInactive' };

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
