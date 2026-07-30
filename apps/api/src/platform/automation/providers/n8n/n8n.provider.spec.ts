// The n8n provider (A-5 trigger path + A-6 authoring).
//
// `fetch` is stubbed by a small in-memory n8n that speaks its documented REST contract, so the A-0
// CONFORMANCE SUITE runs against this provider exactly as it runs against the null provider — which
// is the promise A-0 made ("proved by the SAME assertions"). A live instance is not part of the
// contract: a provider that needed one to pass conformance would have made the runtime part of the
// interface, which is the coupling the seam exists to prevent. `scripts/n8n-conformance.mjs` runs
// the same shape against a real Railway instance when an operator wants end-to-end proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runProviderConformance } from '../../provider-conformance';
import { N8nAutomationProvider, N8nNotImplementedError, N8nUnmanagedWorkflowError } from './n8n.provider';
import { decodeRef, N8N_FORMAT_VERSION } from './n8n.graph';

// ── A fake n8n ───────────────────────────────────────────────────────────────

interface FakeState {
  workflows: Map<string, { id: string; active: boolean; nodes: unknown[]; connections: unknown }>;
  calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[];
  nextId: number;
}

let fake: FakeState;

const json = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

/** Routes the handful of n8n endpoints the provider actually uses. */
const installFakeN8n = (): void => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: unknown, init?: unknown) => {
    const url = new URL(String(input));
    const request = (init ?? {}) as RequestInit;
    const method = (request.method ?? 'GET').toUpperCase();
    const path = url.pathname;
    const body = request.body === undefined ? undefined : JSON.parse(String(request.body));
    fake.calls.push({
      method,
      path,
      body,
      headers: (request.headers ?? {}) as Record<string, string>,
    });

    if (path === '/healthz') return Promise.resolve(json({ status: 'ok' }));
    if (path.startsWith('/webhook/')) return Promise.resolve(json({ accepted: true }));

    const match = /^\/api\/v1\/workflows(?:\/([^/]+))?(?:\/(activate|deactivate))?$/.exec(path);
    if (match === null) return Promise.resolve(json({ message: 'not found' }, 404));
    const [, id, activation] = match;

    if (method === 'POST' && id === undefined) {
      const created = {
        id: `wf_${(fake.nextId += 1)}`,
        active: false,
        nodes: (body as { nodes?: unknown[] })?.nodes ?? [],
        connections: (body as { connections?: unknown })?.connections ?? {},
      };
      fake.workflows.set(created.id, created);
      return Promise.resolve(json(created, 201));
    }
    if (id === undefined) return Promise.resolve(json({ message: 'not found' }, 404));
    const existing = fake.workflows.get(id);
    if (existing === undefined) return Promise.resolve(json({ message: 'not found' }, 404));

    if (activation !== undefined && method === 'POST') {
      existing.active = activation === 'activate';
      return Promise.resolve(json(existing));
    }
    if (method === 'GET') return Promise.resolve(json(existing));
    if (method === 'PUT') {
      existing.nodes = (body as { nodes?: unknown[] })?.nodes ?? [];
      return Promise.resolve(json(existing));
    }
    if (method === 'DELETE') {
      fake.workflows.delete(id);
      return Promise.resolve(json(existing));
    }
    return Promise.resolve(json({ message: 'not found' }, 404));
  });
};

const provider = (over: { webhookSecret?: string } = {}) =>
  new N8nAutomationProvider({
    baseUrl: 'https://n8n.example',
    apiKey: 'k',
    maxRetries: 0,
    timeoutMs: 2_000,
    ...over,
  });

const spec = () => ({
  key: 'wf.sample',
  name: 'Sample',
  trigger: { kind: 'event' as const, event: 'hr.employee.created', timezone: 'Africa/Cairo', filters: [] },
});

const dispatchInput = (over: Record<string, unknown> = {}) => ({
  executionId: 'ex_1',
  event: {
    id: 'evt_9',
    type: 'hr.employee.created',
    occurredAt: new Date('2026-01-02T03:04:05.000Z'),
    version: 1,
  },
  payload: { employeeId: 'e1' },
  actor: { userId: 'u1', branchId: 'b1' },
  depth: 0,
  ...over,
});

beforeEach(() => {
  fake = { workflows: new Map(), calls: [], nextId: 0 };
  installFakeN8n();
});
afterEach(() => vi.restoreAllMocks());

// ── The shared A-0 contract, run against the real n8n provider ───────────────

runProviderConformance(() => provider(), 'N8nAutomationProvider');

// ── Authoring (A-6) ──────────────────────────────────────────────────────────

