// The CV a candidate attaches on the public application page: a PDF, a Word file or a photo of it.
// Its own category because a CV is not a card photo (the card category takes images only) and not a
// portal certificate — and because the files service enforces type and size per category.
import { type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const APPLICANT_CV_CATEGORY: CreateFileCategory = {
  key: 'hr-applicant-cv',
  name: { ar: 'السيرة الذاتية للمتقدمين', en: 'Applicant CVs' },
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
  maxSizeMb: 10,
  retentionDays: null,
};

export const APPLICANT_CV_MIME_TYPES: readonly string[] = APPLICANT_CV_CATEGORY.allowedMimeTypes ?? [];

let cachedCategoryId: string | null = null;

/** The category id (ensured and cached on first use). */
export const resolveApplicantCvCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(APPLICANT_CV_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};
