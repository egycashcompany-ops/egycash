// Egyptian National-ID capture (the OQ-30 extraction seam) — two upload areas (front + back)
// read together in ONE extraction pass. Upload the card images → the server extraction runs →
// the raw fields (name, number, marital status, address, religion, card expiry) come back with
// confidence bands and are handed to the review step. NOTHING is auto-saved and nothing is
// trusted: the user verifies/edits every value in the form below before saving (§2.1 rule 4).
// Degrades gracefully — when no real provider is wired (`available: false`) it tells the user to
// fill the fields manually; the National-ID-derived fields (birth date, gender, governorate)
// are computed downstream from the number regardless.
import { useState } from 'react';
import { type OcrExtractionDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { FileUpload } from '../../../../../shared/ui/FileUpload';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useFileCategories, useOcrExtract } from '../api/applicant-queries';
import { uploadPlatformFile } from '../api/applicant-api';

const imageCategoryId = (categories: { id: string; allowedMimeTypes: string[] }[]): string | null =>
  categories.find((c) => c.allowedMimeTypes.some((m) => m.startsWith('image/')))?.id ?? null;

export const NationalIdCapture = ({
  onExtract,
}: {
  /** Receives the extraction result so the review step can pre-fill every editable field. */
  onExtract: (result: OcrExtractionDto) => void;
}): JSX.Element => {
  const t = useT();
  const { data: categories = [] } = useFileCategories();
  const ocr = useOcrExtract();
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const uploadOne = async (file: File, categoryId: string): Promise<string> => {
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

  const run = async (): Promise<void> => {
    if (front === null && back === null) return;
    const categoryId = imageCategoryId(categories);
    if (categoryId === null) {
      toast.error(t('applicants.ocr.noCategory'));
      return;
    }
    setBusy(true);
    setUnavailable(false);
    try {
      const [frontFileId, backFileId] = await Promise.all([
        front === null ? Promise.resolve(undefined) : uploadOne(front, categoryId),
        back === null ? Promise.resolve(undefined) : uploadOne(back, categoryId),
      ]);
      const extraction = await ocr.mutateAsync({
        ...(frontFileId === undefined ? {} : { frontFileId }),
        ...(backFileId === undefined ? {} : { backFileId }),
      });
      if (extraction.available) {
        toast.success(t('applicants.ocr.extracted'));
      } else {
        setUnavailable(true);
        toast.info(t('applicants.ocr.unavailable'));
      }
      onExtract(extraction);
    } catch {
      // surfaced by the global error handler
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t('applicants.ocr.title')} description={t('applicants.ocr.subtitle')} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('applicants.ocr.front')}
            </p>
            <FileUpload accept="image/*" maxSizeMb={10} onFiles={(files) => setFront(files[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('applicants.ocr.back')}
            </p>
            <FileUpload accept="image/*" maxSizeMb={10} onFiles={(files) => setBack(files[0] ?? null)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={front === null && back === null}
            loading={busy}
            onClick={() => void run()}
          >
            {t('applicants.ocr.extract')}
          </Button>
          <p className="text-xs text-slate-400">{t('applicants.ocr.reviewHint')}</p>
        </div>

        {unavailable && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t('applicants.ocr.unavailable')}
          </p>
        )}
      </CardBody>
    </Card>
  );
};
