// The Automation Service — the ONLY door between ECMS and any automation runtime (D-A2).
//
// Business modules depend on this file's exports and nothing else. They do not know which provider
// is installed, whether one is installed at all, or that n8n exists. `trigger()` is the whole
// surface most callers ever need; the lifecycle methods are for the Automation module's registry.
//
// Two properties this file is responsible for, both of which are easy to lose later:
//
//   1. **Triggering never throws into the caller.** A module emitting an event, or calling
//      `trigger()` after a business write, must not fail because an automation runtime is
//      unreachable. Automation is strictly downstream of a committed transaction (ADR-018
//      decision 4); a provider outage degrades automation and nothing else.
//   2. **Capabilities are checked, not assumed.** Anything gated on a capability raises
//      `AutomationCapabilityError` rather than calling an optional method that may not exist.
import {
  type AutomationCapabilities,
  type AutomationStatusDto,
  type DispatchInput,
  type ProviderExecutionRef,
  type ProviderExecutionState,
  type ProviderHealth,
  type ProviderWorkflowRef,
  type WorkflowGraph,
  type WorkflowSpec,
} from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import { getRequestId } from '../../infrastructure/http/request-context';
import { AutomationCapabilityError } from './automation.provider';
import {
  automationCapabilities,
  getAutomationProvider,
  isAutomationEnabled,
} from './automation.registry';

export interface TriggerRequest {
  workflow: ProviderWorkflowRef;
  executionId: string;
  payload: unknown;
  /** The subject the run executes as — never omitted, see §7.2: there is no automation superuser. */
  actor: { userId: string; branchId?: string | undefined };
  depth?: number | undefined;
}

export interface TriggerOutcome {
  dispatched: boolean;
  execution?: ProviderExecutionRef | undefined;
  /** Present when dispatch was refused or failed. Callers log it; they do not retry inline. */
  reason?: string | undefined;
}

const requireCapability = (capability: keyof AutomationCapabilities): void => {
  const provider = getAutomationProvider();
  if (!provider.capabilities[capability]) {
    throw new AutomationCapabilityError(provider.id, capability);
  }
};

export const automationService = {
  /** What this deployment's automation posture actually is — surfaced by `/health`. */
  status(): AutomationStatusDto {
    return {
      enabled: isAutomationEnabled(),
      providerId: getAutomationProvider().id,
      capabilities: automationCapabilities(),
    };
  },

  capabilities(): AutomationCapabilities {
    return automationCapabilities();
  },

  /**
   * Start one run. **Never throws** — see property 1 above.
   *
   * Returns `dispatched: false` with a reason when automation is off or the provider failed, so a
   * caller that wants to record the attempt can, and a caller that does not can ignore it. The
   * alternative — throwing — would put an integration runtime's availability on the business
   * write path, which is exactly what ADR-018 forbids.
   */
  async trigger(request: TriggerRequest): Promise<TriggerOutcome> {
    const provider = getAutomationProvider();
    const requestId = getRequestId();
    const input: DispatchInput = {
      executionId: request.executionId,
      payload: request.payload,
      actor: request.actor,
      depth: request.depth ?? 0,
      ...(requestId === undefined ? {} : { requestId }),
    };

    if (!isAutomationEnabled()) {
      return { dispatched: false, reason: 'automation is disabled' };
    }

    try {
      const execution = await provider.dispatch(request.workflow, input);
      return { dispatched: true, execution };
    } catch (error: unknown) {
      logger.error(
        { err: error, providerId: provider.id, executionId: request.executionId },
        'automation dispatch failed',
      );
      return { dispatched: false, reason: 'provider dispatch failed' };
    }
  },

  // ── Registry operations (the Automation module's callers) ──────────────────
  // These DO propagate errors: a user pressing "save" on a workflow needs to be told it failed.

  createWorkflow(spec: WorkflowSpec): Promise<ProviderWorkflowRef> {
    return getAutomationProvider().createWorkflow(spec);
  },

  updateWorkflow(ref: ProviderWorkflowRef, spec: WorkflowSpec): Promise<void> {
    return getAutomationProvider().updateWorkflow(ref, spec);
  },

  deleteWorkflow(ref: ProviderWorkflowRef): Promise<void> {
    return getAutomationProvider().deleteWorkflow(ref);
  },

  setEnabled(ref: ProviderWorkflowRef, enabled: boolean): Promise<void> {
    return getAutomationProvider().setEnabled(ref, enabled);
  },

  // `async` on every capability-gated method is deliberate. `requireCapability` throws, and a
  // method typed `Promise<T>` that throws SYNCHRONOUSLY is a footgun: `service.cancel(ref).catch(…)`
  // never runs the catch, because the throw happens before a promise exists. Marking them async
  // turns the same failure into a rejection, which is what every caller is already written for.
  async cancel(ref: ProviderExecutionRef): Promise<void> {
    requireCapability('cancellation');
    return getAutomationProvider().cancel(ref);
  },

  getExecution(ref: ProviderExecutionRef): Promise<ProviderExecutionState> {
    return getAutomationProvider().getExecution(ref);
  },

  async exportGraph(ref: ProviderWorkflowRef): Promise<WorkflowGraph> {
    requireCapability('graphImportExport');
    return getAutomationProvider().exportGraph(ref);
  },

  async importGraph(graph: WorkflowGraph): Promise<ProviderWorkflowRef> {
    requireCapability('graphImportExport');
    const provider = getAutomationProvider();
    if (graph.providerId !== provider.id) {
      // A graph is provider-native (ADR-018 §Honest limit). Importing an n8n graph into a
      // different runtime would half-succeed and fail at run time, which is worse than refusing.
      throw new Error(
        `graph belongs to provider '${graph.providerId}', active provider is '${provider.id}'`,
      );
    }
    return provider.importGraph(graph);
  },

  /** The authoring UI's URL, when the active provider has one. */
  async builderUrl(ref: ProviderWorkflowRef): Promise<string> {
    requireCapability('visualBuilder');
    const provider = getAutomationProvider();
    if (provider.builderUrl === undefined) {
      // Declaring the capability without implementing the method is a provider bug, and it should
      // surface as one rather than as `undefined is not a function` at the call site.
      throw new AutomationCapabilityError(provider.id, 'visualBuilder');
    }
    return provider.builderUrl(ref);
  },

  health(): Promise<ProviderHealth> {
    return getAutomationProvider().health();
  },
};
