// Bulk scheduling: create interviews for MANY selected applicants at once (Phase-Board bulk
// action). One stage + one date/time applied to every selected applicant; the committee stays
// optional (assign later per interview). Each applicant is scheduled through the normal endpoint
// so every server rule (stage progression, one-live-interview, applicant liveness) still applies;
// per-applicant failures are counted and reported without aborting the rest.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { scheduleInterview } from '../api/interview-api';
import { useInterviewStages } from '../api/interview-queries';

export const BulkScheduleDialog = ({
  applicantIds,
  onClose,
  onDone,
}: {
  applicantIds: string[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const qc = useQueryClient();
  const stages = useInterviewStages();
  const [stageId, setStageId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (stageId === '' || scheduledAt === '') return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const applicantId of applicantIds) {
      try {
        await scheduleInterview({
          applicantId,
          stageId,
          scheduledAt: new Date(scheduledAt),
          interviewerIds: [],
        });
        ok += 1;
      } catch {
        failed += 1; // server rule refused this applicant (progression / duplicate / not live)
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['hr', 'interviews'] });
    if (failed === 0) toast.success(t('interviews.bulk.scheduledAll', { count: ok }));
    else toast.error(t('interviews.bulk.scheduledSome', { ok, failed }));
    onDone();
    onClose();
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
          <Button loading={busy} disabled={stageId === '' || scheduledAt === ''} onClick={() => void submit()}>
            {t('interviews.actions.schedule')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('interviews.schedule.stage')} required>
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">{t('offers.form.selectRef')}</option>
            {(stages.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.order}. {localized(s.name, locale)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('interviews.schedule.when')} required>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} dir="ltr" />
        </Field>
      </div>
    </Dialog>
  );
};
