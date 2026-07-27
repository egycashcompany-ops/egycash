// Boot migration for the Electronic Employee File (I8: automatic, idempotent, no manual step;
// safe on every boot).
//
// I5 — files assembled before the canonical recruitment timeline existed carry FOUR re-derived
// recruitment milestones on their own timeline (`applicantRegistered`, `screeningAccepted`,
// `interviewPassed`, `offerAccepted`). That is a second history of the same events, and a second
// history is exactly what I5 forbids: the two drift the moment a return-to-stage, a re-decision
// or a withdrawal rewrites the pipeline, and the file then shows a past that never happened.
//
// The entries are pulled out rather than rewritten. Nothing is lost: every one of them is a
// projection of a workflow event that `hr_recruitment_timeline` already holds, and the file now
// reads that collection at request time. The file's own post-hire entries — the hire, the
// completed hiring case, the file being opened, and any notes — are untouched.
import { EmployeeFileModel } from './employee-file.model';

/** The re-derived recruitment milestones. No longer written, and no longer part of the enum. */
const DERIVED_RECRUITMENT_TYPES = [
  'applicantRegistered',
  'screeningAccepted',
  'interviewPassed',
  'offerAccepted',
];

export const migrateEmployeeFiles = async (): Promise<void> => {
  await EmployeeFileModel.updateMany(
    { 'timeline.type': { $in: DERIVED_RECRUITMENT_TYPES } },
    { $pull: { timeline: { type: { $in: DERIVED_RECRUITMENT_TYPES } } } },
  ).exec();
};
