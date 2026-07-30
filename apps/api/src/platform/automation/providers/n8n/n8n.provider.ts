// The n8n automation provider.
//
// Implements the A-0 `AutomationProvider` seam so ECMS still depends only on the contract, not on
// n8n. A-5 delivered the trigger path (`dispatch` + `health`); **A-6 adds authoring** — creating,
// updating, activating, deleting and round-tripping workflows in n8n — which is what finally
// populates a workflow's `providerRef` so a dispatch has something real to run.
//
// What is still deliberately absent: `cancel` and per-node execution state. Those belong to the
// execution lifecycle (A-7, progress callback) and reject clearly rather than pretending.
//
// Everything that knows n8n's JSON dialect lives in `n8n.graph.ts`; everything that knows n8n's
// transport lives in `n8n.client.ts`. This file is the thin layer that maps one onto the other.
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
import { N8nClient, N8nRequestError } from './n8n.client';
import {
  assertImportable,
  buildWorkflowBody,
  decodeRef,
  encodeRef,
  newWebhookPath,
  signBody,
  toWorkflowGraph,
  workflowSigningSecret,
} from './n8n.graph';

export const N8N_PROVIDER_ID = 'n8n';

/** Raised by the surfaces that land at A-7, so a premature call fails clearly, not silently. */
export class N8nNotImplementedError extends Error {
  constructor(operation: string) {
    super(`n8n provider: ${operation} arrives at A-7 (execution lifecycle)`);
    this.name = 'N8nNotImplementedError';
  }
}

/** A ref minted before A-6 carries no workflow id, so it can be triggered but not edited in place. */
export class N8nUnmanagedWorkflowError extends Error {
  constructor(operation: string) {
    super(
      `n8n provider: cannot ${operation} — this workflow has no n8n workflow id. ` +
        'Re-enable it to push a managed copy to n8n.',
    );
    this.name = 'N8nUnmanagedWorkflowError';
  }
}

export interface N8nProviderOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Deployment secret the per-workflow webhook signature is derived from (design §2.2). Absent, the
   * trigger is still sent — unsigned — because an unsigned trigger to a private-network n8n is the
   * A-5 behaviour and losing automation over a missing optional secret is the worse failure.
   */
  webhookSecret?: string | undefined;
}

const WORKFLOWS = '/api/v1/workflows';

export class N8nAutomationProvider implements AutomationProvider {
  readonly id = N8N_PROVIDER_ID;

  // A-6 lights up authoring and graph portability. Cancellation and per-node progress stay false
  // until A-7 implements them — a capability is a promise, and claiming one you cannot keep is
  // worse than declaring the gap.
  readonly capabilities: AutomationCapabilities = {
    visualBuilder: true,
    graphImportExport: true,
    cancellation: false,
    perNodeProgress: false,
  };

  private readonly client: N8nClient;
  private readonly baseUrl: string;
  private readonly webhookSecret: string | undefined;

