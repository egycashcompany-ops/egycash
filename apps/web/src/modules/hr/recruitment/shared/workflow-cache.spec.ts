// What a workflow response does to the query cache (I6).
//
// These run against a real QueryClient rather than a mock, because the behaviour under test IS
// cache behaviour: which keys are written, which are only marked stale, and — the point of the
// whole slice — that applying an envelope issues no request. A fetch that slipped back in would
// show up here as an unexpected `queryFn` call.
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  type BulkWorkflowResultDto,
  type Paginated,
  type RecruitmentStageCountsDto,
  type RecruitmentTimelineEntryDto,
  type StageCountDto,
  type WorkflowEnvelopeDto,
  type WorkflowStateDto,
} from '@ecms/contracts';
import { describe, expect, it, vi } from 'vitest';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import { stageCountsKey } from '../counters/stage-counts-queries';
import { mergeTimelineEntries, timelineKey } from '../timeline/api/timeline-cache';
import {
  applyBulkWorkflowResult,
  applyWorkflowEnvelope,
  markAllRecruitmentListsStale,
  workflowStateKey,
} from './workflow-cache';

// ── Fixtures ────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  status: string;
}

const page = (items: Row[], totalItems = items.length): Paginated<Row> => ({
  items,
  meta: { page: 1, pageSize: 20, totalItems, totalPages: 1 },
});

const entry = (
  eventId: string,
  at: string,
  applicantId = 'app-1',
): RecruitmentTimelineEntryDto =>
  ({
    eventId,
    applicantId,
    applicantCode: 'APP-0001',
    at,
    actorUserId: null,
    actorName: 'System',
    type: 'note',
    stage: null,
    fromStatus: null,
    toStatus: null,
    placement: null,
    placementLabel: null,
    entityRef: null,
    reason: null,
    note: null,
    correlationType: 'applicant',
    correlationId: 'corr-1',
    supersededAt: null,
    metadata: {},
  }) as RecruitmentTimelineEntryDto;

const counter = (key: string, count: number): StageCountDto => ({
  key,
  kind: 'screening',
  refId: null,
  name: null,
  route: `/${key}`,
  permission: 'screening.view',
  count,
  buckets: { waiting: count },
  order: 1,
});

const workflowState = (applicantId: string): WorkflowStateDto => ({
  applicantId,
  applicantCode: 'APP-0001',
  applicantStatus: 'new',
  stage: { kind: 'screening', refId: null, key: 'screening', name: null },
  status: 'approved',
  attempt: 1,
  placement: {
    jobTitleId: null,
    departmentId: null,
    branchId: null,
    sectionId: null,
  },
  placementLabel: { position: null, branch: null, department: null },
  availableActions: [
    { key: 'reassign', permission: 'applicant.reassign', enabled: true, reason: null },
    {
      key: 'returnToStage',
      permission: 'applicant.returnToStage',
      enabled: false,
      reason: 'alreadyAtEarliestStage',
    },
  ],
});

const envelope = (
  data: Row,
  overrides: Partial<WorkflowEnvelopeDto<Row>> = {},
): WorkflowEnvelopeDto<Row> => ({
  data,
  workflow: workflowState('app-1'),
  timeline: { produced: [], latest: [], total: 0 },
  counters: [counter('screening', 3)],
  ...overrides,
});

const client = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * A list page that is on screen — an ACTIVE observer, the way a mounted queue is, settled before
 * the act under test runs.
 *
 * Both halves matter. An UNOBSERVED cache entry is never refetched by an invalidation, so proving
 * "no request" against one would prove nothing. And an entry still IN FLIGHT clears its own
 * invalidation flag when it lands, which would quietly erase the very thing being asserted.
 */
const observeList = async (
  qc: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<Paginated<Row>>,
): Promise<() => void> => {
  const unsubscribe = new QueryObserver(qc, { queryKey, queryFn, retry: false }).subscribe(() => {
    /* rendering is not what is under test — the fetch count is */
  });
  await vi.waitFor(() => {
    const state = qc.getQueryState(queryKey);
    expect(state?.status).toBe('success');
    expect(state?.fetchStatus).toBe('idle');
  });
  return unsubscribe;
};

