// The Files-service category evaluation attachments live under. Seeded idempotently at boot and
// resolved (id cached) at upload time. Broader than hiring documents — security/medical/driving
// evidence is commonly a scan or a photo — so PDFs and common image types are accepted. Modules
// reach the Files service through its platform barrel (ADR-003).
import { EVALUATION_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const EVALUATION_CATEGORY: CreateFileCategory = {
  key: EVALUATION_FILE_CATEGORY,
  name: { ar: 'مرفقات التقييم', en: 'Evaluation attachments' },
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 25,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed of the evaluation attachments category. */
export const ensureEvaluationCategory = async (): Promise<void> => {
  const cat = await fileCategoryService.ensure(EVALUATION_CATEGORY);
  cachedCategoryId = String(cat._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveEvaluationCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(EVALUATION_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};
