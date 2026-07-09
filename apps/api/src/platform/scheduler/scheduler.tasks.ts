// Platform-owned scheduled tasks for phase 2.1, plus the audit feature's F3/F4 tasks
// (Sprint 3.2). Declarations are aggregated here — as with `platform.rbac.expiringAssignments`
// below — rather than each feature importing the scheduler back, which would create an
// audit ⇄ scheduler import cycle (scheduler already imports `auditService` from `../audit`).
import { logger } from '../../infrastructure/logging/logger';
import { relayOutbox } from '../kernel/event-bus';
import { rbacService } from '../rbac';
import { runActivityRetention, runSecuritySignalDetection } from '../audit';
import { schedulerService } from './scheduler.service';

export const registerPlatformScheduledTasks = (): void => {
  // Crash-recovery net for the reliable event tier (ADR-008).
  schedulerService.declareTask({
    key: 'platform.outboxSweep',
    description: 'Relay pending outbox events to the dispatch queue',
    cron: '* * * * *',
    ownerService: 'kernel',
    handler: async () => {
      await relayOutbox();
    },
  });

  // Expiring-soon report for time-bound role assignments (Review R14).
  schedulerService.declareTask({
    key: 'platform.rbac.expiringAssignments',
    description: 'Log role assignments expiring within 7 days',
    cron: '0 6 * * *',
    ownerService: 'rbac',
    handler: async () => {
      const expiring = await rbacService.listExpiringAssignments(7);
      if (expiring.length > 0) {
        logger.warn(
          { count: expiring.length, assignments: expiring },
          'role assignments expiring within 7 days',
        );
      }
    },
  });

  // F4 — retention governance (Sprint 3.2): purge expired ACTIVITY records only;
  // the audit stream has no delete path, here or anywhere (ADR-012).
  schedulerService.declareTask({
    key: 'platform.audit.retention',
    description: 'Purge activity records past the retention floor in idempotent batches',
    cron: '0 3 * * *',
    ownerService: 'audit',
    handler: async () => {
      await runActivityRetention();
    },
  });

  // F5 — security-signal detection (Sprint 3.2): raises `alertRaised` audit records +
  // the reliable `platform.audit.alertRaised` event (Security Architecture §5).
  schedulerService.declareTask({
    key: 'platform.audit.securitySignals',
    description: 'Run security-signal detectors over the trailing window',
    cron: '0 * * * *',
    ownerService: 'audit',
    handler: async () => {
      await runSecuritySignalDetection();
    },
  });
};
