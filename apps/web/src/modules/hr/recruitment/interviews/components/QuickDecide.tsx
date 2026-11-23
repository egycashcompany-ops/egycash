// Approve / reject at a decision-only interview stage (the second interview): no evaluation form,
// just the outcome and a note — for one candidate on their page, or for a whole selection at once.
import { useState } from 'react';
import { type InterviewDecision } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { cn } from '../../../../../shared/lib/cn';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Textarea } from '../../../../../shared/ui/form';
import { CheckIcon, CloseIcon } from '../../../../../shared/ui/icons';
import { useQuickDecideInterviews } from '../api/interview-queries';
import { DISPLAY, SHEET } from './InterviewRoom';

/** The dialog both entry points use: the outcome is chosen, the note is written here. */
export const QuickDecideDialog = ({
  outcome,
  applicantIds,
  stageId,
  names,
  onClose,
  onDone,
}: {
  outcome: InterviewDecision;
  applicantIds: string[];
  stageId: string;
  /** Shown when one or a few candidates are decided, so the reader sees who. */
  names: string[];
  onClose: () => void;
  onDone?: () => void;
}): JSX.Element => {
  const t = useT();
  const [notes, setNotes] = useState('');
  const run = useQuickDecideInterviews(() => {
    onDone?.();
    onClose();
  });
  const approve = outcome === 'passed';
  const many = applicantIds.length > 1;

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        many
          ? t(approve ? 'interviews.quick.approveMany' : 'interviews.quick.rejectMany', { n: applicantIds.length })
          : t(approve ? 'interviews.eval.confirmApprove' : 'interviews.eval.confirmReject', { name: names[0] ?? '' })
      }
      description={approve ? t('interviews.quick.approveBody') : t('interviews.quick.rejectBody')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant={approve ? 'primary' : 'danger'}
            loading={run.isPending}
            onClick={() =>
              void run.mutateAsync({
                applicantIds,
                stageId,
                outcome,
                ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
              }).catch(() => undefined)
            }
          >
            {approve ? t('interviews.eval.approve') : t('interviews.eval.reject')}
            {many && ` (${applicantIds.length})`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {many && names.length > 0 && (
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {names.map((n, i) => (
              <span
                key={`${n}-${i}`}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  approve
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
                )}
              >
                {n}
              </span>
            ))}
          </div>
        )}
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder={approve ? t('interviews.quick.approveNotes') : t('interviews.quick.rejectNotes')}
        />
      </div>
    </Dialog>
  );
};

/** The candidate's own page at a decision-only stage: two buttons and the note. */
export const QuickDecidePanel = ({
  applicantId,
  applicantName,
  stageId,
  canDecide,
}: {
  applicantId: string;
  applicantName: string;
  stageId: string;
  canDecide: boolean;
}): JSX.Element => {
  const t = useT();
  const [outcome, setOutcome] = useState<InterviewDecision | null>(null);
  return (
    <div className={cn(SHEET, 'overflow-hidden')}>
      <div aria-hidden className="h-1 bg-brand-600" />
      <div className="border-b border-slate-100 px-5 pb-4 pt-4 dark:border-slate-800">
        <h2 className={cn(DISPLAY, 'text-xl font-extrabold text-slate-900 dark:text-slate-50')}>{t('interviews.quick.title')}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t('interviews.quick.subtitle')}</p>
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2 p-5">
        <button
          type="button"
          disabled={!canDecide}
          onClick={() => setOutcome('failed')}
          className="flex h-12 items-center justify-center gap-2 rounded-xl border border-rose-200 text-sm font-bold text-rose-600 transition hover:border-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:hover:bg-rose-950/40"
        >
          <CloseIcon className="h-4 w-4" /> {t('interviews.eval.reject')}
        </button>
        <button
          type="button"
          disabled={!canDecide}
          onClick={() => setOutcome('passed')}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckIcon className="h-4 w-4" /> {t('interviews.eval.approve')}
        </button>
      </div>
      {outcome !== null && (
        <QuickDecideDialog
          outcome={outcome}
          applicantIds={[applicantId]}
          stageId={stageId}
          names={[applicantName]}
          onClose={() => setOutcome(null)}
        />
      )}
    </div>
  );
};
