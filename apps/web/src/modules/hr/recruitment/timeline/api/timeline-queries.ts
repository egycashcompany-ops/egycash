// TanStack Query hooks for the candidate timeline (ADR-013). The timeline is THE recruitment
// history (I5), so every recruitment mutation invalidates it through `invalidateRecruitment()`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AddTimelineNote } from '@ecms/contracts';
import { addRecruitmentTimelineNote, listRecruitmentTimeline, type TimelineParams } from './timeline-api';
import { invalidateRecruitment } from '../../shared/invalidate-recruitment';

const MODULE = 'hr';
const FEATURE = 'recruitmentTimeline';

export const timelineKey = (applicantId: string, params?: TimelineParams): readonly unknown[] =>
  params === undefined ? [MODULE, FEATURE, applicantId] : [MODULE, FEATURE, applicantId, params];

export const useRecruitmentTimeline = (applicantId: string, params: TimelineParams = {}) =>
  useQuery({
    queryKey: timelineKey(applicantId, params),
    queryFn: () => listRecruitmentTimeline(applicantId, params),
    enabled: applicantId !== '',
  });

export const useAddTimelineNote = (applicantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddTimelineNote) => addRecruitmentTimelineNote(applicantId, body),
    onSuccess: () => invalidateRecruitment(qc),
  });
};
