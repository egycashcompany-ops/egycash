// Evaluation detail: the applicant's record for one phase — attached files (upload / remove), the
// approve/reject decision with reason (editable — re-deciding is audited), and the full audited
// decision history. Application Number only (no names). All mutations permission-gated + version-
// checked. A rejection removes the applicant from the pipeline; correcting it reactivates them.
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type EvaluationDecision, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Select, Textarea } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { TrashIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDateTime, localized } from '../../../../../shared/lib/format';
import { EvaluationStatusBadge } from '../components/EvaluationStatusBadge';
import { MoveToOfferButton } from '../../applicants/components/MoveToOfferButton';
import {
  useDecideEvaluation,
  useEvaluation,
  useRemoveEvaluationFile,
  useUploadEvaluationFile,
} from '../api/evaluation-queries';

export const EvaluationDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const { data: ev, isLoading, isError, error, refetch } = useEvaluation(id);
  const decide = useDecideEvaluation(id);
  const uploadFile = useUploadEvaluationFile(id);
  const removeFile = useRemoveEvaluationFile(id);
  const fileInput = useRef<HTMLInputElement>(null);

  const [decision, setDecision] = useState<EvaluationDecision>('approved');
  const [reason, setReason] = useState('');

  if (isLoading) return <LoadingState />;
  if (isError || ev === undefined) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      await uploadFile.mutateAsync({ file, version: ev.version });
      toast.success(t('evaluations.file.uploaded'));
    } catch {
      // surfaced globally
    } finally {
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  const onRemoveFile = async (fileId: string): Promise<void> => {
    try {
      await removeFile.mutateAsync({ fileId, version: ev.version });
      toast.success(t('evaluations.file.removed'));
    } catch {
      // surfaced globally
    }
  };

  const submitDecision = async (): Promise<void> => {
    if (decision === 'rejected' && reason.trim() === '') {
      toast.error(t('evaluations.decide.reasonRequired'));
      return;
    }
    try {
      await decide.mutateAsync({
        decision,
        version: ev.version,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      toast.success(t('evaluations.decide.done'));
      setReason('');
    } catch {
      // surfaced globally
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={localized(ev.phaseName, locale)}
        description={ev.applicantCode}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.evaluations'), to: '/evaluations' },
          { label: ev.applicantCode },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <MoveToOfferButton applicantId={ev.applicantId} />
            <EvaluationStatusBadge status={ev.status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Files */}
          <Card>
            <CardHeader
              title={t('evaluations.files.title')}
              actions={
                <Can permission="evaluation.manage">
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      className="hidden"
                      onChange={(e) => void onPickFile(e.target.files?.[0])}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={uploadFile.isPending}
                      onClick={() => fileInput.current?.click()}
                    >
                      {t('evaluations.files.upload')}
                    </Button>
                  </>
                </Can>
              }
            />
            <CardBody>
              {ev.files.length === 0 ? (
                <p className="text-sm text-slate-400">{t('evaluations.files.empty')}</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ev.files.map((f) => (
                    <li key={f.fileId} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-700 dark:text-slate-200" dir="ltr">{f.fileName}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(f.uploadedAt, locale)}</p>
                      </div>
                      <Can permission="evaluation.manage">
                        <button
                          type="button"
                          onClick={() => void onRemoveFile(f.fileId)}
                          className="text-slate-400 hover:text-red-600"
                          aria-label={t('common.remove')}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </Can>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Decision (editable — re-deciding is audited) */}
          <Can permission="evaluation.manage">
            <Card>
              <CardHeader title={ev.status === 'pending' ? t('evaluations.decide.title') : t('evaluations.decide.editTitle')} />
              <CardBody>
                <div className="space-y-4">
                  <Field label={t('evaluations.decide.decision')} required>
                    <Select value={decision} onChange={(e) => setDecision(e.target.value as EvaluationDecision)}>
                      <option value="approved">{t('evaluations.status.approved')}</option>
                      <option value="rejected">{t('evaluations.status.rejected')}</option>
                    </Select>
                  </Field>
                  <Field
                    label={t('evaluations.decide.reason')}
                    required={decision === 'rejected'}
                    hint={decision === 'rejected' ? undefined : t('offers.form.optional')}
                  >
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
                  </Field>
                  <div className="flex justify-end">
                    <Button loading={decide.isPending} onClick={() => void submitDecision()}>
                      {ev.status === 'pending' ? t('evaluations.decide.submit') : t('evaluations.decide.update')}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          </Can>
        </div>

        {/* Sidebar: summary + decision history */}
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('evaluations.summary.title')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-slate-400">{t('evaluations.columns.applicant')}</dt>
                  <dd className="font-mono" dir="ltr">
                    <Link to={`/applicants/${ev.applicantId}`} className="text-brand-600 hover:underline">{ev.applicantCode}</Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">{t('evaluations.columns.phase')}</dt>
                  <dd>{ev.phaseOrder}. {localized(ev.phaseName, locale)}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">{t('evaluations.columns.status')}</dt>
                  <dd><EvaluationStatusBadge status={ev.status} /></dd>
                </div>
                {ev.reason !== null && (
                  <div>
                    <dt className="text-slate-400">{t('evaluations.decide.reason')}</dt>
                    <dd className="text-slate-700 dark:text-slate-200">{ev.reason}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>

          {ev.decisionHistory.length > 0 && (
            <Card>
              <CardHeader title={t('evaluations.history.title')} />
              <CardBody>
                <ol className="space-y-3">
                  {[...ev.decisionHistory].reverse().map((h, i) => (
                    <li key={i} className="border-s-2 border-slate-200 ps-3 dark:border-slate-700">
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        {t(`evaluations.status.${h.from}`)} → {t(`evaluations.status.${h.to}`)}
                      </p>
                      <p className="text-xs text-slate-400">{formatDateTime(h.at, locale)}</p>
                      {h.reason !== null && <p className="text-xs text-slate-500">{h.reason}</p>}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
};
