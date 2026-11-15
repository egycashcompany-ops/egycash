// The evaluation as a SCORECARD — written on the page, and it is where the round is decided.
//
// Recommendation tiles, a labelled star rating, one-tap strength / concern tags that write into the
// notes, and the verdict at the bottom: «Reject» or «Approve». One confirm saves the evaluation and
// decides the round with the same notes. Nothing opens by itself when a round starts.
//
// When other interviewers on the panel have not evaluated yet, the round cannot be decided (server
// rule): the card says who it waits for and offers «Save my evaluation» instead.
import { useState } from 'react';
import {
  INTERVIEW_RECOMMENDATIONS,
  type InterviewDecision,
  type InterviewDto,
  type InterviewPanelistDto,
  type InterviewRecommendation,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { cn } from '../../../../../shared/lib/cn';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { CheckIcon, CloseIcon } from '../../../../../shared/ui/icons';
import { useDecideInterview, useSubmitEvaluation } from '../api/interview-queries';
import { UserName } from './UserName';
import { DISPLAY, EYEBROW, SHEET } from './InterviewRoom';

const REC_STYLE: Record<InterviewRecommendation, string> = {
  recommend: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  neutral: 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  notRecommend: 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};
const REC_GLYPH: Record<InterviewRecommendation, string> = { recommend: '✓', neutral: '~', notRecommend: '✕' };

const STRENGTHS = ['communication', 'confidence', 'experience', 'attitude', 'punctual', 'appearance'] as const;
const CONCERNS = ['weakCommunication', 'noExperience', 'salaryGap', 'distance', 'attitudeConcern'] as const;

export const InterviewEvaluationPanel = ({
  interview: iv,
  mine,
  canEvaluate,
  canDecide,
}: {
  interview: InterviewDto;
  mine: InterviewPanelistDto | null;
  canEvaluate: boolean;
  canDecide: boolean;
}): JSX.Element => {
  const t = useT();
  const evaluate = useSubmitEvaluation(iv.id);
  const decide = useDecideInterview(iv.id);
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | null>(mine?.recommendation ?? null);
  const [rating, setRating] = useState<number | null>(mine?.rating ?? null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [notes, setNotes] = useState(mine?.notes ?? '');
  const [confirm, setConfirm] = useState<InterviewDecision | null>(null);

  const waitingFor = iv.panel.filter((p) => p.state === 'pending' && p.interviewerId !== mine?.interviewerId);
  const decidable = canDecide && waitingFor.length === 0;
  const busy = evaluate.isPending || decide.isPending;
  const shown = hoverRating ?? rating ?? 0;

  /** A tag toggles its own line in the notes: «+ Good communication» / «− Lives far away». */
  const tagLine = (kind: 'plus' | 'minus', key: string): string =>
    `${kind === 'plus' ? '+' : '−'} ${t(`interviews.tag.${key}`)}`;
  const hasLine = (line: string): boolean => notes.split('\n').some((l) => l.trim() === line);
  const toggleTag = (line: string): void =>
    setNotes((prev) => {
      const lines = prev.split('\n').filter((l) => l.trim() !== '');
      return (lines.some((l) => l.trim() === line) ? lines.filter((l) => l.trim() !== line) : [...lines, line]).join('\n');
    });

  const saveEvaluation = async (fallback: InterviewRecommendation): Promise<number> => {
    if (!canEvaluate) return iv.version;
    const saved = await evaluate.mutateAsync({
      recommendation: recommendation ?? fallback,
      version: iv.version,
      ...(rating === null ? {} : { rating }),
      ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
    });
    return saved.version;
  };

  const finish = async (outcome: InterviewDecision): Promise<void> => {
    try {
      const version = await saveEvaluation(outcome === 'passed' ? 'recommend' : 'notRecommend');
      await decide.mutateAsync({ outcome, version, ...(notes.trim() === '' ? {} : { notes: notes.trim() }) });
      toast.success(outcome === 'passed' ? t('interviews.decide.passedDone') : t('interviews.decide.failedDone'));
      setConfirm(null);
    } catch {
      // surfaced globally
    }
  };

  const saveOnly = async (): Promise<void> => {
    if (recommendation === null) {
      toast.error(t('interviews.eval.pickFirst'));
      return;
    }
    try {
      await saveEvaluation(recommendation);
      toast.success(t('interviews.evaluate.done'));
    } catch {
      // surfaced globally
    }
  };

  const pill = (on: boolean, tone: 'plus' | 'minus'): string =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs font-semibold transition',
      on
        ? tone === 'plus'
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-rose-600 bg-rose-600 text-white'
        : tone === 'plus'
          ? 'border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-300'
          : 'border-slate-200 text-slate-600 hover:border-rose-400 hover:text-rose-700 dark:border-slate-700 dark:text-slate-300',
    );

  return (
    <div className={cn(SHEET, 'overflow-hidden')}>
      <div aria-hidden className="h-1 bg-brand-600" />
      <div className="border-b border-slate-100 px-5 pb-4 pt-4 dark:border-slate-800">
        <p className={cn(EYEBROW, 'text-brand-600 dark:text-brand-400')}>{t('interviews.eval.scorecard')}</p>
        <h2 className={cn(DISPLAY, 'mt-0.5 text-xl font-extrabold text-slate-900 dark:text-slate-50')}>{t('interviews.eval.title')}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t('interviews.eval.subtitle')}</p>
      </div>

      <div className="space-y-5 p-5">
        {canEvaluate && (
          <>
            {/* Recommendation */}
            <div className="grid grid-cols-3 gap-2">
              {INTERVIEW_RECOMMENDATIONS.map((r) => {
                const on = recommendation === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRecommendation(r)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-bold transition',
                      on ? REC_STYLE[r] : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400',
                    )}
                  >
                    <span className="text-base leading-none">{REC_GLYPH[r]}</span>
                    {t(`interviews.recommendation.${r}`)}
                  </button>
                );
              })}
            </div>

            {/* Rating: five numbered steps and the word for it */}
            <div>
              <div className="mb-1.5 flex items-center justify-end">
                <span className={cn('text-xs font-bold', shown === 0 ? 'text-slate-400' : 'text-brand-600 dark:text-brand-400')}>
                  {shown === 0 ? t('interviews.eval.rateIt') : t(`interviews.rating.${shown}`)}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5" onMouseLeave={() => setHoverRating(null)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={String(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onClick={() => setRating(rating === n ? null : n)}
                    className={cn(
                      DISPLAY,
                      'h-10 rounded-lg border text-base font-black tabular-nums transition',
                      n <= shown
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-200 text-slate-400 hover:border-brand-300 dark:border-slate-700',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Quick tags -> notes */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {STRENGTHS.map((k) => {
              const line = tagLine('plus', k);
              return (
                <button key={k} type="button" onClick={() => toggleTag(line)} className={pill(hasLine(line), 'plus')}>
                  + {t(`interviews.tag.${k}`)}
                </button>
              );
            })}
            {CONCERNS.map((k) => {
              const line = tagLine('minus', k);
              return (
                <button key={k} type="button" onClick={() => toggleTag(line)} className={pill(hasLine(line), 'minus')}>
                  − {t(`interviews.tag.${k}`)}
                </button>
              );
            })}
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder={t('interviews.eval.notesPlaceholder')}
          />
        </div>

        {waitingFor.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {t('interviews.eval.waitingFor')}{' '}
            {waitingFor.map((p, i) => (
              <span key={p.interviewerId} className="font-semibold">
                {i > 0 && '، '}
                <UserName id={p.interviewerId} />
              </span>
            ))}
          </div>
        )}

        {/* The verdict */}
        {decidable ? (
          <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className={cn(EYEBROW, 'text-center')}>{t('interviews.eval.verdict')}</p>
            <div className="grid grid-cols-[1fr_1.4fr] gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirm('failed')}
                className="flex h-12 items-center justify-center gap-2 rounded-xl border border-rose-200 text-sm font-bold text-rose-600 transition hover:border-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:hover:bg-rose-950/40"
              >
                <CloseIcon className="h-4 w-4" /> {t('interviews.eval.reject')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirm('passed')}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckIcon className="h-4 w-4" /> {t('interviews.eval.approve')}
              </button>
            </div>
          </div>
        ) : canEvaluate ? (
          <Button className="w-full" loading={evaluate.isPending} onClick={() => void saveOnly()}>
            {mine?.state === 'submitted' ? t('interviews.actions.reevaluate') : t('interviews.eval.saveMine')}
          </Button>
        ) : null}
      </div>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'passed' ? t('interviews.eval.confirmApprove', { name: iv.applicantName }) : t('interviews.eval.confirmReject', { name: iv.applicantName })}
        description={confirm === 'passed' ? t('interviews.decide.passBody') : t('interviews.decide.failBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant={confirm === 'failed' ? 'danger' : 'primary'} loading={busy} onClick={() => confirm !== null && void finish(confirm)}>
              {confirm === 'passed' ? t('interviews.eval.approve') : t('interviews.eval.reject')}
            </Button>
          </>
        }
      >
        {notes.trim() === '' ? (
          <p className="text-sm text-slate-500">{t('interviews.eval.noNotes')}</p>
        ) : (
          <blockquote className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{notes.trim()}</blockquote>
        )}
      </Dialog>
    </div>
  );
};
