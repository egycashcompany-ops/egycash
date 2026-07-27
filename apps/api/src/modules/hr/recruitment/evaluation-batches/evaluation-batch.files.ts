// The Files-service category batch artifacts live under (RW8b): the generated PDF list, the ZIP
// export package, and the returned result documents. Seeded idempotently at boot and resolved
// (id cached) at upload time. Modules reach the Files service through its platform barrel
// (ADR-003).
import { EVALUATION_BATCH_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const BATCH_CATEGORY: CreateFileCategory = {
  key: EVALUATION_BATCH_FILE_CATEGORY,
  name: { ar: 'دفعات التقييم', en: 'Evaluation batches' },
  allowedMimeTypes: [
    'application/pdf',
    'application/zip',
    'image/jpeg',
    'image/png',
    'image/webp',
  ],
  // The ZIP carries every member's attachments, so the cap is well above a single document's.
  maxSizeMb: 100,
  // Batches are never purged (RW8) — the artifacts outlive every retention window.
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed of the evaluation-batch category. */
export const ensureEvaluationBatchCategory = async (): Promise<void> => {
  const cat = await fileCategoryService.ensure(BATCH_CATEGORY);
  cachedCategoryId = String(cat._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveEvaluationBatchCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(BATCH_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};
