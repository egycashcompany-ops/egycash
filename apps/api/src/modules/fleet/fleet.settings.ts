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

  // ── The signature block on every printed Fleet report ─────────────────────
  //
  // A printed table is a company document: it goes up for signature and into a binder, so it
  // names who prepared it, who approves it and who endorses the totals. These are PEOPLE — they
  // are promoted and they move — so they are settings rather than literals in a print template,
  // which would mean a code change and a release every time one of them changed.
  //
  // Bounded at 160 characters because the endorsement line carries a rank, a name, an office and
  // the company, and it still has to print on one line.
  const signatory = (key: string, description: string, defaultValue: string): void =>
    declareSetting({
      key,
      description,
      schema: z.string().trim().min(1).max(160),
      defaultValue,
      allowedScopes: ['organization'],
    });

  signatory(
    FleetSettingKeys.ReportPreparedByTitle,
    'Printed Fleet reports — the office that prepared the report',
    'القائم بالأعمال',
  );
  signatory(
    FleetSettingKeys.ReportPreparedByName,
    'Printed Fleet reports — the person who prepared the report',
    'م / محمد حسين محمد',
  );
  signatory(
    FleetSettingKeys.ReportApprovedByTitle,
    'Printed Fleet reports — the office that approves the report',
    'مدير إدارة الحركة',
  );
  signatory(
    FleetSettingKeys.ReportApprovedByName,
    'Printed Fleet reports — the person who approves the report',
    'عميد / إيهاب عبد السلام سليمان',
  );
  signatory(
    FleetSettingKeys.ReportEndorsementNote,
    'Printed Fleet reports — the line asking for the totals to be endorsed',
    'يُرجى المراجعة والتصديق على إجمالي المصروفات',
  );
  signatory(
    FleetSettingKeys.ReportEndorsedByName,
    'Printed Fleet reports — the executive who endorses the totals',
    'لواء أ ح / جمال أحمد أبواسماعيل - المدير العام التنفيذى - شركة ايجى كاش للحلول النقدية',
  );
  // ── Fuel ─────────────────────────────────────────────────────────────────
  //
  // Prices per litre, in EGP: what a fuel receipt's amount is divided by to show its litres. They
  // change when the pump's do, and a receipt is computed with the price of the day it is recorded.
  const fuelPrice = (key: string, description: string, defaultValue: number): void =>
    declareSetting({
      key,
      description,
      schema: z.number().nonnegative(),
      defaultValue,
      allowedScopes: ['organization'],
    });
  fuelPrice(FleetSettingKeys.FuelPricePetrol80, 'Fuel price per litre — petrol 80', 15.75);
  fuelPrice(FleetSettingKeys.FuelPricePetrol92, 'Fuel price per litre — petrol 92', 17.25);
  fuelPrice(FleetSettingKeys.FuelPricePetrol95, 'Fuel price per litre — petrol 95', 19);
  fuelPrice(FleetSettingKeys.FuelPriceDiesel, 'Fuel price per litre — diesel', 15.5);
  declareSetting({
    key: FleetSettingKeys.FuelCardExpiryWarnDays,
    description: 'Days before a fuel card expires that the cards screen flags it',
    schema: z.number().int().min(1).max(365),
    defaultValue: 30,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: FleetSettingKeys.FuelCardBalanceYellow,
    description: 'A fuel card balance below this reads yellow on the charging screen',
    schema: z.number().nonnegative(),
    defaultValue: 300,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: FleetSettingKeys.FuelCardBalanceRed,
    description: 'A fuel card balance below this reads red on the charging screen',
    schema: z.number().nonnegative(),
    defaultValue: 100,
    allowedScopes: ['organization'],
  });

  // ── The movement dashboard (Phase 1) ─────────────────────────────────────
  //
  // Off by default (owner, Q-01): until it is switched on, the roster only FLAGS a driver or a
  // vehicle whose licence expired — badges, views and «منهم رخصة منتهية N» — and planning behaves
  // exactly as before. The owner checks that list first, so a stale date in the registry never
  // silently takes a car or a driver off the road. A licence with no recorded date never blocks.
  declareSetting({
    key: FleetSettingKeys.RosterRefuseExpiredLicence,
    description:
      'Roster planning refuses a driver or a vehicle whose licence expired (off: the roster only flags them)',
    schema: z.boolean(),
    defaultValue: false,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: FleetSettingKeys.OdometerMissingReadingDays,
    description:
      'Days without an odometer reading after which an active vehicle is flagged on the dashboard',
    schema: z.number().int().min(1).max(30),
    defaultValue: 3,
    allowedScopes: ['organization'],
  });
};
