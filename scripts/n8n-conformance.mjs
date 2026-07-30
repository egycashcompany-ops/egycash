// Run the A-6 authoring contract against a REAL n8n instance.
//
// The automated suite (`n8n.provider.spec.ts`) proves conformance against n8n's documented REST
// contract with `fetch` stubbed — deliberately, because a provider that needed a live runtime to
// pass conformance would have made the runtime part of the interface. This script is the other
// half: an operator's end-to-end check that the instance you actually deployed behaves the way the
// contract assumes, before you point production at it.
//
// It is OPT-IN and it CLEANS UP AFTER ITSELF (creates a throwaway workflow, then deletes it).
//
//   N8N_BASE_URL=https://n8n-production-xxxx.up.railway.app \
//   N8N_API_KEY=<key> \
//   node scripts/n8n-conformance.mjs
//
// Exit code 0 = the instance satisfies the contract; 1 = it does not, with the failing step named.

const baseUrl = (process.env.N8N_BASE_URL ?? '').replace(/\/+$/, '');
const apiKey = process.env.N8N_API_KEY ?? '';
const timeoutMs = Number(process.env.N8N_TIMEOUT_MS ?? 30_000);

if (baseUrl === '' || apiKey === '') {
  process.stderr.write('N8N_BASE_URL and N8N_API_KEY are both required.\n');
  process.exit(1);
}

const call = async (method, path, body) => {
  const response = await fetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-n8n-api-key': apiKey,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, ok: response.ok, body: parsed };
};

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    results.push({ name, ok: false, error });
    process.stdout.write(`  ✗ ${name}\n    ${String(error?.message ?? error)}\n`);
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const webhookPath = `ecms-conformance-${Date.now()}`;
let workflowId = null;

process.stdout.write(`n8n conformance — ${baseUrl}\n`);

await check('reachable without auth on /healthz', async () => {
  const health = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
  assert(health.ok, `healthz answered ${health.status}`);
});

await check('creates a workflow with an ECMS webhook trigger', async () => {
  const created = await call('POST', '/api/v1/workflows', {
    name: 'ECMS conformance (safe to delete)',
    nodes: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'ECMS Trigger',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        parameters: { path: webhookPath, httpMethod: 'POST', responseMode: 'onReceived' },
      },
    ],
    connections: {},
    settings: {},
  });
  assert(created.ok, `create answered ${created.status}: ${JSON.stringify(created.body)}`);
  workflowId = created.body?.id ?? created.body?.data?.id;
  assert(typeof workflowId === 'string' || typeof workflowId === 'number', 'no workflow id returned');
  workflowId = String(workflowId);
});

await check('reads the workflow back (graph export)', async () => {
  const read = await call('GET', `/api/v1/workflows/${workflowId}`);
  assert(read.ok, `get answered ${read.status}`);
  assert(Array.isArray(read.body?.nodes ?? read.body?.data?.nodes), 'no nodes on the workflow');
});

await check('activates and deactivates through its own endpoints', async () => {
  const activated = await call('POST', `/api/v1/workflows/${workflowId}/activate`);
  assert(activated.ok, `activate answered ${activated.status}: ${JSON.stringify(activated.body)}`);
  const deactivated = await call('POST', `/api/v1/workflows/${workflowId}/deactivate`);
  assert(deactivated.ok, `deactivate answered ${deactivated.status}`);
});

await check('deletes, and tolerates being asked twice', async () => {
  const first = await call('DELETE', `/api/v1/workflows/${workflowId}`);
  assert(first.ok, `delete answered ${first.status}`);
  const second = await call('DELETE', `/api/v1/workflows/${workflowId}`);
  // 404 on the second is the contract the provider relies on to make delete idempotent.
  assert(second.ok || second.status === 404, `second delete answered ${second.status}`);
  workflowId = null;
});

if (workflowId !== null) {
  // A check failed mid-way — do not leave a workflow behind on someone's instance.
  await call('DELETE', `/api/v1/workflows/${workflowId}`).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(
  `\n${results.length - failed.length}/${results.length} checks passed.\n` +
    (failed.length === 0
      ? 'This instance satisfies the A-6 authoring contract.\n'
      : 'This instance does NOT satisfy the contract — see the failures above.\n'),
);
process.exit(failed.length === 0 ? 0 : 1);
