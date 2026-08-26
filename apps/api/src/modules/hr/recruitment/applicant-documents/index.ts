// The applicant-documents feature's public surface. Nothing outside reaches past it.
export { applicantDocumentService } from './applicant-document.service';
export { applicantDocumentTypeService } from './applicant-document-type.service';
export {
  buildApplicantDocumentsRouter,
  buildApplicantPortalDocumentsRouter,
} from './applicant-document.routes';
export {
  APPLICANT_DOCUMENT_ENTITY_TYPE,
  ensureApplicantDocsCategory,
  hrApplicantDocumentFileAuthorizers,
} from './applicant-document.files';
