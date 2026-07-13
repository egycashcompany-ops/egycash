// A panel member records their own evaluation (recommendation + optional rating + notes).
// Re-submitting replaces the prior one (an interviewer evaluates at most once per round).
// Matches SubmitInterviewEvaluation; version-checked. Shown only to an assigned interviewer.
import { useState } from 'react';
import {
  INTERVIEW_RECOMMENDATIONS,
  type InterviewPanelistDto,
  type InterviewRecommendation,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Select, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useSubmitEvaluation } from '../api/interview-queries';

const RATINGS = [1, 2, 3, 4, 5] as const;

export const EvaluateDialog = ({
  open,
  onClose,
  interviewId,
  version,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  version: number;
  existing: InterviewPanelistDto | null;
}): JSX.Element => {
  const t = useT();
  const evaluate = useSubmitEvaluation(interviewId);
  const [recommendation, setRecommendation] = useState<'' | InterviewRecommendation>(existing?.recommendation ?? '');
  const [rating, setRating] = useState<string>(existing?.rating != null ? String(existing.rating) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const submit = async (): Promise<void> => {
    if (recommendation === '') return;
    try {
      await evaluate.mutateAsync({
        recommendation,
        version,
        ...(rating === '' ? {} : { rating: Number(rating) }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      });
      toast.success(t('interviews.evaluate.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('interviews.evaluate.title')}
      description={t('interviews.evaluate.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={evaluate.isPending} disabled={recommendation === ''} onClick={() => void submit()}>
            {t('interviews.evaluate.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('interviews.evaluate.recommendation')} required>
          <Select value={recommendation} onChange={(e) => setRecommendation(e.target.value as InterviewRecommendation | '')}>
            <option value="">{t('interviews.evaluate.pickRecommendation')}</option>
            {INTERVIEW_RECOMMENDATIONS.map((r) => (
              <option key={r} value={r}>{t(`interviews.recommendation.${r}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('interviews.evaluate.rating')} hint={t('interviews.evaluate.ratingHint')}>
          <Select value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">{t('interviews.evaluate.noRating')}</option>
            {RATINGS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('interviews.evaluate.notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
      </div>
    </Dialog>
  );
};
