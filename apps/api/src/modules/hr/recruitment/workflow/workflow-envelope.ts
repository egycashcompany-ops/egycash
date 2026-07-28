// The response EVERY recruitment workflow endpoint returns (I6).
//
//   { data, workflow, timeline, counters }
//
// One shape, built one way, so the frontend never issues a follow-up request to learn what just
// happened — and, just as importantly, so it cannot get a DIFFERENT answer from the follow-up than
// the action actually produced. The old pattern (mutate, then invalidate seven query subtrees and
// refetch) had exactly that race: two requests, two moments, two truths.
//
// `timeline.produced` is what THIS action wrote, resolved from the entry ids reported into the
// capture scope — not "entries written since I started", which a concurrent request on the same
// candidate would poison.
import {
  type BulkActionResultDto,
  type BulkWorkflowResultDto,
  type StageCountDto,
  type WorkflowEnvelopeDto,
} from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { captureTimelineEntries, recruitmentTimelineService, timelineSummaryDto } from '../timeline';
import { buildWorkflowState } from './workflow-state';

/** How many recent entries ride along, so a timeline view renders without asking again. */
const LATEST_ENTRIES = 20;

/**
 * The workflow state a caller with no candidate in scope gets. It is never invented: the only way
 * to reach this is a workflow action whose applicant could not be read, which is a bug worth
 * seeing as an obviously empty state rather than a plausible wrong one.
 */
const UNKNOWN_STATE = {
  applicantId: '',
  applicantCode: '',
  applicantStatus: 'unknown',
  stage: null,
  status: null,
  attempt: 1,
  placement: { jobPositionId: null, jobTitleId: null, departmentId: null, branchId: null, sectionId: null },
  placementLabel: { position: null, branch: null, department: null },
  availableActions: [],
};

const countersFor = async (ctx: AuthContext): Promise<StageCountDto[]> => {
  // Loaded dynamically: the counters read every stage barrel, and every stage barrel imports this
  // folder, so a static import would close the cycle. The same acyclic-by-deferral trick the
  // Employee profile timeline uses to reach the Employee File.
  //
  // A failure here must not fail the action that already committed, so it degrades to "unchanged"
  // (BD-007) — the client keeps the counters it had rather than losing them to a read error.
  try {
    const { stageCountsService } = await import('../counters');
    const page = await stageCountsService.list(ctx, { branchId: undefined });
    return page.stages;
  } catch {
    return [];
  }
};

/**
 * Run a workflow action and answer with the full envelope. The action's own return value becomes
 * `data`; everything else is derived here, once, for every endpoint.
 *
 * `applicantIdOf` runs AFTER the action, because for a create the candidate is only known from the
 * result.
 */
export const withWorkflowEnvelope = async <TDoc, TDto>(
  ctx: AuthContext,
  action: () => Promise<TDoc>,
  toDto: (doc: TDoc) => TDto,
  applicantIdOf: (doc: TDoc) => string,
): Promise<WorkflowEnvelopeDto<TDto>> => {
  const { result, entryIds } = await captureTimelineEntries(action);
  const applicantId = applicantIdOf(result);

  const [state, produced, latest, total, counters] = await Promise.all([
    buildWorkflowState(ctx, applicantId),
    recruitmentTimelineService.findByEventIds(entryIds),
    recruitmentTimelineService.listForApplicant(applicantId, { includeSuperseded: true }, LATEST_ENTRIES),
    recruitmentTimelineService.countForApplicant(applicantId),
    countersFor(ctx),
  ]);

  return {
    data: toDto(result),
    workflow: state ?? UNKNOWN_STATE,
    timeline: timelineSummaryDto(produced, latest, total),
    counters,
  };
};

/**
 * The bulk counterpart (I6/RW17): the partial-success envelope the act produced, plus the entries
 * the whole batch wrote and the refreshed counters. There is no per-candidate `workflow` here —
 * a selection has no single state — which is exactly what `BulkWorkflowResultDto` declares.
 */
export const withBulkWorkflowEnvelope = async (
  ctx: AuthContext,
  action: () => Promise<BulkActionResultDto>,
): Promise<BulkWorkflowResultDto> => {
  const { result, entryIds } = await captureTimelineEntries(action);
  const [produced, counters] = await Promise.all([
    recruitmentTimelineService.findByEventIds(entryIds),
    countersFor(ctx),
  ]);
  return {
    ...result,
    // `latest` is per-candidate and a bulk act spans many, so the batch reports only what it wrote.
    timeline: timelineSummaryDto(produced, [], produced.length),
    counters,
  };
};
