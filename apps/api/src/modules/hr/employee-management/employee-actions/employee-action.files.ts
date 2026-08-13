// The file category personnel-action documents live in (HR3-C).
//
// Same shape as the leave-attachments category — an idempotent boot seed plus a lazily-resolved,
// cached id — because the Files service identifies a category by an ObjectId while the module only
// ever knows the KEY, and something has to bridge the two exactly once.
import {
  EMPLOYEE_ACTION_ATTACHMENTS_FILE_CATEGORY,
  type CreateFileCategory,
} from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

/**
 * A resignation letter, a signed raise approval, a medical certificate behind a leave of absence.
 *
 * PDFs and photographs, since a document arrives as one or the other and nothing else here has a
 * reason to exist. Retention is `null` — an action's supporting document is part of the employment
 * record, which is exactly the kind of thing that must NOT quietly expire.
 */
const EMPLOYEE_ACTION_ATTACHMENTS_CATEGORY: CreateFileCategory = {
  key: EMPLOYEE_ACTION_ATTACHMENTS_FILE_CATEGORY,
  name: { ar: 'مرفقات إجراءات شؤون الموظفين', en: 'Personnel action attachments' },
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed. */
export const ensureEmployeeActionAttachmentsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(EMPLOYEE_ACTION_ATTACHMENTS_CATEGORY);
  cachedCategoryId = String(category._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveEmployeeActionAttachmentsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const category = await fileCategoryService.ensure(EMPLOYEE_ACTION_ATTACHMENTS_CATEGORY);
    cachedCategoryId = String(category._id);
  }
  return cachedCategoryId;
};
