// My Profile — the employee's own file, and the one HR screen every employee can open.
//
// A DEDICATED SELF VIEW, not the HR hub with tabs hidden. The hub at `/hr/employees/:id` is an
// administrator's console: nineteen tabs, personnel actions, the settlement and documents files,
// and the Account panel with its security actions. Reusing it and hiding what an employee may not
// see would make every tab added there visible by default until somebody remembered to gate it —
// the wrong way round for a screen the whole company can open. This one shows the two things a
// person needs about themselves and nothing that acts on anyone.
//
// It reads `/hr/employees/me`, so there is no id in the URL to change to somebody else's, and it
// needs no `employee.view` — the permission that would otherwise hand an employee the registry.
//
// What is shown is still decided by the SERVER, not here: the DTO arrives redacted by the caller's
// own permissions, and `compensationVisible` is passed straight through to `EmploymentView`, which
// already knows how to render a salary that was withheld. An employee sees their placement without
// their pay; a manager who holds `employee.viewCompensation` sees their own pay on the same screen,
// through the same code, with no exception written for either of them.
import { Link } from 'react-router-dom';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../../../shared/ui/Card';
import { EmptyState, ErrorState, Spinner } from '../../../../../shared/ui';
import { EmployeeStatusBadge } from '../components/EmployeeStatusBadge';
import { PersonalView } from '../components/PersonalView';
import { EmploymentView } from '../components/EmploymentView';
import { useMyEmployeeProfile } from '../api/employee-queries';

/** Where else this person can go about themselves. Only the ones they can actually open. */
const Shortcut = ({ to, label }: { to: string; label: string }): JSX.Element => (
  <Link
    to={to}
    className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  >
    {label}
  </Link>
);

export const MyProfilePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const { data: employee, isLoading, isError, error, refetch } = useMyEmployeeProfile();

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.mine.title')}
        breadcrumbs={[{ label: t('employees.mine.title') }]}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {can('leave.view') && <Shortcut to="/leave" label={t('leave.my.title')} />}
        {can('attendance.view') && <Shortcut to="/attendance/me" label={t('attendance.my.title')} />}
        {can('employeeLoan.create') && (
          <Shortcut to="/payroll/employee-loans/me" label={t('loans.mine.title')} />
        )}
      </div>
      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {/*
        A login that is not an employee — a platform administrator, an external account. The server
        answers 404 for them, which `ErrorState` above renders; this covers the shape where the
        query resolved to nothing at all.
      */}
      {!isLoading && !isError && employee === undefined && (
        <EmptyState title={t('employees.mine.noEmployee')} description={t('employees.mine.noEmployeeHint')} />
      )}
      {employee !== undefined && (
        <div className="space-y-4">
          <Card>
            <CardBody>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.account.employeeCode')}</dt>
                  <dd className="mt-1 font-mono text-slate-700 dark:text-slate-200" dir="ltr">
                    {employee.code}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.columns.status')}</dt>
                  <dd className="mt-1">
                    <EmployeeStatusBadge status={employee.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">{t('employees.detail.hiredAt')}</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-200">{employee.hiredAt}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <PersonalView personal={employee.personal} />
          <EmploymentView
            employment={employee.employment}
            placement={employee.placement}
            compensationVisible={employee.compensationVisible}
          />
        </div>
      )}
    </PageContainer>
  );
};
