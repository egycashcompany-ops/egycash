// Section detail (Phase 3.3). Shows identity (Code, ar/en name, description, manager), placement
// (the owning Department and its Branch — each section belongs to exactly one department — plus path
// and audit timestamps), and the section actions: Edit, Activate/Deactivate (version-checked) and
// Delete (soft). The Section Code is immutable after creation (the update schema omits it).
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
import { useBranchOptions, useDepartmentOptions } from '../../shared/references';
import { sectionConfig } from '../../shared/unit-config';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const SectionDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();

  const { data: section, isLoading, isError, error, refetch } = sectionConfig.queries.useOne(id);
  const update = sectionConfig.queries.useUpdate(id);
  const remove = sectionConfig.queries.useRemove();
  const { data: branches = [] } = useBranchOptions();
  const { data: departments = [] } = useDepartmentOptions(undefined);

  const [confirming, setConfirming] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || section === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const branch = branches.find((b) => b.id === section.branchId);
  const department = departments.find((d) => d.id === section.departmentId);
  const nextStatus = section.status === 'active' ? 'inactive' : 'active';

  const toggleStatus = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: nextStatus, version: section.version });
      toast.success(t(`organization.section.${nextStatus === 'active' ? 'activated' : 'deactivated'}`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      // other errors surface globally
    }
  };

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(section.id);
      toast.success(t('organization.section.deleted'));
      navigate(sectionConfig.routeBase);
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
        title={localized(section.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.sections'), to: sectionConfig.routeBase },
          { label: section.code },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission="section.edit">
              <Button
                size="sm"
                variant={section.status === 'active' ? 'ghost' : 'secondary'}
                loading={update.isPending}
                onClick={() => void toggleStatus()}
              >
                {t(
                  section.status === 'active'
                    ? 'organization.action.deactivate'
                    : 'organization.action.activate',
                )}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission="section.delete">
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-slate-500" dir="ltr">
          {section.code}
        </span>
        <StatusBadge
          tone={section.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${section.status}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('organization.detail.identity')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.field.code')}>
                <span className="font-mono" dir="ltr">
                  {section.code}
                </span>
              </Row>
              <Row label={t('organization.section.nameAr')}>
                <span dir="rtl">{section.name.ar}</span>
              </Row>
              <Row label={t('organization.section.nameEn')}>
                <span dir="ltr">{section.name.en}</span>
              </Row>
              <Row label={t('organization.field.description')}>
                {section.description === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span>{localized(section.description, locale)}</span>
                )}
              </Row>
              <Row label={t('organization.field.manager')}>
                <UserName userId={section.managerId} />
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
                  to={`/organization/branches/${section.branchId}`}
                  className="text-brand-600 hover:underline"
                >
                  {branch === undefined ? section.branchId : localized(branch.name, locale)}
                </Link>
              </Row>
              <Row label={t('organization.field.department')}>
                <Link
                  to={`/organization/departments/${section.departmentId}`}
                  className="text-brand-600 hover:underline"
                >
                  {department === undefined ? section.departmentId : localized(department.name, locale)}
                </Link>
              </Row>
              <Row label={t('organization.field.path')}>
                <span className="font-mono text-xs text-slate-400" dir="ltr">
                  {section.path}
                </span>
              </Row>
              <Row label={t('organization.field.created')}>{formatDateTime(section.createdAt, locale)}</Row>
              <Row label={t('organization.field.updated')}>{formatDateTime(section.updatedAt, locale)}</Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('organization.section.deleteTitle')}
        description={t('organization.delete.confirm', { name: localized(section.name, locale) })}
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
