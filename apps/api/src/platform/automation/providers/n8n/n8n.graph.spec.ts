// The n8n dialect — pure mapping, no I/O (A-6).
//
// These are the decisions that are cheap to get wrong and expensive to debug through a live n8n:
// what a ref means, how a trigger URL is derived, and what a signature is computed over.
import { describe, expect, it } from 'vitest';
import {
  assertImportable,
  buildWorkflowBody,
  decodeRef,
  encodeRef,
  N8N_FORMAT_VERSION,
  newWebhookPath,
  signBody,
  toWorkflowGraph,
  workflowSigningSecret,
} from './n8n.graph';

const spec = (over: Record<string, unknown> = {}) => ({
  key: 'wf.sample',
  name: 'Sample',
  trigger: { kind: 'event' as const, event: 'hr.employee.created', timezone: 'Africa/Cairo', filters: [] },
  ...over,
});

describe('the workflow ref', () => {
  it('round-trips a workflow id and webhook path', () => {
    const ref = { workflowId: 'wf_1', webhookPath: 'abc-123' };
    expect(decodeRef(encodeRef(ref))).toEqual(ref);
  });

  it('reads a pre-A-6 bare path as triggerable but unmanaged', () => {
    // A-5 stored only the webhook path. Such a workflow must still dispatch; it just cannot be
    // edited in place, which the provider reports rather than silently no-opping.
    expect(decodeRef('legacy-path')).toEqual({ workflowId: '', webhookPath: 'legacy-path' });
  });

  it('tolerates a webhook path that itself contains the separator', () => {
    expect(decodeRef('wf_1|a|b')).toEqual({ workflowId: 'wf_1', webhookPath: 'a|b' });
  });

  it('mints an unguessable webhook path — the URL is the capability', () => {
    const paths = new Set(Array.from({ length: 50 }, () => newWebhookPath()));
    expect(paths.size).toBe(50);
    expect([...paths][0]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('the workflow body', () => {
  it('always starts with the ECMS webhook trigger, on the given path', () => {
    const body = buildWorkflowBody(spec(), 'path-1');
    expect(body.nodes[0]?.type).toBe('n8n-nodes-base.webhook');
    expect(body.nodes[0]?.parameters).toMatchObject({ path: 'path-1', httpMethod: 'POST' });
  });

  it('answers the trigger on receipt, so ECMS never waits for the workflow to finish', () => {
    expect(buildWorkflowBody(spec(), 'p').nodes[0]?.parameters).toMatchObject({
      responseMode: 'onReceived',
    });
  });

  it('appends a supplied graph after the trigger rather than replacing it', () => {
    const body = buildWorkflowBody(
      spec({
        graph: {
          providerId: 'n8n',
          formatVersion: N8N_FORMAT_VERSION,
          nodes: { nodes: [{ name: 'Slack' }], connections: { a: 1 } },
        },
      }),
      'p',
    );
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[1]).toMatchObject({ name: 'Slack' });
    expect(body.connections).toEqual({ a: 1 });
  });

  it('produces a valid empty workflow when there is no graph yet', () => {
    // Enabled-but-empty is a real state until A-9 installs template packages: it should run and
    // do nothing, not fail to create.
    const body = buildWorkflowBody(spec(), 'p');
    expect(body.nodes).toHaveLength(1);
    expect(body.connections).toEqual({});
    expect(body.settings).toEqual({});
  });
});

describe('signing', () => {
  it('derives a different secret per webhook path from one deployment secret', () => {
    const a = workflowSigningSecret('deployment', 'path-a');
    const b = workflowSigningSecret('deployment', 'path-b');
    expect(a).not.toBe(b);
    // Deterministic — the same workflow signs identically across processes and restarts.
    expect(workflowSigningSecret('deployment', 'path-a')).toBe(a);
  });

  it('signs the exact body, so any tampering changes the signature', () => {
    const secret = workflowSigningSecret('deployment', 'p');
    const signature = signBody(secret, '{"a":1}');
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody(secret, '{"a":2}')).not.toBe(signature);
  });
});

describe('graph import guards', () => {
  it('accepts this provider′s own current format', () => {
    expect(() =>
      assertImportable({ providerId: 'n8n', formatVersion: N8N_FORMAT_VERSION, nodes: {} }, 'n8n'),
    ).not.toThrow();
  });

  it('refuses another provider′s graph, and a future format', () => {
    expect(() =>
      assertImportable({ providerId: 'other', formatVersion: N8N_FORMAT_VERSION, nodes: {} }, 'n8n'),
    ).toThrow(/cannot import/);
    expect(() =>
      assertImportable({ providerId: 'n8n', formatVersion: '99', nodes: {} }, 'n8n'),
    ).toThrow(/cannot import/);
  });

  it('exports nodes and connections under a declared format version', () => {
    const graph = toWorkflowGraph('n8n', { nodes: [{ name: 'A' }], connections: { x: 1 } });
    expect(graph).toEqual({
      providerId: 'n8n',
      formatVersion: N8N_FORMAT_VERSION,
      nodes: { nodes: [{ name: 'A' }], connections: { x: 1 } },
    });
  });
});
