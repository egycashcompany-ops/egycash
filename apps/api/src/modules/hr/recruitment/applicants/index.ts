// Public surface of the Applicants feature (Sprint 4.1). The HR manifest and tests
// import from here; internal files are not reached across the feature boundary.
export { buildApplicantsRouter, buildApplicantSourcesRouter } from './applicant.routes';
export { applicantService } from './applicant.service';
// RW1/RW4 — the shared placement resolver: stage features validate + label a recommendation
// with exactly the same rules the applicant's own placement uses.
export { resolvePlacement, changedDimensions, type PlacementInput } from './placement-resolver';
export { applicantSourceService } from './applicant-source.service';
export { ensureApplicantSourceIconCategory } from './applicant-source.files';
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
export {
  setStageMaterializer,
  resetStageMaterializer,
  type StageMaterializer,
} from './stage-materializer-seam';
export {
  registerNationalIdOcrProvider,
  resetNationalIdOcrProviderRegistration,
} from './register-ocr-provider';
export { PaddleNationalIdOcrProvider } from './paddle-ocr-provider';
