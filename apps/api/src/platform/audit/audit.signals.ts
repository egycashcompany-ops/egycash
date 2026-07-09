// F4 (plan) / F5 (this sprint's numbering) — security-signal detection. Scheduled
// detectors scan a trailing window of the audit stream; a raised signal is itself an
// `alertRaised` audit record (entityType `security`) plus a reliable event — the event
// is a seam only, no consumer subscribes this sprint (notifications capability, later).
import { Types } from 'mongoose';
import { PlatformEvents, SettingKeys } from '@ecms/contracts';
import { settingsService } from '../settings';
import { emit, nudgeOutboxRelay } from '../kernel/event-bus';
import { auditService } from './audit.service';
import { AuditLogModel } from './audit.model';

// No authenticated caller in a scheduled job — same pattern as audit.retention.ts.
const SYSTEM_SUBJECT = { userId: null, branchId: null };

/** Defense-in-depth floors — mirror the settings' own schema minimums (Plan §12). */
const DENIED_THRESHOLD_FLOOR = 3;
const EXPORT_SPIKE_THRESHOLD_FLOOR = 5;

/** Not settings-declared (Plan §12 lists only the two thresholds above) — fixed, documented. */
const LOCKOUT_CLUSTER_THRESHOLD = 3;
const LOCKOUT_CLUSTER_WINDOW_MINUTES = 60;
const REFRESH_REUSE_WINDOW_MINUTES = 60;
const DENIED_WINDOW_MINUTES = 60;
const EXPORT_SPIKE_WINDOW_MINUTES = 24 * 60;

/** Pure floor-enforcement — unit-testable without touching Mongo (mirrors retention's). */
export const applyThresholdFloor = (floor: number, configured: number): number =>
  Math.max(floor, configured);

interface RaiseAlertInput {
  signal: string;
  userId?: string;
  count: number;
  windowMinutes: number;
  details?: Record<string, unknown>;
}

/** Dedup per (signal, subject, window): skip if this signal already fired within the window. */
const raiseAlert = async (input: RaiseAlertInput): Promise<void> => {
  const windowStart = new Date(Date.now() - input.windowMinutes * 60_000);
  const alreadyRaised = await AuditLogModel.exists({
    action: 'alertRaised',
    'entityRef.entityType': 'security',
    'entityRef.entityId': input.signal,
    at: { $gte: windowStart },
    ...(input.userId === undefined ? {} : { 'actor.userId': new Types.ObjectId(input.userId) }),
  });
  if (alreadyRaised !== null) return;

  await auditService.record({
    entityRef: { moduleId: 'platform', entityType: 'security', entityId: input.signal },
    action: 'alertRaised',
    actor: { userId: input.userId ?? null, ip: null, userAgent: null },
    changes: [
      { field: 'count', old: null, new: input.count },
      { field: 'windowMinutes', old: null, new: input.windowMinutes },
    ],
  });
  await emit(
    PlatformEvents.AuditAlertRaised,
    {
      signal: input.signal,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      count: input.count,
      windowMinutes: input.windowMinutes,
      ...(input.details === undefined ? {} : { details: input.details }),
    },
    { reliable: true },
  );
  nudgeOutboxRelay();
};

interface UserCountRow {
  _id: Types.ObjectId | null;
  count: number;
}

const countByUser = async (
  action: string,
  windowStart: Date,
  threshold: number,
): Promise<UserCountRow[]> =>
  AuditLogModel.aggregate<UserCountRow>([
    { $match: { action, at: { $gte: windowStart }, 'actor.userId': { $ne: null } } },
    { $group: { _id: '$actor.userId', count: { $sum: 1 } } },
    { $match: { count: { $gte: threshold } } },
  ]);

/** Repeated 403s per user — permission probing (Security Architecture §5). */
const detectRepeatedDenied = async (threshold: number): Promise<void> => {
  const windowStart = new Date(Date.now() - DENIED_WINDOW_MINUTES * 60_000);
  const rows = await countByUser('permissionDenied', windowStart, threshold);
  for (const row of rows) {
    if (row._id === null) continue;
    await raiseAlert({
      signal: 'repeatedDenied',
      userId: String(row._id),
      count: row.count,
      windowMinutes: DENIED_WINDOW_MINUTES,
    });
  }
};

/** Multiple lockouts organization-wide close together — possible credential-stuffing wave. */
const detectLockoutCluster = async (): Promise<void> => {
  const windowStart = new Date(Date.now() - LOCKOUT_CLUSTER_WINDOW_MINUTES * 60_000);
  const count = await AuditLogModel.countDocuments({
    action: 'lockout',
    at: { $gte: windowStart },
  }).exec();
  if (count < LOCKOUT_CLUSTER_THRESHOLD) return;
  await raiseAlert({
    signal: 'lockoutCluster',
    count,
    windowMinutes: LOCKOUT_CLUSTER_WINDOW_MINUTES,
  });
};

/** Export spikes per user per day — bulk PII egress is itself a signal (Plan §16). */
const detectExportSpike = async (threshold: number): Promise<void> => {
  const windowStart = new Date(Date.now() - EXPORT_SPIKE_WINDOW_MINUTES * 60_000);
  const rows = await countByUser('export', windowStart, threshold);
  for (const row of rows) {
    if (row._id === null) continue;
    await raiseAlert({
      signal: 'exportSpike',
      userId: String(row._id),
      count: row.count,
      windowMinutes: EXPORT_SPIKE_WINDOW_MINUTES,
    });
  }
};

/** Any refresh-token reuse is inherently severe — threshold of one occurrence. */
const detectRefreshReuse = async (): Promise<void> => {
  const windowStart = new Date(Date.now() - REFRESH_REUSE_WINDOW_MINUTES * 60_000);
  const rows = await countByUser('refreshReuse', windowStart, 1);
  for (const row of rows) {
    if (row._id === null) continue;
    await raiseAlert({
      signal: 'refreshReuse',
      userId: String(row._id),
      count: row.count,
      windowMinutes: REFRESH_REUSE_WINDOW_MINUTES,
    });
  }
};

export const runSecuritySignalDetection = async (): Promise<void> => {
  const deniedThreshold = applyThresholdFloor(
    DENIED_THRESHOLD_FLOOR,
    await settingsService.resolve<number>(SettingKeys.AuditSignalsDeniedThreshold, SYSTEM_SUBJECT),
  );
  const exportSpikeThreshold = applyThresholdFloor(
    EXPORT_SPIKE_THRESHOLD_FLOOR,
    await settingsService.resolve<number>(
      SettingKeys.AuditSignalsExportSpikeThreshold,
      SYSTEM_SUBJECT,
    ),
  );

  await detectRepeatedDenied(deniedThreshold);
  await detectLockoutCluster();
  await detectExportSpike(exportSpikeThreshold);
  await detectRefreshReuse();
};
