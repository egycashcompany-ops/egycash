// The two daily sweeps (fleet design §4.4, §9.2, FR-14). Both are pure announcers: they change
// no business state, derive everything at run time (owner FL-4 points 2/4), and are idempotent
// through `markOnce` — run either twice and the second run inserts no marks and emits nothing.
import { FleetEvents, FleetSettingKeys } from '@ecms/contracts';
import { type Types } from 'mongoose';
import { settingsService } from '../../../platform/settings';
import { getDirectoryEmployee } from '../../../platform/directory';
import { emit } from '../../../platform/kernel/event-bus';
import { FleetVehicleModel } from '../vehicles/vehicle.model';
import { FleetDriverProfileModel } from '../driver-profiles/driver-profile.model';
import { computeAlarms } from '../maintenance/maintenance-alarm';
import { markOnce } from './sweep-mark.model';

const ORG = { userId: null, branchId: null };
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * License expiry (FR-14): `expiring` inside the warn window, `expired` past the date. Keyed on
 * (subject, expiry date), so renewal — a NEW expiry date — re-arms both announcements.
 */
export const licenseExpirySweep = async (now: Date = new Date()): Promise<void> => {
  const [vehicleWarnDays, driverWarnDays] = await Promise.all([
    settingsService.resolve<number>(FleetSettingKeys.VehicleLicenseWarnDays, ORG),
    settingsService.resolve<number>(FleetSettingKeys.DriverLicenseWarnDays, ORG),
  ]);
  const windowEnd = (days: number): Date => new Date(now.getTime() + days * 86_400_000);

  const vehicles = await FleetVehicleModel.find(
    { isDeleted: false, status: 'active', licenseExpiresAt: { $lte: windowEnd(vehicleWarnDays) } },
    { code: 1, licenseExpiresAt: 1 },
  ).lean<{ _id: Types.ObjectId; code: string; licenseExpiresAt: Date }[]>();

  for (const vehicle of vehicles) {
    const expired = vehicle.licenseExpiresAt <= now;
    const kind = expired ? 'expired' : 'expiring';
    if (await markOnce(`vlic:${kind}:${vehicle._id}:${dayKey(vehicle.licenseExpiresAt)}`)) {
      await emit(expired ? FleetEvents.VehicleLicenseExpired : FleetEvents.VehicleLicenseExpiring, {
        subjectId: String(vehicle._id),
        code: vehicle.code,
        expiresAt: vehicle.licenseExpiresAt,
      });
    }
  }

  const profiles = await FleetDriverProfileModel.find(
    { isDeleted: false, isActive: true, licenseExpiresAt: { $lte: windowEnd(driverWarnDays) } },
    { employeeId: 1, licenseNumber: 1, licenseExpiresAt: 1 },
  ).lean<
    {
      _id: Types.ObjectId;
      employeeId: Types.ObjectId;
      licenseNumber: string;
      licenseExpiresAt: Date;
    }[]
  >();

  for (const profile of profiles) {
    const expired = profile.licenseExpiresAt <= now;
    const kind = expired ? 'expired' : 'expiring';
    if (await markOnce(`dlic:${kind}:${profile.employeeId}:${dayKey(profile.licenseExpiresAt)}`)) {
      const employee = await getDirectoryEmployee(String(profile.employeeId));
      await emit(expired ? FleetEvents.DriverLicenseExpired : FleetEvents.DriverLicenseExpiring, {
        subjectId: String(profile.employeeId),
        code: employee?.code ?? profile.licenseNumber,
        expiresAt: profile.licenseExpiresAt,
      });
    }
  }
};

/**
 * Maintenance alarm (§4.4 additive half): the alarm itself is derived on read; this announces a
 * threshold CROSSING once per (vehicle, level, baseline) — a new service visit is a new baseline,
 * which is exactly when the announcement should re-arm.
 */
export const maintenanceAlarmSweep = async (): Promise<void> => {
  const alarms = await computeAlarms();
  const flagged = alarms.filter((alarm) => alarm.level !== 'none');
  if (flagged.length === 0) return;

  for (const alarm of flagged) {
    const baseline = alarm.lastServiceAt ?? 'none';
    if (await markOnce(`alarm:${alarm.vehicleId}:${alarm.level}:${baseline}`)) {
      await emit(FleetEvents.MaintenanceAlarmRaised, {
        vehicleId: alarm.vehicleId,
        code: alarm.code,
        level: alarm.level as 'yellow' | 'red',
        remainingKm: alarm.remainingKm ?? 0,
      });
    }
  }
};
