// The Files-service category the Electronic Employee File's documents live under — both the
// independent copies made from the hiring documents at assembly and any custom HR uploads.
// Seeded idempotently at boot and resolved (id cached) at use time. PDF + common image types
// are accepted so custom documents (scans, photos) are supported. Modules reach the Files
// service through its platform barrel (ADR-003).
import { EMPLOYEE_FILE_DOCUMENT_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const EMPLOYEE_FILE_CATEGORY: CreateFileCategory = {
  key: EMPLOYEE_FILE_DOCUMENT_CATEGORY,
  name: { ar: 'مستندات ملف الموظف', en: 'Employee file documents' },
  allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
  maxSizeMb: 20,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed of the employee-file documents category. */
export const ensureEmployeeFileCategory = async (): Promise<void> => {
  const cat = await fileCategoryService.ensure(EMPLOYEE_FILE_CATEGORY);
  cachedCategoryId = String(cat._id);
};

/** The category id for copies/uploads (ensures + caches on first use). */
export const resolveEmployeeFileCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(EMPLOYEE_FILE_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};