// ── data → detail + list row ────────────────────────────────────────────────

describe('applyWorkflowEnvelope — data', () => {
  it('writes the aggregate into its own detail cache', () => {
    const qc = client();
    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    expect(qc.getQueryData(detailKey('hr', 'screenings', 's-1'))).toEqual({
      id: 's-1',
      status: 'approved',
    });
  });

  it('replaces the row in every cached list page that holds it', () => {
    const qc = client();
    const keyA = listKey('hr', 'screenings', { page: 1 });
    const keyB = listKey('hr', 'screenings', { page: 2 });
    qc.setQueryData(keyA, page([{ id: 's-1', status: 'pending' }, { id: 's-2', status: 'pending' }]));
    qc.setQueryData(keyB, page([{ id: 's-9', status: 'pending' }]));

    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    expect(qc.getQueryData<Paginated<Row>>(keyA)?.items).toEqual([
      { id: 's-1', status: 'approved' },
      { id: 's-2', status: 'pending' },
    ]);
    // A page that never held the row is left exactly as it was.
    expect(qc.getQueryData<Paginated<Row>>(keyB)?.items).toEqual([{ id: 's-9', status: 'pending' }]);
  });

  it('drops the row from a page whose status filter it no longer satisfies, and decrements the total', () => {
    const qc = client();
    const pending = listKey('hr', 'screenings', { status: 'pending' });
    qc.setQueryData(pending, page([{ id: 's-1', status: 'pending' }, { id: 's-2', status: 'pending' }], 7));

    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    const after = qc.getQueryData<Paginated<Row>>(pending);
    expect(after?.items).toEqual([{ id: 's-2', status: 'pending' }]);
    expect(after?.meta.totalItems).toBe(6);
  });

  it('keeps the row on an unfiltered page — an empty status filter is not a filter', () => {
    const qc = client();
    const all = listKey('hr', 'screenings', { status: '' });
    qc.setQueryData(all, page([{ id: 's-1', status: 'pending' }]));

    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    expect(qc.getQueryData<Paginated<Row>>(all)?.items).toEqual([{ id: 's-1', status: 'approved' }]);
  });

  it('never seeds a page that has not been fetched', () => {
    const qc = client();
    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    expect(qc.getQueryData(listKey('hr', 'screenings', { status: 'pending' }))).toBeUndefined();
  });
});

// ── workflow → per-applicant state ──────────────────────────────────────────

describe('applyWorkflowEnvelope — workflow', () => {
  it('writes the derived state under the applicant it belongs to', () => {
    const qc = client();
    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    const state = qc.getQueryData<WorkflowStateDto>(workflowStateKey('app-1'));
    expect(state?.status).toBe('approved');
    expect(state?.availableActions.find((a) => a.key === 'reassign')?.enabled).toBe(true);
    expect(state?.availableActions.find((a) => a.key === 'returnToStage')?.reason).toBe(
      'alreadyAtEarliestStage',
    );
  });

  it('ignores the empty state a candidate-less act answers with', () => {
    const qc = client();
    applyWorkflowEnvelope(
      qc,
      'hiringDocuments',
      envelope({ id: 'h-1', status: 'open' }, { workflow: { ...workflowState(''), applicantId: '' } }),
    );

    expect(qc.getQueryData(workflowStateKey(''))).toBeUndefined();
  });
});

// ── timeline → the candidate's history ──────────────────────────────────────

