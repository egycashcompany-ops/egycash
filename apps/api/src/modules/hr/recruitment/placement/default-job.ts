// The default job at the first interview: «أخصائي نقل أموال».
//
// Nearly every candidate is hired as a cash-in-transit specialist, so HR asked for that job to be
// filled in for them rather than chosen by hand each time. It is a DEFAULT, not a rule: it is only
// written when the candidate has no job yet, and HR changes it with the ordinary «اقتراح وظيفة وفرع»
// action like any other placement.
//
// The write is an ordinary audited reassignment (placement history, timeline, audit, scope sync),
// so the default is visible on the candidate's history as the move that put them in the job.
import { Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { jobTitleService } from '../../../../platform/organization';
import { BusinessRuleError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { jobKey } from '../../shared/job-match';
import { applicantService } from '../applicants';
import { onWorkflowEvent, WorkflowEvents } from '../workflow';
import { reassignPlacement } from './placement.service';

/** The job every candidate starts the first interview in, matched by its Arabic name. */
export const DEFAULT_FIRST_INTERVIEW_JOB = 'أخصائي نقل أموال';

export const DEFAULT_JOB_REASON = 'الوظيفة الافتراضية عند المقابلة الأولى';

const systemCtx = (userId: string): AuthContext => ({
  userId,
  sessionId: 'system',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {},
  permissionVersion: 0,
  isPrivileged: true,
});

const systemScope = (userId: string): ScopeSelector => ({
  scope: 'organization',
  userId,
  branchId: null,
  departmentId: null,
  sectionId: null,
});

/**
 * The catalog id of «أخصائي نقل أموال», or null when the catalog has no such job.
 *
 * Matched by folded name («أخصائى نقل اموال» meets «أخصائي نقل أموال»). An exact name wins over a
 * longer one in the same family («أخصائي نقل أموال أول»), which is only used when it is the sole
 * match.
 */
export const findDefaultJobTitleId = async (): Promise<string | null> => {
  const options = await jobTitleService.options();
  const wanted = jobKey(DEFAULT_FIRST_INTERVIEW_JOB);
  const exact = options.find((o) => jobKey(o.name.ar) === wanted);
  if (exact !== undefined) return exact.id;
  const family = options.filter((o) => jobKey(o.name.ar).startsWith(`${wanted} `));
  return family.length === 1 ? (family[0]?.id ?? null) : null;
};

/**
 * Put a candidate in the default job when they have none.
 *
 * Returns true when the job was written. Never throws: a missing catalog entry, a candidate who
 * left the pipeline, or a concurrent edit simply leaves the placement as it was.
 */
export const assignDefaultJob = async (
  applicantId: string,
  actorUserId: string | null,
  jobTitleId?: string | null,
): Promise<boolean> => {
  try {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return false;
    if (applicant.placement.jobTitleId !== null) return false;
    const job = jobTitleId === undefined ? await findDefaultJobTitleId() : jobTitleId;
    if (job === null) {
      logger.warn({ applicantId }, `default job «${DEFAULT_FIRST_INTERVIEW_JOB}» is not in the job-title catalog`);
      return false;
    }
    const actor =
      actorUserId ??
      (applicant.createdBy === null || applicant.createdBy === undefined
        ? String(new Types.ObjectId())
        : String(applicant.createdBy));
    const str = (v: Types.ObjectId | null): string | null => (v === null ? null : String(v));
    await reassignPlacement(
      systemCtx(actor),
      applicantId,
      {
        placement: {
          jobTitleId: job,
          departmentId: str(applicant.placement.departmentId),
          branchId: str(applicant.placement.branchId),
          sectionId: str(applicant.placement.sectionId),
        },
        reason: DEFAULT_JOB_REASON,
        source: 'interview',
        version: applicant.__v,
      },
      systemScope(actor),
    );
    return true;
  } catch (error) {
    // A candidate whose job is locked (an accepted offer) simply keeps it — expected, not a fault.
    if (error instanceof BusinessRuleError) return false;
    logger.warn({ err: error, applicantId }, 'default job at the first interview was not assigned');
    return false;
  }
};

let registered = false;

/** A candidate whose screening is accepted enters the first interview — in the default job. */
export const registerDefaultJobAtFirstInterview = (): void => {
  if (registered) return;
  registered = true;
  onWorkflowEvent('recruitment.defaultJob', '*', async (event) => {
    if (event.name !== WorkflowEvents.ScreeningAccepted && event.name !== WorkflowEvents.ScreeningRedecided) return;
    if (event.to !== 'accepted') return;
    await assignDefaultJob(
      String(event.applicantId),
      event.actorUserId === null || event.actorUserId === undefined ? null : String(event.actorUserId),
    );
  });
};

/** Test seam. */
export const resetDefaultJobRegistration = (): void => {
  registered = false;
};
