#!/usr/bin/env node
// Criterion 8's staging run (P2 plan §16; RK-33): ten purchase requests of 100 lines each, raised by
// ten focal points and submitted at the same moment into the one company-wide series of the year
// (OD-58 A). Every submission is a transaction whose first write is the series' counter, so the ten
// meet on one document and the driver retries the losers; the run shows whether that holds up.
//
// The threshold is design §18.3.2's, borrowed for the first numbered write: all ten commit, none
// exhausts the driver's 120 s retry, and the slowest commits within 5 s. A miss goes to the owner
// with OD-58 B, a series per branch, before P2 closes; the figures are recorded in design §22.
//
// It WRITES to the environment it is pointed at: ten drafts, then ten submitted requests, each
// numbered for good. Point it at staging, never at production. Nothing here cancels them — a cancel
// is P2.5's act, and a submitted request is cancelled by a holder of its key, from the register.
//
// Each focal point must already be set up as P2 plan §2 says: the department requester bundle over
// their own department copy, an employee record HR links to their login, and an approval chain
// with somebody other than them on its first staffed rung. Ten focal points, because a draft is its
// requester's alone (P2 plan §1.2 item 22). Their tokens and the URL come from the environment and
// are never printed.
//
//   ECMS_STAGING_URL=https://ecms-staging.example \
//   ECMS_FOCAL_TOKENS=<token1>,<token2>,…,<token10> \
//   node scripts/measure-purchase-request-contention.mjs
//
// Exit code 0 = all ten committed and the slowest within 5 s; 1 = a miss, with every figure printed.
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.ECMS_STAGING_URL ?? '').replace(/\/+$/, '');
const tokens = (process.env.ECMS_FOCAL_TOKENS ?? '')
  .split(',')
  .map((token) => token.trim())
  .filter((token) => token !== '');
const timeoutMs = Number(process.env.ECMS_TIMEOUT_MS ?? 180_000);

const REQUESTS = 10;
const LINES = 100;
const THRESHOLD_MS = 5_000;

if (baseUrl === '' || tokens.length !== REQUESTS) {
  process.stderr.write(
    `ECMS_STAGING_URL and exactly ${String(REQUESTS)} comma-separated ECMS_FOCAL_TOKENS are required.\n`,
  );
  process.exit(1);
}

const call = async (token, method, path, body) => {
  const response = await fetch(`${baseUrl}/api/v1/administration${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
};

/** A refusal as one line: its code and its details' codes, never the server's whole answer. */
const refusalOf = (body) => {
  const error = body?.error;
  if (error === undefined || error === null) return 'no error body';
  const details = (error.details ?? []).map((d) => `${d.field ?? ''}:${d.code}`).join(', ');
  return details === '' ? String(error.code) : `${String(error.code)} (${details})`;
};

process.stdout.write(`purchase-request contention — ${baseUrl}\n`);

// The lines: the active items the first focal point's picker offers, cycled to 100. Two lines may
// name one item (P2.2 adds no rule against it), so a catalog of fewer than 100 items still serves.
const items = await call(tokens[0], 'GET', '/items?isActive=true&pageSize=100');
const itemIds = (items.body?.data ?? []).map((item) => item.id);
if (items.status !== 200 || itemIds.length === 0) {
  process.stdout.write(
    `  ✗ no active item to name: ${String(items.status)} ${refusalOf(items.body)}\n`,
  );
  process.exit(1);
}
const lines = Array.from({ length: LINES }, (_, i) => ({
  itemId: itemIds[i % itemIds.length],
  qty: 1,
}));

// One draft per focal point, made one after another: only the submissions are measured.
const drafts = [];
for (const [index, token] of tokens.entries()) {
  const created = await call(token, 'POST', '/purchase-requests', {
    justification: 'contention measurement (P2 criterion 8)',
    lines,
  });
  if (created.status !== 201) {
    process.stdout.write(
      `  ✗ focal point ${String(index + 1)}: draft refused, ${String(created.status)} ${refusalOf(created.body)}\n`,
    );
    process.exit(1);
  }
  drafts.push({ token, id: created.body.data.id, version: created.body.data.version });
}
process.stdout.write(
  `  ${String(REQUESTS)} drafts of ${String(LINES)} lines made; submitting at once\n`,
);

const started = performance.now();
const results = await Promise.all(
  drafts.map(async ({ token, id, version }, index) => {
    const from = performance.now();
    try {
      const answer = await call(token, 'POST', `/purchase-requests/${id}/submit`, { version });
      return {
        index,
        status: answer.status,
        ms: performance.now() - from,
        number: answer.status === 200 ? answer.body.data.number : null,
        refusal: answer.status === 200 ? null : refusalOf(answer.body),
      };
    } catch (error) {
      return {
        index,
        status: 0,
        ms: performance.now() - from,
        number: null,
        refusal: String(error?.message ?? error),
      };
    }
  }),
);
const wall = performance.now() - started;

for (const result of results) {
  const outcome =
    result.status === 200 ? result.number : `refused ${String(result.status)} ${result.refusal}`;
  process.stdout.write(
    `  submission ${String(result.index + 1).padStart(2, ' ')}: ${result.ms.toFixed(0).padStart(6, ' ')} ms  ${outcome}\n`,
  );
}

const committed = results.filter((result) => result.status === 200);
const slowest = Math.max(...results.map((result) => result.ms));
const seqs = committed
  .map((result) => Number(String(result.number).split('-').at(-1)))
  .sort((a, b) => a - b);
const consecutive = seqs.every((seq, i) => i === 0 || seq === (seqs[i - 1] ?? 0) + 1);

process.stdout.write(
  `  committed ${String(committed.length)}/${String(REQUESTS)}; slowest ${slowest.toFixed(0)} ms ` +
    `(threshold ${String(THRESHOLD_MS)} ms); all ten in ${wall.toFixed(0)} ms; ` +
    `numbers ${consecutive ? 'consecutive' : 'NOT consecutive'}\n`,
);

const met = committed.length === REQUESTS && slowest <= THRESHOLD_MS && consecutive;
process.stdout.write(met ? '  ✓ criterion 8 met\n' : '  ✗ criterion 8 missed\n');
process.exit(met ? 0 : 1);