describe('applyWorkflowEnvelope — timeline', () => {
  it('merges the produced entries into every cached view of that candidate', () => {
    const qc = client();
    const unfiltered = timelineKey('app-1', {});
    const filtered = timelineKey('app-1', { type: 'note' });
    qc.setQueryData(unfiltered, [entry('e-1', '2026-01-01T00:00:00.000Z')]);
    qc.setQueryData(filtered, [entry('e-1', '2026-01-01T00:00:00.000Z')]);

    applyWorkflowEnvelope(
      qc,
      'screenings',
      envelope(
        { id: 's-1', status: 'approved' },
        { timeline: { produced: [entry('e-2', '2026-02-01T00:00:00.000Z')], latest: [], total: 2 } },
      ),
    );

    for (const key of [unfiltered, filtered]) {
      expect(qc.getQueryData<RecruitmentTimelineEntryDto[]>(key)?.map((e) => e.eventId)).toEqual([
        'e-2',
        'e-1',
      ]);
    }
  });

  it('leaves another candidate’s history untouched', () => {
    const qc = client();
    const other = timelineKey('app-2', {});
    qc.setQueryData(other, [entry('e-9', '2026-01-01T00:00:00.000Z', 'app-2')]);

    applyWorkflowEnvelope(
      qc,
      'screenings',
      envelope(
        { id: 's-1', status: 'approved' },
        { timeline: { produced: [entry('e-2', '2026-02-01T00:00:00.000Z')], latest: [], total: 1 } },
      ),
    );

    expect(qc.getQueryData<RecruitmentTimelineEntryDto[]>(other)?.map((e) => e.eventId)).toEqual([
      'e-9',
    ]);
  });
});

describe('mergeTimelineEntries', () => {
  it('orders newest first', () => {
    const merged = mergeTimelineEntries(
      [entry('e-1', '2026-01-01T00:00:00.000Z')],
      [entry('e-3', '2026-03-01T00:00:00.000Z'), entry('e-2', '2026-02-01T00:00:00.000Z')],
    );
    expect(merged.map((e) => e.eventId)).toEqual(['e-3', 'e-2', 'e-1']);
  });

  it('replaces rather than duplicates an entry it already holds (I9 — eventId is identity)', () => {
    const cached = [entry('e-1', '2026-01-01T00:00:00.000Z')];
    const incoming = [{ ...entry('e-1', '2026-01-01T00:00:00.000Z'), note: 'rewritten' }];

    const merged = mergeTimelineEntries(cached, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.note).toBe('rewritten');
  });

  it('is idempotent — applying the same response twice changes nothing', () => {
    const once = mergeTimelineEntries([], [entry('e-1', '2026-01-01T00:00:00.000Z')]);
    expect(mergeTimelineEntries(once, [entry('e-1', '2026-01-01T00:00:00.000Z')])).toEqual(once);
  });
});

// ── counters → the one aggregated read model ────────────────────────────────

describe('applyWorkflowEnvelope — counters', () => {
  it('writes the refreshed counters every badge reads (I3)', () => {
    const qc = client();
    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    const counts = qc.getQueryData<RecruitmentStageCountsDto>(stageCountsKey());
    expect(counts?.stages).toEqual([counter('screening', 3)]);
  });

  it('leaves the previous numbers alone when the server degraded them to none (BD-007)', () => {
    const qc = client();
    qc.setQueryData<RecruitmentStageCountsDto>(stageCountsKey(), {
      stages: [counter('screening', 11)],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }, { counters: [] }));

    expect(qc.getQueryData<RecruitmentStageCountsDto>(stageCountsKey())?.stages).toEqual([
      counter('screening', 11),
    ]);
  });
});

// ── the whole point: no follow-up request ───────────────────────────────────

describe('applyWorkflowEnvelope — no refetch (I6)', () => {
  it('marks an on-screen list stale without fetching it', async () => {
    const qc = client();
    const queryFn = vi.fn().mockResolvedValue(page([{ id: 's-1', status: 'pending' }]));
    const key = listKey('hr', 'screenings', { status: 'pending' });
    const unsubscribe = await observeList(qc, key, queryFn);
    expect(queryFn).toHaveBeenCalledTimes(1);

    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    unsubscribe();
  });

  it('does not touch another feature’s lists', () => {
    const qc = client();
    const interviews = listKey('hr', 'interviews', { status: 'scheduled' });
    qc.setQueryData(interviews, page([{ id: 'i-1', status: 'scheduled' }]));

    applyWorkflowEnvelope(qc, 'screenings', envelope({ id: 's-1', status: 'approved' }));

    expect(qc.getQueryState(interviews)?.isInvalidated).toBe(false);
  });
});

