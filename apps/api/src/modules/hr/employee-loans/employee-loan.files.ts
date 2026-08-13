// The file category a loan's supporting document lives in (P-HR-05).
//
// The same shape the personnel-action and payroll-adjustment categories use — an idempotent boot
// seed plus a lazily-resolved, cached id — because the Files service identifies a category by an
// ObjectId while the module only ever knows the KEY.
import { type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../platform/files';

/** The category key, and the entity type the files are owned by (ADR-023). */
export const LOAN_ATTACHMENTS_FILE_CATEGORY = 'hr-employee-loans';

/**
 * The EMPLOYEE owns the file, not the loan — it is uploaded before the request that names it
 * exists, so the request's id cannot be its owner. A type of its own keeps the authorizer this
 * phase registers from changing the rules for any file already filed against an employee.
 */
export const LOAN_ATTACHMENT_ENTITY_TYPE = 'employeeLoanAttachment';

/** The signed request behind a loan, the receipt behind an external settlement. */
const LOAN_ATTACHMENTS_CATEGORY: CreateFileCategory = {
  key: LOAN_ATTACHMENTS_FILE_CATEGORY,
  name: { ar: 'مرفقات قروض وسلف الموظفين', en: 'Employee loan attachments' },
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeMb: 10,
  // Null on purpose: the document behind a debt is part of its record, and a debt outlives any
  // retention window somebody would pick for it.
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed. */
export const ensureLoanAttachmentsCategory = async (): Promise<void> => {
  const category = await fileCategoryService.ensure(LOAN_ATTACHMENTS_CATEGORY);
  cachedCategoryId = String(category._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveLoanAttachmentsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const category = await fileCategoryService.ensure(LOAN_ATTACHMENTS_CATEGORY);
    cachedCategoryId = String(category._id);
  }
  return cachedCategoryId;
};
