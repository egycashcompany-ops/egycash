// F4 — retention governance. The ACTIVITY stream is a bounded, storage-cost-driven log
// and is purged on a schedule; the AUDIT stream is a compliance record and has NO
// delete path here or anywhere — this file never touches AuditLogModel for deletion.
import { SettingKeys } from '@ecms/contracts';
import { settingsService } from '../settings';
import { auditService } from './audit.service';
import { ActivityLogModel } from './audit.model';

/** Defense-in-depth: even if a stored value predates this floor, never purge below it. */
const RETENTION_FLOOR_DAYS = 365;
const DELETE_BATCH_SIZE = 5_000;

// No authenticated caller in a scheduled job — organization is the only allowed scope
// for this setting, so a null-identity subject resolves it (same pattern as the login
// policy lookup in auth.service.ts).
const SYSTEM_SUBJECT = { userId: null, branchId: null };

export interface RetentionRunResult {
  retentionDays: number;
  cutoff: Date;
  deletedCount: number;
}

/** Pure floor-enforcement + cutoff math — unit-testable without touching Mongo. */
export const computeRetentionWindow = (
  configuredDays: number,
  now: Date = new Date(),
): { retentionDays: number; cutoff: Date } => {
  const retentionDays = Math.max(RETENTION_FLOOR_DAYS, configuredDays);
  return { retentionDays, cutoff: new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000) };
};

/** Idempotent: safe to re-run — each batch only ever deletes rows already past cutoff. */
export const runActivityRetention = async (): Promise<RetentionRunResult> => {
  const configured = await settingsService.resolve<number>(
    SettingKeys.AuditRetentionActivityDays,
    SYSTEM_SUBJECT,
  );
  const { retentionDays, cutoff } = computeRetentionWindow(configured);

  let deletedCount = 0;
  for (;;) {
    const batch = await ActivityLogModel.find({ at: { $lt: cutoff } })
      .select('_id')
      .limit(DELETE_BATCH_SIZE)
      .lean<{ _id: unknown }[]>()
      .exec();
    if (batch.length === 0) break;
    const result = await ActivityLogModel.deleteMany({
      _id: { $in: batch.map((row) => row._id) },
    }).exec();
    deletedCount += result.deletedCount ?? 0;
    if (batch.length < DELETE_BATCH_SIZE) break;
  }

  await auditService.record({
    entityRef: { moduleId: 'platform', entityType: 'activityLog', entityId: 'retention' },
    action: 'purge',
    changes: [
      { field: 'retentionDays', old: null, new: retentionDays },
      { field: 'cutoff', old: null, new: cutoff.toISOString() },
      { field: 'deletedCount', old: null, new: deletedCount },
    ],
  });

  return { retentionDays, cutoff, deletedCount };
};
