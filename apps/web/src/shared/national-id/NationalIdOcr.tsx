// Reusable Egyptian National-ID OCR capture → review flow. Two upload areas (front + back) are
// read together in one extraction pass (the extractor is injected by the consuming module, which
// owns the upload + OCR endpoint), then a DEDICATED review dialog opens with every extracted field
// editable. Only on Confirm is the reviewed data handed back via `onConfirm` — the flow is fully
// independent of any host form, so Applicants, Employees, KYC, etc. can all reuse it. Degrades
// gracefully when no provider is wired (OQ-30): the review still opens for manual entry.
import { useState } from 'react';
import { useT } from '../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { FileUpload } from '../ui/FileUpload';
import { NationalIdReviewDialog } from './NationalIdReviewDialog';
import { ocrToReview } from './mapping';
import { type NationalIdExtractor, type NationalIdReviewData } from './types';

export const NationalIdOcr = ({
  extract,
  onConfirm,
}: {
  /** Runs the OCR for the two images (owns upload + endpoint) — injected by the host module. */
  extract: NationalIdExtractor;
  /** Called with the reviewed, confirmed fields — the host maps them into its own form/record. */
  onConfirm: (data: NationalIdReviewData) => void;
}): JSX.Element => {
  const t = useT();
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewData, setReviewData] = useState<NationalIdReviewData | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const run = async (): Promise<void> => {
    if (front === null && back === null) return;
    setBusy(true);
    try {
      const result = await extract({ frontFile: front, backFile: back });
      setUnavailable(!result.available);
      setReviewData(ocrToReview(result));
      setReviewOpen(true);
    } catch {
      // surfaced by the global error handler
    } finally {
      setBusy(false);
    }
  };

  const confirm = (data: NationalIdReviewData): void => {
    setReviewOpen(false);
    onConfirm(data);
  };

  return (
    <Card>
      <CardHeader title={t('nationalIdOcr.title')} description={t('nationalIdOcr.subtitle')} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('nationalIdOcr.front')}</p>
            <FileUpload accept="image/*" maxSizeMb={10} onFiles={(files) => setFront(files[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('nationalIdOcr.back')}</p>
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
            {t('nationalIdOcr.extract')}
          </Button>
          <p className="text-xs text-slate-400">{t('nationalIdOcr.reviewHint')}</p>
        </div>
      </CardBody>

      {reviewData !== null && (
        <NationalIdReviewDialog
          open={reviewOpen}
          initial={reviewData}
          notice={unavailable ? t('nationalIdOcr.unavailable') : undefined}
          onCancel={() => setReviewOpen(false)}
          onConfirm={confirm}
        />
      )}
    </Card>
  );
};
