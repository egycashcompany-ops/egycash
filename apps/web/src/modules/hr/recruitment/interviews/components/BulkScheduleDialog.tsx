// RW17 — schedule ONE stage at ONE time across a whole selection of candidates.
//
// The whole selection goes to `POST /hr/interviews/bulk/schedule` in a single request. That is not
// a detail: the server runs each candidate in its own transaction through the ordinary schedule
// path (same gates, same audit, same events, same timeline), audits the bulk act once, and answers
// with the partial-success envelope the shared hook reports honestly. A client-side loop could
// give none of that — no single act to audit, and a half-finished run if the tab closes.
import { useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { localized } from '../../../../../shared/lib/format';
import { useBulkScheduleInterviews, useInterviewStages } from '../api/interview-queries';

export const BulkScheduleDialog = ({
  applicantIds,
  /** Pre-selected stage — the per-stage queue page already knows which round it is scheduling. */
  stageId: fixedStageId,
  onClose,
  onDone,
}: {
  applicantIds: string[];
  stageId?: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const stages = useInterviewStages();
  const [stageId, setStageId] = useState(fixedStageId ?? '');
  const [scheduledAt, setScheduledAt] = useState('');

  const bulkSchedule = useBulkScheduleInterviews(() => {
    onDone();
    onClose();
  });

  const submit = async (): Promise<void> => {
    if (stageId === '' || scheduledAt === '') return;
    await bulkSchedule.mutateAsync({
      applicantIds,
      stageId,
      scheduledAt: new Date(scheduledAt),
      interviewerIds: [],
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('interviews.bulk.scheduleTitle', { count: applicantIds.length })}
      description={t('interviews.bulk.scheduleBody')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            loading={bulkSchedule.isPending}
            disabled={stageId === '' || scheduledAt === '' || applicantIds.length === 0}
            onClick={() => void submit()}
          >
            {t('interviews.actions.schedule')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {fixedStageId === undefined && (
          <Field label={t('interviews.schedule.stage')} required>
            <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">{t('offers.form.selectRef')}</option>
              {(stages.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.order}. {localized(s.name, locale)}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('interviews.schedule.when')} required>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} dir="ltr" />
        </Field>
      </div>
    </Dialog>
  );
};