describe('workflow authoring', () => {
  it('creates a workflow whose entry point is an ECMS webhook trigger', async () => {
    const ref = await provider().createWorkflow(spec());
    const created = fake.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/workflows');
    const nodes = (created?.body as { nodes: { type: string; parameters: { path: string } }[] }).nodes;

    expect(nodes[0]?.type).toBe('n8n-nodes-base.webhook');
    // The ref binds the n8n workflow id (for editing) to the webhook path (for triggering).
    const decoded = decodeRef(ref.ref);
    expect(decoded.workflowId).toBeTruthy();
    expect(decoded.webhookPath).toBe(nodes[0]?.parameters.path);
  });

  it('keeps the trigger URL stable across an update', async () => {
    // A workflow edit that re-pointed the webhook would strand every dispatch already in flight.
    const p = provider();
    const ref = await p.createWorkflow(spec());
    await p.updateWorkflow(ref, { ...spec(), name: 'Renamed' });

    const put = fake.calls.find((c) => c.method === 'PUT');
    const nodes = (put?.body as { nodes: { parameters: { path: string } }[] }).nodes;
    expect(nodes[0]?.parameters.path).toBe(decodeRef(ref.ref).webhookPath);
  });

  it('activates and deactivates through n8n′s own endpoints', async () => {
    const p = provider();
    const ref = await p.createWorkflow(spec());
    await p.setEnabled(ref, true);
    expect(fake.workflows.get(decodeRef(ref.ref).workflowId)?.active).toBe(true);
    await p.setEnabled(ref, false);
    expect(fake.workflows.get(decodeRef(ref.ref).workflowId)?.active).toBe(false);
  });

  it('treats deleting an already-deleted workflow as success', async () => {
    const p = provider();
    const ref = await p.createWorkflow(spec());
    await p.deleteWorkflow(ref);
    await expect(p.deleteWorkflow(ref)).resolves.toBeUndefined();
  });

  it('refuses to edit a pre-A-6 ref that carries no workflow id, and says why', async () => {
    // A-5 stored a bare webhook path. Such a workflow can still be triggered — but silently
    // "updating" it would report success while n8n kept running the old copy.
    const p = provider();
    const legacy = { providerId: 'n8n', ref: 'just-a-webhook-path' };
    await expect(p.updateWorkflow(legacy, spec())).rejects.toBeInstanceOf(N8nUnmanagedWorkflowError);
    await expect(p.dispatch(legacy, dispatchInput())).resolves.toBeTruthy();
  });
});

describe('graph portability', () => {
  it('round-trips a graph through export and import', async () => {
    const p = provider();
    const ref = await p.createWorkflow(spec());
    const graph = await p.exportGraph(ref);

    expect(graph).toMatchObject({ providerId: 'n8n', formatVersion: N8N_FORMAT_VERSION });
    await expect(p.importGraph(graph)).resolves.toMatchObject({ providerId: 'n8n' });
  });

  it('refuses a graph from another provider rather than half-importing it', async () => {
    await expect(
      provider().importGraph({ providerId: 'other', formatVersion: '1', nodes: {} }),
    ).rejects.toThrow(/cannot import/);
  });
});

// ── Dispatch (A-5) ───────────────────────────────────────────────────────────

describe('dispatch', () => {
  it('posts a stable event envelope to the workflow′s webhook', async () => {
    const p = provider();
    const ref = await p.createWorkflow(spec());
    await p.dispatch(ref, dispatchInput({ requestId: 'req-5' }));

    const hook = fake.calls.find((c) => c.path.startsWith('/webhook/'));
    expect(hook?.body).toMatchObject({
      eventId: 'evt_9',
      eventType: 'hr.employee.created',
      occurredAt: '2026-01-02T03:04:05.000Z',
      correlationId: 'req-5',
      version: 1,
      payload: { employeeId: 'e1' },
      executionId: 'ex_1',
    });
    expect(hook?.headers['idempotency-key']).toBe('ex_1');
    expect(hook?.headers['x-request-id']).toBe('req-5');
  });

  it('signs the trigger per workflow when a webhook secret is configured', async () => {
    const p = provider({ webhookSecret: 'deployment-secret-value' });
    const refA = await p.createWorkflow(spec());
    const refB = await p.createWorkflow({ ...spec(), key: 'wf.other' });
    await p.dispatch(refA, dispatchInput());
    await p.dispatch(refB, dispatchInput());

    const [hookA, hookB] = fake.calls.filter((c) => c.path.startsWith('/webhook/'));
    expect(hookA?.headers['x-ecms-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    // Derived per webhook path, so a secret leaked from one workflow cannot forge another's.
    expect(hookA?.headers['x-ecms-signature']).not.toBe(hookB?.headers['x-ecms-signature']);
  });

  it('sends no signature when no secret is configured, rather than failing the trigger', async () => {
    const p = provider();
    const ref = await p.createWorkflow(spec());
    await p.dispatch(ref, dispatchInput());
    const hook = fake.calls.find((c) => c.path.startsWith('/webhook/'));
    expect(hook?.headers['x-ecms-signature']).toBeUndefined();
  });
});

describe('the scope boundary', () => {
  it('claims authoring and graph portability, not the A-7 execution lifecycle', () => {
    expect(provider().capabilities).toEqual({
      visualBuilder: true,
      graphImportExport: true,
      cancellation: false,
      perNodeProgress: false,
    });
  });

  it('rejects cancellation clearly instead of faking it', async () => {
    await expect(provider().cancel()).rejects.toBeInstanceOf(N8nNotImplementedError);
  });

  it('points the builder at the n8n workflow it manages', async () => {
    const p = provider();
    const ref = await p.createWorkflow(spec());
    await expect(p.builderUrl?.(ref)).resolves.toBe(
      `https://n8n.example/workflow/${decodeRef(ref.ref).workflowId}`,
    );
  });
});
