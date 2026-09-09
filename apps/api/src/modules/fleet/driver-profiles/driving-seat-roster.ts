// WHO THE FLEET CAN PUT ON THE ROAD — one answer, read by every screen that asks.
//
// The registry (`/fleet/drivers`) has answered this from the ORG CHART since PR #375's lesson:
// a driver is whoever holds a seat whose job title carries `requiresDrivingTest`, which the
// job-title form calls "the single place driver-ness is decided". A `fleet_driver_profiles`
// document is what Fleet has RECORDED about such a person — a licence number, an expiry, an
// area — and a person nobody has got round to recording is still a driver.
//
// The two roster boards did not read it that way. Both pooled from `fleet_driver_profiles`, so a
// house whose drivers are all on the registry and none of them recorded saw «لا يوجد سائقون
// متاحون في هذا التاريخ» on a screen whose own sibling listed ten of them — the empty pool and an
// empty payroll look exactly alike, which is the failure mode the registry itself was rebuilt to
// end. The daily board narrows this by the availability seam (التمامات + HR leave) and the
// standing board does not, and that is the only difference between the two pools.
import { jobTitleRepository } from '../../../platform/organization/job-titles/job-title.repository';
import { listDirectoryEmployeesByJobTitles } from '../../../platform/directory';

/**
 * Every employee in a driving seat, by employee id, in the directory's own order.
 *
 * Empty when no job title carries the flag — the honest answer, and the one the registry screen
 * names out loud rather than showing as an empty fleet.
 */
export const drivingSeatEmployeeIds = async (): Promise<string[]> => {
  const jobTitleIds = await jobTitleRepository.idsRequiringDrivingTestSystem();
  const roster = await listDirectoryEmployeesByJobTitles(jobTitleIds);
  return roster.map((employee) => employee.employeeId);
};
