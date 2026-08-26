// The Files-service category that marks an attachment as a National-ID card image.
//
// WHY A CATEGORY AND NOT TWO FIELDS ON THE APPLICANT. The security-check package prints one card
// per page after its list, so something has to say which of an applicant's attachments is the
// card. Filing a document by KIND is what this system already does everywhere else; it survives a
// replacement (a re-scan is another file in the same category, not a column to overwrite), it
// holds both sides without the model growing a column per image, and it works whether or not the
// OCR scan was ever run — the OCR seam takes file ids as transient INPUT and persists nothing.
//
// There is no upload endpoint of our own: a card goes up through `POST /platform/files` like any
// other attachment and carries this category. All this module contributes is the category, which
// is where the "an image or a PDF, and small" rule lives — so the same validation runs whoever
// does the uploading.
import { APPLICANT_NATIONAL_ID_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { fileCategoryService } from '../../../../platform/files';

const CARD_CATEGORY: CreateFileCategory = {
  key: APPLICANT_NATIONAL_ID_FILE_CATEGORY,
  name: { ar: 'صور بطاقة الرقم القومي', en: 'National ID card images' },
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeMb: 10,
  // A card image is identity evidence attached to a permanent batch record; it outlives every
  // retention window for the same reason the batch itself does (RW8).
  retentionDays: null,
};

/** Boot-time idempotent seed. */
export const ensureNationalIdCardCategory = async (): Promise<void> => {
  await fileCategoryService.ensure(CARD_CATEGORY);
};

let cachedCategoryId: string | null = null;

/** The category id, ensured and cached on first use. */
export const resolveNationalIdCardCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(CARD_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};
