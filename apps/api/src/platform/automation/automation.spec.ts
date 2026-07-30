// The Automation Service seam (A-0). No provider, no n8n, no network.
//
// Two things are proved here and they are different: that the null provider honours the shared
// contract (via the exported conformance suite, which A-6 will re-run against n8n), and that the
// SERVICE behaves correctly around a provider — particularly when there isn't a real one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationCapabilityError, type AutomationProvider } from './automation.provider';
import { runProviderConformance } from './provider-conformance';
import { nullAutomationProvider } from './providers/null/null.provider';
import {
  getAutomationProvider,
  isAutomationEnabled,
  resetAutomationProvider,
  setAutomationProvider,
} from './automation.registry';
import { automationService } from './automation.service';

vi.mock('../../infrastructure/config/env', () => ({
  env: { AUTOMATION_ENABLED: false, AUTOMATION_PROVIDER: 'null' },
  isTest: true,
}));

const { env } = await import('../../infrastructure/config/env');
const settings = env as unknown as { AUTOMATION_ENABLED: boolean; AUTOMATION_PROVIDER: string };

/** A minimal in-memory provider — stands in for whatever A-6 and beyond bring. */
const fakeProvider = (over: Partial<AutomationProvider> = {}): AutomationProvider => ({
  id: 'n8n',
  capabilities: {
    visualBuilder: true,
    graphImportExport: true,
    cancellation: true,
    perNodeProgress: true,
  },
  createWorkflow: (spec) => Promise.resolve({ providerId: 'n8n', ref: spec.key }),
  updateWorkflow: () => Promise.resolve(),
  deleteWorkflow: () => Promise.resolve(),
  setEnabled: () => Promise.resolve(),
  dispatch: (_ref, input) => Promise.resolve({ providerId: 'n8n', ref: input.executionId }),
  cancel: () => Promise.resolve(),
  getExecution: (ref) => Promise.resolve({ ref, status: 'success' as const, nodes: [] }),
  exportGraph: () => Promise.resolve({ providerId: 'n8n', formatVersion: '1', nodes: [] }),
  importGraph: () => Promise.resolve({ providerId: 'n8n', ref: 'imported' }),
  builderUrl: () => Promise.resolve('https://n8n.internal/workflow/1'),
  health: () => Promise.resolve({ providerId: 'n8n', reachable: true }),
  ...over,
});

beforeEach(() => {
  settings.AUTOMATION_ENABLED = false;
  settings.AUTOMATION_PROVIDER = 'null';
  resetAutomationProvider();
});
afterEach(() => resetAutomationProvider());

// ── The shared contract, proved against the provider that ships today ────────

runProviderConformance(() => nullAutomationProvider, 'nullAutomationProvider');

// ── Registry ────────────────────────────────────────────────────────────────

describe('provider registration', () => {
  it('starts on the null provider so nothing depends on boot order', () => {
    expect(getAutomationProvider().id).toBe('null');
    expect(isAutomationEnabled()).toBe(false);
  });

  it('refuses a provider while the feature flag is off', () => {
    // The flag is the only thing keeping thirteen unfinished slices invisible in production. A
    // provider that installed itself anyway would make it advisory.
    setAutomationProvider(fakeProvider());
    expect(getAutomationProvider().id).toBe('null');
    expect(isAutomationEnabled()).toBe(false);
  });

  it('refuses a provider that is not the configured one', () => {
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'null';
    setAutomationProvider(fakeProvider({ id: 'n8n' }));
    expect(getAutomationProvider().id).toBe('null');
  });

  it('installs the configured provider when enabled', () => {
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'n8n';
    setAutomationProvider(fakeProvider());
    expect(getAutomationProvider().id).toBe('n8n');
    expect(isAutomationEnabled()).toBe(true);
  });
});

// ── Triggering ──────────────────────────────────────────────────────────────

