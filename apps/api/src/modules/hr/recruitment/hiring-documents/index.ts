// Public surface of the Hiring Documents feature (Stage 6). The HR manifest, the seed, and
// tests import from here; internal files are not reached across the feature boundary.
export { buildHiringDocumentsRouter, buildHiringDocumentTypesRouter } from './hiring-documents.routes';
export { hiringDocumentsService } from './hiring-documents.service';
export { hiringDocumentTypeService } from './hiring-document-type.service';
export { ensureHiringDocsCategory } from './hiring-documents.files';
export { type HiringDocumentsDoc } from './hiring-documents.model';
export { type HiringDocumentTypeDoc } from './hiring-document-type.model';
