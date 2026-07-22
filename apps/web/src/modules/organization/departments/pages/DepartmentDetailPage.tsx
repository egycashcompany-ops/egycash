// Department detail (Phase 3.2). Shows identity (Code, ar/en name, description, manager), placement
// (the owning Branch — each department belongs to exactly one — plus path and audit timestamps), and
// the department actions: Edit, Activate/Deactivate (version-checked) and Delete (soft, guarded
// server-side against departments that still have sections). The Department Code is immutable after
// creation (the update schema omits it).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../shared/lib/api-client';
import { formatDateTime, localized } from '../../../../shared/lib/format';
import { UserName } from '../../shared/UserPicker';
import { useBranchOptions } from '../../shared/references';
import { departmentConfig } from '../../shared/unit-config';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const DepartmentDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();

  const { data: department, isLoading, isError, error, refetch } = departmentConfig.queries.useOne(id);
  const update = departmentConfig.queries.useUpdate(id);
  const remove = departmentConfig.queries.useRemove();
  const { data: branches = [] } = useBranchOptions();

  const [confirming, setConfirming] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || department === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const branch = branches.find((b) => b.id === department.branchId);
  const nextStatus = department.status === 'active' ? 'inactive' : 'active';

  const toggleStatus = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: nextStatus, version: department.version });
      toast.success(
        t(`organization.department.${nextStatus === 'active' ? 'activated' : 'deactivated'}`),
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      // other errors surface globally
    }
  };

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(department.id);
      toast.success(t('organization.department.deleted'));
      navigate(departmentConfig.routeBase);
    } catch (e) {
      setConfirming(false);
      if (e instanceof ApiError && e.code === 'ORG_UNIT_HAS_CHILDREN') {
        toast.error(t('organization.delete.hasChildren'));
      } else {
        toast.error(t('organization.delete.failed'));
      }
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={localized(department.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.departments'), to: departmentConfig.routeBase },
          { label: department.code },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission="department.edit">
              <Button
                size="sm"
                variant={department.status === 'active' ? 'ghost' : 'secondary'}
                loading={update.isPending}
                onClick={() => void toggleStatus()}
              >
                {t(
                  department.status === 'active'
                    ? 'organization.action.deactivate'
                    : 'organization.action.activate',
                )}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission="department.delete">
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">
          {department.code}
        </span>
        <StatusBadge
          tone={department.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${department.status}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('organization.detail.identity')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.field.code')}>
                <span className="font-mono" dir="ltr">
                  {department.code}
                </span>
              </Row>
              <Row label={t('organization.department.nameAr')}>
                <span dir="rtl">{department.name.ar}</span>
              </Row>
              <Row label={t('organization.department.nameEn')}>
                <span dir="ltr">{department.name.en}</span>
              </Row>
              <Row label={t('organization.field.description')}>
                {department.description === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span>{localized(department.description, locale)}</span>
                )}
              </Row>
              <Row label={t('organization.field.manager')}>
                <UserName userId={department.managerId} />
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('organization.detail.placement')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.field.branch')}>
                <Link
                  to={`/organization/branches/${department.branchId}`}
                  className="text-brand-600 hover:underline"
                >
                  {branch === undefined ? department.branchId : localized(branch.name, locale)}
                </Link>
              </Row>
              <Row label={t('organization.field.path')}>
                <span className="font-mono text-xs text-slate-400" dir="ltr">
                  {department.path}
                </span>
              </Row>
              <Row label={t('organization.field.created')}>{formatDateTime(department.createdAt, locale)}</Row>
              <Row label={t('organization.field.updated')}>{formatDateTime(department.updatedAt, locale)}</Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('organization.department.deleteTitle')}
        description={t('organization.delete.confirm', { name: localized(department.name, locale) })}
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
