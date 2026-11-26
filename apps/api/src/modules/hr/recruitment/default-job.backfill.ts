// Boot catch-up for the first-interview default job (see `placement/default-job.ts`).
//
// Candidates who reached the interviews before the default existed have no job at all. Each live
// one with an interview record and an empty job is given «أخصائي نقل أموال» now, through the same
// audited reassignment. Idempotent: a candidate with any job is never touched, so a re-run, or a
// job HR has since chosen, changes nothing.
import { logger } from '../../../infrastructure/logging/logger';
import { ApplicantModel } from './applicants/applicant.model';
import { InterviewModel } from './interviews/interview.model';
import { assignDefaultJob, findDefaultJobTitleId } from './placement';

export const backfillDefaultJobAtFirstInterview = async (): Promise<number> => {
  const jobTitleId = await findDefaultJobTitleId();
  if (jobTitleId === null) return 0;
  const interviewed = await InterviewModel.distinct('applicantId').exec();
  if (interviewed.length === 0) return 0;
  const missing = await ApplicantModel.find(
    { _id: { $in: interviewed }, status: 'new', 'placement.jobTitleId': null },
    { _id: 1 },
  )
    .lean<{ _id: unknown }[]>()
    .exec();
  let assigned = 0;
  for (const row of missing) {
    if (await assignDefaultJob(String(row._id), null, jobTitleId)) assigned += 1;
  }
  if (assigned > 0) logger.info({ assigned }, 'recruitment: default first-interview job assigned');
  return assigned;
};
