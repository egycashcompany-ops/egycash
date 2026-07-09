// Platform-owned scheduled tasks for phase 2.1.
import { logger } from '../../infrastructure/logging/logger';
import { relayOutbox } from '../kernel/event-bus';
import { rbacService } from '../rbac';
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
};
