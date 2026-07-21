// Reusable Egyptian National-ID OCR capture + review flow (module-agnostic). Consumers inject an
// extractor and receive the reviewed fields on confirm — see NationalIdOcr.
export { NationalIdOcr } from './NationalIdOcr';
export { NationalIdReviewDialog } from './NationalIdReviewDialog';
export { ocrToReview, deriveFromNationalId, mapMaritalStatus } from './mapping';
export { transliterateArabicName } from './transliterate';
export { type NationalIdReviewData, type NationalIdExtractor } from './types';
