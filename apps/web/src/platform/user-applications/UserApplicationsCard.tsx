// Which applications an account has been GRANTED — and why that is not the same question as what it
// may do.
//
// Navigation is a union of two grants (this one, and the account's department's) INTERSECTED with
// the permissions RBAC gives it. A grant is an administrator saying "this is on offer to you"; the
// permission is RBAC saying whether you may enter it. Neither implies the other, and the sidebar
// shows only what has both — so an account holding a role full of permissions and no grant at all
// sees an EMPTY sidebar, which is exactly the confusion this card is placed here to end.
//
// **It lives in `platform/` because that is what it is about**: platform users and the platform
// application catalog, with no HR concept anywhere in it. It sat under HR's employee profile only
// because that was the first screen in the product with a user detail on it — System Administration
// now has one too, and both import it from here rather than one module reaching into another.
//
// Assigning or removing only touches the LINK — never the user, never the application.
import { useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../localization/useT';
import { useAppSelector } from '../../store';
import { Can } from '../rbac/Can';
import { Card, CardBody, CardHeader } from '../../shared/ui/Card';
import { Button } from '../../shared/ui/Button';
import { Select } from '../../shared/ui/form';
import { StatusBadge } from '../../shared/ui/Badge';
import { LoadingState } from '../../shared/ui/states/LoadingState';
import { toast } from '../../shared/ui/toast/toast-store';
import { ApiError } from '../../shared/lib/api-client';
import { localized } from '../../shared/lib/format';
import {
  useActiveApplications,
  useAssignUserApplication,
  useRemoveUserApplication,
  useUserApplications,
} from './user-application-queries';

export const UserApplicationsCard = ({ userId }: { userId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canViewApps = useAppSelector(
    (state) =>
      (state.auth.me?.isPrivileged ?? false) ||
      state.auth.me?.permissions['application.view'] !== undefined,
  );

  const { data: assigned = [], isLoading } = useUserApplications(userId);
  const { data: allApps = [] } = useActiveApplications(canViewApps);
  const assign = useAssignUserApplication(userId);
  const remove = useRemoveUserApplication(userId);

  const [toAssign, setToAssign] = useState('');

  const available = useMemo(() => {
    const assignedIds = new Set(assigned.map((a) => a.id));
    return allApps.filter((a) => !assignedIds.has(a.id));
  }, [allApps, assigned]);

  const doAssign = async (): Promise<void> => {
    if (toAssign === '') return;
    try {
      await assign.mutateAsync(toAssign);
      toast.success(t('userApplications.assigned'));
      setToAssign('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') {
        toast.error(t('userApplications.duplicate'));
      }
      // other errors surface globally
    }
  };

  const doRemove = async (applicationId: string): Promise<void> => {
    try {
      await remove.mutateAsync(applicationId);
      toast.success(t('userApplications.removed'));
    } catch {
      // surfaced globally
    }
  };

  return (
    <Card>
      <CardHeader title={t('userApplications.title')} description={t('userApplications.subtitle')} />
      <CardBody>
        {isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-4">
            {assigned.length === 0 ? (
              <p className="text-sm text-slate-400">{t('userApplications.empty')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {assigned.map((appl) => (
                  <li key={appl.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-700 dark:text-slate-200">{localized(appl.name, locale)}</span>
                      <span className="font-mono text-xs text-slate-400" dir="ltr">
                        {appl.route}
                      </span>
                      {appl.status !== 'active' && (
                        <StatusBadge tone="neutral" label={t('userApplications.inactive')} />
                      )}
                    </div>
                    <Can permission="user.edit">
                      <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => void doRemove(appl.id)}>
                        {t('common.remove')}
                      </Button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}

            {canViewApps && (
              <Can permission="user.edit">
                <div className="flex items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <div className="flex-1">
                    <Select value={toAssign} onChange={(e) => setToAssign(e.target.value)} aria-label={t('userApplications.assign')}>
                      <option value="">{t('userApplications.selectApplication')}</option>
                      {available.map((a) => (
                        <option key={a.id} value={a.id}>
                          {localized(a.name, locale)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button size="sm" disabled={toAssign === ''} loading={assign.isPending} onClick={() => void doAssign()}>
                    {t('userApplications.assign')}
                  </Button>
                </div>
              </Can>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
};
