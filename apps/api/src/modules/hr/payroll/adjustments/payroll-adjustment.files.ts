// The file category a payroll adjustment's supporting document lives in (P-HR-04).
//
// The same shape the leave-attachments and personnel-action categories use — an idempotent boot
// seed plus a lazily-resolved, cached id — because the Files service identifies a category by an
// ObjectId while the module only ever knows the KEY.
import { type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

/** The category key, and the entity type the files are owned by (ADR-023). */
export const ADJUSTMENT_ATTACHMENTS_FILE_CATEGORY = 'hr-payroll-adjustments';

/**
 * The EMPLOYEE owns the file, not the adjustment — it is uploaded before the entry that names it
 * exists, so the entry's id cannot be its owner. A type of its own keeps the authorizer this phase
 * registers from changing the rules for any file already filed against an employee.
 */
export const ADJUSTMENT_ATTACHMENT_ENTITY_TYPE = 'payrollAdjustmentAttachment';

/** A memo approving a bonus, a warning letter behind a penalty. PDFs and photographs. */
const ADJUSTMENT_ATTACHMENTS_CATEGORY: CreateFileCategory = {
  key: ADJUSTMENT_ATTACHMENTS_FILE_CATEGORY,
  name: { ar: 'مرفقات مؤثرات الرواتب', en: 'Payroll adjustment attachments' },
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  // Null on purpose: the document behind a payment is part of the payroll record, which is exactly
  // the kind of thing that must not quietly expire.
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed. */
export const ensureAdjustmentAttachmentsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(ADJUSTMENT_ATTACHMENTS_CATEGORY);
  cachedCategoryId = String(category._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveAdjustmentAttachmentsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const category = await fileCategoryService.ensure(ADJUSTMENT_ATTACHMENTS_CATEGORY);
    cachedCategoryId = String(category._id);
  }
  return cachedCategoryId;
};
