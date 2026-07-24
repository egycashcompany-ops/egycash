// The Employee Profile hub (frozen design §8): header (name, code, status, Actions menu
// filtered by status × permissions) + tabs — Overview, Personal, Employment (action history),
// Documents (the Electronic Employee File), Timeline (composed), Account (login link). Shows a
// pending-exit banner while a scheduled exit exists and the probation card while unconfirmed.
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EMPLOYEE_EXIT_TYPES, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Timeline, type TimelineEntry } from '../../../../../shared/ui/Timeline';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { formatDate, formatDateTime } from '../../../../../shared/lib/format';
import { useState } from 'react';
import { EmployeeStatusBadge } from '../components/EmployeeStatusBadge';
import { EmploymentView } from '../components/EmploymentView';
import { EmployeeAccountCard } from '../components/EmployeeAccountCard';
import { UserApplicationsCard } from '../components/UserApplicationsCard';
import { ActionsMenu } from '../components/actions/ActionsMenu';
import { ActionHistory } from '../components/ActionHistory';
import { PersonalView } from '../components/PersonalView';
import { EditPersonalDialog } from '../components/EditPersonalDialog';
import { EmployeeFileDocuments } from '../../employee-files/components/EmployeeFileDocuments';
import { useEmployeeFiles } from '../../employee-files/api/employee-file-queries';
import { useEmployee, useEmployeeActions, useEmployeeTimeline } from '../api/employee-queries';

const TABS = ['overview', 'personal', 'employment', 'documents', 'timeline', 'account'] as const;
type Tab = (typeof TABS)[number];

const ProbationCard = ({ e }: { e: EmployeeDto }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (e.status !== 'probation' || e.probation === null || e.probation.confirmedAt !== null) return null;
  const deadline = e.probation.extendedTo ?? e.probation.endDate;
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
      {t('employees.probation.banner', {
        date: deadline === null ? '—' : formatDate(deadline, locale),
      })}
    </div>
  );
};

