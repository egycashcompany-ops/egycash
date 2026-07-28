// TanStack Query hooks for the candidate timeline (ADR-013). The timeline is THE recruitment
// history (I5): workflow acts write their entries into it from the envelope they answer with (I6),
// and the one entry a user authors directly — a note — is written here from its own response.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AddTimelineNote, type RecruitmentTimelineEntryDto } from '@ecms/contracts';
import { addRecruitmentTimelineNote, listRecruitmentTimeline, type TimelineParams } from './timeline-api';
import { mergeTimelineEntries, timelineKey } from './timeline-cache';

export { timelineKey };

export const useRecruitmentTimeline = (applicantId: string, params: TimelineParams = {}) =>
  useQuery({
    queryKey: timelineKey(applicantId, params),
    queryFn: () => listRecruitmentTimeline(applicantId, params),
    enabled: applicantId !== '',
  });

/**
 * A note changes the history and nothing else — no stage moves, no counter shifts — so the entry
 * the server answers with is merged straight into every cached view of this candidate's timeline.
 * Nothing is refetched: the response already IS the new entry.
 */
export const useAddTimelineNote = (applicantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddTimelineNote) => addRecruitmentTimelineNote(applicantId, body),
    onSuccess: (entry) => {
      qc.setQueriesData<RecruitmentTimelineEntryDto[]>(
        { queryKey: timelineKey(applicantId) },
        (cached) => (cached === undefined ? cached : mergeTimelineEntries(cached, [entry])),
      );
    },
  });
};
