// Applicants' binding of the reusable National-ID OCR flow. It supplies the module-specific
// extractor (upload the two images to the platform Files service, then call the HR OCR endpoint)
// and forwards the reviewed, confirmed fields to the caller. All the capture + review UI lives in
// the shared `NationalIdOcr` component, so Employees / KYC / etc. reuse it with their own binding.
//
// THE UPLOADS ARE FILED BY KIND. They used to land in whichever category happened to allow an
// image first — which could be the applicant-source ICON category, and meant nothing downstream
// could tell a scanned card from any other picture. They go to the National-ID category now, which
// is what the security-check package reads when it prints one card per page.
//
// The scan runs BEFORE the applicant exists, so these uploads still land on a scratch reference:
// `onScanned` hands their ids up so the register call can name them and the server can copy them
// onto the applicant it creates.
import { APPLICANT_NATIONAL_ID_FILE_CATEGORY, type FileCategoryDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  NationalIdOcr,
  type NationalIdExtractor,
  type NationalIdReviewData,
} from '../../../../../shared/national-id';
import { useFileCategories, useOcrExtract } from '../api/applicant-queries';
import { uploadPlatformFile } from '../api/applicant-api';

/**
 * The card category, by KEY — never "the first one that allows an image".
 *
 * The fallback covers a database seeded before this category existed: scanning still works, the
 * images simply are not recognisable as cards until the seed runs again.
 */
const cardCategoryId = (categories: FileCategoryDto[]): string | null =>
  categories.find((c) => c.key === APPLICANT_NATIONAL_ID_FILE_CATEGORY)?.id ??
  categories.find((c) => c.allowedMimeTypes.some((m) => m.startsWith('image/')))?.id ??
  null;

export const ApplicantNationalIdOcr = ({
  onConfirm,
  onScanned,
}: {
  onConfirm: (data: NationalIdReviewData) => void;
  /** The ids of the images just uploaded, so a caller that is about to create the applicant can
   *  have them filed against it. Omitted by callers that do not create one. */
  onScanned?: (fileIds: string[]) => void;
}): JSX.Element => {
  const t = useT();
  const { data: categories = [] } = useFileCategories();
  const ocr = useOcrExtract();

  const extract: NationalIdExtractor = async ({ frontFile, backFile }) => {
    const categoryId = cardCategoryId(categories);
    if (categoryId === null) {
      toast.error(t('applicants.ocr.noCategory'));
      throw new Error('no image file category configured');
    }
    const uploadOne = async (file: File): Promise<string> => {
      const form = new FormData();
      form.append('file', file);
      form.append('moduleId', 'hr');
      form.append('entityType', 'applicantOcr');
      form.append('entityId', 'pending');
      form.append('categoryId', categoryId);
      form.append('visibility', 'private');
      const uploaded = await uploadPlatformFile(form);
      return uploaded.id;
    };
    const [frontFileId, backFileId] = await Promise.all([
      frontFile === null ? Promise.resolve(undefined) : uploadOne(frontFile),
      backFile === null ? Promise.resolve(undefined) : uploadOne(backFile),
    ]);
    onScanned?.([frontFileId, backFileId].filter((id): id is string => id !== undefined));
    return ocr.mutateAsync({
      ...(frontFileId === undefined ? {} : { frontFileId }),
      ...(backFileId === undefined ? {} : { backFileId }),
    });
  };

  return <NationalIdOcr extract={extract} onConfirm={onConfirm} />;
};
