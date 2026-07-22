// Employee detail: the employee number, status, preserved references (applicant + accepted offer),
// and the copied employment terms. Read-only in this stage — no lifecycle mutations are exposed.
import { Link, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { formatDateTime, formatNumber } from '../../../../../shared/lib/format';
import { EmployeeStatusBadge } from '../components/EmployeeStatusBadge';
import { EmploymentView } from '../components/EmploymentView';
import { EmployeeAccountCard } from '../components/EmployeeAccountCard';
import { UserApplicationsCard } from '../components/UserApplicationsCard';
import { useEmployee } from '../api/employee-queries';

export const EmployeeDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const { data: e, isLoading, isError, error, refetch } = useEmployee(id);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || e === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.detail.title', { code: e.code })}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('recruitment.nav.employees'), to: '/employees' },
          { label: e.code },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">{e.code}</span>
        <Link to={`/applicants/${e.applicantId}`} className="font-mono text-sm text-brand-600 hover:underline" dir="ltr">
          {e.applicantCode}
        </Link>
        <EmployeeStatusBadge status={e.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t('employees.detail.employment')} />
            <CardBody>
              <EmploymentView employment={e.employment} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <EmployeeAccountCard employee={e} />
          {e.userId !== null && <UserApplicationsCard userId={e.userId} />}
          <Card>
            <CardHeader title={t('employees.detail.summary')} />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.columns.status')}</dt>
                  <dd className="mt-1"><EmployeeStatusBadge status={e.status} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.detail.hiredAt')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(e.hiredAt, locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.detail.offer')}</dt>
                  <dd className="mt-1">
                    <Link to={`/job-offers/${e.jobOfferId}`} className="font-mono text-xs text-brand-600 hover:underline" dir="ltr">
                      {e.offerCode}
                    </Link>
                    <span className="ms-2 text-xs text-slate-400">
                      {t('employees.detail.revision', { n: formatNumber(e.acceptedOfferRevision, locale) })}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.columns.created')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(e.createdAt, locale)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
