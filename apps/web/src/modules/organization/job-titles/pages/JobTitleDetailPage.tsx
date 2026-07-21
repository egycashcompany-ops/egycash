// Job Title detail: the full role definition (grade, salary band, description, qualifications,
// experience) plus edit / delete. A Job Title is an organization-wide catalog entry — it is not tied
// to any Branch/Department/Section; that linkage is the concern of Job Positions (a later phase).
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Badge, StatusBadge } from '../../../../shared/ui/Badge';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatMoney, localized } from '../../../../shared/lib/format';
import { useDeleteJobTitle, useJobTitle } from '../job-title-queries';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 whitespace-pre-line text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const JobTitleDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: jt, isLoading, isError, error, refetch } = useJobTitle(id);
  const remove = useDeleteJobTitle();
  const [confirming, setConfirming] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || jt === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const dash = '—';
  const band =
    jt.salaryMin === null && jt.salaryMax === null
      ? dash
      : `${jt.salaryMin === null ? '' : formatMoney(jt.salaryMin, 'EGP', locale)} – ${
          jt.salaryMax === null ? '' : formatMoney(jt.salaryMax, 'EGP', locale)
        }`;

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(jt.id);
      toast.success(t('organization.jobTitle.deleted'));
      navigate('/organization/job-titles');
    } catch {
      setConfirming(false);
      toast.error(t('organization.delete.failed'));
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={localized(jt.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.jobTitles'), to: '/organization/job-titles' },
          { label: jt.code },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission="jobTitle.edit">
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission="jobTitle.delete">
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">
          {jt.code}
        </span>
        <Badge tone="brand">{t('organization.jobTitle.grade')}: {jt.jobGrade}</Badge>
        <StatusBadge
          tone={jt.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${jt.status}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('organization.detail.identity')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={`${t('organization.field.name')} (${t('organization.lang.ar')})`}>
                <span dir="rtl">{jt.name.ar}</span>
              </Row>
              <Row label={`${t('organization.field.name')} (${t('organization.lang.en')})`}>
                <span dir="ltr">{jt.name.en}</span>
              </Row>
              <Row label={t('organization.jobTitle.grade')}>{jt.jobGrade}</Row>
              <Row label={t('organization.jobTitle.description')}>
                {jt.description === null ? dash : localized(jt.description, locale)}
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('organization.jobTitle.requirements')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.jobTitle.salary')}>{band}</Row>
              <Row label={t('organization.jobTitle.experience')}>
                {jt.requiredExperienceYears === null
                  ? dash
                  : t('organization.jobTitle.years', { n: jt.requiredExperienceYears })}
              </Row>
              <Row label={t('organization.jobTitle.qualifications')}>
                {jt.requiredQualifications === null ? dash : localized(jt.requiredQualifications, locale)}
              </Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('organization.jobTitle.deleteTitle')}
        description={t('organization.delete.confirm', { name: localized(jt.name, locale) })}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => void doDelete()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('organization.delete.body')}</p>
      </Dialog>
    </PageContainer>
  );
};
