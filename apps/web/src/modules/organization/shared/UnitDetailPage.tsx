// Generic Branch/Department/Section detail: identity + hierarchy links, manager, address (branches),
// and the permission-gated edit / delete actions. Delete is version-independent (soft delete) and
// the server guards against removing a unit that still has children — surfaced as a toast.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { StatusBadge } from '../../../shared/ui/Badge';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../shared/lib/api-client';
import { formatDateTime, localized } from '../../../shared/lib/format';
import { UserName } from './UserPicker';
import { useBranchOptions, useDepartmentOptions } from './references';
import { type AnyUnitDto } from './org-unit-resource';
import { type UnitConfig } from './unit-config';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const UnitDetailPage = <TDto extends AnyUnitDto>({
  config,
}: {
  config: UnitConfig<TDto>;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: u, isLoading, isError, error, refetch } = config.queries.useOne(id);
  const remove = config.queries.useRemove();
  const [confirming, setConfirming] = useState(false);

  const wantsBranch = config.parents.includes('branch');
  const wantsDept = config.parents.includes('department');
  const { data: branches = [] } = useBranchOptions(wantsBranch);
  const { data: departments = [] } = useDepartmentOptions(undefined, wantsDept);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || u === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const branchLabel = branches.find((b) => b.id === u.branchId);
  const deptLabel = departments.find((d) => d.id === u.departmentId);

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(u.id);
      toast.success(t(`organization.${config.entity}.deleted`));
      navigate(config.routeBase);
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
        title={localized(u.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t(`organization.nav.${config.feature}`), to: config.routeBase },
          { label: u.code },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission={`${config.entity}.edit`}>
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission={`${config.entity}.delete`}>
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">
          {u.code}
        </span>
        <StatusBadge
          tone={u.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${u.status}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('organization.detail.identity')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={`${t('organization.field.name')} (${t('organization.lang.ar')})`}>
                <span dir="rtl">{u.name.ar}</span>
              </Row>
              <Row label={`${t('organization.field.name')} (${t('organization.lang.en')})`}>
                <span dir="ltr">{u.name.en}</span>
              </Row>
              <Row label={t('organization.field.manager')}>
                <UserName userId={u.managerId} />
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('organization.detail.placement')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              {wantsBranch && (
                <Row label={t('organization.nav.branches')}>
                  <Link to={`/organization/branches/${u.branchId ?? ''}`} className="text-brand-600 hover:underline">
                    {branchLabel === undefined ? (u.branchId ?? '—') : localized(branchLabel.name, locale)}
                  </Link>
                </Row>
              )}
              {wantsDept && (
                <Row label={t('organization.nav.departments')}>
                  <Link
                    to={`/organization/departments/${u.departmentId ?? ''}`}
                    className="text-brand-600 hover:underline"
                  >
                    {deptLabel === undefined ? (u.departmentId ?? '—') : localized(deptLabel.name, locale)}
                  </Link>
                </Row>
              )}
              {config.hasAddress && u.address != null && (
                <Row label={t('organization.field.address')}>
                  <span>
                    {[u.address.line1, u.address.line2, u.address.city, u.address.governorate, u.address.postalCode]
                      .filter((p) => p !== undefined && p !== '')
                      .join('، ')}
                  </span>
                </Row>
              )}
              <Row label={t('organization.field.path')}>
                <span className="font-mono text-xs text-slate-400" dir="ltr">
                  {u.path}
                </span>
              </Row>
              <Row label={t('organization.field.created')}>{formatDateTime(u.createdAt, locale)}</Row>
              <Row label={t('organization.field.updated')}>{formatDateTime(u.updatedAt, locale)}</Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t(`organization.${config.entity}.deleteTitle`)}
        description={t('organization.delete.confirm', { name: localized(u.name, locale) })}
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
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('organization.delete.body')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
