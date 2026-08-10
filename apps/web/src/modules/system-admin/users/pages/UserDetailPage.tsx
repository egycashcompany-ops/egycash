// One account, everything an administrator needs to see and the actions this slice exposes.
//
// Three tabs rather than one long page, because they answer different questions and are read at
// different moments: WHO this is (overview), WHAT its credential state is and what can be done
// about it (security), and WHAT HAS HAPPENED to it (activity). The tab lives in the URL so a
// support conversation can link to the security panel of a specific account.
//
// The employee link is INDICATION, not administration: it renders whether this login belongs to an
// employee and offers a way through to the HR record, and it never writes. HR owns that linkage
// (`user.employeeId` is the authority, `employee.userId` its denormalized back-reference), and
// linking/unlinking is HR service work in the next slice — writing the field from here would leave
// the two sides disagreeing.
import { useState } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, ErrorState, LoadingState } from '../../../../shared/ui';
import { Can } from '../../../../platform/rbac/Can';
import { fullName } from '../../../../shared/lib/format';
import { cn } from '../../../../shared/lib/cn';
import { AccountStatusBadge, UserStatusBadge } from '../components/UserStatusBadges';
import { UserAccountCard, UserIdentityCard } from '../components/UserFactCards';
import { UserLifecycleActions } from '../components/UserLifecycleActions';
import { UserSecurityActions } from '../components/UserSecurityActions';
import { UserActivityTab } from '../components/UserActivityTab';
import { UserEmployeeLinkCard } from '../components/UserEmployeeLinkCard';
import { UserFormDialog } from '../components/UserFormDialog';
import { useSystemUser } from '../api/user-queries';

const TABS = ['overview', 'security', 'activity'] as const;
type Tab = (typeof TABS)[number];

export const UserDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const can = useCan();
  const { id = '' } = useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();
  const [editing, setEditing] = useState(false);

  const tabParam = sp.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'overview';

  const { data: user, isLoading, isError, error, refetch } = useSystemUser(id);

  if (isLoading) return <PageContainer><LoadingState /></PageContainer>;
  if (isError || user === undefined) {
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

  // The subtitle is the sign-in identifier when there is one. `exactOptionalPropertyTypes`: an
  // absent subtitle is an absent PROP, never an `undefined` value.
  const identifier = user.username ?? user.email;

  return (
    <PageContainer>
      <PageHeader
        title={fullName(user, locale)}
        {...(identifier === null ? {} : { description: identifier })}
        breadcrumbs={[
          { label: t('systemAdmin.module.title') },
          { label: t('systemAdmin.users.title'), to: '/system/users' },
          { label: fullName(user, locale) },
        ]}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <UserStatusBadge status={user.status} />
            <AccountStatusBadge status={user.accountStatus} />
          </div>
        }
        actions={
          <Can permission="user.edit">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t('systemAdmin.users.actions.edit')}
            </Button>
          </Can>
        }
      />

      {/* Keyed on the account's version so a reopened dialog starts from the CURRENT record rather
          than the draft the last edit left behind. */}
      {editing && (
        <UserFormDialog
          key={`${user.id}:${String(user.version)}`}
          open
          user={user}
          onClose={() => setEditing(false)}
        />
      )}

      <div
        className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
        aria-label={t('systemAdmin.users.title')}
      >
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === name
                ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
            )}
          >
            {t(`systemAdmin.users.tabs.${name}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <UserEmployeeLinkCard userId={user.id} employeeId={user.employeeId} />
          {user.employeeId !== null && can('employee.view') && (
            <div>
              <Button
                size="sm"
                variant="ghost-brand"
                onClick={() => navigate(`/employees/${user.employeeId ?? ''}`)}
              >
                {t('systemAdmin.users.employee.open')}
              </Button>
            </div>
          )}
          <UserIdentityCard user={user} />
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-4">
          <UserAccountCard user={user} />
          <UserLifecycleActions user={user} />
          <UserSecurityActions user={user} />
        </div>
      )}

      {tab === 'activity' && <UserActivityTab userId={user.id} />}
    </PageContainer>
  );
};
