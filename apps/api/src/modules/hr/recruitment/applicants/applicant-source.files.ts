// The Files-service category an applicant source's icon lives under.
//
// There is no upload endpoint of our own: an icon goes up through the platform's `POST
// /platform/files` like every other file, and the source keeps the id it gets back. All this
// module contributes is the category — which is where the "PNG or SVG, and small" rule lives, so
// the same validation runs whoever does the uploading.
import { APPLICANT_SOURCE_ICON_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const ICON_CATEGORY: CreateFileCategory = {
  key: APPLICANT_SOURCE_ICON_FILE_CATEGORY,
  name: { ar: 'أيقونات مصادر التقديم', en: 'Applicant source icons' },
  allowedMimeTypes: ['image/png', 'image/svg+xml'],
  maxSizeMb: 2,
  retentionDays: null,
};

/** Boot-time idempotent seed. */
export const ensureApplicantSourceIconCategory = async (): Promise<void> => {
  await fileCategoryService.ensure(ICON_CATEGORY);
};
