// Application detail. Shows the application definition (ar/en name, icon, client route, category,
// sort order, status) and the actions: Edit, Activate/Deactivate (version-checked) and soft Delete.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { useApplication, useDeleteApplication, useUpdateApplication } from '../application-queries';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const ApplicationDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const { id = '' } = useParams();

  const { data: application, isLoading, isError, error, refetch } = useApplication(id);
  const update = useUpdateApplication(id);
  const remove = useDeleteApplication();

  const [confirming, setConfirming] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || application === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const nextStatus = application.status === 'active' ? 'inactive' : 'active';

  const toggleStatus = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: nextStatus, version: application.version });
      toast.success(
        t(`organization.application.${nextStatus === 'active' ? 'activated' : 'deactivated'}`),
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') toast.error(t('organization.form.stale'));
      // other errors surface globally
    }
  };

  const doDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(application.id);
      toast.success(t('organization.application.deleted'));
      navigate('/organization/applications');
    } catch {
      setConfirming(false);
      toast.error(t('organization.delete.failed'));
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={localized(application.name, locale)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t('organization.nav.applications'), to: '/organization/applications' },
          { label: localized(application.name, locale) },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Can permission="application.edit">
              <Button
                size="sm"
                variant={application.status === 'active' ? 'ghost' : 'secondary'}
                loading={update.isPending}
                onClick={() => void toggleStatus()}
              >
                {t(
                  application.status === 'active'
                    ? 'organization.action.deactivate'
                    : 'organization.action.activate',
                )}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('edit')}>
                {t('common.edit')}
              </Button>
            </Can>
            <Can permission="application.delete">
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                {t('common.delete')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge
          tone={application.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${application.status}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('organization.detail.identity')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.application.nameAr')}>
                <span dir="rtl">{application.name.ar}</span>
              </Row>
              <Row label={t('organization.application.nameEn')}>
                <span dir="ltr">{application.name.en}</span>
              </Row>
              <Row label={t('organization.application.icon')}>
                <span className="font-mono text-xs" dir="ltr">
                  {application.icon}
                </span>
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('organization.application.navigation')} />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label={t('organization.application.route')}>
                <span className="font-mono text-xs" dir="ltr">
                  {application.route}
                </span>
              </Row>
              <Row label={t('organization.application.category')}>{application.category}</Row>
              <Row label={t('organization.application.sortOrder')}>{application.sortOrder}</Row>
              <Row label={t('organization.field.created')}>{formatDateTime(application.createdAt, locale)}</Row>
              <Row label={t('organization.field.updated')}>{formatDateTime(application.updatedAt, locale)}</Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('organization.application.deleteTitle')}
        description={t('organization.delete.confirm', { name: localized(application.name, locale) })}
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
