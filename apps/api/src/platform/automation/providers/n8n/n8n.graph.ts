// The n8n-native workflow shape, and the mapping to/from ECMS's provider-agnostic contracts (A-6).
//
// PURE — no I/O, no fetch. Everything that knows what an n8n workflow JSON looks like lives here,
// so the provider stays about *calling* n8n and this stays about *speaking n8n's dialect*. It is
// also the only file that decides what a `ProviderWorkflowRef.ref` means for this provider.
import { createHmac, randomUUID } from 'node:crypto';
import { type WorkflowGraph, type WorkflowSpec } from '@ecms/contracts';

/** Bumped when the shape we WRITE changes incompatibly, so an old package can be refused. */
export const N8N_FORMAT_VERSION = '1';

const WEBHOOK_NODE_TYPE = 'n8n-nodes-base.webhook';
const WEBHOOK_NODE_NAME = 'ECMS Trigger';

/**
 * A workflow ref for n8n carries TWO facts: the workflow id (needed to update/activate/delete via
 * the REST API) and the webhook path (needed to trigger a run). `ProviderWorkflowRef.ref` is a
 * single opaque string — opaque to ECMS, which never interprets it (A-0), but the provider that
 * minted it may. So this provider encodes both and owns the format.
 */
export interface N8nRef {
  workflowId: string;
  webhookPath: string;
}

const REF_SEPARATOR = '|';

export const encodeRef = (ref: N8nRef): string =>
  `${ref.workflowId}${REF_SEPARATOR}${ref.webhookPath}`;

/**
 * Tolerant of a ref minted before A-6 (A-5 stored a bare webhook path with no workflow id): such a
 * workflow can still be TRIGGERED, it just cannot be updated in place until it is re-pushed. That
 * is a better outcome than refusing to run it.
 */
export const decodeRef = (raw: string): N8nRef => {
  const index = raw.indexOf(REF_SEPARATOR);
  if (index < 0) return { workflowId: '', webhookPath: raw };
  return { workflowId: raw.slice(0, index), webhookPath: raw.slice(index + 1) };
};

/** An unguessable webhook path. n8n webhooks are reachable by URL, so the URL is a capability. */
export const newWebhookPath = (): string => randomUUID();

/**
 * The per-workflow signing secret, DERIVED rather than stored: `HMAC(deploymentSecret, webhookPath)`.
 * Design §2.2 asks for a per-workflow secret so a leaked one cannot forge another workflow's
 * trigger; deriving it gets that property with no new column and no rotation bookkeeping beyond the
 * deployment secret itself.
 */
export const workflowSigningSecret = (deploymentSecret: string, webhookPath: string): string =>
  createHmac('sha256', deploymentSecret).update(webhookPath).digest('hex');

/** `sha256=<hex>` over the exact request body, so n8n can reject anything not from ECMS. */
export const signBody = (secret: string, body: string): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

// ── n8n workflow JSON ────────────────────────────────────────────────────────

interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
}

export interface N8nWorkflowBody {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/**
 * The trigger node every ECMS-owned workflow starts with. ECMS dispatches by POSTing to this path;
 * without it the workflow exists in n8n but nothing can start it.
 */
export const webhookNode = (webhookPath: string): N8nNode => ({
  id: randomUUID(),
  name: WEBHOOK_NODE_NAME,
  type: WEBHOOK_NODE_TYPE,
  typeVersion: 2,
  position: [0, 0],
  parameters: {
    path: webhookPath,
    httpMethod: 'POST',
    // n8n answers as soon as it has accepted the run. ECMS must never wait for the workflow to
    // finish (the trigger path is fire-and-forget); completion comes back via A-7's callback.
    responseMode: 'onReceived',
  },
});

interface GraphNodes {
  nodes?: unknown;
  connections?: unknown;
}

/**
 * Build the workflow body to POST/PUT to n8n.
 *
 * With no graph (the common case until A-9 ships template packages) the result is a valid workflow
 * whose only node is the ECMS trigger: it runs, and does nothing, which is exactly what an
 * enabled-but-empty workflow should do. With a graph, the graph's nodes are appended after the
 * trigger — ECMS does not rewrite them, it only guarantees the entry point.
 */
export const buildWorkflowBody = (spec: WorkflowSpec, webhookPath: string): N8nWorkflowBody => {
  const graphNodes = (spec.graph?.nodes ?? {}) as GraphNodes;
  const extra = Array.isArray(graphNodes.nodes) ? (graphNodes.nodes as N8nNode[]) : [];
  const connections =
    typeof graphNodes.connections === 'object' && graphNodes.connections !== null
      ? (graphNodes.connections as Record<string, unknown>)
      : {};

  return {
    name: spec.name,
    nodes: [webhookNode(webhookPath), ...extra],
    connections,
    // `settings` must be present — n8n rejects a create without it on several versions.
    settings: {},
  };
};

/** n8n's stored workflow → the portable graph a template package carries (design §11). */
export const toWorkflowGraph = (providerId: string, workflow: unknown): WorkflowGraph => {
  const source = (workflow ?? {}) as GraphNodes;
  return {
    providerId,
    formatVersion: N8N_FORMAT_VERSION,
    nodes: { nodes: source.nodes ?? [], connections: source.connections ?? {} },
  };
};

/**
 * A graph from another provider — or a future n8n format — is refused rather than half-imported.
 * Silently importing an incompatible graph produces a workflow that looks installed and is not.
 */
export class N8nGraphFormatError extends Error {
  constructor(graph: WorkflowGraph, providerId: string) {
    super(
      `n8n cannot import a '${graph.providerId}' graph at format '${graph.formatVersion}' ` +
        `(this provider is '${providerId}' at format '${N8N_FORMAT_VERSION}')`,
    );
    this.name = 'N8nGraphFormatError';
  }
}

export const assertImportable = (graph: WorkflowGraph, providerId: string): void => {
  if (graph.providerId !== providerId || graph.formatVersion !== N8N_FORMAT_VERSION) {
    throw new N8nGraphFormatError(graph, providerId);
  }
};
