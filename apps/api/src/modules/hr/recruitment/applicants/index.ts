// Public surface of the Applicants feature (Sprint 4.1). The HR manifest and tests
// import from here; internal files are not reached across the feature boundary.
export { buildApplicantsRouter, buildApplicantSourcesRouter } from './applicant.routes';
export { applicantService } from './applicant.service';
export { applicantSourceService } from './applicant-source.service';
export { type ApplicantDoc } from './applicant.model';
export { type ApplicantSourceDoc } from './applicant-source.model';
// Swappable seams (OQ-30) — exported so a real provider (or a test double) can be wired.
export {
  setNationalIdOcrProvider,
  resetNationalIdOcrProvider,
  type NationalIdOcrProvider,
} from './national-id-ocr';
export {
  setRequisitionValidator,
  resetRequisitionValidator,
  type RequisitionReferenceValidator,
} from './requisition-ref';
