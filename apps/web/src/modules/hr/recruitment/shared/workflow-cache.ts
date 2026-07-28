// I6 — what a recruitment mutation does to the cache, in one place.
//
// This module replaces `invalidateRecruitment()`, which fanned seven query subtrees out to the
// network after every write. It could not do better: the response was a bare aggregate, so the only
// way to learn where the candidate now stood, what their history said and what the queue badges
// should read was to go and ask again. That was two requests, two moments, and therefore two
// answers that could disagree.
//
// The envelope removes the question. `{ data, workflow, timeline, counters }` already IS the
// refreshed state, so every write below is a cache WRITE, not a cache invalidation:
//
//   data      → the aggregate's detail cache, and its row inside every cached list page
//   workflow  → where the candidate stands + what the caller may do next, keyed per applicant
//   timeline  → the entries this act wrote, merged into the candidate's history
//   counters  → the aggregated stage counters the sidebar, rail and every badge read
//
// The one thing an envelope genuinely cannot answer is list MEMBERSHIP: which rows belong on a
// filtered, sorted, paginated queue is the server's judgement, and re-deriving it here would be a
// second source of truth about what a queue contains (I1). So cached lists are marked stale with
// `refetchType: 'none'` — no request now, and the next mount or focus re-reads them anyway. The
// visible list stays correct in the meantime because the row is patched in place, and dropped when
// the status it was filtered on no longer matches.
import { type QueryClient } from '@tanstack/react-query';
import {
  type BulkWorkflowResultDto,
  type Paginated,
  type RecruitmentStageCountsDto,
  type RecruitmentTimelineEntryDto,
  type StageCountDto,
  type TimelineSummaryDto,
  type WorkflowEnvelopeDto,
  type WorkflowStateDto,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import { stageCountsKey } from '../counters/stage-counts-queries';
import { mergeTimelineEntries, timelineKey } from '../timeline/api/timeline-cache';

const MODULE = 'hr';

/** The recruitment features whose caches a workflow response can refresh. */
export type RecruitmentFeature =
  | 'applicants'
  | 'screenings'
  | 'interviews'
  | 'evaluations'
  | 'jobOffers'
  | 'hiringDocuments'
  | 'evaluationBatches';

/** Anything a workflow endpoint returns as `data` is identified the same way. */
interface Identified {
  id: string;
}

/** Where the candidate stands, per candidate — written by every mutation, fetched by none. */
export const workflowStateKey = (applicantId: string): readonly unknown[] => [
  MODULE,
  'recruitmentWorkflow',
  applicantId,
];

// ── The four halves ─────────────────────────────────────────────────────────

/** `data` → the aggregate's own detail cache. A detail screen re-renders with no request. */
const writeDetail = <T extends Identified>(qc: QueryClient, feature: RecruitmentFeature, data: T): void => {
  qc.setQueryData(detailKey(MODULE, feature, data.id), data);
};

/**
 * `data` → the same row inside every cached list page.
 *
 * The row is REPLACED where it appears, and REMOVED from a page whose `status` filter it no longer
 * satisfies — the one membership rule worth honouring locally, because it is the whole reason a
 * decided item leaves a queue the moment it is decided. Every other membership question is left to
 * the server: the page is marked stale (without refetching) and re-read when it is next mounted.
 */
const writeListRow = <T extends Identified>(
  qc: QueryClient,
  feature: RecruitmentFeature,
  data: T,
): void => {
  const rowStatus = (data as { status?: unknown }).status;

  // Walked rather than `setQueriesData`-ed, because the decision needs each page's OWN filter and
  // that lives in its query key: `['hr', feature, 'list', params]`.
  for (const query of qc.getQueryCache().findAll({ queryKey: listKey(MODULE, feature) })) {
    const page = query.state.data as Paginated<T> | undefined;
    if (page === undefined || !Array.isArray(page.items)) continue;
    if (!page.items.some((item) => item.id === data.id)) continue;

    const wanted = (query.queryKey[3] as { status?: unknown } | undefined)?.status;
    const left =
      typeof rowStatus === 'string' &&
      typeof wanted === 'string' &&
      wanted !== '' &&
      wanted !== rowStatus;

    qc.setQueryData<Paginated<T>>(
      query.queryKey,
      left
        ? {
            ...page,
            items: page.items.filter((item) => item.id !== data.id),
            meta: { ...page.meta, totalItems: Math.max(0, page.meta.totalItems - 1) },
          }
        : { ...page, items: page.items.map((item) => (item.id === data.id ? data : item)) },
    );
  }
};

/**
 * `counters` → the ONE counters cache the sidebar, the stage rail and every queue badge read
 * (RW15/I3), so all of them move together off a single response.
 *
 * An empty array is not written: the server degrades the counters to `[]` rather than failing an
 * action whose transaction already committed (BD-007), and blanking the navigation because a
 * secondary read hiccuped would be worse than showing the previous numbers a moment longer.
 */
const writeCounters = (qc: QueryClient, counters: StageCountDto[]): void => {
  if (counters.length === 0) return;
  qc.setQueryData<RecruitmentStageCountsDto>(stageCountsKey(), {
    stages: counters,
    generatedAt: new Date().toISOString(),
  });
};

/**
 * `workflow` → the candidate's current state, keyed by applicant. Nothing fetches this key: it is
 * written by mutations and read by whichever surface wants to know where the candidate stands or
 * what the caller may do next (I10 — capability lives in `availableActions`, not in a flag).
 *
 * A workflow half with no applicant is not written: that is the deliberate empty state a candidate
 * -less act answers with (a hiring-documents set for a direct registration), never a real state.
 */
const writeWorkflowState = (qc: QueryClient, workflow: WorkflowStateDto): void => {
  if (workflow.applicantId === '') return;
  qc.setQueryData(workflowStateKey(workflow.applicantId), workflow);
};

/**
 * `timeline` → the candidate's history. The entries this act produced are merged into every cached
 * view of that candidate's timeline, whatever filter it was fetched with; a filtered view keeps
 * only what belongs to it, because the filter is applied where it always was — in the component.
 */
const writeTimeline = (qc: QueryClient, applicantId: string, timeline: TimelineSummaryDto): void => {
  if (applicantId === '' || timeline.produced.length === 0) return;
  qc.setQueriesData<RecruitmentTimelineEntryDto[]>({ queryKey: timelineKey(applicantId) }, (cached) =>
    cached === undefined ? cached : mergeTimelineEntries(cached, timeline.produced),
  );
};

/**
 * Membership is the server's judgement, so cached pages are marked stale and re-read when they are
 * next mounted or focused — `refetchType: 'none'` means this issues no request at all.
 */
const markListsStale = (qc: QueryClient, feature: RecruitmentFeature): void => {
  void qc.invalidateQueries({ queryKey: listKey(MODULE, feature), refetchType: 'none' });
};

const ALL_FEATURES: RecruitmentFeature[] = [
  'applicants',
  'screenings',
  'interviews',
  'evaluations',
  'jobOffers',
  'hiringDocuments',
  'evaluationBatches',
];

/**
 * The one act that reaches across every stage: a return to an earlier stage supersedes forward
 * records wherever they live (RW13). Their pages are marked stale — still no request — because a
 * response about the candidate cannot carry every other feature's rows.
 */
export const markAllRecruitmentListsStale = (qc: QueryClient): void => {
  for (const feature of ALL_FEATURES) markListsStale(qc, feature);
};

// ── The whole envelope ──────────────────────────────────────────────────────

/**
 * Apply one workflow response to the cache. This is the entire replacement for the invalidate/
 * refetch pattern: it issues NO request, and after it runs every recruitment surface — the detail
 * screen, the list row, the candidate's history and every queue badge — is showing what the server
 * just said, from the one response that said it.
 */
export const applyWorkflowEnvelope = <T extends Identified>(
  qc: QueryClient,
  feature: RecruitmentFeature,
  envelope: WorkflowEnvelopeDto<T>,
): void => {
  writeDetail(qc, feature, envelope.data);
  writeListRow(qc, feature, envelope.data);
  writeWorkflowState(qc, envelope.workflow);
  writeTimeline(qc, envelope.workflow.applicantId, envelope.timeline);
  writeCounters(qc, envelope.counters);
  markListsStale(qc, feature);
};

/**
 * The bulk counterpart (RW17). A selection spans many candidates, so the response carries no single
 * `workflow` and none of the changed rows — which is exactly why the affected list is the one thing
 * here that must be re-read. Counters and history still come from the response.
 *
 * A batch also moves candidates ACROSS stages (approving twenty screenings fills an interview
 * queue), so every recruitment list is marked stale as well. That still costs nothing now — those
 * pages re-read when they are next opened — and it is the same breadth the pre-envelope code had.
 */
export const applyBulkWorkflowResult = (
  qc: QueryClient,
  feature: RecruitmentFeature,
  result: BulkWorkflowResultDto,
): void => {
  writeCounters(qc, result.counters);
  for (const applicantId of new Set(result.timeline.produced.map((e) => e.applicantId))) {
    writeTimeline(qc, applicantId, {
      produced: result.timeline.produced.filter((e) => e.applicantId === applicantId),
      latest: [],
      total: 0,
    });
  }
  markAllRecruitmentListsStale(qc);
  // The rows themselves are not in the response, so the visible queue re-reads once — ONE request
  // for the whole batch, where the pre-envelope code refetched every mounted recruitment query.
  void qc.invalidateQueries({ queryKey: listKey(MODULE, feature) });
};
