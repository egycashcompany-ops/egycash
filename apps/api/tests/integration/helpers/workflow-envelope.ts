// I6 — helpers for asserting the workflow envelope every recruitment mutation answers with.
//
// A mutation returns `{ data, workflow, timeline, counters }`; a read returns the aggregate as it
// always did. Specs say which they mean by calling `mutated(...)` or leaving `res.body.data` alone,
// so the difference is visible at every call site rather than hidden behind a shared unwrap.
import { expect } from 'vitest';
import {
  type BulkWorkflowResultDto,
  type StageCountDto,
  type WorkflowEnvelopeDto,
} from '@ecms/contracts';

interface ResponseLike {
  status: number;
  body: { data?: unknown };
}

const asEnvelope = <T>(res: ResponseLike): WorkflowEnvelopeDto<T> =>
  res.body.data as WorkflowEnvelopeDto<T>;

/**
 * Assert the envelope's shape and return it whole. Every mutation test runs this, so a controller
 * that forgets a half fails somewhere specific rather than through a confusing `undefined` further
 * down the test.
 */
export const envelope = <T>(res: ResponseLike): WorkflowEnvelopeDto<T> => {
  const body = asEnvelope<T>(res);
  expect(body, `expected a workflow envelope, got ${JSON.stringify(res.body.data)}`).toBeDefined();
  expect(body.data, 'envelope.data').toBeDefined();
  expect(body.workflow, 'envelope.workflow').toBeDefined();
  expect(body.timeline, 'envelope.timeline').toBeDefined();
  expect(Array.isArray(body.timeline.produced), 'envelope.timeline.produced').toBe(true);
  expect(Array.isArray(body.timeline.latest), 'envelope.timeline.latest').toBe(true);
  expect(typeof body.timeline.total, 'envelope.timeline.total').toBe('number');
  expect(Array.isArray(body.counters), 'envelope.counters').toBe(true);
  return body;
};

/** The updated aggregate a mutation returns — the half specs assert business outcomes on. */
export const mutated = <T>(res: ResponseLike): T => envelope<T>(res).data;

/** The bulk counterpart: the partial-success envelope plus what the batch wrote (I6/RW17). */
export const bulkEnvelope = (res: ResponseLike): BulkWorkflowResultDto => {
  const body = res.body.data as BulkWorkflowResultDto;
  expect(typeof body.requested, 'bulk.requested').toBe('number');
  expect(typeof body.succeeded, 'bulk.succeeded').toBe('number');
  expect(typeof body.failed, 'bulk.failed').toBe('number');
  expect(body.timeline, 'bulk.timeline').toBeDefined();
  expect(Array.isArray(body.timeline.produced), 'bulk.timeline.produced').toBe(true);
  expect(Array.isArray(body.counters), 'bulk.counters').toBe(true);
  return body;
};

/** One stage's refreshed counter, by key — `screening`, `interview:<id>`, `jobOffers`, … */
export const counter = (counters: StageCountDto[], key: string): StageCountDto | undefined =>
  counters.find((c) => c.key === key);

/** The action's `enabled` flag, or undefined when the state does not offer it at all. */
export const actionEnabled = (
  workflow: WorkflowEnvelopeDto<unknown>['workflow'],
  key: string,
): boolean | undefined => workflow.availableActions.find((a) => a.key === key)?.enabled;
