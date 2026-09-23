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
};
