// The internal pipeline, translated into the six words a candidate may read (D-APP-8).
//
// THIS FILE IS A NARROWING, AND THAT IS ITS WHOLE JOB. `buildWorkflowState` answers the same
// question for a recruiter and answers far more with it — the concrete interview stage by name,
// the attempt number, the row's status, the actions the reader may take. Every one of those is a
// fact about how the company is handling this person, and handing them to the person themselves
// turns a status page into a window on an internal process.
//
// So the portal does NOT reuse that reader. It takes the two coarsest facts — has the candidate
// left the pipeline, and which stage kind still has open work — and maps them onto a closed
// vocabulary. A leak has to be added here on purpose; it cannot arrive by somebody widening a DTO
// three files away.
import {
  type ApplicantPortalStep,
  type ApplicantStatus,
  type RecruitmentStageKind,
} from '@ecms/contracts';

/**
 * Stage kind → the candidate's word for it.
 *
 * Total over `RECRUITMENT_STAGE_KINDS` on purpose: a seventh internal stage added next year fails
 * to compile here until somebody decides what a candidate should be told about it, which is the
 * one moment that decision is cheap to make.
 */
const STEP_BY_STAGE: Readonly<Record<RecruitmentStageKind, ApplicantPortalStep>> = {
  // Both of these mean somebody sent the candidate BACK — a portal account only exists because a
  // screening was accepted (D-APP-2), so an open intake or screening row is a return, not a first
  // pass. `applied` is the truthful word for it: their application is being looked at, and nothing
  // is decided.
  applicants: 'applied',
  screening: 'applied',
  interview: 'interview',
  // «تحت الفحص» — the security check and the driving test, which the candidate is told they are
  // undergoing and never told the result of.
  evaluation: 'assessment',
  jobOffer: 'jobOffer',
  employeesReady: 'hired',
};

/**
 * Where this candidate stands.
 *
 * The terminal statuses win over any stage row, because a candidate who has left the pipeline
 * stands nowhere in it — their rows all carry terminal statuses, which is exactly how they left
 * every queue. `withdrawn` maps to `rejected` deliberately: the portal has one word for «this is
 * over», and a person who withdrew does not need their own screen to tell them they withdrew.
 *
 * `stageKind === null` with a live status is `screeningPassed`, and that floor is a fact about WHO
 * calls this: a portal account exists only because a screening was accepted, so a candidate with
 * nothing open has passed screening and is waiting for the next stage to be opened for them.
 * Answering `applied` there would tell somebody who cleared screening that nothing had happened
 * yet — the one reading this screen is the person who knows better.
 */
export const portalStepOf = (
  applicantStatus: ApplicantStatus,
  stageKind: RecruitmentStageKind | null,
): ApplicantPortalStep => {
  if (applicantStatus === 'hired') return 'hired';
  if (applicantStatus === 'rejected' || applicantStatus === 'withdrawn') return 'rejected';
  if (stageKind === null) return 'screeningPassed';
  return STEP_BY_STAGE[stageKind];
};

/** Is the pipeline over for them, either way? Nothing more is coming, and the screen says so. */
export const isTerminalStep = (step: ApplicantPortalStep): boolean =>
  step === 'hired' || step === 'rejected';

/**
 * The steps to draw, in order, for a candidate at this one.
 *
 * A refused candidate gets the single terminal word and NOT a progress bar with a red cross two
 * thirds along it: showing them how far they got before being turned down is a cruelty the design
 * has no use for.
 */
export const stepsToDraw = (step: ApplicantPortalStep): ApplicantPortalStep[] =>
  step === 'rejected'
    ? ['rejected']
    : ['applied', 'screeningPassed', 'interview', 'assessment', 'jobOffer', 'hired'];
