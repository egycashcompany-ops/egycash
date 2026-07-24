// Files-service category for leave attachments (medical certificates, supporting documents).
// PDFs + images, seeded idempotently, resolved (cached) at upload time — mirrors the
// hiring-documents pattern.
import { LEAVE_ATTACHMENTS_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const LEAVE_ATTACHMENTS_CATEGORY: CreateFileCategory = {
  key: LEAVE_ATTACHMENTS_FILE_CATEGORY,
  name: { ar: 'مرفقات الإجازات', en: 'Leave attachments' },
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed of the leave-attachments category. */
export const ensureLeaveAttachmentsCategory = async (): Promise<void> => {
  const cat = await fileCategoryService.ensure(LEAVE_ATTACHMENTS_CATEGORY);
  cachedCategoryId = String(cat._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveLeaveAttachmentsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(LEAVE_ATTACHMENTS_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};