describe('trigger', () => {
  const request = {
    workflow: { providerId: 'n8n', ref: 'wf-1' },
    executionId: 'exec-1',
    event: { id: 'evt-1', type: 'hr.employee.created', occurredAt: new Date(), version: 1 },
    payload: { employeeId: '1' },
    actor: { userId: 'u1', branchId: 'b1' },
  };

  it('reports "not dispatched" rather than pretending, when automation is off', async () => {
    const outcome = await automationService.trigger(request);
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toContain('disabled');
  });

  it('never dispatches to a provider while disabled', async () => {
    const dispatch = vi.fn();
    setAutomationProvider(fakeProvider({ dispatch }));
    await automationService.trigger(request);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches when a provider is installed', async () => {
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'n8n';
    setAutomationProvider(fakeProvider());

    const outcome = await automationService.trigger(request);
    expect(outcome.dispatched).toBe(true);
    expect(outcome.execution?.ref).toBe('exec-1');
  });

  it('SWALLOWS a provider failure instead of throwing at the caller', async () => {
    // The property that keeps ADR-018's boundary real: automation is downstream of a committed
    // transaction, so an unreachable runtime must degrade automation and nothing else. If this
    // ever throws, a module's business write starts failing because n8n is down.
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'n8n';
    setAutomationProvider(fakeProvider({ dispatch: () => Promise.reject(new Error('ECONNREFUSED')) }));

    const outcome = await automationService.trigger(request);
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toContain('dispatch failed');
  });

  it('passes the actor through, so a run is always on behalf of somebody', async () => {
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'n8n';
    const dispatch = vi.fn().mockResolvedValue({ providerId: 'n8n', ref: 'e' });
    setAutomationProvider(fakeProvider({ dispatch }));

    await automationService.trigger(request);
    expect(dispatch.mock.calls[0]?.[1]).toMatchObject({
      actor: { userId: 'u1', branchId: 'b1' },
      depth: 0,
    });
  });

  it('carries the re-entrancy depth a caller supplies', async () => {
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'n8n';
    const dispatch = vi.fn().mockResolvedValue({ providerId: 'n8n', ref: 'e' });
    setAutomationProvider(fakeProvider({ dispatch }));

    await automationService.trigger({ ...request, depth: 2 });
    expect(dispatch.mock.calls[0]?.[1]).toMatchObject({ depth: 2 });
  });
});

// ── Capabilities ────────────────────────────────────────────────────────────

describe('capability gating', () => {
  beforeEach(() => {
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'n8n';
  });

  it('refuses a builder URL from a provider that has no builder', async () => {
    setAutomationProvider(
      fakeProvider({
        capabilities: {
          visualBuilder: false,
          graphImportExport: true,
          cancellation: true,
          perNodeProgress: true,
        },
      }),
    );
    await expect(automationService.builderUrl({ providerId: 'n8n', ref: 'w' })).rejects.toThrow(
      AutomationCapabilityError,
    );
  });

  it('treats a declared-but-unimplemented capability as a provider bug', async () => {
    // Better than `undefined is not a function` three layers up. The key is OMITTED rather than
    // set to undefined — `exactOptionalPropertyTypes` makes those different things, and omission
    // is what a real provider that forgot the method would actually look like.
    const withoutBuilder: AutomationProvider = fakeProvider();
    delete withoutBuilder.builderUrl;
    setAutomationProvider(withoutBuilder);
    await expect(automationService.builderUrl({ providerId: 'n8n', ref: 'w' })).rejects.toThrow(
      AutomationCapabilityError,
    );
  });

  it('refuses cancellation when the provider cannot cancel', async () => {
    setAutomationProvider(
      fakeProvider({
        capabilities: {
          visualBuilder: true,
          graphImportExport: true,
          cancellation: false,
          perNodeProgress: true,
        },
      }),
    );
    await expect(automationService.cancel({ providerId: 'n8n', ref: 'e' })).rejects.toThrow(
      AutomationCapabilityError,
    );
  });

  it('refuses a graph belonging to a different provider', async () => {
    // Graphs are provider-native (ADR-018 §Honest limit). Importing an n8n graph into another
    // runtime would half-succeed and fail at run time, which is worse than refusing outright.
    setAutomationProvider(fakeProvider());
    await expect(
      automationService.importGraph({ providerId: 'temporal', formatVersion: '1', nodes: [] }),
    ).rejects.toThrow(/belongs to provider/);
  });
});

// ── Status ──────────────────────────────────────────────────────────────────

describe('status', () => {
  it('reports the null provider as not enabled', () => {
    expect(automationService.status()).toMatchObject({ enabled: false, providerId: 'null' });
  });

  it('reports the active provider and its capabilities once installed', () => {
    settings.AUTOMATION_ENABLED = true;
    settings.AUTOMATION_PROVIDER = 'n8n';
    setAutomationProvider(fakeProvider());

    expect(automationService.status()).toMatchObject({
      enabled: true,
      providerId: 'n8n',
      capabilities: { visualBuilder: true },
    });
  });
});
