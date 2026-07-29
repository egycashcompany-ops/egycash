// The AutomationProvider contract (ADR-018 decision 2, design §2.1, D-A4).
//
// WHY THIS INTERFACE EXISTS AT ALL, given that only one provider is planned. ADR-018 permits n8n
// on a *scope condition* — ECMS is internal to one company — rather than on a permanent property.
// Conditions change. If ECMS is ever sold as a product whose customers author their own
// automations, the licence position changes with it, and the cost of that change is decided here:
// with this seam it is one new class; without it, it is every module that ever automated anything.
//
// The methods are shaped by what a RUNTIME MUST DO, not by what n8n offers. A contract modelled on
// one vendor's payloads is that vendor's SDK with extra steps.
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

export interface AutomationProvider {
  readonly id: string;

  /**
   * What this runtime can do. Callers ASK rather than assume — see the `AutomationCapabilities`
   * contract for why that distinction is load-bearing rather than pedantic.
   */
  readonly capabilities: AutomationCapabilities;

  // ── Workflow lifecycle ────────────────────────────────────────────────────
  createWorkflow(spec: WorkflowSpec): Promise<ProviderWorkflowRef>;
  updateWorkflow(ref: ProviderWorkflowRef, spec: WorkflowSpec): Promise<void>;
  deleteWorkflow(ref: ProviderWorkflowRef): Promise<void>;
  setEnabled(ref: ProviderWorkflowRef, enabled: boolean): Promise<void>;

  // ── Execution ─────────────────────────────────────────────────────────────
  /**
   * Start one run. Implementations MUST NOT reject because the payload is unfamiliar — a provider
   * that validates business payloads has taken on a job that belongs to ECMS.
   */
  dispatch(ref: ProviderWorkflowRef, input: DispatchInput): Promise<ProviderExecutionRef>;
  cancel(ref: ProviderExecutionRef): Promise<void>;
  getExecution(ref: ProviderExecutionRef): Promise<ProviderExecutionState>;

  // ── Graph portability ─────────────────────────────────────────────────────
  // Required by template packages (design §11). Gated on `capabilities.graphImportExport`, because
  // a provider without it can still run workflows — it just cannot participate in the catalogue.
  exportGraph(ref: ProviderWorkflowRef): Promise<WorkflowGraph>;
  importGraph(graph: WorkflowGraph): Promise<ProviderWorkflowRef>;

  // ── Optional surfaces ─────────────────────────────────────────────────────
  /** Present only when `capabilities.visualBuilder` is true. */
  builderUrl?(ref: ProviderWorkflowRef): Promise<string>;

  health(): Promise<ProviderHealth>;
}

/**
 * Raised when a caller asks for something the active provider does not claim to support.
 *
 * Distinct from a generic failure on purpose: "this provider has no builder" is a configuration
 * fact the UI should reflect, not an error a user should see as a broken feature.
 */
export class AutomationCapabilityError extends Error {
  constructor(
    readonly providerId: string,
    readonly capability: keyof AutomationCapabilities,
  ) {
    super(`automation provider '${providerId}' does not support '${capability}'`);
    this.name = 'AutomationCapabilityError';
  }
}
