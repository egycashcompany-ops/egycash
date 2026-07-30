// Keeping the provider's copy of a workflow in step with ECMS's (A-6).
//
// Until A-6 a workflow existed only in ECMS: `providerRef` stayed null and every dispatch recorded
// `skipped` because there was nothing to run. This module is what closes that gap — enabling a
// workflow pushes it to the provider and stores the ref the trigger bridge dispatches against.
//
// It talks to `automationService` only (the A-0 seam), never to a provider directly, so swapping
// n8n for another engine changes nothing here.
import { type ProviderWorkflowRef, type WorkflowSpec } from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { automationService } from '../../../platform/automation';
import { automationWorkflowRepository } from './workflow.repository';
import { type AutomationWorkflowDoc } from './workflow.model';

/**
 * Whether a real runtime is installed. With the flag off (or the null provider active) there is
 * nothing to push to, and a workflow keeps `providerRef: null` exactly as it did before A-6 —
 * which is what lets this merge without changing any existing deployment's behaviour.
 */
const providerAvailable = (): boolean => automationService.status().enabled;

/**
 * ECMS's workflow, in the provider-agnostic shape A-0 defined.
 *
 * No `graph` yet: a workflow's node graph is authored in the provider's own builder, or installed
 * from a signed template package at A-9. What ECMS guarantees here is the workflow's identity and
 * its trigger — the entry point the bridge dispatches against.
 */
const toSpec = (doc: AutomationWorkflowDoc): WorkflowSpec => ({
  key: doc.key,
  name: doc.name.en,
  trigger: {
    kind: doc.trigger.kind,
    ...(doc.trigger.event === null ? {} : { event: doc.trigger.event }),
    ...(doc.trigger.cron === null ? {} : { cron: doc.trigger.cron }),
    timezone: doc.trigger.timezone,
    filters: [],
  } as WorkflowSpec['trigger'],
});

/**
 * Make the provider's copy match ours, and return the ref to dispatch against.
 *
 * Errors PROPAGATE, unlike a dispatch: someone pressing "enable" is making a decision, and telling
 * them it worked when the provider refused would leave a workflow ECMS believes is live and the
 * runtime has never heard of (design §2.1).
 */
export const ensurePushedToProvider = async (
  doc: AutomationWorkflowDoc,
  by: string,
): Promise<ProviderWorkflowRef | null> => {
  if (!providerAvailable()) return doc.providerRef;

  if (doc.providerRef === null) {
    const ref = await automationService.createWorkflow(toSpec(doc));
    await automationWorkflowRepository.setProviderRef(String(doc._id), ref, by);
    logger.info({ workflowId: String(doc._id), key: doc.key }, 'automation: workflow pushed to provider');
    return ref;
  }

  // Already known to the provider — bring its copy up to date rather than minting a second one,
  // which would leave an orphan running the old definition.
  await automationService.updateWorkflow(doc.providerRef, toSpec(doc));
  return doc.providerRef;
};

/** Mirror ECMS's enabled state onto the provider, pushing first if it has never been pushed. */
export const syncEnabledToProvider = async (
  doc: AutomationWorkflowDoc,
  enabled: boolean,
  by: string,
): Promise<void> => {
  if (!providerAvailable()) return;
  const ref = enabled ? await ensurePushedToProvider(doc, by) : doc.providerRef;
  if (ref === null) return;
  await automationService.setEnabled(ref, enabled);
};

/**
 * Remove the provider's copy when a workflow is deleted.
 *
 * This one SWALLOWS its error: the ECMS row is already soft-deleted, the user's intent is served,
 * and a provider that is briefly unreachable must not resurrect a deleted workflow in the UI. The
 * leftover is logged loudly enough to be swept later, which is the lesser of the two failures.
 */
export const removeFromProvider = async (doc: AutomationWorkflowDoc): Promise<void> => {
  if (!providerAvailable() || doc.providerRef === null) return;
  try {
    await automationService.deleteWorkflow(doc.providerRef);
  } catch (error) {
    logger.error(
      { err: error, workflowId: String(doc._id), providerRef: doc.providerRef },
      'automation: could not delete the provider copy of a deleted workflow; it may be orphaned',
    );
  }
};
