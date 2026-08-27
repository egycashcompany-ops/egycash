// The one way a recruitment mutation is written (I6). Every hook in every recruitment feature goes
// through here, so the envelope is applied to the cache exactly once, in exactly one way, and no
// feature can quietly reintroduce a follow-up refetch of its own.
//
// The hook resolves to the aggregate — `envelope.data` — because that is what a caller means when
// it says "the screening I just created". The other three halves are not the caller's business:
// they are the cache's, and they have already been applied by the time this promise settles.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type WorkflowEnvelopeDto, type WorkflowStateDto } from '@ecms/contracts';
import { get } from '../../../../shared/lib/api-client';
import {
  applyBulkWorkflowResult,
  applyWorkflowEnvelope,
  workflowStateKey,
  type RecruitmentFeature,
} from './workflow-cache';

interface Identified {
  id: string;
}

export const useWorkflowMutation = <TInput, TDto extends Identified>(
  feature: RecruitmentFeature,
  run: (input: TInput) => Promise<WorkflowEnvelopeDto<TDto>>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TInput): Promise<TDto> => {
      const envelope = await run(input);
      applyWorkflowEnvelope(qc, feature, envelope);
      return envelope.data;
    },
  });
};

/**
 * Where the candidate stands right now (I6/I10).
 *
 * READ-THROUGH, and the same key `applyWorkflowEnvelope` writes after every mutation. Acting on a
 * candidate still updates this instantly from the response — the server derives the state and says
 * so, exactly as I6 requires — and now a screen that has NOT acted can also ask.
 *
 * That gap used to matter: with no way to read it, every detail page drew the pipeline bar from its
 * own name, so opening a candidate from the interview queue showed them at «interview» even when an
 * offer was already out. Nothing here derives workflow state on the client; it fetches the same
 * answer from the same builder.
 */
export const useWorkflowState = (applicantId: string): WorkflowStateDto | undefined =>
  useQuery<WorkflowStateDto>({
    queryKey: workflowStateKey(applicantId),
    queryFn: () => get<WorkflowStateDto>(`/hr/applicants/${applicantId}/workflow-state`),
    enabled: applicantId !== '',
    staleTime: 30_000,
  }).data;

export { applyBulkWorkflowResult, applyWorkflowEnvelope, workflowStateKey };
export type { RecruitmentFeature };
