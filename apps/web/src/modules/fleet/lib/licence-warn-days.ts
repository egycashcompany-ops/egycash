// «لو غيّرت أيام التنبيه في إعدادات الحركة، ألوان الترخيص في الشاشات بقت تمشي على الإعداد».
//
// How many days before a licence runs out it reads «ينتهي قريبًا» — the two warning days the
// admin sets in «إعدادات الحركة» (`fleet.license.vehicleWarnDays` / `driverWarnDays`). The
// dashboard and the bell's sweeps already count with them; the screens painted a fixed thirty
// days, so once the setting moved a car the dashboard counted in «تنتهي خلال 45 يومًا» showed
// «ساري» on the very list its link opened.
//
// ONE place reads them, for every screen that colours a licence: the vehicles list, the car record
// and card, the licensing board, the drivers list. A screen copying its own reading is how the
// thirty days got there in the first place.
import { useMemo } from 'react';
import { FleetSettingKeys, type ResolvedSettingDto } from '@ecms/contracts';
import { useMySettings } from '../../../platform/settings/settings-api';

/** The settings' own default (`fleet.settings.ts`): what a screen counts with until they load. */
export const DEFAULT_LICENCE_WARN_DAYS = 30;

export interface LicenceWarnDays {
  /** A car's licence — «ترخيص السيارة». */
  vehicle: number;
  /** A driver's licence — «رخصة القيادة». */
  driver: number;
}

/** A whole number of days the setting allows (1 … 365), or the default for anything else. */
const daysOf = (value: unknown): number => {
  const days = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_LICENCE_WARN_DAYS;
};

/** The two warning days out of the caller's resolved settings; the default for one not there. */
export const licenceWarnDaysOf = (
  settings: readonly Pick<ResolvedSettingDto, 'key' | 'value'>[] | undefined,
): LicenceWarnDays => {
  const of = (key: string): number =>
    daysOf(settings?.find((setting) => setting.key === key)?.value);
  return {
    vehicle: of(FleetSettingKeys.VehicleLicenseWarnDays),
    driver: of(FleetSettingKeys.DriverLicenseWarnDays),
  };
};

/**
 * The warning days every licence colour on the Fleet screens is drawn with — from the caller's
 * resolved settings (`GET /platform/settings/me`, open to any signed-in reader), thirty while they
 * load or when they cannot be read.
 */
export const useLicenceWarnDays = (): LicenceWarnDays => {
  const settings = useMySettings();
  return useMemo(() => licenceWarnDaysOf(settings.data), [settings.data]);
};
