// Start a screening for an applicant: pick a live applicant (search) + an optional first note.
// One screening per applicant (server-enforced); on success routes to the new screening.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ApplicantDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { ApplicantPicker } from './ApplicantPicker';
import { useCreateScreening } from '../api/screening-queries';

export const CreateScreeningDialog = ({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateScreening();
  const [applicant, setApplicant] = useState<ApplicantDto | null>(null);
  const [note, setNote] = useState('');

  const reset = (): void => {
    setApplicant(null);
    setNote('');
  };

  const submit = async (): Promise<void> => {
    if (applicant === null) return;
    try {
      const screening = await create.mutateAsync({
        applicantId: applicant.id,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success(t('screening.create.done'));
      onClose();
      reset();
      navigate(`/screening/${screening.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title={t('screening.create.title')}
      description={t('screening.create.body')}
      footer={
        <>
          <Button variant="secondary" onClick={() => { onClose(); reset(); }}>{t('common.cancel')}</Button>
          <Button loading={create.isPending} disabled={applicant === null} onClick={() => void submit()}>
            {t('screening.create.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('screening.create.applicant')} required>
          {applicant === null ? (
            <ApplicantPicker onSelect={setApplicant} />
          ) : (
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <span className="font-mono text-xs text-slate-400" dir="ltr">{applicant.code}</span>
              <span className="text-slate-700 dark:text-slate-200">{applicant.fullNameAr}</span>
              <button type="button" onClick={() => setApplicant(null)} className="ms-2 text-xs text-brand-600 hover:underline">
                {t('screening.create.change')}
              </button>
            </span>
          )}
        </Field>
        <Field label={t('screening.notes.first')} hint={t('screening.notes.optional')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
      </div>
    </Dialog>
  );
};
