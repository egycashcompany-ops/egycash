// Schedule an interview round: pick an applicant, a stage (admin catalog), and a date/time. The
// interview committee is OPTIONAL (assign members later via reassign-panel); location + notes are
// optional too. Matches ScheduleInterview exactly. On success routes to the new interview.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { ApplicantPicker } from './ApplicantPicker';
import { UserPicker, type SelectedUser } from './UserPicker';
import { useInterviewStages, useScheduleInterview } from '../api/interview-queries';

/** Minimal applicant shape the dialog needs — satisfied by a full ApplicantDto or an awaiting row. */
export interface PickedApplicant {
  id: string;
  code: string;
  fullNameAr: string;
}

export const ScheduleInterviewDialog = ({
  open,
  onClose,
  applicant: presetApplicant,
}: {
  open: boolean;
  onClose: () => void;
  applicant?: PickedApplicant;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const schedule = useScheduleInterview();
  const { data: stages = [] } = useInterviewStages();

  const [applicant, setApplicant] = useState<PickedApplicant | null>(presetApplicant ?? null);
  const [stageId, setStageId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [panel, setPanel] = useState<SelectedUser[]>([]);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const reset = (): void => {
    setApplicant(presetApplicant ?? null);
    setStageId('');
    setScheduledAt('');
    setPanel([]);
    setLocation('');
    setNotes('');
  };

  const close = (): void => {
    onClose();
    reset();
  };

  // The committee is OPTIONAL — an interview can be scheduled before members are assigned
  // (assign them later via reassign-panel). Only applicant, stage and time are required.
  const valid = applicant !== null && stageId !== '' && scheduledAt !== '';

  const submit = async (): Promise<void> => {
    if (applicant === null || !valid) return;
    try {
      const created = await schedule.mutateAsync({
        applicantId: applicant.id,
        stageId,
        scheduledAt: new Date(scheduledAt),
        interviewerIds: panel.map((u) => u.id),
        ...(location.trim() === '' ? {} : { location: location.trim() }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      });
      toast.success(t('interviews.schedule.done'));
      close();
      navigate(`/interviews/${created.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={t('interviews.schedule.title')}
      description={t('interviews.schedule.body')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button loading={schedule.isPending} disabled={!valid} onClick={() => void submit()}>
            {t('interviews.schedule.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('interviews.schedule.applicant')} required>
          {applicant === null ? (
            <ApplicantPicker onSelect={setApplicant} />
          ) : (
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <span className="font-mono text-xs text-slate-400" dir="ltr">{applicant.code}</span>
              <span className="text-slate-700 dark:text-slate-200">{applicant.fullNameAr}</span>
              {presetApplicant === undefined && (
                <button type="button" onClick={() => setApplicant(null)} className="ms-2 text-xs text-brand-600 hover:underline">
                  {t('interviews.schedule.change')}
                </button>
              )}
            </span>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('interviews.schedule.stage')} required>
            <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">{t('interviews.schedule.pickStage')}</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{localized(s.name, locale)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('interviews.schedule.when')} required>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} dir="ltr" />
          </Field>
        </div>

        <Field label={t('interviews.schedule.panel')} hint={t('interviews.schedule.panelOptionalHint')}>
          <UserPicker value={panel} onChange={setPanel} />
        </Field>

        <Field label={t('interviews.schedule.location')}>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
        </Field>

        <Field label={t('interviews.schedule.notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
        </Field>
      </div>
    </Dialog>
  );
};
