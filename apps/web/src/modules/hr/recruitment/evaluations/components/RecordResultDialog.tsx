// RW9 — the individual-phase workspace in one dialog: upload the returned result document and
// record the decision without leaving the queue. Medical Check is the phase this exists for; any
// individual phase gets it.
//
// The two steps stay separate server-side (upload, then decide), so a decision is never recorded
// against a document that failed to store — the dialog only advances once the upload succeeded.
import { useRef, useState } from 'react';
import { type EvaluationDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import {
  useDecideEvaluation,
  useSetEvaluationAppointment,
  useUploadEvaluationFile,
} from '../api/evaluation-queries';

export const RecordResultDialog = ({
  evaluation,
  appointmentEnabled,
  open,
  onClose,
}: {
  evaluation: EvaluationDto | null;
  appointmentEnabled: boolean;
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const id = evaluation?.id ?? '';
  const upload = useUploadEvaluationFile(id);
  const decide = useDecideEvaluation(id);
  const appointment = useSetEvaluationAppointment(id);
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [visitAt, setVisitAt] = useState('');

  const reset = (): void => {
    setFile(null);
    setReason('');
    setVisitAt('');
    if (fileInput.current !== null) fileInput.current.value = '';
  };

  /** Upload first (if a file was picked), then decide against the version the upload returned. */
  const submit = async (decision: 'approved' | 'rejected'): Promise<void> => {
    if (evaluation === null) return;
    if (decision === 'rejected' && reason.trim() === '') {
      toast.error(t('evaluations.decide.reasonRequired'));
      return;
    }
    try {
      let version = evaluation.version;
      if (file !== null) {
        const uploaded = await upload.mutateAsync({ file, version });
        version = uploaded.version;
      }
      await decide.mutateAsync({
        decision,
        version,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      toast.success(t('evaluations.decide.done'));
      reset();
      onClose();
    } catch {
      // surfaced globally
    }
  };

  const saveVisit = async (): Promise<void> => {
    if (evaluation === null || visitAt === '') return;
    try {
      await appointment.mutateAsync({
        appointmentAt: new Date(visitAt),
        version: evaluation.version,
      });
      toast.success(t('evaluations.appointment.saved'));
      setVisitAt('');
    } catch {
      // surfaced globally
    }
  };

  const busy = upload.isPending || decide.isPending;

  return (
    <Dialog
      open={open && evaluation !== null}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('evaluations.result.title')}
      {...(evaluation === null
        ? {}
        : { description: `${evaluation.applicantName} · ${evaluation.applicantCode}` })}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void submit('rejected')}>
            {t('evaluations.actions.reject')}
          </Button>
          <Button loading={busy} onClick={() => void submit('approved')}>
            {t('evaluations.actions.approve')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {appointmentEnabled && (
          <Field label={t('evaluations.appointment.label')} hint={t('evaluations.appointment.hint')}>
            <div className="flex gap-2">
              <Input
                type="datetime-local"
                value={visitAt}
                onChange={(e) => setVisitAt(e.target.value)}
              />
              <Button
                variant="secondary"
                loading={appointment.isPending}
                disabled={visitAt === ''}
                onClick={() => void saveVisit()}
              >
                {t('common.save')}
              </Button>
            </div>
          </Field>
        )}

        <Field label={t('evaluations.result.file')} hint={t('evaluations.result.fileHint')}>
          <input
            ref={fileInput}
            type="file"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>

        <Field label={t('bulk.reason.title')} hint={t('evaluations.result.reasonHint')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
