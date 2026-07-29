// The Automation module manifest (ADR-018 · design §13, slice A-3).
//
// Registered only when `AUTOMATION_ENABLED` is on — see `modules/index.ts`. With the flag off
// nothing here loads: no routes mounted, no permissions synced into the registry, no event
// subscriptions. That is what lets an unfinished feature sit on `main` without a user meeting it.
import {
  PlatformEvents,
  automationPermissions,
  type EventEnvelope,
  type PermissionDef,
} from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { logger } from '../../infrastructure/logging/logger';
import { buildAutomationEventsRouter } from './events/event-catalog.routes';
import { automationCredentialService, buildAutomationCredentialsRouter } from './credentials';
import { automationWorkflowService, buildAutomationWorkflowsRouter } from './workflows';
import { buildAutomationVariablesRouter } from './variables';

/**
 * A deactivated owner's workflows are SUSPENDED, not left running (§7.2).
 *
 * This is the one subscription the registry slice needs, and it is the reason the ownership rule
 * is a rule rather than a convention: offboarding someone has to actually stop what they set in
 * motion, or the automation becomes a way for a revoked account to keep acting.
 */
const suspendWorkflowsOfDeactivatedOwner = async (envelope: EventEnvelope): Promise<void> => {
  const payload = envelope.payload as { userId?: string; status?: string };
  if (payload.userId === undefined) return;
  if (payload.status === 'active' || payload.status === undefined) return;

  const suspended = await automationWorkflowService.suspendOwnedBy(
    payload.userId,
    `owner status changed to '${payload.status}'`,
  );
  if (suspended > 0) {
    logger.warn(
      { userId: payload.userId, status: payload.status, suspended },
      'automation: suspended workflows owned by a deactivated user',
    );
  }
};

export const automationModule: ModuleManifest = {
  id: 'automation',
  name: { en: 'Automation', ar: 'الأتمتة' },
  version: '0.1.0',
  requiresPlatform: '^2.2',
  permissions: automationPermissions as PermissionDef[],
  routes: [
    { prefix: '/automation/workflows', router: buildAutomationWorkflowsRouter() },
    { prefix: '/automation/variables', router: buildAutomationVariablesRouter() },
    { prefix: '/automation/credentials', router: buildAutomationCredentialsRouter() },
    { prefix: '/automation/events', router: buildAutomationEventsRouter() },
  ],
  collections: ['automation_workflows', 'automation_variables', 'automation_credentials'],
  scheduledTasks: [
    {
      key: 'automation.rotateCredentialKeys',
      description:
        'Re-wrap automation credentials still sealed under a retired key. Touches the data key ' +
        'only — no plaintext exists at any point, which is what lets rotation run unattended ' +
        'instead of asking people to re-enter secrets.',
      // Nightly, off-peak. Rotation is not urgent: the retired key keeps decrypting during the
      // overlap window, so the cost of a slow sweep is a longer window, not a broken workflow.
      cron: '30 2 * * *',
      ownerService: 'automation',
      handler: async () => {
        await automationCredentialService.rotateKeys();
      },
    },
  ],
  eventSubscriptions: [
    {
      event: PlatformEvents.UserStatusChanged,
      handlerId: 'workflows.suspendOnOwnerDeactivated',
      handler: suspendWorkflowsOfDeactivatedOwner,
    },
  ],
};
