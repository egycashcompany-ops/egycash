// The one way a recruitment mutation is written (I6). Every hook in every recruitment feature goes
// through here, so the envelope is applied to the cache exactly once, in exactly one way, and no
// feature can quietly reintroduce a follow-up refetch of its own.
//
// The hook resolves to the aggregate — `envelope.data` — because that is what a caller means when
// it says "the screening I just created". The other three halves are not the caller's business:
// they are the cache's, and they have already been applied by the time this promise settles.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type WorkflowEnvelopeDto, type WorkflowStateDto } from '@ecms/contracts';
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
 * Where the candidate stands right now, as the last workflow response reported it (I6/I10).
 *
 * There is no `queryFn`: this key is never fetched, only written — by `applyWorkflowEnvelope` after
 * every mutation. A screen that has not yet acted simply has no entry, which is the honest answer;
 * inventing one would mean deriving workflow state on the client, and the whole point of I6 is that
 * the server derives it and says so.
 */
export const useWorkflowState = (applicantId: string): WorkflowStateDto | undefined =>
  useQuery<WorkflowStateDto>({
    queryKey: workflowStateKey(applicantId),
    enabled: false,
    staleTime: Infinity,
  }).data;

export { applyBulkWorkflowResult, applyWorkflowEnvelope, workflowStateKey };
export type { RecruitmentFeature };