const OverviewTab = ({ e }: { e: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <ProbationCard e={e} />
        <Card>
          <CardHeader title={t('employees.detail.employment')} />
          <CardBody>
            <EmploymentView employment={e.employment} compensationVisible={e.compensationVisible} />
          </CardBody>
        </Card>
        {e.exit !== null && (
          <Card>
            <CardHeader title={t('employees.exit.title')} />
            <CardBody>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.actions.exit.type')}</dt>
                  <dd className="mt-0.5 text-sm">{t(`employees.exitType.${e.exit.type}`)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.actions.effectiveDate')}</dt>
                  <dd className="mt-0.5 text-sm">{formatDate(e.exit.effectiveDate, locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.actions.reason')}</dt>
                  <dd className="mt-0.5 text-sm">{e.exit.reason ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.actions.exit.eligibleForRehire')}</dt>
                  <dd className="mt-0.5 text-sm">
                    {e.exit.eligibleForRehire ? t('common.yes') : t('common.no')}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title={t('employees.detail.summary')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">{t('employees.columns.status')}</dt>
                <dd className="mt-1"><EmployeeStatusBadge status={e.status} /></dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">{t('employees.detail.origin')}</dt>
                <dd className="mt-1">{t(`employees.origin.${e.origin}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">{t('employees.detail.hiredAt')}</dt>
                <dd className="mt-1 text-slate-700 dark:text-slate-200">{formatDateTime(e.hiredAt, locale)}</dd>
              </div>
              {e.applicantId !== null && (
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.columns.applicant')}</dt>
                  <dd className="mt-1">
                    <Link to={`/applicants/${e.applicantId}`} className="font-mono text-xs text-brand-600 hover:underline" dir="ltr">
                      {e.applicantCode}
                    </Link>
                  </dd>
                </div>
              )}
              {e.jobOfferId !== null && (
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.detail.offer')}</dt>
                  <dd className="mt-1">
                    <Link to={`/job-offers/${e.jobOfferId}`} className="font-mono text-xs text-brand-600 hover:underline" dir="ltr">
                      {e.offerCode}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('employees.periods.title')} />
          <CardBody>
            <ol className="space-y-2 text-sm">
              {e.employmentPeriods.map((p, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>
                    {formatDate(p.hiredAt, locale)} →{' '}
                    {p.exitedAt === null ? t('employees.periods.current') : formatDate(p.exitedAt, locale)}
                  </span>
                  {p.exitType !== null && (
                    <span className="text-xs text-slate-400">{t(`employees.exitType.${p.exitType}`)}</span>
                  )}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

const DocumentsTab = ({ e }: { e: EmployeeDto }): JSX.Element => {
  const t = useT();
  const files = useEmployeeFiles({ employeeId: e.id, pageSize: 1 });
  const file = files.data?.items[0];
  if (files.isLoading) return <LoadingState />;
  if (file === undefined) {
    return (
      <EmptyState
        title={t('employees.documents.noFile')}
        description={t('employees.documents.noFileHint')}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link to={`/employee-files/${file.id}`} className="text-sm text-brand-600 hover:underline">
          {t('employees.documents.openFile')}
        </Link>
      </div>
      <EmployeeFileDocuments fileId={file.id} documents={file.documents} version={file.version} />
    </div>
  );
};

const TimelineTab = ({ e }: { e: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading } = useEmployeeTimeline(e.id);
  if (isLoading) return <LoadingState />;
  const label = (item: { source: string; type: string }): string => {
    if (item.source === 'action') return t(`employees.actionType.${item.type}`);
    if (item.source === 'personal') return t('employees.timeline.personalDataUpdated');
    if (item.source === 'note') return t('employeeFiles.event.note');
    return t(`employeeFiles.event.${item.type}`);
  };
  const entries: TimelineEntry[] = (data ?? []).map((item, i) => ({
    id: `${item.at}-${String(i)}`,
    title: label(item),
    meta: formatDateTime(item.at, locale),
    ...(item.detail === null ? {} : { description: item.detail }),
    tone:
      item.source === 'action' ? ('brand' as const) : item.source === 'personal' ? ('warning' as const) : ('neutral' as const),
  }));
  if (entries.length === 0) return <EmptyState title={t('employees.timeline.empty')} />;
  return (
    <Card>
      <CardBody>
        <Timeline entries={entries} />
      </CardBody>
    </Card>
  );
};

export const EmployeeProfilePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'overview';
  const [editPersonal, setEditPersonal] = useState(false);
  const { data: e, isLoading, isError, error, refetch } = useEmployee(id);
  // Pending-exit banner: a still-scheduled exit action (frozen design §3 edge rule).
  const scheduled = useEmployeeActions(id, { page: 1, pageSize: 20, status: 'scheduled' });
  const pendingExit = (scheduled.data?.items ?? []).find((a) =>
    (EMPLOYEE_EXIT_TYPES as readonly string[]).includes(a.type),
  );

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

  const setTab = (next: Tab): void => {
    const params = new URLSearchParams(sp);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSp(params, { replace: true });
  };

  return (
    <PageContainer>
      <PageHeader
        title={e.personal.fullNameAr}
        description={e.code}
        breadcrumbs={[
          { label: t('employees.module.title'), to: '/employees' },
          { label: e.code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <ActionsMenu employee={e} />
            <EmployeeStatusBadge status={e.status} />
          </div>
        }
      />

      {pendingExit !== undefined && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {t('employees.exit.pendingBanner', {
            type: t(`employees.exitType.${pendingExit.type}`),
            date: formatDate(pendingExit.effectiveDate, locale),
          })}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              tab === k
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`employees.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab e={e} />}
      {tab === 'personal' && (
        <div className="space-y-4">
          <Can permission="employee.editPersonal">
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setEditPersonal(true)}>
                {t('employees.personal.edit')}
              </Button>
            </div>
          </Can>
          <PersonalView personal={e.personal} />
          <EditPersonalDialog employee={e} open={editPersonal} onClose={() => setEditPersonal(false)} />
        </div>
      )}
      {tab === 'employment' && <ActionHistory employee={e} />}
      {tab === 'documents' && <DocumentsTab e={e} />}
      {tab === 'timeline' && <TimelineTab e={e} />}
      {tab === 'account' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EmployeeAccountCard employee={e} />
          {e.userId !== null && <UserApplicationsCard userId={e.userId} />}
        </div>
      )}
    </PageContainer>
  );
};
