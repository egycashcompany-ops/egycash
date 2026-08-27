// Completing a session — the act that qualifies people (D7).
//
// THIS IS A LIST, NOT A CONFIRMATION, and that is the whole design. Every other transition on a
// session is «are you sure»; this one asks WHO. The default is everybody marked present, because
// that is what usually happens and making somebody tick twenty boxes to say so would teach them to
// tick without reading — but it is a DEFAULT the person changes, not a rule the system applies.
// The difference matters: presence is a fact the room recorded, and qualification is a judgement
// somebody makes, and D7 exists because turning the first into the second automatically would be
// the system inventing an assessment rule nobody gave it.
//
// The absent are shown and cannot be ticked. Somebody who was not there did not complete it, and
// the server refuses it too — this only means the person finds out before they click.
import { useMemo, useState } from 'react';
import { type TrainingEnrollmentDto, type TrainingSessionDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Checkbox } from '../../../../shared/ui/form';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useCompleteTrainingSession, useTrainingEnrollments } from '../api/training-queries';

/** Who may be completed at all — the absent and the cancelled cannot (see the header). */
const COMPLETABLE = new Set(['enrolled', 'attended', 'excused']);

export const CompleteSessionDialog = ({
  session,
  onClose,
}: {
  session: TrainingSessionDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const complete = useCompleteTrainingSession();
  const roster = useTrainingEnrollments({ sessionId: session.id, pageSize: 200, liveOnly: 'true' });
  const seats = useMemo(
    () => (roster.data?.items ?? []) as TrainingEnrollmentDto[],
    [roster.data],
  );

  // Everybody present, pre-ticked — a default, not a rule. `undefined` means «not chosen yet», so
  // the first render can fill it in without fighting a user who has already unticked somebody.
  const [chosen, setChosen] = useState<Set<string> | undefined>(undefined);
  const selected =
    chosen ?? new Set(seats.filter((s) => s.status === 'attended').map((s) => s.id));

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const submit = async (): Promise<void> => {
    try {
      const result = await complete.mutateAsync({
        id: session.id,
        body: { completing: [...selected], version: session.version },
      });
      toast.success(
        t('training.session.done.complete', { n: String(result.recordsCreated) }),
      );
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('training.session.action.complete')}
      description={t('training.session.confirm.complete')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={complete.isPending} onClick={() => void submit()}>
            {t('training.session.completeAction', { n: String(selected.size) })}
          </Button>
        </>
      }
    >
      {roster.isPending ? (
        <LoadingState />
      ) : seats.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('training.session.rosterEmpty')}
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {seats.map((seat) => {
            const completable = COMPLETABLE.has(seat.status);
            return (
              <li
                key={seat.id}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <Checkbox
                  label={seat.employeeName}
                  checked={completable && selected.has(seat.id)}
                  disabled={!completable}
                  onChange={() => toggle(seat.id)}
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t(`training.enrollment.status.${seat.status}`)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
};
