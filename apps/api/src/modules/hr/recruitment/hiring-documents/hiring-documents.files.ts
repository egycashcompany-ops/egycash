// The Files-service category hiring-document PDFs live under. Seeded idempotently at boot and
// resolved (id cached) at upload time — a PDF-only category so intake validation rejects
// non-PDF uploads. Modules reach the Files service through its platform barrel (ADR-003).
import { HIRING_DOCUMENTS_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const HIRING_DOCS_CATEGORY: CreateFileCategory = {
  key: HIRING_DOCUMENTS_FILE_CATEGORY,
  name: { ar: 'مستندات التعيين', en: 'Hiring documents' },
  allowedMimeTypes: ['application/pdf'],
  maxSizeMb: 20,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;

/** Boot-time idempotent seed of the hiring-documents PDF category. */
export const ensureHiringDocsCategory = async (): Promise<void> => {
  const cat = await fileCategoryService.ensure(HIRING_DOCS_CATEGORY);
  cachedCategoryId = String(cat._id);
};

/** The category id for uploads (ensures + caches on first use). */
export const resolveHiringDocsCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(HIRING_DOCS_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};
