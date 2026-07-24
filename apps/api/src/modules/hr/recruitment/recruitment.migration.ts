// Boot migration for recruitment-era legacy documents (idempotent; safe on every boot).
//
// ① `hr_applicants` — fields added after the first applicant release do not exist on old
//    documents, and `.lean()` reads skip schema defaults; one missing `movedToOfferAt` used
//    to 500 the whole applicants list. Each late-added field is backfilled to its schema
//    default, guarded by `$exists: false` so re-runs are no-ops.
// ② Stage collections (screenings, interviews, evaluations, job offers) predate the
//    denormalized `applicantName` — tables showed bare codes. Backfilled from the applicant
//    registry so every list shows the person's display name without a join.
import { ApplicantModel } from './applicants/applicant.model';
import { ScreeningModel } from './screening/screening.model';
import { InterviewModel } from './interviews/interview.model';
import { EvaluationModel } from './evaluations/evaluation.model';
import { JobOfferModel } from './job-offers/job-offer.model';

const APPLICANT_FIELD_DEFAULTS: Record<string, unknown> = {
  jobRequisitionId: null,
  branchId: null,
  sourceDetail: null,
  intakeChannel: 'internal',
  intakeKey: null,
  expectedSalary: null,
  earliestStartDate: null,
  willingToRelocate: false,
  willingToTravel: false,
  willingToShiftWork: false,
  externalRef: null,
  identityVerification: 'unverified',
  identityVerifiedBy: null,
  identityVerifiedAt: null,
  fullNameEn: null,
  nationalId: null,
  birthDate: null,
  gender: null,
  placeOfBirth: null,
  photoFileId: null,
  maritalStatus: null,
  religion: null,
  nationalIdExpiry: null,
  dependentsCount: null,
  officialAddress: null,
  currentAddress: null,
  military: null,
  education: null,
  experience: [],
  drivingLicenses: [],
  certifications: [],
  references: [],
  duplicateFlag: false,
  duplicateOf: [],
  attachmentCount: 0,
  withdrawnReason: null,
  withdrawnAt: null,
  movedToOfferAt: null,
  movedToOfferBy: null,
};

export const migrateRecruitmentLegacy = async (): Promise<void> => {
  // ① Applicant field backfill — one targeted update per late-added field.
  for (const [field, value] of Object.entries(APPLICANT_FIELD_DEFAULTS)) {
    await ApplicantModel.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } })
      .exec();
  }

  // ② Denormalized applicant display name on the stage collections.
  const stageModels = [ScreeningModel, InterviewModel, EvaluationModel, JobOfferModel] as const;
  for (const model of stageModels) {
    const missing = await model.exists({ applicantName: { $exists: false } });
    if (missing === null) continue;
    const applicants = await ApplicantModel.find({}, { fullNameAr: 1 }).lean().exec();
    for (const applicant of applicants) {
      await model
        .updateMany(
          { applicantId: applicant._id, applicantName: { $exists: false } },
          { $set: { applicantName: applicant.fullNameAr } },
        )
        .exec();
    }
    // Orphans (applicant hard-gone): empty display name rather than a missing field.
    await model
      .updateMany({ applicantName: { $exists: false } }, { $set: { applicantName: '' } })
      .exec();
  }
};
