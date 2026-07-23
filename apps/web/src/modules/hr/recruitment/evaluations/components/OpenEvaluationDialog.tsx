// Open (start) an evaluation for an applicant at a phase. Applicant is chosen with the shared
// autocomplete; the phase comes from the sequential catalog. One record per (applicant, phase) —
// the server is idempotent. On success routes to the new evaluation. RTL-safe.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ApplicantDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Select } from '../../../../../shared/ui/form';
import { localized } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { ApplicantPicker } from '../../interviews/components/ApplicantPicker';
import { useEvaluationPhases, useOpenEvaluation } from '../api/evaluation-queries';

export const OpenEvaluationDialog = ({
  open,
  onClose,
  presetApplicant,
}: {
  open: boolean;
  onClose: () => void;
  presetApplicant?: ApplicantDto | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const phases = useEvaluationPhases();
  const openEval = useOpenEvaluation();
  const [applicant, setApplicant] = useState<ApplicantDto | null>(presetApplicant ?? null);
  const [phaseId, setPhaseId] = useState('');

  const reset = (): void => {
    setApplicant(presetApplicant ?? null);
    setPhaseId('');
  };
  const close = (): void => {
    onClose();
    reset();
  };

  const submit = async (): Promise<void> => {
    if (applicant === null || phaseId === '') return;
    try {
      const evaluation = await openEval.mutateAsync({ applicantId: applicant.id, phaseId });
      toast.success(t('evaluations.open.done'));
      close();
      navigate(`/evaluations/${evaluation.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('evaluations.open.title')}
      description={t('evaluations.open.body')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button
            loading={openEval.isPending}
            disabled={applicant === null || phaseId === ''}
            onClick={() => void submit()}
          >
            {t('evaluations.open.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('evaluations.open.applicant')} required>
          {applicant === null ? (
            <ApplicantPicker onSelect={setApplicant} placeholder={t('evaluations.open.applicantSearch')} />
          ) : (
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <span className="font-mono text-xs text-slate-500" dir="ltr">{applicant.code}</span>
              <button
                type="button"
                onClick={() => setApplicant(null)}
                className="ms-2 text-xs text-brand-600 hover:underline"
              >
                {t('offers.form.change')}
              </button>
            </span>
          )}
        </Field>
        <Field label={t('evaluations.open.phase')} required>
          <Select value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
            <option value="">{t('offers.form.selectRef')}</option>
            {(phases.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.order}. {localized(p.name, locale)}
                {p.driversOnly ? ` (${t('evaluations.phase.driversOnly')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
};
