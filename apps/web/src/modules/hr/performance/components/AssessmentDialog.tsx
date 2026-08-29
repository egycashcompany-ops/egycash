// Writing an assessment, and deciding what happens to one (P-HR-PRF D6, D8, D15).
//
// ONE DIALOG, TWO CHAIRS. The evaluator writes; HR returns, finalizes or excuses. Which half is
// offered comes from the permission and the review's state, not from a mode the caller picks —
// a screen that let somebody choose which role they were in would be a screen that lets them be
// wrong about it.
//
// THE RATING IS TYPED, NEVER SUGGESTED (D8). There is no default computed from the goals, no
// «recommended» marker, and no average anywhere on this screen. The scale's bounds come from the
// CYCLE, which is why they are passed in rather than assumed — a round rated 1–10 and one rated
// 1–5 must not share a hardcoded five.
import { useState } from 'react';
import { type PerformanceCycleDto, type PerformanceReviewDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Can } from '../../../../platform/rbac/Can';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Textarea } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import {
  useExcusePerformanceReview,
  useFinalizePerformanceReview,
  useReturnPerformanceReview,
  useSubmitPerformanceReview,
} from '../api/performance-queries';

/** What the evaluator writes. Both texts required — an assessment with a blank half is unwritten. */
const MIN_TEXT = 10;

export const AssessmentDialog = ({
  review,
  cycle,
  onClose,
}: {
  review: PerformanceReviewDto;
  /** The round this review belongs to — the authority on the scale (D8). */
  cycle: PerformanceCycleDto | undefined;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const submit = useSubmitPerformanceReview();
  const sendBack = useReturnPerformanceReview();
  const finalize = useFinalizePerformanceReview();
  const excuse = useExcusePerformanceReview();

  const [rating, setRating] = useState(review.rating === null ? '' : String(review.rating));
  const [strengths, setStrengths] = useState(review.strengths ?? '');
  const [improvements, setImprovements] = useState(review.improvements ?? '');
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState<'return' | 'excuse' | null>(null);

  const scaleMin = cycle?.scale.min ?? 1;
  const scaleMax = cycle?.scale.max ?? 5;
  const ratingNumber = Number(rating);
  const ratingOnScale =
    rating !== '' &&
    Number.isInteger(ratingNumber) &&
    ratingNumber >= scaleMin &&
    ratingNumber <= scaleMax;
  const complete =
    ratingOnScale && strengths.trim().length >= MIN_TEXT && improvements.trim().length >= MIN_TEXT;

  const doSubmit = async (): Promise<void> => {
    if (!complete) return;
    try {
      await submit.mutateAsync({
        id: review.id,
        body: {
          rating: ratingNumber,
          strengths: strengths.trim(),
          improvements: improvements.trim(),
          version: review.version,
        },
      });
      toast.success(t('performance.review.submitted'));
      onClose();
    } catch {
      // surfaced globally — including «this review is assigned to somebody else»
    }
  };

  const doFinalize = async (): Promise<void> => {
    try {
      await finalize.mutateAsync({ id: review.id, body: { version: review.version } });
      toast.success(t('performance.review.finalized'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  const doReasoned = async (): Promise<void> => {
    if (asking === null || reason.trim().length < 5) return;
    try {
      if (asking === 'return') {
        await sendBack.mutateAsync({
          id: review.id,
          body: { reason: reason.trim(), version: review.version },
        });
        toast.success(t('performance.review.returned'));
      } else {
        await excuse.mutateAsync({
          id: review.id,
          body: { reason: reason.trim(), version: review.version },
        });
        toast.success(t('performance.review.excused'));
      }
      onClose();
    } catch {
      // surfaced globally
    }
  };

  const closed = review.status === 'finalized' || review.status === 'excused';
  const pending = submit.isPending || sendBack.isPending || finalize.isPending || excuse.isPending;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('performance.review.assessment')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {`${review.employeeName} · ${review.employeeCode}`}
      </p>

      {/* Why it came back, kept visible so the evaluator can see what to change (nothing was
          cleared — see the contract). */}
      {review.returnedReason !== null && review.status === 'draft' && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {`${t('performance.review.sentBack')}: ${review.returnedReason}`}
        </p>
      )}

      {closed ? (
        <div className="space-y-2 text-sm">
          {/* A closed review is READ ONLY — the repository refuses a write to it, and the screen
              says so instead of offering fields the server would reject (D7). */}
          <p className="text-slate-600 dark:text-slate-300">
            {t(`performance.review.closedAs.${review.status}`)}
          </p>
          {review.rating !== null && <p dir="ltr">{`${review.rating} / ${String(scaleMax)}`}</p>}
          {review.strengths !== null && <p>{review.strengths}</p>}
          {review.improvements !== null && <p>{review.improvements}</p>}
          {review.excusedReason !== null && <p>{review.excusedReason}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <Can permission="performanceReview.assess">
            <Field
              label={t('performance.review.rating')}
              required
              hint={`${String(scaleMin)}–${String(scaleMax)}`}
            >
              <Input
                type="number"
                min={scaleMin}
                max={scaleMax}
                step={1}
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                disabled={review.status !== 'draft'}
                dir="ltr"
              />
            </Field>
            <Field label={t('performance.review.strengths')} required>
              <Textarea
                value={strengths}
                onChange={(e) => setStrengths(e.target.value)}
                disabled={review.status !== 'draft'}
                rows={3}
              />
            </Field>
            <Field label={t('performance.review.improvements')} required>
              <Textarea
                value={improvements}
                onChange={(e) => setImprovements(e.target.value)}
                disabled={review.status !== 'draft'}
                rows={3}
              />
            </Field>
            {review.status === 'draft' && (
              <div className="flex justify-end">
                <Button
                  loading={submit.isPending}
                  disabled={!complete}
                  onClick={() => void doSubmit()}
                >
                  {t('performance.review.submit')}
                </Button>
              </div>
            )}
          </Can>

          <Can permission="performanceReview.finalize">
            {asking === null ? (
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                {review.status === 'submitted' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setAsking('return')}>
                      {t('performance.review.return')}
                    </Button>
                    <Button
                      size="sm"
                      loading={finalize.isPending}
                      onClick={() => void doFinalize()}
                    >
                      {t('performance.review.finalize')}
                    </Button>
                  </>
                )}
                <Button size="sm" variant="secondary" onClick={() => setAsking('excuse')}>
                  {t('performance.review.excuse')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t(
                    asking === 'return'
                      ? 'performance.review.returnReason'
                      : 'performance.review.excuseReason',
                  )}
                  rows={2}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAsking(null)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    loading={pending}
                    disabled={reason.trim().length < 5}
                    onClick={() => void doReasoned()}
                  >
                    {t(
                      asking === 'return'
                        ? 'performance.review.return'
                        : 'performance.review.excuse',
                    )}
                  </Button>
                </div>
              </div>
            )}
          </Can>
        </div>
      )}
    </Dialog>
  );
};
