// Where a medical certificate lives (P-HR-MED D3, D9), and who may reach it (ADR-023).
//
// ITS OWN CATEGORY, and that is D3 reaching the file layer. Training certificates are readable by
// whoever may read a training record; hiring documents by whoever may read a personnel file. A
// medical certificate is readable by `medicalRecord.view` and by nothing else — and a shared
// category would have to answer «who may reach this file» two different ways depending on which
// entity it hung off, which is not a thing an authorizer can do.
import { MEDICAL_DOCUMENT_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../../platform/files';
import { hasPermission } from '../../../../shared/types';

const MEDICAL_DOCUMENT_CATEGORY: CreateFileCategory = {
  key: MEDICAL_DOCUMENT_FILE_CATEGORY,
  name: { ar: 'مستندات طبية', en: 'Medical documents' },
  // A scan or a phone photograph of a signed certificate, the same shapes every other certificate
  // category accepts — a branch without a scanner should not be unable to file one.
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 25,
  // NULL, and here it matters more than anywhere else. A medical certificate is the evidence behind
  // a fitness verdict, and a retention window would delete the proof of why somebody was assessed
  // the way they were — years before the dispute that needs it.
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

export const ensureMedicalDocumentCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(MEDICAL_DOCUMENT_CATEGORY);
  cachedCategoryId = String(category._id);
};

export const resolveMedicalDocumentCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const category = await fileCategoryService.ensure(MEDICAL_DOCUMENT_CATEGORY);
    cachedCategoryId = String(category._id);
  }
  return cachedCategoryId;
};

/** The entity a certificate is filed against — the EVENT it documents. */
export const MEDICAL_EVENT_ENTITY_TYPE = 'hr.medicalEvent';

/**
 * ADR-023 — HR answers «may this caller reach the owning entity?».
 *
 * BOTH INTENTS ASK FOR A MEDICAL KEY, and neither asks for an employee one (D3). Reading follows
 * `medicalRecord.view` because the document IS the event's evidence and an event without it is half
 * an answer; writing follows `medicalRecord.manage`, which is the key that records events at all.
 */
export const hrMedicalDocumentAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: MEDICAL_EVENT_ENTITY_TYPE,
    authorize: ({ ctx, intent }) =>
      Promise.resolve(
        intent === 'read'
          ? hasPermission(ctx, 'medicalRecord.view')
          : hasPermission(ctx, 'medicalRecord.manage'),
      ),
  },
];
