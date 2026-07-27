// The candidate's complete recruitment history (RW14/I5) as the recruitment screens show it:
// the canonical entries, plus the filter and the one user-authored note. The entries themselves
// are drawn by `RecruitmentTimelineList` — the single renderer the Employee File shares — so this
// component owns fetching and interaction, never a second way of presenting history.
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { RecruitmentTimelineList } from './RecruitmentTimelineList';
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

export const CandidateTimeline = ({ applicantId }: { applicantId: string }): JSX.Element => {
  const t = useT();
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

        <RecruitmentTimelineList entries={entries} />
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
