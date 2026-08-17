// Fleet settings (frozen design §2.2/§9.2, owner principle 4) — declared at module load, before
// boot resolves any value. Consumers arrive with FL-3/FL-4; declaring them here makes them
// admin-manageable from day one and keeps every threshold out of code.
import { z } from 'zod';
import { FleetSettingKeys } from '@ecms/contracts';
import { declareSetting } from '../../platform/settings';

export const registerFleetSettings = (): void => {
  declareSetting({
    key: FleetSettingKeys.AlarmYellowKm,
    description: 'Remaining-km threshold that turns the maintenance alarm yellow',
    schema: z.number().int().min(0),
    defaultValue: 1000,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: FleetSettingKeys.AlarmRedKm,
    description: 'Remaining-km threshold that turns the maintenance alarm red',
    schema: z.number().int().min(0),
    defaultValue: 300,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: FleetSettingKeys.UseHrLeave,
    description:
      'Driver availability also consults HR leave (owner decision §13-Q1: leave is the base, fleet adds the daily operational overlay)',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: FleetSettingKeys.VehicleLicenseWarnDays,
    description: 'Days before vehicle-license expiry that fleet.vehicleLicense.expiring fires',
    schema: z.number().int().min(1).max(365),
    defaultValue: 30,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: FleetSettingKeys.DriverLicenseWarnDays,
    description: 'Days before driving-license expiry that fleet.driverLicense.expiring fires',
    schema: z.number().int().min(1).max(365),
    defaultValue: 30,
    allowedScopes: ['organization'],
  });
  declareSetting({
    // A NAME, not an id: ids differ per environment and would need a code change per deployment,
    // while the name is what the business actually means by "the default branch". Resolved against
    // live branch data on every request, so renaming the branch here is all it takes to move it.
    key: FleetSettingKeys.DefaultBranchName,
    description:
      'Branch name the new-vehicle form preselects; matched against live branch names (ar or en)',
    schema: z.string().trim().min(1).max(120),
    defaultValue: 'المهندسين',
    allowedScopes: ['organization'],
  });
};
