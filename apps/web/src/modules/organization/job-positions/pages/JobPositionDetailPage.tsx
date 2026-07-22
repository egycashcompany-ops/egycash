// Job Position detail. Shows identity (ar/en name, description, status) and placement (the owning
// Department — required — and the optional Section), plus the actions: Edit, Activate/Deactivate
// (version-checked) and soft Delete. The owning Department is fixed at creation (the edit form omits
// it); the Section is optional and editable.
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
import { useDepartmentOptions, useSectionOptions } from '../../shared/references';
import { useDeleteJobPosition, useJobPosition, useUpdateJobPosition } from '../job-position-queries';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const JobPositionDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();

  const { data: position, isLoading, isError, error, refetch } = useJobPosition(id);
  const update = useUpdateJobPosition(id);
  const remove = useDeleteJobPosition();
  const { data: departments = [] } = useDepartmentOptions(undefined);
  const { data: sections = [] } = useSectionOptions(undefined);

  const [confirming, setConfirming] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || position === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const department = departments.find((d) => d.id === position.departmentId);
  const section = position.sectionId === null ? undefined : sections.find((s) => s.id === position.sectionId);
  const nextStatus = position.status === 'active' ? 'inactive' : 'active';

  const toggleStatus = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: nextStatus, version: position.version });
      toast.success(
        t(`organization.jobPosition.${nextStatus === 'active' ? 'activated' : 'deactivated'}`),
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      // other errors surface globally
    }
  };

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(position.id);
      toast.success(t('organization.jobPosition.deleted'));
      navigate('/organization/job-positions');
    } catch {
      setConfirming(false);
      toast.error(t('organization.delete.failed'));
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={localized(position.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.jobPositions'), to: '/organization/job-positions' },
          { label: localized(position.name, locale) },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission="jobPosition.edit">
              <Button
                size="sm"
                variant={position.status === 'active' ? 'ghost' : 'secondary'}
                loading={update.isPending}
                onClick={() => void toggleStatus()}
              >
                {t(
                  position.status === 'active'
                    ? 'organization.action.deactivate'
                    : 'organization.action.activate',
                )}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission="jobPosition.delete">
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge
          tone={position.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${position.status}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('organization.detail.identity')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.jobPosition.nameAr')}>
                <span dir="rtl">{position.name.ar}</span>
              </Row>
              <Row label={t('organization.jobPosition.nameEn')}>
                <span dir="ltr">{position.name.en}</span>
              </Row>
              <Row label={t('organization.field.description')}>
                {position.description === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span>{localized(position.description, locale)}</span>
                )}
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('organization.detail.placement')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.field.department')}>
                <Link
                  to={`/organization/departments/${position.departmentId}`}
                  className="text-brand-600 hover:underline"
                >
                  {department === undefined ? position.departmentId : localized(department.name, locale)}
                </Link>
              </Row>
              <Row label={t('organization.field.section')}>
                {position.sectionId === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <Link
                    to={`/organization/sections/${position.sectionId}`}
                    className="text-brand-600 hover:underline"
                  >
                    {section === undefined ? position.sectionId : localized(section.name, locale)}
                  </Link>
                )}
              </Row>
              <Row label={t('organization.field.created')}>{formatDateTime(position.createdAt, locale)}</Row>
              <Row label={t('organization.field.updated')}>{formatDateTime(position.updatedAt, locale)}</Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('organization.jobPosition.deleteTitle')}
        description={t('organization.delete.confirm', { name: localized(position.name, locale) })}
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
