// Where a training certificate lives (P-HR-TRN D9), and who may reach it (ADR-023).
//
// ITS OWN CATEGORY, not the applicant portal's and not hiring documents'. Those hold what a
// CANDIDATE hands in before they are hired; this holds what the company ISSUES to somebody already
// employed. Two populations, two lifecycles, and an authorizer that would have to say two
// different things if they shared one.
//
// IMAGES AS WELL AS PDF, for the reason the applicant-document category gives: what arrives is
// usually a photograph of a signed certificate taken on a phone, and refusing that would mean
// asking a branch without a scanner to find one.
import {
  TRAINING_CERTIFICATE_FILE_CATEGORY,
  type CreateFileCategory,
} from '@ecms/contracts';
import { fileCategoryService, type FileEntityAuthorizer } from '../../../../platform/files';
import { hasPermission } from '../../../../shared/types';

const TRAINING_CERTIFICATE_CATEGORY: CreateFileCategory = {
  key: TRAINING_CERTIFICATE_FILE_CATEGORY,
  name: { ar: 'شهادات التدريب', en: 'Training certificates' },
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 25,
  // Null, deliberately. A training certificate is the evidence the record exists to hold, and a
  // retention window would quietly delete the proof years before anybody asks for it.
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

export const ensureTrainingCertificateCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(TRAINING_CERTIFICATE_CATEGORY);
  cachedCategoryId = String(category._id);
};

export const resolveTrainingCertificateCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const category = await fileCategoryService.ensure(TRAINING_CERTIFICATE_CATEGORY);
    cachedCategoryId = String(category._id);
  }
  return cachedCategoryId;
};

/** The entity a certificate is filed against — the RECORD, not the session or the employee. */
export const TRAINING_RECORD_ENTITY_TYPE = 'hr.trainingRecord';

/**
 * ADR-023 — HR answers «may this caller reach the owning entity?» for training certificates.
 *
 * READING follows the record: whoever may read training records may read the certificate on one,
 * because the certificate IS the record's evidence and a record without it is half an answer.
 * WRITING is the conducting key, because attaching a certificate is the last step of running a
 * session — the person who taught it is the person holding the paper.
 */
export const hrTrainingCertificateAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: TRAINING_RECORD_ENTITY_TYPE,
    authorize: ({ ctx, intent }) =>
      Promise.resolve(
        intent === 'read'
          ? hasPermission(ctx, 'trainingRecord.view')
          : hasPermission(ctx, 'trainingSession.conduct'),
      ),
  },
];
