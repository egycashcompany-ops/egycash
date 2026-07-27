// ONE invalidation helper for the whole recruitment module. Every recruitment mutation calls it,
// so the stage queues, the aggregated counters and the candidate timeline refresh together and
// can never disagree about what just happened.
import { type QueryClient } from '@tanstack/react-query';

const MODULE = 'hr';

/** The recruitment query subtrees a mutation can affect, in one place. */
const SUBTREES = [
  'applicants',
  'screenings',
  'interviews',
  'evaluations',
  'jobOffers',
  'recruitmentTimeline',
  'recruitmentStageCounts',
] as const;

export const invalidateRecruitment = (qc: QueryClient): void => {
  for (const feature of SUBTREES) {
    void qc.invalidateQueries({ queryKey: [MODULE, feature] });
  }
};
