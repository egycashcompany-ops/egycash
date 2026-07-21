// Applicants' binding of the reusable National-ID OCR flow. It supplies the module-specific
// extractor (upload the two images to the platform Files service, then call the HR OCR endpoint)
// and forwards the reviewed, confirmed fields to the caller. All the capture + review UI lives in
// the shared `NationalIdOcr` component, so Employees / KYC / etc. reuse it with their own binding.
import { useT } from '../../../../../platform/localization/useT';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  NationalIdOcr,
  type NationalIdExtractor,
  type NationalIdReviewData,
} from '../../../../../shared/national-id';
import { useFileCategories, useOcrExtract } from '../api/applicant-queries';
import { uploadPlatformFile } from '../api/applicant-api';

const imageCategoryId = (categories: { id: string; allowedMimeTypes: string[] }[]): string | null =>
  categories.find((c) => c.allowedMimeTypes.some((m) => m.startsWith('image/')))?.id ?? null;

export const ApplicantNationalIdOcr = ({
  onConfirm,
}: {
  onConfirm: (data: NationalIdReviewData) => void;
}): JSX.Element => {
  const t = useT();
  const { data: categories = [] } = useFileCategories();
  const ocr = useOcrExtract();

  const extract: NationalIdExtractor = async ({ frontFile, backFile }) => {
    const categoryId = imageCategoryId(categories);
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
    return ocr.mutateAsync({
      ...(frontFileId === undefined ? {} : { frontFileId }),
      ...(backFileId === undefined ? {} : { backFileId }),
    });
  };

  return <NationalIdOcr extract={extract} onConfirm={onConfirm} />;
};