  constructor(options: N8nProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.webhookSecret = options.webhookSecret;
    this.client = new N8nClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    });
  }

  // ── Workflow lifecycle (A-6) ─────────────────────────────────────────────
  // These PROPAGATE errors, unlike `dispatch`: a user pressing "save" or "enable" must be told the
  // provider refused, not left with a workflow ECMS thinks is live and n8n has never heard of.

  async createWorkflow(spec: WorkflowSpec): Promise<ProviderWorkflowRef> {
    const webhookPath = newWebhookPath();
    const response = await this.client.request(
      'POST',
      WORKFLOWS,
      buildWorkflowBody(spec, webhookPath),
    );
    const workflowId = readWorkflowId(response.body);
    logger.info({ workflowId, key: spec.key }, 'n8n: workflow created');
    return { providerId: this.id, ref: encodeRef({ workflowId, webhookPath }) };
  }

  async updateWorkflow(ref: ProviderWorkflowRef, spec: WorkflowSpec): Promise<void> {
    const { workflowId, webhookPath } = this.managed(ref, 'update this workflow');
    // The SAME webhook path is rewritten, so editing a workflow never changes its trigger URL —
    // an edit that silently re-pointed the trigger would strand every dispatch already in flight.
    await this.client.request('PUT', `${WORKFLOWS}/${workflowId}`, buildWorkflowBody(spec, webhookPath));
    logger.info({ workflowId, key: spec.key }, 'n8n: workflow updated');
  }

  async deleteWorkflow(ref: ProviderWorkflowRef): Promise<void> {
    const { workflowId } = this.managed(ref, 'delete this workflow');
    // Idempotent by contract (A-0 conformance): retries, sweeps and crash recovery all re-issue
    // this, and "already gone" is the outcome delete asked for — not a failure.
    try {
      await this.client.request('DELETE', `${WORKFLOWS}/${workflowId}`);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      logger.debug({ workflowId }, 'n8n: workflow already deleted');
      return;
    }
    logger.info({ workflowId }, 'n8n: workflow deleted');
  }

  async setEnabled(ref: ProviderWorkflowRef, enabled: boolean): Promise<void> {
    const { workflowId } = this.managed(ref, `${enabled ? 'activate' : 'deactivate'} this workflow`);
    // n8n exposes activation as its own endpoint rather than a field on update, so that a workflow
    // cannot be activated as a side effect of an unrelated edit.
    await this.client.request(
      'POST',
      `${WORKFLOWS}/${workflowId}/${enabled ? 'activate' : 'deactivate'}`,
    );
    logger.info({ workflowId, enabled }, 'n8n: workflow activation changed');
  }

  // ── Graph portability (A-6) — what template packages ride on (design §11) ──

  async exportGraph(ref: ProviderWorkflowRef): Promise<WorkflowGraph> {
    const { workflowId } = this.managed(ref, 'export this workflow');
    const response = await this.client.request('GET', `${WORKFLOWS}/${workflowId}`);
    return toWorkflowGraph(this.id, response.body);
  }

  async importGraph(graph: WorkflowGraph): Promise<ProviderWorkflowRef> {
    // Refused rather than half-imported when the dialect does not match.
    assertImportable(graph, this.id);
    return this.createWorkflow({
      key: `imported-${Date.now()}`,
      name: 'Imported workflow',
      trigger: { kind: 'manual', timezone: 'Africa/Cairo', filters: [] },
      graph,
    });
  }

  /** The authoring UI ECMS proxies (capabilities.visualBuilder). */
  builderUrl(ref: ProviderWorkflowRef): Promise<string> {
    const { workflowId } = this.managed(ref, 'open this workflow in the builder');
    return Promise.resolve(`${this.baseUrl}/workflow/${workflowId}`);
  }

  // ── Execution — the A-5 deliverable ──────────────────────────────────────

  async dispatch(ref: ProviderWorkflowRef, input: DispatchInput): Promise<ProviderExecutionRef> {
    const { webhookPath } = decodeRef(ref.ref);
    const body = {
      // A stable, self-describing event envelope — not a bare payload — so an n8n workflow can
      // route on the type, dedup on the id, order on occurredAt, and read the payload under a
      // known schema version (ADR-008). Kept identical in shape for every event ECMS emits.
      eventId: input.event.id,
      eventType: input.event.type,
      occurredAt: input.event.occurredAt.toISOString(),
      correlationId: input.requestId ?? null,
      version: input.event.version,
      // The payload is already redacted upstream (A-4) before it becomes a snapshot; what n8n
      // receives is the business event, which is what a workflow acts on.
      payload: input.payload,
      // ECMS run context, retained alongside the envelope so n8n can correlate the run and see
      // the acting principal and re-entrancy depth without parsing headers.
      executionId: input.executionId,
      actor: input.actor,
      depth: input.depth,
    };

    await this.client.request('POST', `/webhook/${webhookPath}`, body, {
      // Correlation id threads the ECMS request through to n8n's logs; the execution id is a
      // stable idempotency key (same `(event, workflow)` → same key across BullMQ retries), so a
      // re-delivered trigger is dedupable on the n8n side too.
      'x-request-id': input.requestId,
      'idempotency-key': input.executionId,
      // Proves the trigger came from ECMS, per workflow (design §2.2). n8n rejects anything else.
      ...(this.webhookSecret === undefined
        ? {}
        : {
            'x-ecms-signature': signBody(
              workflowSigningSecret(this.webhookSecret, webhookPath),
              JSON.stringify(body),
            ),
          }),
    });
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

  cancel(): Promise<void> {
    return Promise.reject(new N8nNotImplementedError('cancel'));
  }

  /** Decode a ref, refusing the operations that need a workflow id when the ref predates A-6. */
  private managed(ref: ProviderWorkflowRef, operation: string): { workflowId: string; webhookPath: string } {
    const decoded = decodeRef(ref.ref);
    if (decoded.workflowId === '') throw new N8nUnmanagedWorkflowError(operation);
    return decoded;
  }
}

const isNotFound = (error: unknown): boolean =>
  error instanceof N8nRequestError && error.status === 404;

/** n8n returns the created workflow either bare or wrapped in `{ data }`, depending on version. */
const readWorkflowId = (body: unknown): string => {
  const source = (body ?? {}) as { id?: unknown; data?: { id?: unknown } };
  const id = source.id ?? source.data?.id;
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number') return String(id);
  throw new Error('n8n did not return a workflow id');
};
