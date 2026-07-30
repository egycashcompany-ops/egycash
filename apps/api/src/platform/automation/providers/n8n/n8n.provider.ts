// The n8n automation provider (A-5, trigger path).
//
// Implements the A-0 `AutomationProvider` seam so ECMS still depends only on the contract, not on
// n8n. This slice delivers the ONE thing A-5 needs from a real provider: `dispatch()` sends an
// authenticated HTTP request to n8n, and `health()` reports reachability. Everything else —
// creating workflows in n8n, exporting/importing graphs, the builder proxy — is A-6, and is
// declared here as not-yet-available rather than faked.
//
// `dispatch` posts the payload to the workflow's n8n webhook (the workflow's providerRef.ref is
// the webhook path/id A-6 will populate). It does NOT interpret the response as anything but
// "accepted" — mapping n8n execution state back is A-7's progress callback.
import {
  type AutomationCapabilities,
  type DispatchInput,
  type ProviderExecutionRef,
  type ProviderExecutionState,
  type ProviderHealth,
  type ProviderWorkflowRef,
  type WorkflowGraph,
  type WorkflowSpec,
} from '@ecms/contracts';
import { logger } from '../../../../infrastructure/logging/logger';
import { type AutomationProvider } from '../../automation.provider';
import { N8nClient } from './n8n.client';

export const N8N_PROVIDER_ID = 'n8n';

/** Raised by the surfaces that land at A-6, so a premature call fails clearly, not silently. */
export class N8nNotImplementedError extends Error {
  constructor(operation: string) {
    super(`n8n provider: ${operation} arrives at A-6 (this slice delivers the trigger path only)`);
    this.name = 'N8nNotImplementedError';
  }
}

export interface N8nProviderOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  timeoutMs?: number;
  maxRetries?: number;
}

export class N8nAutomationProvider implements AutomationProvider {
  readonly id = N8N_PROVIDER_ID;

  // Honest about the trigger-only scope: the graph/builder capabilities light up at A-6. Declaring
  // them false now keeps callers (and the conformance suite) from exercising surfaces that are not
  // wired yet, and A-6 flips them on when it implements them.
  readonly capabilities: AutomationCapabilities = {
    visualBuilder: false,
    graphImportExport: false,
    cancellation: false,
    perNodeProgress: false,
  };

  private readonly client: N8nClient;

  constructor(options: N8nProviderOptions) {
    this.client = new N8nClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    });
  }

  // ── Execution — the A-5 deliverable ──────────────────────────────────────

  async dispatch(ref: ProviderWorkflowRef, input: DispatchInput): Promise<ProviderExecutionRef> {
    // The ref is the n8n webhook path A-6 assigns; until then a workflow has none and the bridge
    // records `skipped` before reaching here. Posting the payload is the whole of "trigger n8n".
    await this.client.request(
      'POST',
      `/webhook/${ref.ref}`,
      {
        executionId: input.executionId,
        // The payload is already redacted upstream (A-4) before it becomes a snapshot; what n8n
        // receives is the business event, which is what a workflow acts on.
        payload: input.payload,
        actor: input.actor,
        depth: input.depth,
      },
      {
        // Correlation id threads the ECMS request through to n8n's logs; the execution id is a
        // stable idempotency key (same `(event, workflow)` → same key across BullMQ retries), so a
        // re-delivered trigger is dedupable on the n8n side too.
        'x-request-id': input.requestId,
        'idempotency-key': input.executionId,
      },
    );
    logger.info(
      { workflowRef: ref.ref, executionId: input.executionId, requestId: input.requestId ?? null },
      'n8n: dispatched trigger',
    );
    return { providerId: this.id, ref: input.executionId };
  }

  async getExecution(ref: ProviderExecutionRef): Promise<ProviderExecutionState> {
    // n8n reports completion back via the progress callback (A-7); until that exists the platform
    // only knows the run was accepted. `running` is the honest state, not `success`.
    return { ref, status: 'running', nodes: [] };
  }

  async health(): Promise<ProviderHealth> {
    const result = await this.client.health();
    return {
      providerId: this.id,
      reachable: result.reachable,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  }

  // ── Workflow authoring — A-6 ─────────────────────────────────────────────
  // Not faked: a premature call is a bug, and it should say so rather than pretend to have created
  // a workflow that does not exist in n8n.

  createWorkflow(_spec: WorkflowSpec): Promise<ProviderWorkflowRef> {
    return Promise.reject(new N8nNotImplementedError('createWorkflow'));
  }

  updateWorkflow(): Promise<void> {
    return Promise.reject(new N8nNotImplementedError('updateWorkflow'));
  }

  deleteWorkflow(): Promise<void> {
    return Promise.reject(new N8nNotImplementedError('deleteWorkflow'));
  }

  setEnabled(): Promise<void> {
    return Promise.reject(new N8nNotImplementedError('setEnabled'));
  }

  cancel(): Promise<void> {
    return Promise.reject(new N8nNotImplementedError('cancel'));
  }

  exportGraph(): Promise<WorkflowGraph> {
    return Promise.reject(new N8nNotImplementedError('exportGraph'));
  }

  importGraph(): Promise<ProviderWorkflowRef> {
    return Promise.reject(new N8nNotImplementedError('importGraph'));
  }
}
