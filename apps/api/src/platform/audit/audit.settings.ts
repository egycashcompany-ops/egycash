// Audit-owned configurable values (Sprint 3.2, F3/F4): retention floor, export cap,
// and signal-detector thresholds. All organization-scoped; schema minimums are the
// HARD FLOORS — misconfiguration cannot push a value below them (Plan §12).
import { z } from 'zod';
import { SettingKeys } from '@ecms/contracts';
import { declareSetting } from '../settings';

export const registerAuditSettings = (): void => {
  declareSetting({
    key: SettingKeys.AuditRetentionActivityDays,
    description:
      'Activity-log retention window in days before batched purge (floor 365). The audit ' +
      'stream itself has no retention setting — it is never purged.',
    schema: z.number().int().min(365).max(3650),
    defaultValue: 730,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.AuditExportMaxRows,
    description: 'Maximum rows a single audit export may stream',
    schema: z.number().int().min(1_000).max(200_000),
    defaultValue: 50_000,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.AuditSignalsDeniedThreshold,
    description: 'Denied-permission (403) occurrences per user per hour that raise a security signal',
    schema: z.number().int().min(3).max(1_000),
    defaultValue: 10,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: SettingKeys.AuditSignalsExportSpikeThreshold,
    description: 'Audit exports per user per day that raise a security signal',
    schema: z.number().int().min(5).max(1_000),
    defaultValue: 20,
    allowedScopes: ['organization'],
  });
};
