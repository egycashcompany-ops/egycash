// The provider that does nothing, and does it visibly.
//
// This backs `AUTOMATION_ENABLED=false`, which is what lets every slice from A-0 to A-13 merge to
// `main` without a user seeing a half-built feature. It is not a test double — it runs in
// production until the flag is flipped.
//
// The one design decision worth stating: a dispatch here is recorded as `skipped`, NOT silently
// dropped and not reported as `success`. "The automation did not run because automation is off" and
// "the automation ran and did nothing" are different facts, and an operator staring at an execution
// list needs to be able to tell them apart. Reporting success would be a lie that looks like health.
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
import { type AutomationProvider } from '../../automation.provider';

const NULL_PROVIDER_ID = 'null';

const capabilities: AutomationCapabilities = {
  visualBuilder: false,
  graphImportExport: false,
  cancellation: false,
  perNodeProgress: false,
};

const ref = (value: string): ProviderWorkflowRef => ({ providerId: NULL_PROVIDER_ID, ref: value });

export const nullAutomationProvider: AutomationProvider = {
  id: NULL_PROVIDER_ID,
  capabilities,

  createWorkflow: (spec: WorkflowSpec) => Promise.resolve(ref(spec.key)),
  updateWorkflow: () => Promise.resolve(),
  deleteWorkflow: () => Promise.resolve(),
  setEnabled: () => Promise.resolve(),

  dispatch: (_workflow: ProviderWorkflowRef, input: DispatchInput) =>
    Promise.resolve({ providerId: NULL_PROVIDER_ID, ref: input.executionId }),

  cancel: () => Promise.resolve(),

  getExecution: (executionRef: ProviderExecutionRef): Promise<ProviderExecutionState> =>
    Promise.resolve({ ref: executionRef, status: 'skipped', nodes: [] }),

  // Deliberately NOT throwing. `graphImportExport: false` is the honest answer, and callers are
  // required to check it; a provider that both denies a capability and throws when asked makes
  // the capability flag decorative.
  exportGraph: (_workflowRef: ProviderWorkflowRef): Promise<WorkflowGraph> =>
    Promise.resolve({ providerId: NULL_PROVIDER_ID, formatVersion: '0', nodes: null }),

  importGraph: (graph: WorkflowGraph) => Promise.resolve(ref(graph.providerId)),

  health: (): Promise<ProviderHealth> =>
    Promise.resolve({
      providerId: NULL_PROVIDER_ID,
      reachable: true,
      detail: 'automation is disabled (AUTOMATION_ENABLED=false)',
    }),
};
