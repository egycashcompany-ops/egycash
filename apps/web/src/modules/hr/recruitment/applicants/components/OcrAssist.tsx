// OCR assist for National-ID capture (the OQ-30 extraction seam). Upload an ID image → the
// server extraction runs → each field returns with a confidence band and can be applied to the
// form. Degrades gracefully: when no real provider is wired (`available: false`) it tells the
// user to enter the data manually. Nothing is trusted — the user confirms every applied value.
import { useState } from 'react';
import { type OcrExtractionDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Badge, type Tone } from '../../../../../shared/ui/Badge';
import { FileUpload } from '../../../../../shared/ui/FileUpload';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useFileCategories, useOcrExtract } from '../api/applicant-queries';
import { uploadPlatformFile } from '../api/applicant-api';

const CONFIDENCE_TONE: Record<'high' | 'medium' | 'low', Tone> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
};

const imageCategoryId = (categories: { id: string; allowedMimeTypes: string[] }[]): string | null => {
  const found = categories.find((c) => c.allowedMimeTypes.some((m) => m.startsWith('image/')));
  return found?.id ?? null;
};

export const OcrAssist = ({
  onApply,
}: {
  onApply: (fields: { nationalId?: string | undefined; fullNameAr?: string | undefined }) => void;
}): JSX.Element => {
  const t = useT();
  const { data: categories = [] } = useFileCategories();
  const ocr = useOcrExtract();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OcrExtractionDto | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    if (file === null) return;
    const categoryId = imageCategoryId(categories);
    if (categoryId === null) {
      toast.error(t('applicants.ocr.noCategory'));
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('moduleId', 'hr');
      form.append('entityType', 'applicantOcr');
      form.append('entityId', 'pending');
      form.append('categoryId', categoryId);
      form.append('visibility', 'private');
      const uploaded = await uploadPlatformFile(form);
      const extraction = await ocr.mutateAsync({ frontFileId: uploaded.id });
      setResult(extraction);
      if (!extraction.available) toast.info(t('applicants.ocr.unavailable'));
    } catch {
      // surfaced by the global error handler
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t('applicants.ocr.title')} description={t('applicants.ocr.subtitle')} />
      <CardBody className="space-y-3">
        <FileUpload accept="image/*" maxSizeMb={10} onFiles={(files) => setFile(files[0] ?? null)} />
        <Button size="sm" variant="secondary" disabled={file === null} loading={busy} onClick={() => void run()}>
          {t('applicants.ocr.extract')}
        </Button>

        {result !== null && !result.available && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t('applicants.ocr.unavailable')}
          </p>
        )}

        {result !== null && result.available && (
          <ul className="space-y-2">
            {result.nationalId !== null && (
              <li className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <span className="flex items-center gap-2">
                  <span className="font-mono" dir="ltr">{result.nationalId.value}</span>
                  <Badge tone={CONFIDENCE_TONE[result.nationalId.confidence]}>
                    {t(`applicants.ocr.confidence.${result.nationalId.confidence}`)}
                  </Badge>
                </span>
                <Button size="sm" variant="ghost" onClick={() => onApply({ nationalId: result.nationalId?.value })}>
                  {t('applicants.ocr.apply')}
                </Button>
              </li>
            )}
            {result.fullNameAr !== null && (
              <li className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <span className="flex items-center gap-2">
                  {result.fullNameAr.value}
                  <Badge tone={CONFIDENCE_TONE[result.fullNameAr.confidence]}>
                    {t(`applicants.ocr.confidence.${result.fullNameAr.confidence}`)}
                  </Badge>
                </span>
                <Button size="sm" variant="ghost" onClick={() => onApply({ fullNameAr: result.fullNameAr?.value })}>
                  {t('applicants.ocr.apply')}
                </Button>
              </li>
            )}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};
