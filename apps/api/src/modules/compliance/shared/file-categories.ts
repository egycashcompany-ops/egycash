// The module's two file categories (design §5.1), ensured by the seed and cached by id:
//
//   * the DOCUMENTS — PDF, Word and Excel, 20 MB («وحط ليميت 20M»), kept for ever;
//   * the COVERS — the picture on a folder's front, JPEG, PNG or WebP, 5 MB.
//
// Rules are fixed when a category is first ensured; a later change is an operator's
// `PATCH /platform/file-categories/:id`, never a seed change. A cached id whose category has since
// gone (removed by an operator) is dropped and ensured again, once, by the upload that met it.
import {
  COMPLIANCE_COVERS_FILE_CATEGORY,
  COMPLIANCE_COVER_MAX_MB,
  COMPLIANCE_COVER_MIMES,
  COMPLIANCE_DOCUMENTS_FILE_CATEGORY,
  COMPLIANCE_DOCUMENT_MAX_MB,
  COMPLIANCE_DOCUMENT_MIMES,
  type CreateFileCategory,
} from '@ecms/contracts';
import {
  fileCategoryService,
  fileService,
  type FileDoc,
  type UploadedBinary,
} from '../../../platform/files';
import { NotFoundError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';

export type ComplianceFileCategory = 'documents' | 'covers';

const CATEGORIES: Record<ComplianceFileCategory, CreateFileCategory> = {
  documents: {
    key: COMPLIANCE_DOCUMENTS_FILE_CATEGORY,
    name: { ar: 'ملفات الالتزام والمخاطر', en: 'Compliance and risk files' },
    allowedMimeTypes: [...COMPLIANCE_DOCUMENT_MIMES],
    maxSizeMb: COMPLIANCE_DOCUMENT_MAX_MB,
    retentionDays: null,
  },
  covers: {
    key: COMPLIANCE_COVERS_FILE_CATEGORY,
    name: { ar: 'صور مجلدات الالتزام والمخاطر', en: 'Compliance folder pictures' },
    allowedMimeTypes: [...COMPLIANCE_COVER_MIMES],
    maxSizeMb: COMPLIANCE_COVER_MAX_MB,
    retentionDays: null,
  },
};

const cached: Partial<Record<ComplianceFileCategory, string>> = {};

/** Boot-time and idempotent, so the category exists before the first upload asks for it. */
export const ensureComplianceFileCategory = async (
  which: ComplianceFileCategory,
): Promise<string> => {
  const category = await fileCategoryService.ensure(CATEGORIES[which]);
  const id = String(category._id);
  cached[which] = id;
  return id;
};

const categoryId = async (which: ComplianceFileCategory): Promise<string> =>
  cached[which] ?? ensureComplianceFileCategory(which);

/**
 * Store one file under a folder, in the category named. Files owns the bytes; the module keeps the
 * link. Filed against the FOLDER, so the folder's authorizer decides every later read of it.
 */
export const storeFolderFile = async (
  ctx: AuthContext,
  folderId: string,
  which: ComplianceFileCategory,
  displayName: string,
  binary: UploadedBinary,
): Promise<FileDoc> => {
  const attempt = async (id: string): Promise<FileDoc> =>
    fileService.upload(
      ctx,
      {
        moduleId: 'compliance',
        entityType: 'folder',
        entityId: folderId,
        categoryId: id,
        displayName,
        visibility: 'private',
        tags: [],
      },
      binary,
    );
  try {
    return await attempt(await categoryId(which));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    delete cached[which];
    return attempt(await categoryId(which));
  }
};
