// The "Applications" section on the Department detail page: lists the applications assigned to the
// department and (for department.edit) lets an admin assign a new one or remove an existing link.
// Assigning/removing only touches the link — never the department or the application.
import { useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can } from '../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import { StatusBadge } from '../../../shared/ui/Badge';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../shared/lib/api-client';
import { localized } from '../../../shared/lib/format';
import { useApplications } from '../applications/application-queries';
import {
  useAssignDepartmentApplication,
  useDepartmentApplications,
  useRemoveDepartmentApplication,
} from './department-applications-queries';

export const DepartmentApplicationsCard = ({ departmentId }: { departmentId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canViewApps = useAppSelector(
    (state) =>
      (state.auth.me?.isPrivileged ?? false) ||
      state.auth.me?.permissions['application.view'] !== undefined,
  );

  const { data: assigned = [], isLoading } = useDepartmentApplications(departmentId);
  const { data: allApps } = useApplications({ status: 'active', pageSize: 200 });
  const assign = useAssignDepartmentApplication(departmentId);
  const remove = useRemoveDepartmentApplication(departmentId);

  const [toAssign, setToAssign] = useState('');

  // Active applications not already assigned to this department.
  const available = useMemo(() => {
    const assignedIds = new Set(assigned.map((a) => a.id));
    return (allApps?.items ?? []).filter((a) => !assignedIds.has(a.id));
  }, [allApps, assigned]);

  const doAssign = async (): Promise<void> => {
    if (toAssign === '') return;
    try {
      await assign.mutateAsync(toAssign);
      toast.success(t('organization.departmentApplication.assigned'));
      setToAssign('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') {
        toast.error(t('organization.departmentApplication.duplicate'));
      }
      // other errors surface globally
    }
  };

  const doRemove = async (applicationId: string): Promise<void> => {
    try {
      await remove.mutateAsync(applicationId);
      toast.success(t('organization.departmentApplication.removed'));
    } catch {
      // surfaced globally
    }
  };

  return (
    <Card>
      <CardHeader title={t('organization.departmentApplication.title')} description={t('organization.departmentApplication.subtitle')} />
      <CardBody>
        {isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-4">
            {assigned.length === 0 ? (
              <p className="text-sm text-slate-400">{t('organization.departmentApplication.empty')}</p>
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
                        <StatusBadge tone="neutral" label={t('organization.status.inactive')} />
                      )}
                    </div>
                    <Can permission="department.edit">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={remove.isPending}
                        onClick={() => void doRemove(appl.id)}
                      >
                        {t('common.remove')}
                      </Button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}

            {canViewApps && (
              <Can permission="department.edit">
                <div className="flex items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <div className="flex-1">
                    <Select value={toAssign} onChange={(e) => setToAssign(e.target.value)} aria-label={t('organization.departmentApplication.assign')}>
                      <option value="">{t('organization.departmentApplication.selectApplication')}</option>
                      {available.map((a) => (
                        <option key={a.id} value={a.id}>
                          {localized(a.name, locale)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button size="sm" disabled={toAssign === ''} loading={assign.isPending} onClick={() => void doAssign()}>
                    {t('organization.departmentApplication.assign')}
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
