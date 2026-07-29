// The conformance suite every AutomationProvider must pass.
//
// WHY THIS IS SHIPPED CODE RATHER THAN A SPEC FILE. An interface in TypeScript proves that a
// provider has the right method NAMES. It proves nothing about behaviour — and behaviour is where
// a second provider would actually diverge: returning a ref that does not round-trip, throwing on
// a capability it already declared false, inventing a status the platform has no case for. Those
// are the failures that would surface as "automation is broken" months later.
//
// So the contract is executable, and it is exported from the barrel so that A-6's
// `N8nAutomationProvider` is proved by the SAME assertions the null provider is proved by today.
// A provider added later cannot quietly hold a weaker contract than the one reviewed here.
//
// It is deliberately behaviour-only: no network, no fixtures, no provider-specific setup. A
// provider that needs a live runtime to pass conformance has made the runtime part of its
// contract, which is the coupling this whole seam exists to prevent.
import { expect, describe, it } from 'vitest';
import {
  AutomationCapabilitiesSchema,
  ProviderExecutionStateSchema,
  ProviderHealthSchema,
  ProviderWorkflowRefSchema,
  type DispatchInput,
  type WorkflowSpec,
} from '@ecms/contracts';
import { type AutomationProvider } from './automation.provider';

const spec = (): WorkflowSpec => ({
  key: 'conformance.sample',
  name: 'Conformance sample',
  trigger: { kind: 'event', event: 'platform.user.created', timezone: 'Africa/Cairo', filters: [] },
});

const dispatchInput = (): DispatchInput => ({
  executionId: 'conformance-exec-1',
  payload: { hello: 'world' },
  actor: { userId: 'user-1', branchId: 'branch-1' },
  depth: 0,
});

/**
 * Run the shared contract against `provider`.
 *
 * Call from a provider's own spec file: `runProviderConformance(() => myProvider)`. The factory
 * form lets a provider be constructed per-test where it needs to be.
 */
export const runProviderConformance = (
  makeProvider: () => AutomationProvider,
  label = 'AutomationProvider',
): void => {
  describe(`${label} — conformance`, () => {
    it('identifies itself with a stable, non-empty id', () => {
      const provider = makeProvider();
      expect(provider.id).toBeTruthy();
      expect(provider.id).toBe(makeProvider().id);
    });

    it('declares every capability explicitly', () => {
      // Not `toBeDefined` — the schema requires each flag to be a real boolean, so a provider
      // cannot leave one undefined and have callers read it as "false, probably".
      expect(() => AutomationCapabilitiesSchema.parse(makeProvider().capabilities)).not.toThrow();
    });

    it('returns a workflow ref that carries its own provider id', async () => {
      const provider = makeProvider();
      const ref = await provider.createWorkflow(spec());

      expect(() => ProviderWorkflowRefSchema.parse(ref)).not.toThrow();
      // Refs travel through the registry and come back later. One tagged with a different
      // provider would be dispatched to the wrong runtime after a configuration change.
      expect(ref.providerId).toBe(provider.id);
    });

    it('accepts a payload it has never seen', async () => {
      // A provider that validates business payloads has taken on a job that belongs to ECMS —
      // and would start rejecting events every time a module adds a field.
      const provider = makeProvider();
      const ref = await provider.createWorkflow(spec());
      await expect(
        provider.dispatch(ref, { ...dispatchInput(), payload: { unexpected: { nested: [1, 2] } } }),
      ).resolves.toBeTruthy();
    });

    it('returns an execution ref that carries its own provider id', async () => {
      const provider = makeProvider();
      const ref = await provider.createWorkflow(spec());
      const execution = await provider.dispatch(ref, dispatchInput());
      expect(execution.providerId).toBe(provider.id);
      expect(execution.ref).toBeTruthy();
    });

    it('reports an execution state the platform has a case for', async () => {
      const provider = makeProvider();
      const workflow = await provider.createWorkflow(spec());
      const execution = await provider.dispatch(workflow, dispatchInput());
      const state = await provider.getExecution(execution);

      // The schema enumerates the statuses; a provider inventing 'waiting' would pass a
      // `typeof === 'string'` check and then fall through every switch in the UI.
      expect(() => ProviderExecutionStateSchema.parse(state)).not.toThrow();
    });

    it('reports health without throwing, even when the runtime is down', async () => {
      // Health is how the platform LEARNS the runtime is down. A provider that throws instead of
      // reporting `reachable: false` turns a monitoring signal into an outage.
      const health = await makeProvider().health();
      expect(() => ProviderHealthSchema.parse(health)).not.toThrow();
      expect(health.providerId).toBe(makeProvider().id);
    });

    it('implements builderUrl if and only if it claims a visual builder', () => {
      const provider = makeProvider();
      expect(typeof provider.builderUrl === 'function').toBe(provider.capabilities.visualBuilder);
    });

    it('does not throw from graph methods merely because it declines the capability', async () => {
      // `graphImportExport: false` is the honest answer and callers are required to check it. A
      // provider that both denies a capability AND throws when asked makes the flag decorative:
      // the platform would have to try/catch around a question it already asked.
      const provider = makeProvider();
      if (provider.capabilities.graphImportExport) return;

      const ref = await provider.createWorkflow(spec());
      await expect(provider.exportGraph(ref)).resolves.toBeTruthy();
    });

    it('tolerates cancelling and deleting things that never ran', async () => {
      // Retries, sweeps and crash recovery all re-issue these. Idempotence is not optional.
      const provider = makeProvider();
      const ref = await provider.createWorkflow(spec());
      await expect(provider.setEnabled(ref, false)).resolves.toBeUndefined();
      await expect(provider.deleteWorkflow(ref)).resolves.toBeUndefined();
      await expect(provider.deleteWorkflow(ref)).resolves.toBeUndefined();
    });
  });
};
