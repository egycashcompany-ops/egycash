// The candidate's complete recruitment history (RW14/I5). Every entry is a projection of a
// workflow event, so this component renders facts and never derives them: it shows what happened,
// who did it, and — for a returned candidate — which attempt the entry belongs to.
//
// Superseded entries STAY VISIBLE, flagged: a return to an earlier stage retires an attempt, it
// never erases it.
import { useState } from 'react';
import { type RecruitmentTimelineEntryDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../../../shared/lib/format';
import { useAddTimelineNote, useRecruitmentTimeline } from '../api/timeline-queries';

/** Entry types that represent a DECISION — the "decisions only" filter. */
const DECISIONS = new Set([
  'screeningDecided',
  'interviewCompleted',
  'evaluationDecided',
  'offerAccepted',
  'offerRejected',
  'offerWithdrawn',
  'hired',
  'rejected',
  'withdrawn',
  'returnedToStage',
]);

const attemptOf = (entry: RecruitmentTimelineEntryDto): number | null => {
  const value = entry.metadata['attempt'];
  return typeof value === 'number' ? value : null;
};

export const CandidateTimeline = ({ applicantId }: { applicantId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [decisionsOnly, setDecisionsOnly] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const { data, isLoading, isError, error, refetch } = useRecruitmentTimeline(applicantId);
  const addNote = useAddTimelineNote(applicantId);

  const submitNote = async (): Promise<void> => {
    try {
      await addNote.mutateAsync({ note });
      toast.success(t('timeline.noteAdded'));
      setNote('');
      setNoteOpen(false);
    } catch {
      // The global mutation error handler surfaces the failure.
    }
  };

  const entries = (data ?? []).filter((e) => !decisionsOnly || DECISIONS.has(e.type));

  return (
    <Card>
      <CardHeader
        title={t('timeline.title')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDecisionsOnly((v) => !v)}>
              {decisionsOnly ? t('timeline.filter.all') : t('timeline.filter.decisions')}
            </Button>
            <Can permission="applicant.edit">
              <Button size="sm" onClick={() => setNoteOpen(true)}>
                {t('timeline.addNote')}
              </Button>
            </Can>
          </div>
        }
      />
      <CardBody>
        {isLoading ? <LoadingState /> : null}
        {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
        {!isLoading && !isError && entries.length === 0 ? (
          <EmptyState title={t('timeline.empty')} />
        ) : null}

        <ol className="relative space-y-4 border-s border-slate-200 ps-4 dark:border-slate-700">
          {entries.map((entry) => {
            const attempt = attemptOf(entry);
            return (
              <li key={entry.eventId} className="relative">
                <span
                  className={`absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-slate-900 ${
                    entry.supersededAt === null ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                  aria-hidden
                />
                <div className={entry.supersededAt === null ? '' : 'opacity-60'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {t(`timeline.type.${entry.type}`)}
                    </span>
                    {entry.stage?.name !== null && entry.stage?.name !== undefined ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        · {entry.stage.name[locale]}
                      </span>
                    ) : null}
                    {attempt !== null && attempt > 1 ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('timeline.attempt').replace('{n}', String(attempt))}
                      </span>
                    ) : null}
                    {entry.supersededAt !== null ? (
                      <span
                        title={t('timeline.supersededHint')}
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      >
                        {t('timeline.superseded')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatDateTime(entry.at, locale)}
                    {entry.actorName === '' ? null : ` · ${entry.actorName}`}
                  </div>
                  {entry.note === null ? null : (
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{entry.note}</p>
                  )}
                  {entry.reason === null ? null : (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {t('timeline.reason')}: {entry.reason}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>

      <Dialog
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title={t('timeline.addNote')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={addNote.isPending}
              disabled={note.trim() === ''}
              onClick={() => void submitNote()}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Field label={t('timeline.addNote')}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('timeline.notePlaceholder')}
          />
        </Field>
      </Dialog>
    </Card>
  );
};
