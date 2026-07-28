// How the candidate timeline lives in the query cache: its key, and the rule for folding new
// entries into an already-cached history.
//
// Both live here rather than beside the hooks because the timeline is THE recruitment history (I5)
// and every workflow response carries a slice of it — so the module that applies envelopes
// (`shared/workflow-cache.ts`) needs the same key and the same merge rule the timeline's own hooks
// use. Keeping them in a leaf module lets it import them without the two files importing each
// other.
import { type RecruitmentTimelineEntryDto } from '@ecms/contracts';
import { type TimelineParams } from './timeline-api';

const MODULE = 'hr';
const FEATURE = 'recruitmentTimeline';

/**
 * `[hr, recruitmentTimeline, applicantId]` — with the fetch params appended for a filtered view.
 * The prefix form matches every cached view of one candidate's history at once.
 */
export const timelineKey = (applicantId: string, params?: TimelineParams): readonly unknown[] =>
  params === undefined ? [MODULE, FEATURE, applicantId] : [MODULE, FEATURE, applicantId, params];

/**
 * Newest first, one entry per `eventId` — the order and identity the timeline endpoint itself uses
 * (I9). An incoming entry replaces a cached one with the same id rather than appearing twice, so
 * re-applying the same response is harmless.
 */
export const mergeTimelineEntries = (
  cached: RecruitmentTimelineEntryDto[],
  incoming: RecruitmentTimelineEntryDto[],
): RecruitmentTimelineEntryDto[] => {
  const byId = new Map(cached.map((entry) => [entry.eventId, entry]));
  for (const entry of incoming) byId.set(entry.eventId, entry);
  return [...byId.values()].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
};
