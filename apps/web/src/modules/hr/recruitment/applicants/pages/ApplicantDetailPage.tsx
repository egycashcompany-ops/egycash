// Applicant details: identity/contact/preferences/history read-out, attachments, and the
// verify-identity + withdraw actions (permission-gated). Edits open the form route.
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Textarea } from '../../../../../shared/ui/form';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { EditIcon } from '../../../../../shared/ui/icons';
import { formatDate, formatMoney } from '../../../../../shared/lib/format';
import { ApplicantStatusBadge } from '../components/ApplicantStatusBadge';
import { ReferenceChip } from '../components/RefPickers';
import { AttachmentsPanel } from '../components/AttachmentsPanel';
import { useApplicant, useVerifyApplicantIdentity, useWithdrawApplicant } from '../api/applicant-queries';

const Info = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400 dark:text-slate-500">{label}</dt>
    <dd className="text-sm text-slate-800 dark:text-slate-100">{children ?? '—'}</dd>
  </div>
);

export const ApplicantDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const navigate = useNavigate();
  const can = useCan();
  const { id = '' } = useParams();
  const { data: a, isLoading, isError, error, refetch } = useApplicant(id);

  const verify = useVerifyApplicantIdentity(id);
  const withdraw = useWithdrawApplicant(id);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [nationalId, setNationalId] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || a === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const submitVerify = async (): Promise<void> => {
    try {
      await verify.mutateAsync({
        version: a.version,
        ...(nationalId.trim() === '' ? {} : { nationalId: nationalId.trim() }),
      });
      toast.success(t('applicants.verify.done'));
      setVerifyOpen(false);
      setNationalId('');
    } catch {
      // surfaced globally
    }
  };

  const submitWithdraw = async (): Promise<void> => {
    try {
      await withdraw.mutateAsync({ version: a.version, reason: reason.trim() });
      toast.success(t('applicants.withdraw.done'));
      setWithdrawOpen(false);
      setReason('');
    } catch {
      // surfaced globally
    }
  };

  const gridCls = 'grid grid-cols-2 gap-4 sm:grid-cols-3';

  return (
    <PageContainer>
      <PageHeader
        title={a.fullNameAr}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.applicants'), to: '/applicants' },
          { label: a.code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {a.status === 'new' && can('applicant.verifyIdentity') && a.identityVerification !== 'verified' && (
              <Button size="sm" variant="secondary" onClick={() => setVerifyOpen(true)}>
                {t('applicants.actions.verify')}
              </Button>
            )}
            {a.status === 'new' && (
              <Can permission="applicant.edit">
                <Button size="sm" variant="secondary" onClick={() => setWithdrawOpen(true)}>
                  {t('applicants.actions.withdraw')}
                </Button>
              </Can>
            )}
            {a.status === 'new' && (
              <Can permission="applicant.edit">
                <Button size="sm" leftIcon={<EditIcon className="h-4 w-4" />} onClick={() => navigate('edit')}>
                  {t('common.edit')}
                </Button>
              </Can>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">{a.code}</span>
        <ApplicantStatusBadge status={a.status} />
        <span className={a.identityVerification === 'verified' ? 'text-sm text-emerald-600' : 'text-sm text-slate-400'}>
          {t(`applicants.identity.${a.identityVerification}`)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('applicants.form.identity')} />
            <CardBody>
              <dl className={gridCls}>
                <Info label={t('applicants.form.fullNameEn')}>{a.fullNameEn}</Info>
                <Info label={t('applicants.form.nationalId')}>
                  <span dir="ltr">{a.nationalIdMasked}</span>
                </Info>
                <Info label={t('applicants.form.nationality')}>{a.nationality}</Info>
                <Info label={t('applicants.detail.birthDate')}>{formatDate(a.birthDate, locale)}</Info>
                <Info label={t('applicants.detail.gender')}>{a.gender === null ? '—' : t(`applicants.gender.${a.gender}`)}</Info>
                <Info label={t('applicants.form.maritalStatus')}>{a.maritalStatus === null ? '—' : t(`applicants.marital.${a.maritalStatus}`)}</Info>
                {a.placeOfBirth !== null && <Info label={t('applicants.detail.governorate')}>{a.placeOfBirth}</Info>}
                {a.religion !== null && <Info label={t('applicants.form.religion')}>{a.religion}</Info>}
                {a.nationalIdExpiry !== null && <Info label={t('applicants.form.nationalIdExpiry')}>{formatDate(a.nationalIdExpiry, locale)}</Info>}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('applicants.form.contact')} />
            <CardBody>
              <dl className={gridCls}>
                <Info label={t('applicants.form.primaryPhone')}><span dir="ltr">{a.contact.primaryPhone}</span></Info>
                <Info label={t('applicants.form.secondaryPhone')}><span dir="ltr">{a.contact.secondaryPhone ?? '—'}</span></Info>
                <Info label={t('applicants.form.email')}><span dir="ltr">{a.contact.email ?? '—'}</span></Info>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('applicants.form.preferences')} />
            <CardBody>
              <dl className={gridCls}>
                <Info label={t('applicants.form.expectedSalary')}>
                  {a.expectedSalary === null ? '—' : formatMoney(a.expectedSalary.amount, a.expectedSalary.currency, locale)}
                </Info>
                <Info label={t('applicants.form.earliestStart')}>{formatDate(a.earliestStartDate, locale)}</Info>
                <Info label={t('applicants.detail.willing')}>
                  {[a.willingToRelocate && t('applicants.form.willingRelocate'), a.willingToTravel && t('applicants.form.willingTravel'), a.willingToShiftWork && t('applicants.form.willingShift')]
                    .filter((x): x is string => typeof x === 'string')
                    .join('، ') || '—'}
                </Info>
              </dl>
            </CardBody>
          </Card>

          {a.experience.length > 0 && (
            <Card>
              <CardHeader title={t('applicants.form.experience')} />
              <CardBody className="space-y-2">
                {a.experience.map((e, i) => (
                  <div key={i} className="text-sm text-slate-700 dark:text-slate-200">
                    <span className="font-medium">{e.employer}</span>
                    {e.position !== undefined && <span className="text-slate-400"> — {e.position}</span>}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('applicants.detail.application')} />
            <CardBody>
              <dl className="space-y-3">
                <Info label={t('applicants.ref.requisition')}><ReferenceChip kind="requisition" value={a.jobRequisitionId} /></Info>
                {a.branchId !== null && <Info label={t('applicants.ref.branch')}><ReferenceChip kind="branch" value={a.branchId} /></Info>}
                <Info label={t('applicants.form.channel')}>{t(`applicants.channel.${a.intakeChannel}`)}</Info>
                <Info label={t('applicants.detail.registered')}>{formatDate(a.createdAt, locale)}</Info>
                {a.duplicateFlag && <Info label={t('applicants.detail.duplicate')}><span className="text-amber-600">{t('applicants.detail.duplicateFlagged')}</span></Info>}
                {a.withdrawnReason !== null && <Info label={t('applicants.withdraw.reason')}>{a.withdrawnReason}</Info>}
              </dl>
            </CardBody>
          </Card>

          <AttachmentsPanel applicantId={a.id} canEdit={a.status === 'new' && can('applicant.edit')} />
        </div>
      </div>

      <Dialog
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title={t('applicants.verify.title')}
        description={t('applicants.verify.body')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVerifyOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={verify.isPending} onClick={() => void submitVerify()}>{t('applicants.actions.verify')}</Button>
          </>
        }
      >
        <Field label={t('applicants.form.nationalId')} hint={t('applicants.verify.nationalIdHint')}>
          <Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} dir="ltr" inputMode="numeric" />
        </Field>
      </Dialog>

      <Dialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title={t('applicants.withdraw.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setWithdrawOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={withdraw.isPending} disabled={reason.trim() === ''} onClick={() => void submitWithdraw()}>
              {t('applicants.actions.withdraw')}
            </Button>
          </>
        }
      >
        <Field label={t('applicants.withdraw.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Dialog>
    </PageContainer>
  );
};