describe('markAllRecruitmentListsStale', () => {
  it('marks every recruitment feature stale without fetching (RW13 reaches across stages)', async () => {
    const qc = client();
    const queryFn = vi.fn().mockResolvedValue(page([{ id: 'i-1', status: 'scheduled' }]));
    const interviews = listKey('hr', 'interviews', { status: 'scheduled' });
    const unsubscribe = await observeList(qc, interviews, queryFn);
    expect(queryFn).toHaveBeenCalledTimes(1);

    markAllRecruitmentListsStale(qc);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(interviews)?.isInvalidated).toBe(true);
    unsubscribe();
  });
});

// ── bulk (RW17 / I4) ────────────────────────────────────────────────────────

const bulkResult = (overrides: Partial<BulkWorkflowResultDto> = {}): BulkWorkflowResultDto => ({
  requested: 2,
  succeeded: 1,
  failed: 1,
  results: [
    { id: 's-1', ok: true },
    { id: 's-2', ok: false, error: 'version conflict' },
  ],
  timeline: { produced: [], latest: [], total: 0 },
  counters: [counter('screening', 5)],
  ...overrides,
});

describe('applyBulkWorkflowResult', () => {
  it('writes the refreshed counters', () => {
    const qc = client();
    applyBulkWorkflowResult(qc, 'screenings', bulkResult());

    expect(qc.getQueryData<RecruitmentStageCountsDto>(stageCountsKey())?.stages).toEqual([
      counter('screening', 5),
    ]);
  });

  it('routes each produced entry to the candidate it belongs to', () => {
    const qc = client();
    qc.setQueryData(timelineKey('app-1', {}), []);
    qc.setQueryData(timelineKey('app-2', {}), []);

    applyBulkWorkflowResult(
      qc,
      'screenings',
      bulkResult({
        timeline: {
          produced: [
            entry('e-1', '2026-01-01T00:00:00.000Z', 'app-1'),
            entry('e-2', '2026-01-02T00:00:00.000Z', 'app-2'),
          ],
          latest: [],
          total: 2,
        },
      }),
    );

    expect(
      qc.getQueryData<RecruitmentTimelineEntryDto[]>(timelineKey('app-1', {}))?.map((e) => e.eventId),
    ).toEqual(['e-1']);
    expect(
      qc.getQueryData<RecruitmentTimelineEntryDto[]>(timelineKey('app-2', {}))?.map((e) => e.eventId),
    ).toEqual(['e-2']);
  });

  it('re-reads the affected list exactly once — the changed rows are not in the response', async () => {
    const qc = client();
    const queryFn = vi.fn().mockResolvedValue(page([{ id: 's-1', status: 'pending' }]));
    const key = listKey('hr', 'screenings', { status: 'pending' });
    const unsubscribe = await observeList(qc, key, queryFn);
    expect(queryFn).toHaveBeenCalledTimes(1);

    applyBulkWorkflowResult(qc, 'screenings', bulkResult());
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));

    // Exactly one re-read, and only for the feature that was acted on.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryFn).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('marks the other stages stale without re-reading them — a batch moves candidates onward', async () => {
    const qc = client();
    const acted = vi.fn().mockResolvedValue(page([{ id: 's-1', status: 'pending' }]));
    const onward = vi.fn().mockResolvedValue(page([{ id: 'i-1', status: 'scheduled' }]));
    const screenings = listKey('hr', 'screenings', { status: 'pending' });
    const interviews = listKey('hr', 'interviews', { status: 'scheduled' });
    const stopActed = await observeList(qc, screenings, acted);
    const stopOnward = await observeList(qc, interviews, onward);

    applyBulkWorkflowResult(qc, 'screenings', bulkResult());
    await vi.waitFor(() => expect(acted).toHaveBeenCalledTimes(2));

    expect(onward).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(interviews)?.isInvalidated).toBe(true);
    stopActed();
    stopOnward();
  });
});
